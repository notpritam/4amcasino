import {
  NEW_ROOM_COMMISSION_BPS,
  type CommissionSettings,
  type CommissionScope,
} from '@4am/shared';
import type { DB } from './db.js';

/** Capture historical rates before a room's editable setting changes. Older
 * commission notes already record the rate; never rewrite the hashed ledger. */
function captureHistoricalRates(db: DB): void {
  const rows = db
    .prepare(
      `
    SELECT l.room_id AS roomId, l.ref, l.note, r.commission_bps AS commissionBps
    FROM ledger l JOIN rooms r ON r.id = l.room_id
    LEFT JOIN hand_commission_rates h ON h.room_id = l.room_id AND h.ref = l.ref
    WHERE l.kind = 'commission' AND l.ref IS NOT NULL AND h.ref IS NULL
    ORDER BY l.id
  `,
    )
    .all() as { roomId: string; ref: string; note: string | null; commissionBps: number }[];
  const insert = db.prepare(
    'INSERT OR IGNORE INTO hand_commission_rates (room_id, ref, commission_bps) VALUES (?, ?, ?)',
  );
  for (const row of rows) {
    const match = row.note?.match(/^(\d+(?:\.\d{1,2})?)% table commission/);
    const rate = match ? Math.round(Number(match[1]) * 100) : row.commissionBps;
    insert.run(row.roomId, row.ref, rate >= 0 && rate <= 10000 ? rate : row.commissionBps);
  }
}

export function initializePlatformSettings(db: DB): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        commission_bps INTEGER NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
        revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by INTEGER
      );
      CREATE TABLE IF NOT EXISTS commission_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, previous_bps INTEGER, commission_bps INTEGER NOT NULL,
        scope TEXT NOT NULL, affected_rooms INTEGER NOT NULL, changed_by INTEGER, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hand_commission_rates (
        room_id TEXT NOT NULL, ref TEXT NOT NULL, commission_bps INTEGER NOT NULL,
        PRIMARY KEY (room_id, ref)
      );
    `);
    captureHistoricalRates(db);
    if (db.prepare('SELECT id FROM platform_settings WHERE id = 1').get()) return;
    const now = Date.now();
    const affected = db
      .prepare('UPDATE rooms SET commission_bps = ? WHERE commission_bps != ?')
      .run(NEW_ROOM_COMMISSION_BPS, NEW_ROOM_COMMISSION_BPS).changes;
    db.prepare('INSERT INTO platform_settings VALUES (1, ?, 1, ?, NULL)').run(
      NEW_ROOM_COMMISSION_BPS,
      now,
    );
    db.prepare(
      `INSERT INTO commission_changes (previous_bps, commission_bps, scope, affected_rooms, changed_by, created_at)
      VALUES (NULL, ?, 'all_rooms', ?, NULL, ?)`,
    ).run(NEW_ROOM_COMMISSION_BPS, affected, now);
  })();
}

export function commissionSettings(db: DB): Omit<CommissionSettings, 'history'> {
  return db
    .prepare(
      `SELECT commission_bps AS commissionBps, revision, updated_at AS updatedAt,
    updated_by AS updatedBy FROM platform_settings WHERE id = 1`,
    )
    .get() as Omit<CommissionSettings, 'history'>;
}

export function adminCommissionSettings(db: DB): CommissionSettings {
  const history = db
    .prepare(
      `SELECT c.id, c.previous_bps AS previousBps, c.commission_bps AS commissionBps,
    c.scope, c.affected_rooms AS affectedRooms, c.changed_by AS changedBy,
    COALESCE(u.display_name, u.username, 'Initial setup') AS changedByName, c.created_at AS createdAt
    FROM commission_changes c LEFT JOIN users u ON u.id = c.changed_by ORDER BY c.id DESC LIMIT 50`,
    )
    .all() as CommissionSettings['history'];
  return { ...commissionSettings(db), history };
}

export function changeCommission(
  db: DB,
  input: { commissionBps: number; revision: number; scope: CommissionScope },
  userId: number,
) {
  return db.transaction(() => {
    const current = commissionSettings(db);
    if (current.revision !== input.revision) return null;
    captureHistoricalRates(db);
    const rooms =
      input.scope === 'all_rooms'
        ? (db
            .prepare('SELECT id FROM rooms WHERE commission_bps != ?')
            .all(input.commissionBps) as { id: string }[])
        : [];
    if (input.scope === 'all_rooms')
      db.prepare('UPDATE rooms SET commission_bps = ?').run(input.commissionBps);
    const now = Date.now();
    db.prepare(
      'UPDATE platform_settings SET commission_bps = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = 1',
    ).run(input.commissionBps, now, userId);
    db.prepare(
      `INSERT INTO commission_changes (previous_bps, commission_bps, scope, affected_rooms, changed_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(current.commissionBps, input.commissionBps, input.scope, rooms.length, userId, now);
    return {
      ...adminCommissionSettings(db),
      affectedRooms: rooms.length,
      roomIds: rooms.map((r) => r.id),
    };
  })();
}
