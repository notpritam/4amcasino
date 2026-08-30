import type { DB } from './db.js';
import { appendLedger } from './ledger.js';

/** Credits raked chips to `recipientId` on the room ledger (same hand ref), ensuring
 *  the recipient is a room member first so the stack has somewhere to land. */
export function settleRake(
  db: DB,
  args: { roomId: string; recipientId: number; rake: number; ref: string },
): void {
  if (args.rake <= 0) return;
  db.prepare('INSERT OR IGNORE INTO room_players (room_id, user_id) VALUES (?, ?)').run(
    args.roomId,
    args.recipientId,
  );
  db.prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?').run(
    args.rake,
    args.roomId,
    args.recipientId,
  );
  appendLedger(db, {
    roomId: args.roomId,
    userId: args.recipientId,
    delta: args.rake,
    kind: 'commission',
    ref: args.ref,
    note: '1% table commission - keeps the lights on',
  });
}
