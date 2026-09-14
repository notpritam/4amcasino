import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SponsorCampaign, SponsorPlacement } from '@4am/shared';
import type { DB } from './db.js';
import { AgentError } from './agentAccess.js';
import { requirePlatform } from './platform.js';

const MAX_CHIPS = 1_000_000_000;
const chips = z.number().int().min(0).max(MAX_CHIPS);
const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const placementSchema = z.enum(['directory', 'tournament', 'watch']);
const plainText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
      'Use plain text without HTML or control characters.',
    );

/** Destination links are never fetched by the server. Block local host names
 * and non-public IP literals, including URL-normalized numeric IPv4 forms. */
function safeDestination(value: string): boolean {
  try {
    if (/[\u0000-\u0020\u007f\\]/.test(value)) return false;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/^\[|\]$/g, '');
    if (isIP(host) === 4) {
      const [a = 0, b = 0, c = 0] = host.split('.').map(Number);
      return !(
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
        (a === 203 && b === 0 && c === 113)
      );
    }
    if (isIP(host) === 6) {
      // Global unicast only; exclude transition/documentation ranges as well.
      return /^[23][0-9a-f]{3}:/.test(host) && !/^(2001:(?:0:|db8:|10:|20:)|2002:)/.test(host);
    }
    if (
      !host.includes('.') ||
      /(^|\.)(localhost|localdomain|local|internal|lan|home|arpa|onion)$/.test(host)
    )
      return false;
    return (
      host.length <= 253 &&
      host
        .split('.')
        .every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    );
  } catch {
    return false;
  }
}

const campaignFields = {
  tournamentId: identifier.nullable(),
  name: plainText(100).refine((value) => value.length > 0, 'A sponsor name is required.'),
  headline: plainText(160).refine((value) => value.length > 0, 'A headline is required.'),
  description: plainText(500),
  destinationUrl: z
    .string()
    .trim()
    .max(2048)
    .refine(safeDestination, 'Use a public HTTPS destination without credentials.'),
  placement: placementSchema,
  startsAt: timestamp,
  endsAt: timestamp,
  active: z.boolean(),
  bookedAmount: chips,
  note: plainText(2000),
};
const validWindow = (input: { startsAt: number; endsAt: number }) => input.endsAt > input.startsAt;
const campaignSchema = z
  .object(campaignFields)
  .strict()
  .refine(validWindow, 'End time must be after start time.');
const editSchema = z
  .object({ ...campaignFields, revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) })
  .strict()
  .refine(validWindow, 'End time must be after start time.');
const receiptSchema = z
  .object({
    requestId: identifier,
    amount: chips.refine((amount) => amount > 0, 'Receipt amount must be positive whole chips.'),
    prizeContribution: chips,
    tournamentId: identifier.nullable().default(null),
    note: plainText(2000),
  })
  .strict()
  .refine(
    (input) => input.prizeContribution <= input.amount,
    'Prize contribution cannot exceed receipt amount.',
  );
const revisionSchema = z
  .object({ revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })
  .strict();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AgentError(400, result.error.issues[0]?.message ?? 'Invalid sponsor input.');
  return result.data;
}

export function initializeSponsors(db: DB): void {
  db.transaction(() =>
    db.exec(`
    CREATE TABLE IF NOT EXISTS sponsor_campaigns (
      id TEXT PRIMARY KEY, tournament_id TEXT REFERENCES tournaments(id),
      name TEXT NOT NULL, headline TEXT NOT NULL, description TEXT NOT NULL,
      destination_url TEXT NOT NULL, placement TEXT NOT NULL CHECK (placement IN ('directory', 'tournament', 'watch')),
      starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL CHECK (ends_at > starts_at),
      active INTEGER NOT NULL CHECK (active IN (0, 1)),
      booked_amount INTEGER NOT NULL CHECK (typeof(booked_amount) = 'integer' AND booked_amount BETWEEN 0 AND ${MAX_CHIPS}),
      note TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id), updated_by INTEGER NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS sponsor_receipts (
      id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES sponsor_campaigns(id),
      request_id TEXT NOT NULL, request_json TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount BETWEEN 1 AND ${MAX_CHIPS}),
      prize_contribution INTEGER NOT NULL CHECK (typeof(prize_contribution) = 'integer' AND prize_contribution BETWEEN 0 AND amount),
      tournament_id TEXT REFERENCES tournaments(id), note TEXT NOT NULL,
      recorded_at INTEGER NOT NULL, recorded_by INTEGER NOT NULL REFERENCES users(id),
      unit TEXT NOT NULL DEFAULT 'chips' CHECK (unit = 'chips'),
      method TEXT NOT NULL DEFAULT 'manual' CHECK (method = 'manual'),
      CHECK (prize_contribution = 0 OR tournament_id IS NOT NULL),
      UNIQUE (campaign_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS sponsor_active_placements ON sponsor_campaigns (placement, active, starts_at, ends_at);
    CREATE TRIGGER IF NOT EXISTS sponsor_receipts_immutable_update BEFORE UPDATE ON sponsor_receipts BEGIN
      SELECT RAISE(ABORT, 'Sponsor receipts are immutable.');
    END;
    CREATE TRIGGER IF NOT EXISTS sponsor_receipts_immutable_delete BEFORE DELETE ON sponsor_receipts BEGIN
      SELECT RAISE(ABORT, 'Sponsor receipts are immutable.');
    END;
    CREATE TRIGGER IF NOT EXISTS sponsor_receipts_booking_limit BEFORE INSERT ON sponsor_receipts
    WHEN NEW.amount + (SELECT COALESCE(SUM(amount), 0) FROM sponsor_receipts WHERE campaign_id = NEW.campaign_id)
      > (SELECT booked_amount FROM sponsor_campaigns WHERE id = NEW.campaign_id) BEGIN
      SELECT RAISE(ABORT, 'Recorded receipts cannot exceed booked chips.');
    END;
    CREATE TRIGGER IF NOT EXISTS sponsor_campaigns_booking_limit BEFORE UPDATE OF booked_amount ON sponsor_campaigns
    WHEN NEW.booked_amount < (SELECT COALESCE(SUM(amount), 0) FROM sponsor_receipts WHERE campaign_id = OLD.id) BEGIN
      SELECT RAISE(ABORT, 'Booked chips cannot be less than recorded receipts.');
    END;
  `),
  ).immediate();
}

const publicColumns = `c.id, c.tournament_id AS tournamentId, c.name, c.headline, c.description,
  c.destination_url AS destinationUrl, c.placement, c.starts_at AS startsAt, c.ends_at AS endsAt, c.active`;
const campaignColumns = `${publicColumns}, c.booked_amount AS bookedAmount, c.note, c.revision,
  (SELECT COALESCE(SUM(r.amount), 0) FROM sponsor_receipts r WHERE r.campaign_id = c.id) AS receivedAmount,
  (SELECT COALESCE(SUM(r.prize_contribution), 0) FROM sponsor_receipts r WHERE r.campaign_id = c.id) AS prizeContribution`;
type StoredCampaign = Omit<SponsorCampaign, 'active'> & { active: number };
type StoredPlacement = Omit<SponsorPlacement, 'active'> & { active: number };

function getCampaign(db: DB, id: string): SponsorCampaign {
  const row = db
    .prepare(`SELECT ${campaignColumns} FROM sponsor_campaigns c WHERE c.id = ?`)
    .get(id) as StoredCampaign | undefined;
  if (!row) throw new AgentError(404, 'Sponsor campaign not found.');
  return { ...row, active: !!row.active };
}

export function sponsorOverview(db: DB): {
  campaigns: SponsorCampaign[];
  totals: { booked: number; received: number; prizeContributions: number };
} {
  const rows = db
    .prepare(`SELECT ${campaignColumns} FROM sponsor_campaigns c ORDER BY c.created_at DESC, c.id`)
    .all() as StoredCampaign[];
  const campaigns = rows.map((row) => ({ ...row, active: !!row.active }));
  return {
    campaigns,
    totals: campaigns.reduce(
      (totals, campaign) => ({
        booked: totals.booked + campaign.bookedAmount,
        received: totals.received + campaign.receivedAmount,
        prizeContributions: totals.prizeContributions + campaign.prizeContribution,
      }),
      { booked: 0, received: 0, prizeContributions: 0 },
    ),
  };
}

interface TargetTournament {
  status: string;
  approval_status: string;
  policy_json: string;
}
function targetTournament(db: DB, id: string): TargetTournament | undefined {
  return db
    .prepare('SELECT status, approval_status, policy_json FROM tournaments WHERE id = ?')
    .get(id) as TargetTournament | undefined;
}
function publicTarget(db: DB, id: string, watch: boolean): boolean {
  const tournament = targetTournament(db, id);
  if (!tournament || tournament.approval_status !== 'approved') return false;
  if (!watch) return true;
  // Legacy tournaments predate stored policies and keep their public-watch default.
  if (tournament.policy_json === '') return true;
  try {
    const policy: unknown = JSON.parse(tournament.policy_json);
    return (
      !!policy &&
      typeof policy === 'object' &&
      'publicWatch' in policy &&
      policy.publicWatch === true
    );
  } catch {
    return false;
  }
}

/** Explicit projection: public queries never load finance, notes, or receipts. */
export function sponsorPlacements(
  db: DB,
  placement: SponsorPlacement['placement'],
  tournamentId?: string,
): SponsorPlacement[] {
  if (
    (placement !== 'directory' && !tournamentId) ||
    (tournamentId && !publicTarget(db, tournamentId, placement === 'watch'))
  )
    return [];
  const now = Date.now();
  const rows = db
    .prepare(
      `SELECT ${publicColumns} FROM sponsor_campaigns c
    WHERE c.placement = ? AND c.active = 1 AND c.starts_at <= ? AND c.ends_at > ?
      AND (c.tournament_id IS NULL OR ? IS NULL OR c.tournament_id = ?)
    ORDER BY c.created_at, c.id`,
    )
    .all(placement, now, now, tournamentId ?? null, tournamentId ?? null) as StoredPlacement[];
  return rows
    .filter((row) => !row.tournamentId || publicTarget(db, row.tournamentId, placement === 'watch'))
    .map((row) => ({ ...row, active: !!row.active }));
}

interface SponsorReceipt {
  id: string;
  requestId: string;
  amount: number;
  prizeContribution: number;
  tournamentId: string | null;
  note: string;
  recordedAt: number;
  recordedBy: number;
  unit: 'chips';
  method: 'manual';
}
const receiptColumns = `id, request_id AS requestId, amount, prize_contribution AS prizeContribution,
  tournament_id AS tournamentId, note, recorded_at AS recordedAt, recorded_by AS recordedBy, unit, method`;
function campaignValues(input: z.infer<typeof campaignSchema>) {
  return [
    input.tournamentId,
    input.name,
    input.headline,
    input.description,
    input.destinationUrl,
    input.placement,
    input.startsAt,
    input.endsAt,
    Number(input.active),
    input.bookedAmount,
    input.note,
  ];
}
function ensureCampaignTarget(db: DB, id: string | null): void {
  if (id && !targetTournament(db, id)) throw new AgentError(404, 'Tournament not found.');
}

/** The contribution callback must synchronously write the balanced tournament
 * journal using this same database connection. It runs inside the receipt's
 * IMMEDIATE transaction, so errors roll back both records. No payment is made. */
export function registerSponsors(
  app: FastifyInstance,
  db: DB,
  contribute: (tournamentId: string, amount: number, ref: string) => void,
): void {
  const admin = requirePlatform(db);
  app.get('/api/sponsors', async (req) => {
    const query = parse(
      z.object({ placement: placementSchema, tournamentId: identifier.optional() }).strict(),
      req.query,
    );
    return { placements: sponsorPlacements(db, query.placement, query.tournamentId) };
  });
  app.get('/api/admin/sponsors', { preHandler: admin }, async () => sponsorOverview(db));
  app.post('/api/admin/sponsors', { preHandler: admin }, async (req, reply) => {
    const input = parse(campaignSchema, req.body);
    const campaign = db
      .transaction(() => {
        ensureCampaignTarget(db, input.tournamentId);
        const id = randomUUID();
        const now = Date.now();
        db.prepare(
          `INSERT INTO sponsor_campaigns
        (id, tournament_id, name, headline, description, destination_url, placement, starts_at, ends_at,
         active, booked_amount, note, created_at, updated_at, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, ...campaignValues(input), now, now, req.userId, req.userId);
        return getCampaign(db, id);
      })
      .immediate();
    return reply.code(201).send(campaign);
  });
  app.put('/api/admin/sponsors/:id', { preHandler: admin }, async (req) => {
    const { id } = parse(z.object({ id: identifier }), req.params);
    const input = parse(editSchema, req.body);
    return db
      .transaction(() => {
        const current = getCampaign(db, id);
        if (input.revision !== current.revision)
          throw new AgentError(409, 'The sponsor campaign changed. Reload before saving.');
        if (input.bookedAmount < current.receivedAmount)
          throw new AgentError(409, 'Booked chips cannot be less than recorded receipts.');
        ensureCampaignTarget(db, input.tournamentId);
        db.prepare(
          `UPDATE sponsor_campaigns SET tournament_id = ?, name = ?, headline = ?, description = ?,
        destination_url = ?, placement = ?, starts_at = ?, ends_at = ?, active = ?, booked_amount = ?, note = ?,
        revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?`,
        ).run(...campaignValues(input), Date.now(), req.userId, id);
        return getCampaign(db, id);
      })
      .immediate();
  });
  app.delete('/api/admin/sponsors/:id', { preHandler: admin }, async (req) => {
    const { id } = parse(z.object({ id: identifier }), req.params);
    const input = parse(revisionSchema, req.body);
    return db
      .transaction(() => {
        const current = getCampaign(db, id);
        if (input.revision !== current.revision)
          throw new AgentError(409, 'The sponsor campaign changed. Reload before deleting.');
        if (current.receivedAmount > 0)
          throw new AgentError(
            409,
            'Campaigns with receipts cannot be deleted. Disable the placement instead.',
          );
        db.prepare('DELETE FROM sponsor_campaigns WHERE id = ?').run(id);
        return { ok: true };
      })
      .immediate();
  });
  app.post('/api/admin/sponsors/:id/receipts', { preHandler: admin }, async (req, reply) => {
    const { id } = parse(z.object({ id: identifier }), req.params);
    const input = parse(receiptSchema, req.body);
    const result = db
      .transaction(() => {
        const current = getCampaign(db, id);
        const requestJson = JSON.stringify(input);
        const previous = db
          .prepare(
            `SELECT ${receiptColumns}, request_json AS requestJson FROM sponsor_receipts
        WHERE campaign_id = ? AND request_id = ?`,
          )
          .get(id, input.requestId) as (SponsorReceipt & { requestJson: string }) | undefined;
        if (previous) {
          if (previous.requestJson !== requestJson)
            throw new AgentError(409, 'This request ID was used for a different sponsor receipt.');
          const { requestJson: _privateRequest, ...receipt } = previous;
          return { campaign: current, receipt, replayed: true };
        }
        if (current.receivedAmount + input.amount > current.bookedAmount) {
          throw new AgentError(
            409,
            'Recorded receipts cannot exceed booked chips. Update the booking first.',
          );
        }
        const tournamentId =
          input.tournamentId ?? (input.prizeContribution > 0 ? current.tournamentId : null);
        if (input.prizeContribution > 0 && !tournamentId)
          throw new AgentError(400, 'Select a tournament for the prize contribution.');
        if (tournamentId) {
          const tournament = targetTournament(db, tournamentId);
          if (!tournament) throw new AgentError(404, 'Tournament not found.');
          if (
            input.prizeContribution > 0 &&
            (tournament.approval_status !== 'approved' ||
              !['registration', 'running', 'paused'].includes(tournament.status))
          ) {
            throw new AgentError(
              409,
              'Prize contributions require an approved tournament in registration or play.',
            );
          }
        }
        const receiptId = randomUUID();
        const now = Date.now();
        db.prepare(
          `INSERT INTO sponsor_receipts
        (id, campaign_id, request_id, request_json, amount, prize_contribution, tournament_id, note, recorded_at, recorded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          receiptId,
          id,
          input.requestId,
          requestJson,
          input.amount,
          input.prizeContribution,
          tournamentId,
          input.note,
          now,
          req.userId,
        );
        if (input.prizeContribution > 0 && tournamentId)
          contribute(tournamentId, input.prizeContribution, `sponsor:${receiptId}`);
        db.prepare(
          'UPDATE sponsor_campaigns SET revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?',
        ).run(now, req.userId, id);
        const receipt = db
          .prepare(`SELECT ${receiptColumns} FROM sponsor_receipts WHERE id = ?`)
          .get(receiptId) as SponsorReceipt;
        return { campaign: getCampaign(db, id), receipt, replayed: false };
      })
      .immediate();
    return reply.code(result.replayed ? 200 : 201).send(result);
  });
}
