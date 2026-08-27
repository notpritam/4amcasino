import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { appendLedger } from '../src/ledger.js';

let ctx: ReturnType<typeof createApp>;
beforeEach(() => {
  ctx = createApp(':memory:');
});
afterEach(async () => {
  await ctx.app.close();
});

async function user(name: string) {
  const r = await ctx.app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username: name, authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) },
  });
  return { token: r.json().token as string, userId: r.json().userId as number };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

// 1x1 transparent PNG
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('profile', () => {
  it('updates display name and bio, and returns them', async () => {
    const alice = await user('alice');
    const put = await ctx.app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: auth(alice.token),
      payload: { displayName: 'Ace Alice', bio: 'river rat since 2020' },
    });
    expect(put.statusCode).toBe(200);
    const me = (
      await ctx.app.inject({ method: 'GET', url: '/api/profile', headers: auth(alice.token) })
    ).json();
    expect(me).toMatchObject({
      username: 'alice',
      displayName: 'Ace Alice',
      bio: 'river rat since 2020',
      hasAvatar: false,
    });
  });

  it('rejects an over-long bio', async () => {
    const alice = await user('alice');
    const put = await ctx.app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: auth(alice.token),
      payload: { bio: 'x'.repeat(281) },
    });
    expect(put.statusCode).toBe(400);
  });

  it('uploads, serves, and deletes an avatar with version bumps', async () => {
    const alice = await user('alice');
    const up = await ctx.app.inject({
      method: 'PUT',
      url: '/api/profile/avatar',
      headers: auth(alice.token),
      payload: { image: TINY_PNG },
    });
    expect(up.statusCode).toBe(200);
    expect(up.json().avatarVersion).toBe(1);

    const img = await ctx.app.inject({ method: 'GET', url: `/api/users/${alice.userId}/avatar` });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.rawPayload.length).toBeGreaterThan(20);

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/profile/avatar',
      headers: auth(alice.token),
    });
    expect(del.statusCode).toBe(200);
    const gone = await ctx.app.inject({ method: 'GET', url: `/api/users/${alice.userId}/avatar` });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects a non-image or oversized upload', async () => {
    const alice = await user('alice');
    const notImage = await ctx.app.inject({
      method: 'PUT',
      url: '/api/profile/avatar',
      headers: auth(alice.token),
      payload: { image: 'data:text/html;base64,PGI+aGk8L2I+' },
    });
    expect(notImage.statusCode).toBe(400);
    const huge = await ctx.app.inject({
      method: 'PUT',
      url: '/api/profile/avatar',
      headers: auth(alice.token),
      payload: { image: 'data:image/png;base64,' + 'A'.repeat(500_000) },
    });
    expect(huge.statusCode).toBe(400);
  });
});

describe('leaderboards', () => {
  it('ranks players by net hand winnings with hands played and biggest win', async () => {
    const host = await user('host');
    const bob = await user('bob');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(host.token),
        payload: { name: 'r', sb: 1, bb: 2 },
      })
    ).json();
    // simulate settled hands directly in the ledger
    appendLedger(ctx.db, { roomId: room.id, userId: host.userId, delta: 100, kind: 'hand-settlement', ref: 'h1' });
    appendLedger(ctx.db, { roomId: room.id, userId: bob.userId, delta: -100, kind: 'hand-settlement', ref: 'h1' });
    appendLedger(ctx.db, { roomId: room.id, userId: host.userId, delta: -30, kind: 'hand-settlement', ref: 'h2' });
    appendLedger(ctx.db, { roomId: room.id, userId: bob.userId, delta: 30, kind: 'hand-settlement', ref: 'h2' });
    appendLedger(ctx.db, { roomId: room.id, userId: host.userId, delta: 500, kind: 'purchase' }); // ignored

    const lb = (
      await ctx.app.inject({ method: 'GET', url: '/api/leaderboard', headers: auth(host.token) })
    ).json();
    expect(lb.rows).toHaveLength(2);
    expect(lb.rows[0]).toMatchObject({ username: 'host', net: 70, handsPlayed: 2, biggestWin: 100 });
    expect(lb.rows[1]).toMatchObject({ username: 'bob', net: -70, handsPlayed: 2, biggestWin: 30 });
  });

  it('room leaderboard is scoped and member-only', async () => {
    const host = await user('host');
    const stranger = await user('stranger');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(host.token),
        payload: { name: 'r', sb: 1, bb: 2 },
      })
    ).json();
    appendLedger(ctx.db, { roomId: room.id, userId: host.userId, delta: 40, kind: 'hand-settlement', ref: 'h1' });
    const ok = await ctx.app.inject({
      method: 'GET',
      url: `/api/rooms/${room.id}/leaderboard`,
      headers: auth(host.token),
    });
    expect(ok.json().rows[0]).toMatchObject({ username: 'host', net: 40 });
    const denied = await ctx.app.inject({
      method: 'GET',
      url: `/api/rooms/${room.id}/leaderboard`,
      headers: auth(stranger.token),
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('user profile page data', () => {
  it('returns stats, rivals, and transactions', async () => {
    const a = await user('aa');
    const b = await user('bb');
    const c = await user('cc');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(a.token),
        payload: { name: 'r', sb: 1, bb: 2 },
      })
    ).json();
    // two hands with b, one with c
    appendLedger(ctx.db, { roomId: room.id, userId: a.userId, delta: 50, kind: 'hand-settlement', ref: 'h1' });
    appendLedger(ctx.db, { roomId: room.id, userId: b.userId, delta: -50, kind: 'hand-settlement', ref: 'h1' });
    appendLedger(ctx.db, { roomId: room.id, userId: a.userId, delta: -20, kind: 'hand-settlement', ref: 'h2' });
    appendLedger(ctx.db, { roomId: room.id, userId: b.userId, delta: 20, kind: 'hand-settlement', ref: 'h2' });
    appendLedger(ctx.db, { roomId: room.id, userId: a.userId, delta: 10, kind: 'hand-settlement', ref: 'h3' });
    appendLedger(ctx.db, { roomId: room.id, userId: c.userId, delta: -10, kind: 'hand-settlement', ref: 'h3' });

    const p = (
      await ctx.app.inject({ method: 'GET', url: `/api/users/${a.userId}/profile`, headers: auth(b.token) })
    ).json();
    expect(p.stats).toMatchObject({ net: 40, handsPlayed: 3, biggestWin: 50 });
    expect(p.rivals[0]).toMatchObject({ username: 'bb', handsTogether: 2, netVs: 30 });
    expect(p.rivals[1]).toMatchObject({ username: 'cc', handsTogether: 1, netVs: 10 });
    // the money rail carries settlement notes, so it is owner-only
    expect(p.transactions).toEqual([]);

    const own = (
      await ctx.app.inject({ method: 'GET', url: `/api/users/${a.userId}/profile`, headers: auth(a.token) })
    ).json();
    expect(own.transactions).toHaveLength(3);
  });

  it('treats an instant repeat buy-in as the same buy, not a second one', async () => {
    const host = await user('dedup1');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(host.token),
        payload: { name: 'dd', sb: 1, bb: 2 },
      })
    ).json();
    const buy = () =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/buy`,
        headers: auth(host.token),
        payload: { amount: 500 },
      });

    const first = (await buy()).json();
    const second = (await buy()).json();
    // the double-tap gets the first request back rather than creating another
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    const rows = ctx.db
      .prepare('SELECT COUNT(*) as n FROM buy_requests WHERE room_id = ? AND user_id = ?')
      .get(room.id, host.userId) as { n: number };
    expect(rows.n).toBe(1);

    // a different amount is a different intent and still goes through
    const other = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/buy`,
      headers: auth(host.token),
      payload: { amount: 250 },
    });
    expect(other.json().duplicate).toBeUndefined();
  });

  it('charges house dues to the players who won the raked pots', async () => {
    const winner = await user('hd1');
    const loser = await user('hd2');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(winner.token),
        payload: { name: 'rake', sb: 1, bb: 2 },
      })
    ).json();

    // one hand: the winner takes 198 of a 200 pot, 2 goes to the house
    appendLedger(ctx.db, { roomId: room.id, userId: winner.userId, delta: 198, kind: 'hand-settlement', ref: 'hh1' });
    appendLedger(ctx.db, { roomId: room.id, userId: loser.userId, delta: -200, kind: 'hand-settlement', ref: 'hh1' });
    appendLedger(ctx.db, { roomId: room.id, userId: winner.userId, delta: 2, kind: 'commission', ref: 'hh1' });

    const duesOf = async (u: { token: string }) =>
      (await ctx.app.inject({ method: 'GET', url: '/api/me/house', headers: auth(u.token) })).json();

    // the rake came off the pot the winner collected, so it is theirs to owe
    expect(await duesOf(winner)).toMatchObject({ accrued: 2, paid: 0, outstanding: 2 });
    // the player who lost the hand did not pay the rake and owes the house nothing
    expect(await duesOf(loser)).toMatchObject({ accrued: 0, outstanding: 0 });

    const paid = await ctx.app.inject({
      method: 'POST',
      url: '/api/house/pay',
      headers: auth(winner.token),
      payload: { amount: 2, note: 'upi' },
    });
    expect(paid.statusCode).toBe(200);
    expect(await duesOf(winner)).toMatchObject({ accrued: 2, paid: 2, outstanding: 0 });
  });

  it('numbers players by the order they joined the platform', async () => {
    const before = (
      ctx.db.prepare('SELECT COALESCE(MAX(join_number), 0) as n FROM users').get() as { n: number }
    ).n;
    const first = await user('jo1');
    const second = await user('jo2');
    const third = await user('jo3');

    const numberOf = async (u: { userId: number; token: string }) =>
      (await ctx.app.inject({ method: 'GET', url: `/api/users/${u.userId}/profile`, headers: auth(u.token) })).json()
        .joinNumber;

    expect(await numberOf(first)).toBe(before + 1);
    expect(await numberOf(second)).toBe(before + 2);
    expect(await numberOf(third)).toBe(before + 3);

    // the number is its own fact, not a restatement of the row id: it must
    // survive a gap in the primary key
    ctx.db.prepare('DELETE FROM users WHERE id = ?').run(second.userId);
    const fourth = await user('jo4');
    expect(await numberOf(fourth)).toBe(before + 4);
    expect(await numberOf(third)).toBe(before + 3);
  });

  it('hides stats and rivals from others when private mode is on', async () => {
    const a = await user('pa');
    const b = await user('pb');
    ctx.db.prepare('UPDATE users SET private_mode = 1 WHERE id = ?').run(a.userId);

    const seen = (
      await ctx.app.inject({ method: 'GET', url: `/api/users/${a.userId}/profile`, headers: auth(b.token) })
    ).json();
    expect(seen.hidden).toBe(true);
    expect(seen.stats).toBeNull();
    expect(seen.rivals).toEqual([]);
    expect(seen.transactions).toEqual([]);
    // ...but the owner still sees their own page in full
    const mine = (
      await ctx.app.inject({ method: 'GET', url: `/api/users/${a.userId}/profile`, headers: auth(a.token) })
    ).json();
    expect(mine.hidden).toBeUndefined();
    expect(mine.stats).not.toBeNull();
  });
});
