import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { verifyLedger } from '../src/ledger.js';
import { settleRake } from '../src/rake.js';

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
