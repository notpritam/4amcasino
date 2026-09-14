import { z } from 'zod';
import { DEFAULT_TOURNAMENT_POLICY, type TournamentPolicy } from '@4am/shared';
import type { DB } from './db.js';
import { AgentError } from './agentAccess.js';

export interface Tournament {
  id: string;
  owner_id: number;
  name: string;
  description: string;
  status: string;
  capacity: number;
  hand_limit: number;
  starting_stack: number;
  sb: number;
  bb: number;
  action_seconds: number;
  prize_description: string;
  rules: string;
  seed: string;
  completed_hands: number;
  round_json: string | null;
  deadline: number | null;
  last_result: string | null;
  created_at: number;
  updated_at: number;
  approval_status: 'approved' | 'pending' | 'rejected';
  policy_json: string;
  revision: number;
  terms_locked: number;
  review_note: string;
  schedule_note: string;
}
export const tournamentInput = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().max(2000).default(''),
  capacity: z.number().int().min(2).max(9).default(6),
  handLimit: z.number().int().min(10).max(10000).default(1000),
  startingStack: z.number().int().min(100).max(1000000).default(2000),
  sb: z.number().int().min(1).max(10000).default(10),
  bb: z.number().int().min(2).max(20000).default(20),
  actionSeconds: z.number().int().min(10).max(300).default(60),
  prizeDescription: z.string().max(1000).default(''),
  rules: z.string().max(4000).default(''),
});
const amount = z.number().int().min(0).max(1_000_000_000);
/** Mirrors the arena stack ceiling in packages/shared/src/arena.ts. */
export const MAX_FREEZEOUT_STACK = 1_000_000;
export function safeBroadcastUrl(value: string, meet = false): boolean {
  if (!value) return true;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    return meet
      ? u.hostname === 'meet.google.com'
      : ['youtube.com', 'www.youtube.com', 'youtu.be', 'twitch.tv', 'www.twitch.tv'].includes(
          u.hostname,
        );
  } catch {
    return false;
  }
}
export const tournamentPolicyInput = z.object({
  format: z.enum(['fixed-hand-league', 'knockout', 'freezeout']),
  startsAt: z.number().int().safe().nonnegative().nullable(),
  entryFee: amount,
  joiningReward: amount,
  guaranteedPool: amount,
  houseBps: z.number().int().min(0).max(1000),
  prizeBps: z.number().int().min(0).max(1000),
  payoutBps: z.array(z.number().int().positive().max(10000)).min(1).max(9),
  blindEveryHands: z.number().int().min(1).max(10000),
  sitOutBudget: z.number().int().min(0).max(200),
  maxSitOutPerRequest: z.number().int().min(0).max(200),
  publicWatch: z.boolean(),
  revealAllAfterHand: z.literal(true),
  streamUrl: z
    .string()
    .max(1000)
    .refine((v) => safeBroadcastUrl(v)),
  meetUrl: z
    .string()
    .max(1000)
    .refine((v) => safeBroadcastUrl(v, true)),
});
export function parsePolicy(value: unknown, capacity: number, bb: number): TournamentPolicy {
  if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value)))
    throw new AgentError(400, 'Invalid tournament policy.');
  const obsolete = value as { bankerBps?: unknown; bankerUserId?: unknown } | undefined;
  if (
    (obsolete?.bankerBps !== undefined && obsolete.bankerBps !== 0) ||
    (obsolete?.bankerUserId !== undefined && obsolete.bankerUserId !== null)
  )
    throw new AgentError(400, 'Tournament cuts may only go to the house and prize pool.');
  const p = tournamentPolicyInput.safeParse({
    ...DEFAULT_TOURNAMENT_POLICY,
    ...((value as object) ?? {}),
  });
  if (!p.success)
    throw new AgentError(
      400,
      'Check tournament fees, payout percentages, schedule and broadcast links.',
    );
  if (p.data.payoutBps.reduce((a, b) => a + b, 0) !== 10000)
    throw new AgentError(400, 'Prize percentages must total 100%.');
  if (p.data.guaranteedPool < capacity * p.data.joiningReward)
    throw new AgentError(
      400,
      'The organizer guarantee must cover the joining reward for every seat.',
    );
  if (p.data.maxSitOutPerRequest > p.data.sitOutBudget)
    throw new AgentError(400, 'A single sit-out cannot exceed the whole sit-out budget.');
  // Freezeout seats an entrant with their entry fee, so the fee must be a stack the engine accepts.
  if (p.data.format === 'freezeout') {
    if (p.data.entryFee > MAX_FREEZEOUT_STACK)
      throw new AgentError(
        400,
        `A freezeout entry fee is the starting stack and cannot exceed ${MAX_FREEZEOUT_STACK} chips.`,
      );
    if (p.data.entryFee < 2 * bb)
      throw new AgentError(400, 'A freezeout entry fee must cover two big blinds.');
  }
  return p.data;
}
export function policyOf(t: Pick<Tournament, 'policy_json'>): TournamentPolicy {
  if (t.policy_json) {
    // Discard retired fields from pre-release saved policies as well as new writes.
    const { bankerBps: _rate, bankerUserId: _payee, ...policy } = JSON.parse(t.policy_json);
    return policy as TournamentPolicy;
  }
  return {
    ...DEFAULT_TOURNAMENT_POLICY,
    houseBps: 0,
    prizeBps: 0,
    revealAllAfterHand: false,
  };
}
export function getTournament(db: DB, id: string): Tournament {
  const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(id) as Tournament | undefined;
  if (!t) throw new AgentError(404, 'Tournament not found.');
  return t;
}
export function initializeTournamentOperations(db: DB): void {
  const cols = new Set(
    (db.prepare('PRAGMA table_info(tournaments)').all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, type] of Object.entries({
    approval_status: "TEXT NOT NULL DEFAULT 'approved'",
    policy_json: "TEXT NOT NULL DEFAULT ''",
    revision: 'INTEGER NOT NULL DEFAULT 0',
    terms_locked: 'INTEGER NOT NULL DEFAULT 0',
    review_note: "TEXT NOT NULL DEFAULT ''",
    schedule_note: "TEXT NOT NULL DEFAULT ''",
  }))
    if (!cols.has(name)) db.exec(`ALTER TABLE tournaments ADD COLUMN ${name} ${type}`);
  const entryCols = new Set(
    (db.prepare('PRAGMA table_info(tournament_entries)').all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  if (!entryCols.has('stack')) {
    db.exec('ALTER TABLE tournament_entries ADD COLUMN stack INTEGER NOT NULL DEFAULT 0');
    db.exec(
      'UPDATE tournament_entries SET stack=(SELECT starting_stack FROM tournaments WHERE id=tournament_id)',
    );
  }
  if (!entryCols.has('eliminated_hand'))
    db.exec('ALTER TABLE tournament_entries ADD COLUMN eliminated_hand INTEGER');
  if (!entryCols.has('accepted_revision'))
    db.exec(
      'ALTER TABLE tournament_entries ADD COLUMN accepted_revision INTEGER NOT NULL DEFAULT 0',
    );
  if (!entryCols.has('sat_out_hands'))
    db.exec('ALTER TABLE tournament_entries ADD COLUMN sat_out_hands INTEGER NOT NULL DEFAULT 0');
  if (!entryCols.has('sit_out_until_hand'))
    db.exec(
      'ALTER TABLE tournament_entries ADD COLUMN sit_out_until_hand INTEGER NOT NULL DEFAULT 0',
    );
  db.exec(`UPDATE tournaments SET terms_locked=1 WHERE EXISTS(SELECT 1 FROM tournament_entries WHERE tournament_id=tournaments.id);
    CREATE TABLE IF NOT EXISTS tournament_reviews(id INTEGER PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id), revision INTEGER NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL, actor_id INTEGER NOT NULL, ts INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS tournament_reviews_no_update BEFORE UPDATE ON tournament_reviews BEGIN SELECT RAISE(ABORT,'Tournament reviews are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS tournament_reviews_no_delete BEFORE DELETE ON tournament_reviews BEGIN SELECT RAISE(ABORT,'Tournament reviews are immutable'); END;`);
}
