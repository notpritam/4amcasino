import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { platformUserId, setPlatformUserId, isPlatform, ensurePlatformAccount } from '../src/platform.js';
import { createApp } from '../src/app.js';
import { appendLedger } from '../src/ledger.js';
import { createUser } from '../src/auth.js';
import { derivePlatformCredentials } from '../scripts/platform-crypto.js';

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

describe('ensurePlatformAccount', () => {
  it('creates the account when neither meta nor user exists', () => {
    const db = openDb(':memory:');
    const res = ensurePlatformAccount(db, {
      username: '4amcasino',
      createCreds: () => ({ authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) }),
    });
    expect(res).toMatchObject({ created: true, adopted: false });
    expect(platformUserId(db)).toBe(res.userId);
    const again = ensurePlatformAccount(db, {
      username: '4amcasino',
      createCreds: () => { throw new Error('must not create twice'); },
    });
    expect(again).toMatchObject({ created: false, adopted: false, userId: res.userId });
  });

  it('adopts an existing account without calling createCreds', () => {
    const db = openDb(':memory:');
    const { userId } = createUser(db, '4amcasino', 'a'.repeat(64), 'b'.repeat(64));
    const res = ensurePlatformAccount(db, {
      username: '4amcasino',
      createCreds: () => { throw new Error('must not derive on adopt'); },
    });
    expect(res).toEqual({ userId, created: false, adopted: true });
    expect(platformUserId(db)).toBe(userId);
  });
});

describe('platform credentials are loginable', () => {
  it('a created platform account logs in with the derived authKey', async () => {
    const ctx = createApp(':memory:');
    const creds = derivePlatformCredentials('4amcasino', 'Fun99312@'); // scrypt: ~1-2s
    ensurePlatformAccount(ctx.db, { username: '4amcasino', createCreds: () => creds });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: '4amcasino', authKey: creds.authKey },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().publicKey).toBe(creds.publicKey);
    await ctx.app.close();
  }, 15_000);
});

// Neutral, non-secret credentials used only to pin the KDF output - not the
// real platform password.
describe('KDF golden vector (must match apps/web/src/shared/crypto.ts)', () => {
  it('derives fixed authKey/publicKey for a known input', () => {
    const { authKey, publicKey } = derivePlatformCredentials('goldenuser', 'golden-vector-pw-1');
    // Pinned scrypt output for PARAMS={N:2**15,r:8,p:1,dkLen:32} and the
    // '4am/auth/<username>' / '4am/id/<username>' salts. If this breaks, the
    // web KDF (apps/web/src/shared/crypto.ts) and this copy have diverged.
    expect(authKey).toBe('4b0e90b4b38b8591972c47506a02d061eca855e8af51b4d7a41168d47e62e811');
    expect(publicKey).toBe('d736f1c1d399d1395905471702bca2ad6c5dea63570d8e51d20bbfc9db496e21');
  }, 15_000);
});
