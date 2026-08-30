import { createHash } from 'node:crypto';
import { canonicalize } from '@4am/mental-poker';
import type { DB } from './db.js';

export interface LedgerRow {
  id: number;
  room_id: string;
  user_id: number;
  delta: number;
  kind: string;
  approved_by: number | null;
  note: string | null;
  ref: string | null;
  ts: number;
  prev_hash: string;
  entry_hash: string;
}

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

function hashFields(prevHash: string, fields: Omit<LedgerRow, 'id' | 'prev_hash' | 'entry_hash'>): string {
  return sha256hex(prevHash + canonicalize(fields));
}

export function appendLedger(
  db: DB,
  e: {
    roomId: string;
    userId: number;
    delta: number;
    kind: string;
    approvedBy?: number;
    note?: string;
    ref?: string;
  },
): LedgerRow {
  const last = db
    .prepare('SELECT entry_hash FROM ledger WHERE room_id = ? ORDER BY id DESC LIMIT 1')
    .get(e.roomId) as { entry_hash: string } | undefined;
  const prevHash = last?.entry_hash ?? 'genesis';
  const fields = {
    room_id: e.roomId,
    user_id: e.userId,
    delta: e.delta,
    kind: e.kind,
    approved_by: e.approvedBy ?? null,
    note: e.note ?? null,
    ref: e.ref ?? null,
    ts: Date.now(),
  };
  const entryHash = hashFields(prevHash, fields);
  const info = db
    .prepare(
      `INSERT INTO ledger (room_id, user_id, delta, kind, approved_by, note, ref, ts, prev_hash, entry_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.room_id,
      fields.user_id,
      fields.delta,
      fields.kind,
      fields.approved_by,
      fields.note,
      fields.ref,
      fields.ts,
      prevHash,
      entryHash,
    );
  return { id: Number(info.lastInsertRowid), prev_hash: prevHash, entry_hash: entryHash, ...fields };
}

export function verifyLedger(db: DB, roomId: string): { ok: boolean; badId?: number } {
  const rows = db
    .prepare('SELECT * FROM ledger WHERE room_id = ? ORDER BY id ASC')
    .all(roomId) as LedgerRow[];
  let prev = 'genesis';
  for (const row of rows) {
    const { id, prev_hash, entry_hash, ...fields } = row;
    if (prev_hash !== prev || hashFields(prev, fields) !== entry_hash) return { ok: false, badId: id };
    prev = entry_hash;
  }
  return { ok: true };
}

/** Recomputes prev_hash/entry_hash for every row of a room, in id order from
 *  'genesis', using the rows' current field values. Used after a deliberate,
 *  audited rewrite of ledger history (e.g. re-attributing rake to the
 *  platform account) so the hash chain reflects the new-but-true history
 *  instead of being permanently broken. */
export function rechainRoom(db: DB, roomId: string): void {
  const rows = db.prepare('SELECT * FROM ledger WHERE room_id = ? ORDER BY id ASC').all(roomId) as LedgerRow[];
  let prev = 'genesis';
  const upd = db.prepare('UPDATE ledger SET prev_hash = ?, entry_hash = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const row of rows) {
      const { id, prev_hash, entry_hash, ...fields } = row;
      const eh = hashFields(prev, fields);
      upd.run(prev, eh, id);
      prev = eh;
    }
  });
  tx();
}

export function stackOf(db: DB, roomId: string, userId: number): number {
  const row = db
    .prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?')
    .get(roomId, userId) as { stack: number } | undefined;
  return row?.stack ?? 0;
}
