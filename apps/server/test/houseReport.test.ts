import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createUser, createSession } from '../src/auth.js';
import { appendLedger, verifyLedger } from '../src/ledger.js';
import { setPlatformUserId } from '../src/platform.js';

let ctx: ReturnType<typeof createApp>;
let house: ReturnType<typeof createUser> & { token: string };
let alice: ReturnType<typeof createUser> & { token: string };
let bob: ReturnType<typeof createUser> & { token: string };
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const get = async (url: string, token: string) =>
  ctx.app.inject({ method: 'GET', url, headers: auth(token) });
function room(id: string) {
  ctx.db
    .prepare(
      `INSERT INTO rooms (id, name, join_code, host_id, banker_id, sb, bb, created_at)
    VALUES (?, ?, ?, ?, ?, 10, 20, 1)`,
    )
    .run(id, `Table ${id}`, id, alice.userId, alice.userId);
  for (const u of [alice, bob])
    ctx.db.prepare('INSERT INTO room_players (room_id, user_id) VALUES (?, ?)').run(id, u.userId);
}
function hand(roomId: string, ref: string, rake: number, wins: [number, number][]) {
  appendLedger(ctx.db, { roomId, userId: house.userId, delta: rake, kind: 'commission', ref });
  for (const [userId, delta] of wins)
    appendLedger(ctx.db, { roomId, userId, delta, kind: 'hand-settlement', ref });
}
beforeEach(() => {
  ctx = createApp(':memory:');
  const user = (name: string) => {
    const row = createUser(ctx.db, name, 'a'.repeat(64), 'b'.repeat(64));
    return { ...row, token: createSession(ctx.db, row.userId) };
  };
  house = user('platform');
  alice = user('alice');
  bob = user('bob');
  setPlatformUserId(ctx.db, house.userId);
  ctx.db
    .prepare("UPDATE users SET display_name = 'Alice Example', private_mode = 1 WHERE id = ?")
    .run(alice.userId);
  room('newroom');
});
afterEach(async () => {
  await ctx.app.close();
});

describe('platform dues report', () => {
  it('is platform-only, including private users without exposing the report to players', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/admin/house' })).statusCode).toBe(401);
    expect((await get('/api/admin/house', alice.token)).statusCode).toBe(403);
    hand('newroom', 'h1', 10, [
      [alice.userId, 90],
      [bob.userId, -100],
    ]);
    const res = await get('/api/admin/house', house.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().people[0]).toMatchObject({
      userId: alice.userId,
      username: 'alice',
      displayName: 'Alice Example',
      accrued: 10,
      paid: 0,
      outstanding: 10,
    });
    expect((await get('/api/me/settle', bob.token)).json().platformHouse).toBeUndefined();
    expect(
      (await get(`/api/users/${alice.userId}/profile`, bob.token)).json().house,
    ).toBeUndefined();
  });

  it('shows identical admin, settle-up, and personal profile dues after a partial payment', async () => {
    hand('newroom', 'h1', 10, [
      [alice.userId, 90],
      [bob.userId, -100],
    ]);
    room('legacy');
    ctx.db.prepare('UPDATE rooms SET commission_bps = 100 WHERE id = ?').run('legacy');
    hand('legacy', 'h2', 20, [
      [alice.userId, 180],
      [bob.userId, -200],
    ]);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/house/pay',
      headers: auth(alice.token),
      payload: { amount: 7, note: 'transfer recorded' },
    });
    const report = (await get('/api/admin/house', house.token)).json();
    expect(report.totals).toMatchObject({
      accrued: 30,
      paid: 7,
      outstanding: 23,
      usersOwing: 1,
      unallocated: 0,
    });
    expect(report.people[0].rooms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roomId: 'newroom', accrued: 10, commissionBps: 10 }),
        expect.objectContaining({ roomId: 'legacy', accrued: 20, commissionBps: 100 }),
      ]),
    );
    expect((await get('/api/me/settle', house.token)).json().platformHouse).toEqual(report);
    expect((await get('/api/me/settle', alice.token)).json().house).toMatchObject({
      accrued: 30,
      paid: 7,
      outstanding: 23,
    });
    expect(
      (await get(`/api/users/${alice.userId}/profile`, alice.token)).json().house,
    ).toMatchObject({ accrued: 30, paid: 7, outstanding: 23 });
    expect(verifyLedger(ctx.db, 'newroom').ok).toBe(true);
  });

  it('allocates odd commission chips only once across winners', async () => {
    hand('newroom', 'split', 1, [
      [alice.userId, 50],
      [bob.userId, 50],
    ]);
    const report = (await get('/api/admin/house', house.token)).json();
    expect(report.totals).toMatchObject({ accrued: 1, outstanding: 1, unallocated: 0 });
    const a = (await get('/api/me/house', alice.token)).json();
    const b = (await get('/api/me/house', bob.token)).json();
    expect(a.accrued + b.accrued).toBe(1);
    expect(a.accrued).toBe(1); // stable user-id tie break
    expect(b.accrued).toBe(0);
  });

  it('keeps same-reference hands in different rooms separate', async () => {
    hand('newroom', 'same-ref', 2, [
      [alice.userId, 198],
      [bob.userId, -200],
    ]);
    room('second');
    hand('second', 'same-ref', 5, [
      [bob.userId, 495],
      [alice.userId, -500],
    ]);
    expect((await get('/api/me/house', alice.token)).json().accrued).toBe(2);
    expect((await get('/api/me/house', bob.token)).json().accrued).toBe(5);
  });

  it('excludes voided hands and retired rooms consistently', async () => {
    hand('newroom', 'voided', 10, [[alice.userId, 90]]);
    appendLedger(ctx.db, {
      roomId: 'newroom',
      userId: house.userId,
      delta: -10,
      kind: 'void-hand',
      ref: 'voided',
    });
    for (const status of ['archived', 'deleted', 'voided']) {
      room(status);
      hand(status, status, 20, [[bob.userId, 180]]);
      ctx.db.prepare(`UPDATE rooms SET ${status} = 1 WHERE id = ?`).run(status);
    }
    expect((await get('/api/admin/house', house.token)).json().totals).toMatchObject({
      accrued: 0,
      outstanding: 0,
    });
    expect((await get('/api/me/house', bob.token)).json().outstanding).toBe(0);
  });

  it('does not apply one user’s overpayment to another user’s debt', async () => {
    hand('newroom', 'h1', 5, [[alice.userId, 95]]);
    hand('newroom', 'h2', 10, [[bob.userId, 90]]);
    ctx.db
      .prepare('INSERT INTO house_payments (user_id, amount, ts) VALUES (?, 20, 1)')
      .run(alice.userId);
    const report = (await get('/api/admin/house', house.token)).json();
    expect(report.totals).toMatchObject({ accrued: 15, paid: 20, outstanding: 10, credit: 15 });
    expect(report.people[0]).toMatchObject({ userId: bob.userId, outstanding: 10 });
    expect(report.people.find((p: { userId: number }) => p.userId === alice.userId)).toMatchObject({
      outstanding: 0,
      credit: 15,
    });
  });

  it('flags commission without a known winner instead of inventing a debtor', async () => {
    hand('newroom', 'no-winner', 4, []);
    const report = (await get('/api/admin/house', house.token)).json();
    expect(report.totals).toMatchObject({ accrued: 0, outstanding: 0, unallocated: 4 });
    expect(report.people).toEqual([]);
  });
});
