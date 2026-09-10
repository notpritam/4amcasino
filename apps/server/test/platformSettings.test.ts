import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createApp } from '../src/app.js';
import { createSession, createUser } from '../src/auth.js';
import { setPlatformUserId } from '../src/platform.js';
import { appendLedger, verifyLedger } from '../src/ledger.js';
import { platformDues } from '../src/house.js';
import { settleRake } from '../src/rake.js';

let ctx: ReturnType<typeof createApp>;
let dir: string;
let path: string;
let adminId: number;
let playerId: number;
let admin: { authorization: string };
let player: { authorization: string };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), '4am-settings-'));
  path = join(dir, 'test.db');
  ctx = createApp(path);
  adminId = createUser(ctx.db, 'house', 'a'.repeat(64), 'b'.repeat(64)).userId;
  playerId = createUser(ctx.db, 'player', 'c'.repeat(64), 'd'.repeat(64)).userId;
  setPlatformUserId(ctx.db, adminId);
  admin = { authorization: `Bearer ${createSession(ctx.db, adminId)}` };
  player = { authorization: `Bearer ${createSession(ctx.db, playerId)}` };
});
afterEach(async () => {
  await ctx.app.close();
  rmSync(dir, { recursive: true, force: true });
});
const createRoom = async () =>
  (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: player,
      payload: { name: 'Test room', sb: 10, bb: 20, commissionBps: 0 },
    })
  ).json();
const settings = async () =>
  (await ctx.app.inject({ url: '/api/admin/settings', headers: admin })).json();
const save = (commissionBps: number, scope = 'all_rooms', revision = 1, headers = admin) =>
  ctx.app.inject({
    method: 'PUT',
    url: '/api/admin/settings/commission',
    headers,
    payload: { commissionBps, scope, revision },
  });

describe('runtime platform commission', () => {
  it('publishes the 0.5% default and applies it to room creation', async () => {
    const res = await ctx.app.inject({ url: '/api/platform/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json().commissionBps).toBe(50);
    expect((await createRoom()).commissionBps).toBe(50);
  });

  it('requires platform authorization for settings, overview and users', async () => {
    for (const url of ['/api/admin/settings', '/api/admin/overview', '/api/admin/users']) {
      expect((await ctx.app.inject({ url })).statusCode).toBe(401);
      expect((await ctx.app.inject({ url, headers: player })).statusCode).toBe(403);
    }
    expect((await save(75, 'all_rooms', 1, {} as typeof admin)).statusCode).toBe(401);
    expect((await save(75, 'all_rooms', 1, player)).statusCode).toBe(403);
  });

  it.each([-1, 10001, 0.5, '50', null])('rejects invalid basis points %s', async (rate) => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/api/admin/settings/commission',
      headers: admin,
      payload: { commissionBps: rate, scope: 'all_rooms', revision: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect((await settings()).commissionBps).toBe(50);
  });

  it('requires an explicit scope and current revision', async () => {
    expect((await save(75, 'surprise')).statusCode).toBe(400);
    expect((await save(75, 'all_rooms', 0)).statusCode).toBe(409);
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/api/admin/settings/commission',
      headers: admin,
      payload: { commissionBps: 75 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('can change new rooms only without changing existing rooms', async () => {
    const old = await createRoom();
    const res = await save(75, 'new_rooms');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ commissionBps: 75, revision: 2, affectedRooms: 0 });
    expect((await createRoom()).commissionBps).toBe(75);
    expect(
      (await ctx.app.inject({ url: `/api/rooms/${old.id}`, headers: player })).json().commissionBps,
    ).toBe(50);
    const current = await settings();
    expect(current.history[0]).toMatchObject({
      commissionBps: 75,
      previousBps: 50,
      changedBy: adminId,
      scope: 'new_rooms',
    });
  });

  it('updates all room rates and preserves the chosen rate on restart', async () => {
    const first = await createRoom();
    const second = await createRoom();
    expect((await save(125)).json()).toMatchObject({ commissionBps: 125, affectedRooms: 2 });
    await ctx.app.close();
    ctx = createApp(path);
    expect((await settings()).commissionBps).toBe(125);
    expect(
      ctx.db
        .prepare('SELECT commission_bps FROM rooms WHERE id IN (?, ?)')
        .all(first.id, second.id),
    ).toEqual([{ commission_bps: 125 }, { commission_bps: 125 }]);
    expect((await createRoom()).commissionBps).toBe(125);
    expect((await save(90, 'all_rooms', 1)).statusCode).toBe(409);
    expect((await settings()).commissionBps).toBe(125);
  });

  it('allows zero commission without falling back to the default', async () => {
    expect((await save(0)).statusCode).toBe(200);
    expect((await createRoom()).commissionBps).toBe(0);
  });

  it('requires room creators to review a rate that changed while the form was open', async () => {
    await save(75);
    const create = (commissionRevision: number) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: player,
        payload: { name: 'Reviewed rate', sb: 10, bb: 20, commissionRevision },
      });
    expect((await create(1)).statusCode).toBe(409);
    expect(ctx.db.prepare('SELECT id FROM rooms').all()).toHaveLength(0);
    expect((await create(2)).json().commissionBps).toBe(75);
  });

  it('keeps historical dues grouped by the rate actually charged', async () => {
    const room = await createRoom();
    for (const [ref, commissionBps, rake] of [
      ['first', 50, 10],
      ['second', 100, 20],
    ] as const) {
      appendLedger(ctx.db, {
        roomId: room.id,
        userId: playerId,
        delta: 100,
        kind: 'hand-settlement',
        ref,
      });
      settleRake(ctx.db, { roomId: room.id, recipientId: adminId, rake, ref, commissionBps });
    }
    const ledger = ctx.db.prepare('SELECT * FROM ledger').all();
    expect((await save(200)).statusCode).toBe(200);
    const dues = platformDues(ctx.db).people.find((p) => p.userId === playerId)!;
    expect(dues.accrued).toBe(30);
    expect(
      dues.rooms.map((r) => [r.commissionBps, r.accrued]).sort((a, b) => a[0]! - b[0]!),
    ).toEqual([
      [50, 10],
      [100, 20],
    ]);
    expect(ctx.db.prepare('SELECT * FROM ledger').all()).toEqual(ledger);
    expect(verifyLedger(ctx.db, room.id).ok).toBe(true);
  });

  it('migrates existing rooms to 0.5% once while retaining historical rates and ledger hashes', async () => {
    const room = await createRoom();
    ctx.db.prepare('UPDATE rooms SET commission_bps = 10 WHERE id = ?').run(room.id);
    appendLedger(ctx.db, {
      roomId: room.id,
      userId: playerId,
      delta: 100,
      kind: 'hand-settlement',
      ref: 'old',
    });
    appendLedger(ctx.db, {
      roomId: room.id,
      userId: adminId,
      delta: 2,
      kind: 'commission',
      ref: 'old',
      note: '0.1% table commission - keeps the lights on',
    });
    const ledger = ctx.db.prepare('SELECT * FROM ledger').all();
    await ctx.app.close();
    const previous = new Database(path);
    previous.exec(
      'DROP TABLE IF EXISTS platform_settings; DROP TABLE IF EXISTS commission_changes; DROP TABLE IF EXISTS hand_commission_rates;',
    );
    previous.close();
    ctx = createApp(path);
    expect((await settings()).commissionBps).toBe(50);
    expect(ctx.db.prepare('SELECT commission_bps FROM rooms WHERE id = ?').get(room.id)).toEqual({
      commission_bps: 50,
    });
    expect(platformDues(ctx.db).people[0]!.rooms[0]).toMatchObject({
      commissionBps: 10,
      accrued: 2,
    });
    expect(ctx.db.prepare('SELECT * FROM ledger').all()).toEqual(ledger);
    expect(verifyLedger(ctx.db, room.id).ok).toBe(true);
  });

  it('returns real overview data and can search users by name or ID', async () => {
    await createRoom();
    const overview = await ctx.app.inject({ url: '/api/admin/overview', headers: admin });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      users: 1,
      rooms: 1,
      activeRooms: 1,
      commissionBps: 50,
    });
    const users = await ctx.app.inject({ url: '/api/admin/users?q=PLAYER', headers: admin });
    expect(users.statusCode).toBe(200);
    expect(users.json().users).toHaveLength(1);
    expect(users.json().users[0]).toMatchObject({ userId: playerId, username: 'player' });
    expect(
      (await ctx.app.inject({ url: `/api/admin/users?q=${playerId}`, headers: admin })).json()
        .users[0].userId,
    ).toBe(playerId);
  });
});

describe('hand qualification ceiling', () => {
  it.each([31, 100, 500])('rejects a %i-hand requirement on new rooms', async (minSettleHands) => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: player,
      payload: { name: 'Too many hands', sb: 10, bb: 20, minSettleHands },
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows 30 hands or no requirement and rejects a higher settings update', async () => {
    const room = await createRoom();
    const update = (minSettleHands: number) =>
      ctx.app.inject({
        method: 'PUT',
        url: `/api/rooms/${room.id}/settings`,
        headers: player,
        payload: { minSettleHands },
      });
    expect((await update(30)).statusCode).toBe(200);
    expect((await update(100)).statusCode).toBe(400);
    expect(ctx.db.prepare('SELECT min_settle_hands FROM rooms WHERE id = ?').get(room.id)).toEqual({
      min_settle_hands: 30,
    });
    expect((await update(0)).statusCode).toBe(200);
  });

  it('reduces existing requirements over 30 on migration', async () => {
    const room = await createRoom();
    ctx.db.prepare('UPDATE rooms SET min_settle_hands = 100 WHERE id = ?').run(room.id);
    await ctx.app.close();
    ctx = createApp(path);
    expect(ctx.db.prepare('SELECT min_settle_hands FROM rooms WHERE id = ?').get(room.id)).toEqual({
      min_settle_hands: 30,
    });
  });
});
