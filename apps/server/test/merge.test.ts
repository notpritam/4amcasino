import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { mergeAccounts } from '../src/merge.js';
import { appendLedger, verifyLedger } from '../src/ledger.js';
import { activeHands } from '../src/liveHands.js';
import { setPlatformUserId } from '../src/platform.js';

async function register(app: ReturnType<typeof createApp>['app'], username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username, authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) },
  });
  return res.json() as { userId: number; token: string };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('Task 1: schema + disabled-user rejection', () => {
  it('users table has disabled and merged_into columns; account_merge_requests round-trips', () => {
    const db = openDb(':memory:');
    const cols = db.pragma('table_info(users)') as { name: string }[];
    expect(cols.some((c) => c.name === 'disabled')).toBe(true);
    expect(cols.some((c) => c.name === 'merged_into')).toBe(true);

    const now = Date.now();
    db.prepare(
      `INSERT INTO account_merge_requests (from_user, into_user, requested_by, created_at) VALUES (1, 2, 1, ?)`,
    ).run(now);
    const row = db.prepare('SELECT * FROM account_merge_requests').get() as {
      id: number;
      from_user: number;
      into_user: number;
      requested_by: number;
      status: string;
      note: string | null;
      created_at: number;
      decided_at: number | null;
      decided_by: number | null;
    };
    expect(row.from_user).toBe(1);
    expect(row.into_user).toBe(2);
    expect(row.requested_by).toBe(1);
    expect(row.status).toBe('pending');
    expect(row.note).toBeNull();
    expect(row.decided_at).toBeNull();
    expect(row.decided_by).toBeNull();
  });

  it("a disabled user's token is rejected with 401 on any authed route", async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');

    // sanity: works before disabling
    const before = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(alice.token),
    });
    expect(before.statusCode).toBe(200);

    ctx.db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(alice.userId);

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(alice.token),
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().error).toBe('account merged');
    await ctx.app.close();
  });

  it('a non-disabled user is unaffected', async () => {
    const ctx = createApp(':memory:');
    const bob = await register(ctx.app, 'bob');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(bob.token),
    });
    expect(res.statusCode).toBe(200);
    await ctx.app.close();
  });
});

function seedRoom(db: ReturnType<typeof openDb>, roomId: string, hostId: number) {
  db.prepare(
    `INSERT INTO rooms (id, name, join_code, host_id, banker_id, sb, bb, audit_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'private', ?)`,
  ).run(roomId, 'T', roomId.toUpperCase().slice(0, 6), hostId, hostId, 1, 2, Date.now());
}

describe('Task 2: mergeAccounts core', () => {
  it('merges stacks, ledger, settlements, friends, sessions and disables from', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice'); // from
    const bob = await register(ctx.app, 'bob'); // into
    const roomId = 'room01';
    seedRoom(ctx.db, roomId, bob.userId);

    ctx.db
      .prepare('INSERT INTO room_players (room_id, user_id, seat, stack) VALUES (?, ?, NULL, ?)')
      .run(roomId, alice.userId, 300);
    ctx.db
      .prepare('INSERT INTO room_players (room_id, user_id, seat, stack) VALUES (?, ?, NULL, ?)')
      .run(roomId, bob.userId, 500);

    appendLedger(ctx.db, {
      roomId,
      userId: alice.userId,
      delta: 300,
      kind: 'hand-settlement',
      ref: 'h1',
    });
    appendLedger(ctx.db, {
      roomId,
      userId: bob.userId,
      delta: 500,
      kind: 'hand-settlement',
      ref: 'h1',
    });

    // a debt: alice (from) owes bob (into) 100
    const [low, high] =
      alice.userId < bob.userId ? [alice.userId, bob.userId] : [bob.userId, alice.userId];
    ctx.db
      .prepare(
        `INSERT INTO settlements (room_id, low_user, high_user, amount, debtor, created_ts)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(roomId, low, high, 100, alice.userId, Date.now());

    ctx.db
      .prepare(
        `INSERT INTO friends (requester_id, target_id, status, created_at) VALUES (?, ?, 'accepted', ?)`,
      )
      .run(alice.userId, bob.userId, Date.now());

    mergeAccounts(ctx.db, alice.userId, bob.userId);

    const bobStack = ctx.db
      .prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?')
      .get(roomId, bob.userId) as { stack: number } | undefined;
    expect(bobStack?.stack).toBe(800);

    const aliceRow = ctx.db
      .prepare('SELECT 1 FROM room_players WHERE room_id = ? AND user_id = ?')
      .get(roomId, alice.userId);
    expect(aliceRow).toBeUndefined();

    const ledgerRows = ctx.db
      .prepare('SELECT user_id FROM ledger WHERE room_id = ?')
      .all(roomId) as { user_id: number }[];
    expect(ledgerRows.length).toBeGreaterThan(0);
    expect(ledgerRows.every((r) => r.user_id === bob.userId)).toBe(true);
    expect(verifyLedger(ctx.db, roomId).ok).toBe(true);

    const settlementRows = ctx.db
      .prepare('SELECT * FROM settlements WHERE room_id = ?')
      .all(roomId);
    expect(settlementRows.length).toBe(0);

    const userRow = ctx.db
      .prepare('SELECT disabled, merged_into FROM users WHERE id = ?')
      .get(alice.userId) as { disabled: number; merged_into: number | null };
    expect(userRow.disabled).toBe(1);
    expect(userRow.merged_into).toBe(bob.userId);

    const sessions = ctx.db.prepare('SELECT * FROM sessions WHERE user_id = ?').all(alice.userId);
    expect(sessions.length).toBe(0);

    const friends = ctx.db
      .prepare('SELECT * FROM friends WHERE requester_id = ? OR target_id = ?')
      .all(alice.userId, alice.userId);
    expect(friends.length).toBe(0);

    await ctx.app.close();
  });

  it('re-normalizes a settlement pair without inverting who owes whom', async () => {
    const ctx = createApp(':memory:');
    // Registration order controls id order (autoincrement), and this is
    // chosen deliberately: alice < carol < bob, so that substituting
    // fromUser=alice with intoUser=bob forces the pair to flip sides
    // (bob's id sorts *above* carol's, where alice's sorted *below* her) -
    // this is the one branch (merge.ts step 8's "swap") that a naive
    // same-side relabel would get wrong, so it's the one worth proving.
    const alice = await register(ctx.app, 'alice'); // from
    const carol = await register(ctx.app, 'carol'); // untouched third party
    const bob = await register(ctx.app, 'bob'); // into
    const roomId = 'room03';
    seedRoom(ctx.db, roomId, bob.userId);

    // carol owes alice 250; alice (low_user) has confirmed, carol
    // (high_user, the debtor) has too. After the merge this becomes
    // carol/bob, with carol still the debtor and her confirmation intact,
    // regardless of which side of the pair she now sorts to.
    expect(alice.userId).toBeLessThan(carol.userId);
    const [low, high] = [alice.userId, carol.userId];
    ctx.db
      .prepare(
        `INSERT INTO settlements (room_id, low_user, high_user, amount, debtor, confirmed_low, confirmed_high, created_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(roomId, low, high, 250, carol.userId, 0, 1, Date.now());

    mergeAccounts(ctx.db, alice.userId, bob.userId);

    const row = ctx.db
      .prepare('SELECT * FROM settlements WHERE room_id = ?')
      .get(roomId) as {
      low_user: number;
      high_user: number;
      debtor: number;
      confirmed_low: number;
      confirmed_high: number;
    };
    expect(row.debtor).toBe(carol.userId);
    expect([row.low_user, row.high_user].sort((a, b) => a - b)).toEqual(
      [bob.userId, carol.userId].sort((a, b) => a - b),
    );
    expect(row.low_user).toBeLessThan(row.high_user);
    // carol's id sorts below bob's, so the pair had to flip sides (the swap
    // branch) - proving carol landed as low_user here is itself proof that
    // branch ran, not just the no-op relabel.
    expect(row.low_user).toBe(carol.userId);
    // whichever side carol ended up on, her confirmation flag must have
    // travelled with her, not stayed pinned to a numeric slot
    const carolConfirmed = row.low_user === carol.userId ? row.confirmed_low : row.confirmed_high;
    expect(carolConfirmed).toBe(1);
    // and alice's original (unconfirmed) flag must have travelled onto bob,
    // who inherited her slot - not been left behind or defaulted to 1
    const bobConfirmed = row.low_user === bob.userId ? row.confirmed_low : row.confirmed_high;
    expect(bobConfirmed).toBe(0);

    await ctx.app.close();
  });

  it('throws and changes nothing if either account is seated in a live hand', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const bob = await register(ctx.app, 'bob');
    const roomId = 'room02';
    seedRoom(ctx.db, roomId, bob.userId);
    ctx.db
      .prepare('INSERT INTO room_players (room_id, user_id, seat, stack) VALUES (?, ?, 1, ?)')
      .run(roomId, alice.userId, 300);
    activeHands.add(roomId);
    try {
      expect(() => mergeAccounts(ctx.db, alice.userId, bob.userId)).toThrow();
      const row = ctx.db
        .prepare('SELECT disabled FROM users WHERE id = ?')
        .get(alice.userId) as { disabled: number };
      expect(row.disabled).toBe(0);
      const stillSeated = ctx.db
        .prepare('SELECT 1 FROM room_players WHERE room_id = ? AND user_id = ?')
        .get(roomId, alice.userId);
      expect(stillSeated).toBeTruthy();
    } finally {
      activeHands.delete(roomId);
    }
    await ctx.app.close();
  });

  it('throws for same-user, missing-user, and already-disabled merges', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const bob = await register(ctx.app, 'bob');
    expect(() => mergeAccounts(ctx.db, alice.userId, alice.userId)).toThrow();
    expect(() => mergeAccounts(ctx.db, alice.userId, 999_999)).toThrow();
    expect(() => mergeAccounts(ctx.db, 999_999, alice.userId)).toThrow();
    ctx.db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(bob.userId);
    expect(() => mergeAccounts(ctx.db, alice.userId, bob.userId)).toThrow();
    await ctx.app.close();
  });
});

describe('Task 3: merge request + admin approval', () => {
  it('non-platform gets 403 on both admin merge routes', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const bob = await register(ctx.app, 'bob');
    setPlatformUserId(ctx.db, bob.userId); // bob is platform, alice is not

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin/merges',
      headers: auth(alice.token),
    });
    expect(list.statusCode).toBe(403);

    const decide = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin/merges/1',
      headers: auth(alice.token),
      payload: { approve: true },
    });
    expect(decide.statusCode).toBe(403);
    await ctx.app.close();
  });

  it('files a request, platform lists it with both balances, approves it, and the merge happens', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice'); // from
    const bob = await register(ctx.app, 'bob'); // into
    const house = await register(ctx.app, 'house');
    setPlatformUserId(ctx.db, house.userId);

    const roomId = 'room10';
    seedRoom(ctx.db, roomId, bob.userId);
    appendLedger(ctx.db, {
      roomId,
      userId: alice.userId,
      delta: 120,
      kind: 'hand-settlement',
      ref: 'h1',
    });
    appendLedger(ctx.db, {
      roomId,
      userId: bob.userId,
      delta: -45,
      kind: 'hand-settlement',
      ref: 'h1',
    });

    const filed = await ctx.app.inject({
      method: 'POST',
      url: '/api/me/merge-request',
      headers: auth(alice.token),
      payload: { fromUsername: 'alice', intoUsername: 'bob', note: 'same person' },
    });
    expect(filed.statusCode).toBe(200);
    const { requestId } = filed.json() as { requestId: number };
    expect(requestId).toBeGreaterThan(0);

    const listed = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin/merges',
      headers: auth(house.token),
    });
    expect(listed.statusCode).toBe(200);
    const requests = listed.json().requests as {
      id: number;
      fromUsername: string;
      intoUsername: string;
      note: string | null;
      fromBalance: number;
      intoBalance: number;
      fromRooms: number;
      intoRooms: number;
    }[];
    const mine = requests.find((r) => r.id === requestId);
    expect(mine).toBeDefined();
    expect(mine?.fromUsername).toBe('alice');
    expect(mine?.intoUsername).toBe('bob');
    expect(mine?.note).toBe('same person');
    expect(mine?.fromBalance).toBe(120);
    expect(mine?.intoBalance).toBe(-45);
    expect(mine?.fromRooms).toBeGreaterThan(0);
    expect(mine?.intoRooms).toBeGreaterThan(0);

    const decided = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/merges/${requestId}`,
      headers: auth(house.token),
      payload: { approve: true },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ ok: true, status: 'approved' });

    const aliceRow = ctx.db
      .prepare('SELECT disabled, merged_into FROM users WHERE id = ?')
      .get(alice.userId) as { disabled: number; merged_into: number | null };
    expect(aliceRow.disabled).toBe(1);
    expect(aliceRow.merged_into).toBe(bob.userId);

    const reqRow = ctx.db
      .prepare('SELECT status, decided_by FROM account_merge_requests WHERE id = ?')
      .get(requestId) as { status: string; decided_by: number };
    expect(reqRow.status).toBe('approved');
    expect(reqRow.decided_by).toBe(house.userId);

    await ctx.app.close();
  });

  it('approving a request for a seated account returns 409 and disables nobody', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const bob = await register(ctx.app, 'bob');
    const house = await register(ctx.app, 'house');
    setPlatformUserId(ctx.db, house.userId);

    const roomId = 'room11';
    seedRoom(ctx.db, roomId, bob.userId);
    ctx.db
      .prepare('INSERT INTO room_players (room_id, user_id, seat, stack) VALUES (?, ?, 1, ?)')
      .run(roomId, alice.userId, 300);
    activeHands.add(roomId);

    try {
      const filed = await ctx.app.inject({
        method: 'POST',
        url: '/api/me/merge-request',
        headers: auth(alice.token),
        payload: { fromUsername: 'alice', intoUsername: 'bob' },
      });
      const { requestId } = filed.json() as { requestId: number };

      const decided = await ctx.app.inject({
        method: 'POST',
        url: `/api/admin/merges/${requestId}`,
        headers: auth(house.token),
        payload: { approve: true },
      });
      expect(decided.statusCode).toBe(409);

      const aliceRow = ctx.db
        .prepare('SELECT disabled FROM users WHERE id = ?')
        .get(alice.userId) as { disabled: number };
      expect(aliceRow.disabled).toBe(0);
      const bobRow = ctx.db.prepare('SELECT disabled FROM users WHERE id = ?').get(bob.userId) as {
        disabled: number;
      };
      expect(bobRow.disabled).toBe(0);
    } finally {
      activeHands.delete(roomId);
    }
    await ctx.app.close();
  });

  it('rejecting a request does not merge anyone', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const bob = await register(ctx.app, 'bob');
    const house = await register(ctx.app, 'house');
    setPlatformUserId(ctx.db, house.userId);

    const filed = await ctx.app.inject({
      method: 'POST',
      url: '/api/me/merge-request',
      headers: auth(alice.token),
      payload: { fromUsername: 'alice', intoUsername: 'bob' },
    });
    const { requestId } = filed.json() as { requestId: number };

    const decided = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/merges/${requestId}`,
      headers: auth(house.token),
      payload: { approve: false },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ ok: true, status: 'rejected' });

    const aliceRow = ctx.db
      .prepare('SELECT disabled FROM users WHERE id = ?')
      .get(alice.userId) as { disabled: number };
    expect(aliceRow.disabled).toBe(0);
    await ctx.app.close();
  });

  it('rejects a merge-request naming the same username twice or an unknown username', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');

    const sameName = await ctx.app.inject({
      method: 'POST',
      url: '/api/me/merge-request',
      headers: auth(alice.token),
      payload: { fromUsername: 'alice', intoUsername: 'alice' },
    });
    expect(sameName.statusCode).toBe(400);

    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/me/merge-request',
      headers: auth(alice.token),
      payload: { fromUsername: 'alice', intoUsername: 'ghost' },
    });
    expect(unknown.statusCode).toBe(404);
    await ctx.app.close();
  });
});

describe('Task 4: admin disable + password reset', () => {
  it('non-platform gets 403 on both admin user routes', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const bob = await register(ctx.app, 'bob');
    setPlatformUserId(ctx.db, bob.userId); // bob is platform, alice is not

    const disable = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/users/${bob.userId}/disable`,
      headers: auth(alice.token),
    });
    expect(disable.statusCode).toBe(403);

    const reset = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/users/${bob.userId}/password`,
      headers: auth(alice.token),
      payload: { newAuthKey: 'c'.repeat(64), newPublicKey: 'd'.repeat(64) },
    });
    expect(reset.statusCode).toBe(403);
    await ctx.app.close();
  });

  it('platform disables a user: sessions die and the token 401s from then on', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const house = await register(ctx.app, 'house');
    setPlatformUserId(ctx.db, house.userId);

    const before = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(alice.token),
    });
    expect(before.statusCode).toBe(200);

    const disable = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/users/${alice.userId}/disable`,
      headers: auth(house.token),
    });
    expect(disable.statusCode).toBe(200);
    expect(disable.json()).toMatchObject({ ok: true });

    const row = ctx.db
      .prepare('SELECT disabled FROM users WHERE id = ?')
      .get(alice.userId) as { disabled: number };
    expect(row.disabled).toBe(1);

    const sessions = ctx.db.prepare('SELECT * FROM sessions WHERE user_id = ?').all(alice.userId);
    expect(sessions.length).toBe(0);

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(alice.token),
    });
    expect(after.statusCode).toBe(401);
    await ctx.app.close();
  });

  it('the platform account cannot disable itself', async () => {
    const ctx = createApp(':memory:');
    const house = await register(ctx.app, 'house');
    setPlatformUserId(ctx.db, house.userId);

    const disable = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/users/${house.userId}/disable`,
      headers: auth(house.token),
    });
    expect(disable.statusCode).toBe(400);

    const row = ctx.db
      .prepare('SELECT disabled FROM users WHERE id = ?')
      .get(house.userId) as { disabled: number };
    expect(row.disabled).toBe(0);
    await ctx.app.close();
  });

  it('platform resets a password: old sessions die, and login works with the new key', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const house = await register(ctx.app, 'house');
    setPlatformUserId(ctx.db, house.userId);

    const newAuthKey = 'e'.repeat(64);
    const newPublicKey = 'f'.repeat(64);
    const reset = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/users/${alice.userId}/password`,
      headers: auth(house.token),
      payload: { newAuthKey, newPublicKey },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ ok: true });

    // the old token is dead
    const stale = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(alice.token),
    });
    expect(stale.statusCode).toBe(401);

    // the old password no longer works
    const oldLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alice', authKey: 'a'.repeat(64) },
    });
    expect(oldLogin.statusCode).toBe(401);

    // but the new one does, and the pubkey it returns is the new one
    const newLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alice', authKey: newAuthKey },
    });
    expect(newLogin.statusCode).toBe(200);
    expect(newLogin.json()).toMatchObject({ userId: alice.userId, publicKey: newPublicKey });
    await ctx.app.close();
  });

  it('refuses a password reset while the target is seated', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const house = await register(ctx.app, 'house');
    setPlatformUserId(ctx.db, house.userId);
    const roomId = 'room20';
    seedRoom(ctx.db, roomId, alice.userId);
    ctx.db
      .prepare('INSERT INTO room_players (room_id, user_id, seat, stack) VALUES (?, ?, 1, ?)')
      .run(roomId, alice.userId, 300);

    const reset = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/users/${alice.userId}/password`,
      headers: auth(house.token),
      payload: { newAuthKey: 'e'.repeat(64), newPublicKey: 'f'.repeat(64) },
    });
    expect(reset.statusCode).toBe(409);

    // nothing changed - the original session and password still work
    const stillWorks = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(alice.token),
    });
    expect(stillWorks.statusCode).toBe(200);
    await ctx.app.close();
  });

  it('rejects a malformed newAuthKey/newPublicKey with 400', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const house = await register(ctx.app, 'house');
    setPlatformUserId(ctx.db, house.userId);

    const reset = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/users/${alice.userId}/password`,
      headers: auth(house.token),
      payload: { newAuthKey: 'not-hex', newPublicKey: 'f'.repeat(64) },
    });
    expect(reset.statusCode).toBe(400);
    await ctx.app.close();
  });
});
