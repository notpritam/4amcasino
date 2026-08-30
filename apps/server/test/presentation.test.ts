import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { appendLedger } from '../src/ledger.js';
import { leaderboardRankOf } from '../src/profile.js';
import { setPlatformUserId } from '../src/platform.js';
import { settleRake } from '../src/rake.js';
import { presentablePlayers, roomPlayers } from '../src/rooms.js';

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

function seedRoom(
  db: ReturnType<typeof createApp>['db'],
  roomId: string,
  hostId: number,
) {
  db.prepare(
    `INSERT INTO rooms (id, name, join_code, host_id, banker_id, sb, bb, audit_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'private', ?)`,
  ).run(roomId, 'T', roomId.toUpperCase().slice(0, 6), hostId, hostId, 1, 2, Date.now());
}

describe('leaderboardRankOf', () => {
  it('ranks users 1/2/3 by descending net', async () => {
    const alice = await user('rank_alice');
    const bob = await user('rank_bob');
    const carl = await user('rank_carl');
    seedRoom(ctx.db, 'roomA', alice.userId);
    appendLedger(ctx.db, { roomId: 'roomA', userId: alice.userId, delta: 300, kind: 'hand-settlement', ref: 'h1' });
    appendLedger(ctx.db, { roomId: 'roomA', userId: bob.userId, delta: 100, kind: 'hand-settlement', ref: 'h1' });
    appendLedger(ctx.db, { roomId: 'roomA', userId: carl.userId, delta: -400, kind: 'hand-settlement', ref: 'h1' });

    expect(leaderboardRankOf(ctx.db, alice.userId)).toBe(1);
    expect(leaderboardRankOf(ctx.db, bob.userId)).toBe(2);
    expect(leaderboardRankOf(ctx.db, carl.userId)).toBe(3);
  });

  it('returns null for a private-mode user', async () => {
    const alice = await user('rankpriv_alice');
    const bob = await user('rankpriv_bob');
    seedRoom(ctx.db, 'roomB', alice.userId);
    appendLedger(ctx.db, { roomId: 'roomB', userId: alice.userId, delta: 300, kind: 'hand-settlement', ref: 'h1' });
    appendLedger(ctx.db, { roomId: 'roomB', userId: bob.userId, delta: -300, kind: 'hand-settlement', ref: 'h1' });
    ctx.db.prepare('UPDATE users SET private_mode = 1 WHERE id = ?').run(bob.userId);

    expect(leaderboardRankOf(ctx.db, alice.userId)).toBe(1);
    expect(leaderboardRankOf(ctx.db, bob.userId)).toBeNull();
  });

  it('returns null for the platform account', async () => {
    const alice = await user('rankplat_alice');
    const house = await user('rankplat_house');
    seedRoom(ctx.db, 'roomC', alice.userId);
    appendLedger(ctx.db, { roomId: 'roomC', userId: alice.userId, delta: 100, kind: 'hand-settlement', ref: 'h1' });
    appendLedger(ctx.db, { roomId: 'roomC', userId: house.userId, delta: 500, kind: 'hand-settlement', ref: 'h1' });
    setPlatformUserId(ctx.db, house.userId);

    expect(leaderboardRankOf(ctx.db, alice.userId)).toBe(1);
    expect(leaderboardRankOf(ctx.db, house.userId)).toBeNull();
  });

  it('returns null for a user with no hands', async () => {
    const alice = await user('rankempty_alice');
    expect(leaderboardRankOf(ctx.db, alice.userId)).toBeNull();
  });
});

describe('/api/me exposes leaderboardRank', () => {
  it('includes the field, populated once hands are played', async () => {
    const alice = await user('meRank_alice');
    const bob = await user('meRank_bob');
    seedRoom(ctx.db, 'roomD', alice.userId);
    appendLedger(ctx.db, { roomId: 'roomD', userId: alice.userId, delta: 100, kind: 'hand-settlement', ref: 'h1' });
    appendLedger(ctx.db, { roomId: 'roomD', userId: bob.userId, delta: -100, kind: 'hand-settlement', ref: 'h1' });

    const me = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: auth(alice.token) });
    expect(me.json().leaderboardRank).toBe(1);
  });
});

describe('/api/users/:id/profile exposes leaderboardRank', () => {
  it('includes the field in the stats response', async () => {
    const alice = await user('profRank_alice');
    const bob = await user('profRank_bob');
    seedRoom(ctx.db, 'roomE', alice.userId);
    appendLedger(ctx.db, { roomId: 'roomE', userId: alice.userId, delta: 100, kind: 'hand-settlement', ref: 'h1' });
    appendLedger(ctx.db, { roomId: 'roomE', userId: bob.userId, delta: -100, kind: 'hand-settlement', ref: 'h1' });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/users/${alice.userId}/profile`,
      headers: auth(alice.token),
    });
    expect(res.json().leaderboardRank).toBe(1);
  });
});

describe('room rosters hide the platform account', () => {
  it('excludes the platform from players but keeps its room_players row for accounting', async () => {
    const alice = await user('roster_alice');
    const house = await user('roster_house');
    setPlatformUserId(ctx.db, house.userId);

    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(alice.token),
        payload: { name: 'Roster Test', sb: 10, bb: 20 },
      })
    ).json() as { id: string };

    settleRake(ctx.db, { roomId: room.id, recipientId: house.userId, rake: 50, ref: 'h1' });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/rooms/${room.id}`,
      headers: auth(alice.token),
    });
    const players = res.json().players as { userId: number }[];
    const playerIds = players.map((p) => p.userId);
    expect(playerIds).toContain(alice.userId);
    expect(playerIds).not.toContain(house.userId);

    const roomPlayerRow = ctx.db
      .prepare('SELECT * FROM room_players WHERE room_id = ? AND user_id = ?')
      .get(room.id, house.userId);
    expect(roomPlayerRow).toBeDefined();
  });
});

describe('presentablePlayers (shared helper backing both REST and the live broadcast)', () => {
  it('excludes the platform while raw roomPlayers still includes it, for the same room', async () => {
    const alice = await user('shared_alice');
    const house = await user('shared_house');
    setPlatformUserId(ctx.db, house.userId);

    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(alice.token),
        payload: { name: 'Shared Helper Test', sb: 10, bb: 20 },
      })
    ).json() as { id: string };

    settleRake(ctx.db, { roomId: room.id, recipientId: house.userId, rake: 50, ref: 'h1' });

    const raw = roomPlayers(ctx.db, room.id);
    expect(raw.map((p) => p.userId)).toContain(house.userId);

    const presented = presentablePlayers(ctx.db, room.id);
    const presentedIds = presented.map((p) => p.userId);
    expect(presentedIds).toContain(alice.userId);
    expect(presentedIds).not.toContain(house.userId);
  });
});
