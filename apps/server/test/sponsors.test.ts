import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { openDb, type DB } from '../src/db.js';
import { createSession, createUser } from '../src/auth.js';
import { setPlatformUserId } from '../src/platform.js';
import { AgentError } from '../src/agentAccess.js';
import {
  initializeSponsors,
  registerSponsors,
  sponsorOverview,
  sponsorPlacements,
} from '../src/sponsors.js';

let app: FastifyInstance;
let db: DB;
let adminId: number;
let admin: { authorization: string };
let member: { authorization: string };
let failContribution: boolean;
const now = Date.now();
const campaignInput = (overrides: Record<string, unknown> = {}) => ({
  tournamentId: null,
  name: 'Example sponsor',
  headline: 'Built for thoughtful play',
  description: 'A plain-text sponsor message.',
  destinationUrl: 'https://sponsor.example/product',
  placement: 'directory',
  startsAt: now - 60_000,
  endsAt: now + 3_600_000,
  active: true,
  bookedAmount: 1000,
  note: 'Private contact and negotiated terms',
  ...overrides,
});
const create = (overrides: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/admin/sponsors',
    headers: admin,
    payload: campaignInput(overrides),
  });
const receipt = (id: string, overrides: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/admin/sponsors/${id}/receipts`,
    headers: admin,
    payload: {
      requestId: 'receipt-1',
      amount: 400,
      prizeContribution: 0,
      note: 'Recorded by platform',
      ...overrides,
    },
  });
const update = (id: string, overrides: Record<string, unknown> = {}) =>
  app.inject({
    method: 'PUT',
    url: `/api/admin/sponsors/${id}`,
    headers: admin,
    payload: { ...campaignInput(), revision: 1, ...overrides },
  });
const publicPlacements = async (query = 'placement=directory') =>
  (await app.inject({ url: `/api/sponsors?${query}` })).json().placements;

beforeEach(() => {
  db = openDb(':memory:');
  // Keep this harness independent of createApp and the parent-owned migration wiring.
  const columns = new Set(
    (db.prepare('PRAGMA table_info(tournaments)').all() as { name: string }[]).map((c) => c.name),
  );
  if (!columns.has('approval_status'))
    db.exec("ALTER TABLE tournaments ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'");
  if (!columns.has('policy_json'))
    db.exec("ALTER TABLE tournaments ADD COLUMN policy_json TEXT NOT NULL DEFAULT '{}'");
  initializeSponsors(db);
  adminId = createUser(db, 'platform', 'a'.repeat(64), 'b'.repeat(64)).userId;
  const memberId = createUser(db, 'member', 'c'.repeat(64), 'd'.repeat(64)).userId;
  setPlatformUserId(db, adminId);
  admin = { authorization: `Bearer ${createSession(db, adminId)}` };
  member = { authorization: `Bearer ${createSession(db, memberId)}` };
  db.prepare(
    `INSERT INTO tournaments
    (id, owner_id, name, capacity, hand_limit, starting_stack, sb, bb, action_seconds, seed, created_at, updated_at, policy_json)
    VALUES ('event', ?, 'Public tournament', 9, 50, 1000, 5, 10, 30, 'private-seed', ?, ?, '{"publicWatch":true}')`,
  ).run(memberId, now, now);
  db.exec(
    'CREATE TABLE test_sponsor_journal (ref TEXT, account TEXT, amount INTEGER, tournament_id TEXT)',
  );
  failContribution = false;
  app = Fastify();
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AgentError)
      return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof ZodError) return reply.code(400).send({ error: 'invalid input' });
    return reply
      .code(500)
      .send({ error: error instanceof Error ? error.message : 'Sponsor failure' });
  });
  registerSponsors(app, db, (tournamentId, amount, ref) => {
    db.prepare('INSERT INTO test_sponsor_journal VALUES (?, ?, ?, ?)').run(
      ref,
      'sponsor',
      -amount,
      tournamentId,
    );
    if (failContribution) throw new Error('journal unavailable');
    db.prepare('INSERT INTO test_sponsor_journal VALUES (?, ?, ?, ?)').run(
      ref,
      'pool',
      amount,
      tournamentId,
    );
  });
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('sponsor administration', () => {
  it('requires the platform account for every administrative operation', async () => {
    const { id } = (await create()).json();
    const operations = [
      { method: 'GET' as const, url: '/api/admin/sponsors' },
      { method: 'POST' as const, url: '/api/admin/sponsors', payload: campaignInput() },
      {
        method: 'PUT' as const,
        url: `/api/admin/sponsors/${id}`,
        payload: { ...campaignInput(), revision: 1 },
      },
      {
        method: 'POST' as const,
        url: `/api/admin/sponsors/${id}/receipts`,
        payload: { requestId: 'r', amount: 1, prizeContribution: 0, note: '' },
      },
      { method: 'DELETE' as const, url: `/api/admin/sponsors/${id}`, payload: { revision: 1 } },
    ];
    for (const operation of operations) {
      expect((await app.inject(operation)).statusCode).toBe(401);
      expect((await app.inject({ ...operation, headers: member })).statusCode).toBe(403);
    }
  });

  it('persists campaigns through an idempotent initialization and uses current revisions', async () => {
    const created = await create();
    expect(created.statusCode).toBe(201);
    const first = created.json();
    expect(first).toMatchObject({ revision: 1, receivedAmount: 0, prizeContribution: 0 });
    initializeSponsors(db);
    const changed = await update(first.id, { active: false, bookedAmount: 1500 });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ active: false, bookedAmount: 1500, revision: 2 });
    expect((await update(first.id)).statusCode).toBe(409);
    expect(sponsorOverview(db)).toMatchObject({
      totals: { booked: 1500, received: 0, prizeContributions: 0 },
    });
  });

  it.each([-1, 0.5, 1_000_000_001, Number.MAX_SAFE_INTEGER + 1, '100', null])(
    'rejects non-whole or out-of-range booked chips: %s',
    async (bookedAmount) => {
      expect((await create({ bookedAmount })).statusCode).toBe(400);
    },
  );

  it('rejects server-owned fields and fake currency/payment metadata', async () => {
    for (const field of [
      { receivedAmount: 5 },
      { prizeContribution: 5 },
      { currency: 'USD' },
      { paymentStatus: 'paid' },
      { revision: 1 },
    ]) {
      expect((await create(field)).statusCode).toBe(400);
    }
    expect((await create({ bookedAmount: 0 })).statusCode).toBe(201);
  });

  it.each([
    'http://sponsor.example',
    'javascript:alert(1)',
    'https://user:password@sponsor.example',
    'https://localhost',
    'https://api.localhost',
    'https://router.local',
    'https://internal',
    'https://127.0.0.1',
    'https://2130706433',
    'https://0x7f000001',
    'https://10.0.0.1',
    'https://172.16.0.1',
    'https://192.168.0.1',
    'https://169.254.169.254',
    'https://100.64.1.1',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
    'https://[fc00::1]',
    'https://[fe80::1]',
  ])('rejects unsafe sponsor destinations: %s', async (destinationUrl) => {
    expect((await create({ destinationUrl })).statusCode).toBe(400);
  });

  it('rejects invalid windows and executable creative fields', async () => {
    for (const fields of [
      { startsAt: now + 5_000_000 },
      { endsAt: now - 60_000 },
      { startsAt: 1.5 },
      { headline: '<img onerror=alert(1)>' },
      { html: '<iframe></iframe>' },
    ]) {
      expect((await create(fields)).statusCode).toBe(400);
    }
  });

  it('permits deletion only before any immutable receipt has been recorded', async () => {
    const { id } = (await create()).json();
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/admin/sponsors/${id}`,
          headers: admin,
          payload: { revision: 0 },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/admin/sponsors/${id}`,
          headers: admin,
          payload: { revision: 1 },
        })
      ).statusCode,
    ).toBe(200);
    const second = (await create()).json();
    const saved = (await receipt(second.id)).json();
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/admin/sponsors/${second.id}`,
          headers: admin,
          payload: { revision: saved.campaign.revision },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await update(second.id, { revision: saved.campaign.revision, active: false })).statusCode,
    ).toBe(200);
  });
});

describe('manual sponsor receipts', () => {
  it('records immutable chip receipts exactly once and rejects changed retries', async () => {
    const { id } = (await create()).json();
    const first = await receipt(id);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      campaign: { receivedAmount: 400, revision: 2 },
      receipt: { unit: 'chips', method: 'manual', recordedBy: adminId },
      replayed: false,
    });
    const retry = await receipt(id);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({
      receipt: { id: first.json().receipt.id },
      replayed: true,
    });
    expect((await receipt(id, { amount: 401 })).statusCode).toBe(409);
    expect((await receipt(id, { note: 'changed' })).statusCode).toBe(409);
    expect(sponsorOverview(db).totals).toEqual({
      booked: 1000,
      received: 400,
      prizeContributions: 0,
    });
    expect(() => db.prepare('UPDATE sponsor_receipts SET amount = 1').run()).toThrow();
    expect(() => db.prepare('DELETE FROM sponsor_receipts').run()).toThrow();
  });

  it('cannot exceed booked chips without an explicit current-revision booking edit', async () => {
    const { id } = (await create()).json();
    await receipt(id, { amount: 1000 });
    expect((await receipt(id, { requestId: 'receipt-2', amount: 1 })).statusCode).toBe(409);
    expect((await update(id, { bookedAmount: 999, revision: 2 })).statusCode).toBe(409);
    expect((await update(id, { bookedAmount: 1200, revision: 2 })).statusCode).toBe(200);
    expect((await receipt(id, { requestId: 'receipt-2', amount: 200 })).statusCode).toBe(201);
    expect(sponsorOverview(db).totals.received).toBe(1200);
  });

  it('validates whole receipt chips and prize contribution bounds', async () => {
    const { id } = (await create()).json();
    for (const fields of [
      { amount: 0 },
      { amount: -1 },
      { amount: 1.5 },
      { amount: 1_000_000_001 },
      { amount: '10' },
      { prizeContribution: -1 },
      { prizeContribution: 0.5 },
      { prizeContribution: 401 },
      { currency: 'INR' },
      { processorConfirmed: true },
    ]) {
      expect((await receipt(id, fields)).statusCode).toBe(400);
    }
    expect(sponsorOverview(db).totals.received).toBe(0);
  });

  it('contributes to an approved open tournament without enrollment and replays after completion', async () => {
    const { id } = (await create({ tournamentId: 'event' })).json();
    const res = await receipt(id, { prizeContribution: 250 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      campaign: { receivedAmount: 400, prizeContribution: 250 },
      receipt: { tournamentId: 'event' },
    });
    expect(
      db.prepare('SELECT SUM(amount) AS total, COUNT(*) AS count FROM test_sponsor_journal').get(),
    ).toEqual({ total: 0, count: 2 });
    expect(
      db
        .prepare("SELECT SUM(amount) AS total FROM test_sponsor_journal WHERE account = 'pool'")
        .get(),
    ).toEqual({ total: 250 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM tournament_entries WHERE user_id = ?').get(adminId),
    ).toEqual({ count: 0 });
    db.prepare("UPDATE tournaments SET status = 'completed' WHERE id = 'event'").run();
    expect((await receipt(id, { prizeContribution: 250 })).statusCode).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS count FROM test_sponsor_journal').get()).toEqual({
      count: 2,
    });
  });

  it('requires a known approved active tournament before contributing', async () => {
    const { id } = (await create()).json();
    expect((await receipt(id, { prizeContribution: 1 })).statusCode).toBe(400);
    expect((await receipt(id, { prizeContribution: 1, tournamentId: 'missing' })).statusCode).toBe(
      404,
    );
    for (const [approval, status] of [
      ['pending', 'registration'],
      ['rejected', 'registration'],
      ['approved', 'completed'],
      ['approved', 'cancelled'],
    ]) {
      db.prepare('UPDATE tournaments SET approval_status = ?, status = ? WHERE id = ?').run(
        approval,
        status,
        'event',
      );
      expect((await receipt(id, { prizeContribution: 1, tournamentId: 'event' })).statusCode).toBe(
        409,
      );
    }
    expect(sponsorOverview(db).totals.received).toBe(0);
  });

  it('accepts running and paused tournaments and preserves retries after campaign edits', async () => {
    const { id } = (await create({ tournamentId: 'event' })).json();
    db.prepare("UPDATE tournaments SET status = 'running' WHERE id = 'event'").run();
    expect((await receipt(id, { prizeContribution: 100 })).statusCode).toBe(201);
    expect((await update(id, { tournamentId: null, revision: 2 })).statusCode).toBe(200);
    expect((await receipt(id, { prizeContribution: 100 })).statusCode).toBe(200);
    db.prepare("UPDATE tournaments SET status = 'paused' WHERE id = 'event'").run();
    expect(
      (await receipt(id, { requestId: 'paused', prizeContribution: 100, tournamentId: 'event' }))
        .statusCode,
    ).toBe(201);
    expect(sponsorOverview(db).totals.prizeContributions).toBe(200);
  });

  it('rolls the receipt, campaign revision and partial journal back together', async () => {
    const { id } = (await create()).json();
    failContribution = true;
    expect((await receipt(id, { prizeContribution: 250, tournamentId: 'event' })).statusCode).toBe(
      500,
    );
    expect(sponsorOverview(db).campaigns[0]).toMatchObject({
      receivedAmount: 0,
      prizeContribution: 0,
      revision: 1,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM test_sponsor_journal').get()).toEqual({
      count: 0,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM sponsor_receipts').get()).toEqual({
      count: 0,
    });
    failContribution = false;
    expect((await receipt(id, { prizeContribution: 250, tournamentId: 'event' })).statusCode).toBe(
      201,
    );
  });
});

describe('public sponsor placements', () => {
  it('publishes only safe creative without private finance, contacts, receipts or seeds', async () => {
    const { id } = (await create()).json();
    await receipt(id);
    const placements = await publicPlacements();
    expect(placements).toHaveLength(1);
    expect(Object.keys(placements[0]).sort()).toEqual(
      [
        'id',
        'tournamentId',
        'name',
        'headline',
        'description',
        'destinationUrl',
        'placement',
        'startsAt',
        'endsAt',
        'active',
      ].sort(),
    );
    expect(JSON.stringify(placements)).not.toMatch(
      /Private|Recorded|booked|received|prize|revision|seed|recordedBy/,
    );
    expect(sponsorPlacements(db, 'directory')).toEqual(placements);
  });

  it('honors runtime active and half-open date windows', async () => {
    await create({ name: 'Future', startsAt: now + 3_600_000, endsAt: now + 7_200_000 });
    await create({ name: 'Expired', startsAt: now - 3_600_000, endsAt: now - 1 });
    await create({ name: 'Disabled', active: false });
    const active = (await create({ name: 'Current' })).json();
    expect((await publicPlacements()).map((p: { name: string }) => p.name)).toEqual(['Current']);
    await update(active.id, { active: false });
    expect(await publicPlacements()).toEqual([]);
  });

  it('filters unpublished targets and respects public watch access for global and targeted ads', async () => {
    await create({ placement: 'watch' });
    await create({ placement: 'watch', tournamentId: 'event' });
    await create({ placement: 'tournament', tournamentId: 'event' });
    expect(await publicPlacements('placement=watch&tournamentId=event')).toHaveLength(2);
    expect(await publicPlacements('placement=watch&tournamentId=missing')).toEqual([]);
    expect(await publicPlacements('placement=watch')).toEqual([]);
    db.prepare(
      "UPDATE tournaments SET policy_json = '{\"publicWatch\":false}' WHERE id = 'event'",
    ).run();
    expect(await publicPlacements('placement=watch&tournamentId=event')).toEqual([]);
    expect(await publicPlacements('placement=tournament&tournamentId=event')).toHaveLength(1);
    db.prepare("UPDATE tournaments SET approval_status = 'pending' WHERE id = 'event'").run();
    expect(await publicPlacements('placement=tournament&tournamentId=event')).toEqual([]);
  });

  it('rejects invalid placements and unknown query fields', async () => {
    expect((await app.inject({ url: '/api/sponsors?placement=admin' })).statusCode).toBe(400);
    expect(
      (await app.inject({ url: '/api/sponsors?placement=directory&finance=true' })).statusCode,
    ).toBe(400);
  });

  it('shows global and targeted watch campaigns for approved legacy tournaments with empty policies', async () => {
    const global = (await create({ placement: 'watch' })).json();
    const targeted = (await create({ placement: 'watch', tournamentId: 'event' })).json();
    db.prepare("UPDATE tournaments SET policy_json = '' WHERE id = 'event'").run();
    expect(await publicPlacements('placement=watch&tournamentId=event')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: global.id, tournamentId: null }),
        expect.objectContaining({ id: targeted.id, tournamentId: 'event' }),
      ]),
    );
    db.prepare("UPDATE tournaments SET approval_status = 'pending' WHERE id = 'event'").run();
    expect(await publicPlacements('placement=watch&tournamentId=event')).toEqual([]);
  });

  it('filters directory campaigns for private proposals and fails closed on malformed watch policy', async () => {
    await create({ tournamentId: 'event' });
    await create({ placement: 'watch', tournamentId: 'event' });
    expect(await publicPlacements()).toHaveLength(1);
    db.prepare("UPDATE tournaments SET approval_status = 'pending' WHERE id = 'event'").run();
    expect(await publicPlacements()).toEqual([]);
    db.prepare(
      "UPDATE tournaments SET approval_status = 'approved', policy_json = 'invalid' WHERE id = 'event'",
    ).run();
    expect(await publicPlacements('placement=watch&tournamentId=event')).toEqual([]);
  });
});
