import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { platformUserId, setPlatformUserId, isPlatform } from '../src/platform.js';
import { createApp } from '../src/app.js';
import { appendLedger } from '../src/ledger.js';

describe('platform state', () => {
  it('is unset until written, then round-trips', () => {
    const db = openDb(':memory:');
    expect(platformUserId(db)).toBeNull();
    expect(isPlatform(db, 5)).toBe(false);
    setPlatformUserId(db, 5);
    expect(platformUserId(db)).toBe(5);
    expect(isPlatform(db, 5)).toBe(true);
    expect(isPlatform(db, 6)).toBe(false);
  });

  it('setPlatformUserId is idempotent (upsert)', () => {
    const db = openDb(':memory:');
    setPlatformUserId(db, 5);
    setPlatformUserId(db, 7);
    expect(platformUserId(db)).toBe(7);
  });
});

async function register(app: ReturnType<typeof createApp>['app'], username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username, authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) },
  });
  return res.json() as { userId: number; token: string };
}

describe('/api/me isPlatform', () => {
  it('is true only for the platform account', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const bob = await register(ctx.app, 'bob');
    setPlatformUserId(ctx.db, alice.userId);

    const meAlice = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${alice.token}` },
    });
    const meBob = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(meAlice.json().isPlatform).toBe(true);
    expect(meBob.json().isPlatform).toBe(false);
    await ctx.app.close();
  });
});

function seedRoomWithSettlements(
  db: ReturnType<typeof openDb>,
  roomId: string,
  hostId: number,
  players: { userId: number; delta: number }[],
) {
  db.prepare(
    `INSERT INTO rooms (id, name, join_code, host_id, banker_id, sb, bb, audit_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'private', ?)`,
  ).run(roomId, 'T', roomId.toUpperCase().slice(0, 6), hostId, hostId, 1, 2, Date.now());
  for (const p of players) {
    appendLedger(db, { roomId, userId: p.userId, delta: p.delta, kind: 'hand-settlement', ref: 'h1' });
  }
}

describe('leaderboard excludes platform', () => {
  it('omits the platform account from /api/leaderboard', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const house = await register(ctx.app, 'house');
    seedRoomWithSettlements(ctx.db, 'room01', alice.userId, [
      { userId: alice.userId, delta: 100 },
      { userId: house.userId, delta: 500 },
    ]);
    setPlatformUserId(ctx.db, house.userId);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/leaderboard',
      headers: { authorization: `Bearer ${alice.token}` },
    });
    const ids = (res.json().rows as { userId: number }[]).map((r) => r.userId);
    expect(ids).toContain(alice.userId);
    expect(ids).not.toContain(house.userId);
    await ctx.app.close();
  });
});
