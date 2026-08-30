import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { appendLedger, verifyLedger } from '../src/ledger.js';
import { settleRake, rewriteRakeToPlatform } from '../src/rake.js';
import { createApp } from '../src/app.js';
import { setPlatformUserId } from '../src/platform.js';

function seedRoom(db: ReturnType<typeof openDb>, roomId: string, hostId: number) {
  db.prepare(
    `INSERT INTO rooms (id, name, join_code, host_id, banker_id, sb, bb, audit_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'private', ?)`,
  ).run(roomId, 'T', roomId.toUpperCase().slice(0, 6), hostId, hostId, 1, 2, Date.now());
}

describe('settleRake', () => {
  it('credits the platform account, creates membership, and appends a verifiable commission entry', () => {
    const db = openDb(':memory:');
    const { userId: hostId } = createUser(db, 'host', 'a'.repeat(64), 'b'.repeat(64));
    const { userId: platformId } = createUser(db, 'house', 'c'.repeat(64), 'd'.repeat(64));
    seedRoom(db, 'room01', hostId);

    settleRake(db, { roomId: 'room01', recipientId: platformId, rake: 50, ref: 'h1' });

    const row = db
      .prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?')
      .get('room01', platformId) as { stack: number } | undefined;
    expect(row?.stack).toBe(50);

    const ledgerRows = db
      .prepare("SELECT * FROM ledger WHERE room_id = ? AND kind = 'commission'")
      .all('room01') as { user_id: number; delta: number; ref: string }[];
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]).toMatchObject({ user_id: platformId, delta: 50, ref: 'h1' });

    expect(verifyLedger(db, 'room01').ok).toBe(true);
  });

  it('is a no-op when rake is 0', () => {
    const db = openDb(':memory:');
    const { userId: hostId } = createUser(db, 'host', 'a'.repeat(64), 'b'.repeat(64));
    const { userId: platformId } = createUser(db, 'house', 'c'.repeat(64), 'd'.repeat(64));
    seedRoom(db, 'room01', hostId);

    settleRake(db, { roomId: 'room01', recipientId: platformId, rake: 0, ref: 'h1' });

    const row = db
      .prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?')
      .get('room01', platformId) as { stack: number } | undefined;
    expect(row).toBeUndefined();

    const ledgerRows = db.prepare('SELECT * FROM ledger WHERE room_id = ?').all('room01');
    expect(ledgerRows).toHaveLength(0);
  });

  it('increments stack without a duplicate-membership error when recipient is already a member', () => {
    const db = openDb(':memory:');
    const { userId: hostId } = createUser(db, 'host', 'a'.repeat(64), 'b'.repeat(64));
    const { userId: platformId } = createUser(db, 'house', 'c'.repeat(64), 'd'.repeat(64));
    seedRoom(db, 'room01', hostId);
    db.prepare('INSERT INTO room_players (room_id, user_id, stack) VALUES (?, ?, ?)').run(
      'room01',
      platformId,
      1000,
    );

    expect(() =>
      settleRake(db, { roomId: 'room01', recipientId: platformId, rake: 25, ref: 'h1' }),
    ).not.toThrow();

    const row = db
      .prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?')
      .get('room01', platformId) as { stack: number };
    expect(row.stack).toBe(1025);
    expect(verifyLedger(db, 'room01').ok).toBe(true);
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
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('platform excluded from peer settle-up', () => {
  it('lists the other player but not the platform account, with the amount unaffected by the rake', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'p2_alice');
    const bob = await register(ctx.app, 'p2_bob');
    const house = await register(ctx.app, 'p2_house');
    setPlatformUserId(ctx.db, house.userId);

    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(alice.token),
        payload: { name: 'Settle Test', sb: 10, bb: 20 },
      })
    ).json();
    await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms/join',
      headers: auth(bob.token),
      payload: { joinCode: room.joinCode },
    });

    // both buy in 500, approved by the banker (alice)
    for (const p of [alice, bob]) {
      const req = (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/rooms/${room.id}/buy`,
          headers: auth(p.token),
          payload: { amount: 500 },
        })
      ).json();
      await ctx.app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/approve`,
        headers: auth(alice.token),
        payload: { requestId: req.id, approve: true },
      });
    }

    // a hand: alice wins 200, bob loses 250, the 50 rake goes to the platform
    ctx.db
      .prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?')
      .run(200, room.id, alice.userId);
    ctx.db
      .prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?')
      .run(-250, room.id, bob.userId);
    appendLedger(ctx.db, { roomId: room.id, userId: alice.userId, delta: 200, kind: 'hand-settlement', ref: 'h1' });
    appendLedger(ctx.db, { roomId: room.id, userId: bob.userId, delta: -250, kind: 'hand-settlement', ref: 'h1' });
    settleRake(ctx.db, { roomId: room.id, recipientId: house.userId, rake: 50, ref: 'h1' });
    expect(verifyLedger(ctx.db, room.id).ok).toBe(true);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/settle',
      headers: auth(bob.token),
    });
    const people = res.json().people as { otherUserId: number; net: number }[];
    const otherIds = people.map((p) => p.otherUserId);
    expect(otherIds).toContain(alice.userId);
    expect(otherIds).not.toContain(house.userId);
    const aliceLine = people.find((p) => p.otherUserId === alice.userId);
    expect(aliceLine?.net).toBe(-200);

    await ctx.app.close();
  });
});

describe('rewriteRakeToPlatform', () => {
  it('re-attributes a legacy banker-keyed commission row to the platform, moving the chips', () => {
    const db = openDb(':memory:');
    const { userId: hostId } = createUser(db, 'host', 'a'.repeat(64), 'b'.repeat(64));
    const { userId: platformId } = createUser(db, 'house', 'c'.repeat(64), 'd'.repeat(64));
    seedRoom(db, 'room01', hostId);

    // legacy behaviour: the banker bought in 1000, then a hand's rake (50)
    // was credited straight to the banker (the pre-platform recipient)
    db.prepare('INSERT INTO room_players (room_id, user_id, stack) VALUES (?, ?, ?)').run(
      'room01',
      hostId,
      1000,
    );
    appendLedger(db, { roomId: 'room01', userId: hostId, delta: 1000, kind: 'purchase', ref: 'buy1' });
    settleRake(db, { roomId: 'room01', recipientId: hostId, rake: 50, ref: 'h1' });
    expect(verifyLedger(db, 'room01').ok).toBe(true);

    const report = rewriteRakeToPlatform(db, platformId);

    expect(report.roomsRewritten).toEqual(['room01']);
    expect(report.roomsSkippedBankerSpent).toEqual([]);

    const commission = db
      .prepare("SELECT user_id, delta FROM ledger WHERE room_id = ? AND kind = 'commission'")
      .get('room01') as { user_id: number; delta: number };
    expect(commission).toMatchObject({ user_id: platformId, delta: 50 });

    const hostStack = (
      db.prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?').get('room01', hostId) as {
        stack: number;
      }
    ).stack;
    expect(hostStack).toBe(1000);

    const platformStack = (
      db
        .prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?')
        .get('room01', platformId) as { stack: number }
    ).stack;
    expect(platformStack).toBe(50);

    expect(verifyLedger(db, 'room01').ok).toBe(true);
  });

  it('skips a room and reports it when the banker has already spent below the reclaim amount', () => {
    const db = openDb(':memory:');
    const { userId: hostId } = createUser(db, 'host', 'a'.repeat(64), 'b'.repeat(64));
    const { userId: platformId } = createUser(db, 'house', 'c'.repeat(64), 'd'.repeat(64));
    seedRoom(db, 'room01', hostId);

    settleRake(db, { roomId: 'room01', recipientId: hostId, rake: 50, ref: 'h1' });
    // the banker has since spent chips elsewhere; stack is now below the 50 reclaim
    db.prepare('UPDATE room_players SET stack = ? WHERE room_id = ? AND user_id = ?').run(30, 'room01', hostId);
    expect(verifyLedger(db, 'room01').ok).toBe(true);

    const before = db.prepare('SELECT * FROM ledger WHERE room_id = ? ORDER BY id').all('room01');

    const report = rewriteRakeToPlatform(db, platformId);

    expect(report.roomsRewritten).toEqual([]);
    expect(report.roomsSkippedBankerSpent).toEqual([
      { roomId: 'room01', bankerId: hostId, reclaim: 50, bankerStack: 30 },
    ]);

    const after = db.prepare('SELECT * FROM ledger WHERE room_id = ? ORDER BY id').all('room01');
    expect(after).toEqual(before);
    const hostStack = (
      db.prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?').get('room01', hostId) as {
        stack: number;
      }
    ).stack;
    expect(hostStack).toBe(30);
    expect(verifyLedger(db, 'room01').ok).toBe(true);
  });

  it('is idempotent: a second run rewrites nothing once commission rows are already platform-keyed', () => {
    const db = openDb(':memory:');
    const { userId: hostId } = createUser(db, 'host', 'a'.repeat(64), 'b'.repeat(64));
    const { userId: platformId } = createUser(db, 'house', 'c'.repeat(64), 'd'.repeat(64));
    seedRoom(db, 'room01', hostId);
    db.prepare('INSERT INTO room_players (room_id, user_id, stack) VALUES (?, ?, ?)').run(
      'room01',
      hostId,
      1000,
    );
    settleRake(db, { roomId: 'room01', recipientId: hostId, rake: 50, ref: 'h1' });

    const first = rewriteRakeToPlatform(db, platformId);
    expect(first.roomsRewritten).toEqual(['room01']);

    const afterFirst = db.prepare('SELECT * FROM ledger WHERE room_id = ? ORDER BY id').all('room01');

    const second = rewriteRakeToPlatform(db, platformId);
    expect(second.roomsRewritten).toEqual([]);
    expect(second.roomsSkippedBankerSpent).toEqual([]);

    const afterSecond = db.prepare('SELECT * FROM ledger WHERE room_id = ? ORDER BY id').all('room01');
    expect(afterSecond).toEqual(afterFirst);
    expect(verifyLedger(db, 'room01').ok).toBe(true);
  });
});
