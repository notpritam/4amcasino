import type { DB } from './db.js';
import { appendLedger, rechainRoom, verifyLedger } from './ledger.js';

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

export interface RewriteReport {
  roomsRewritten: string[];
  roomsSkippedBankerSpent: { roomId: string; bankerId: number; reclaim: number; bankerStack: number }[];
}

/** One-time (idempotent) history rewrite: re-attributes every legacy
 *  commission ledger row - one that was credited straight to a room's
 *  banker, before the platform account existed - to the platform account
 *  instead. Moves the corresponding chips out of the banker's stack and
 *  into the platform's, then rechains the room so the hash chain reflects
 *  the corrected-but-true history. A room is skipped (and reported) rather
 *  than mutated if the banker has since spent below the amount being
 *  reclaimed - we never drive a stack negative to fix history. */
export function rewriteRakeToPlatform(db: DB, platformId: number): RewriteReport {
  const report: RewriteReport = { roomsRewritten: [], roomsSkippedBankerSpent: [] };

  const tx = db.transaction(() => {
    const rooms = db
      .prepare(
        `SELECT DISTINCT room_id FROM ledger WHERE kind = 'commission' AND user_id != ?`,
      )
      .all(platformId) as { room_id: string }[];

    for (const { room_id: roomId } of rooms) {
      const recipients = db
        .prepare(
          `SELECT user_id, SUM(delta) as reclaim FROM ledger
           WHERE room_id = ? AND kind = 'commission' AND user_id != ?
           GROUP BY user_id`,
        )
        .all(roomId, platformId) as { user_id: number; reclaim: number }[];

      let skipped = false;
      for (const { user_id: bankerId, reclaim } of recipients) {
        const bankerRow = db
          .prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?')
          .get(roomId, bankerId) as { stack: number } | undefined;
        const bankerStack = bankerRow?.stack ?? 0;
        if (bankerStack < reclaim) {
          report.roomsSkippedBankerSpent.push({ roomId, bankerId, reclaim, bankerStack });
          skipped = true;
        }
      }
      if (skipped) continue;

      for (const { user_id: bankerId, reclaim } of recipients) {
        db.prepare('UPDATE room_players SET stack = stack - ? WHERE room_id = ? AND user_id = ?').run(
          reclaim,
          roomId,
          bankerId,
        );
        db.prepare('INSERT OR IGNORE INTO room_players (room_id, user_id) VALUES (?, ?)').run(
          roomId,
          platformId,
        );
        db.prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?').run(
          reclaim,
          roomId,
          platformId,
        );
      }

      db.prepare(`UPDATE ledger SET user_id = ? WHERE room_id = ? AND kind = 'commission' AND user_id != ?`).run(
        platformId,
        roomId,
        platformId,
      );

      rechainRoom(db, roomId);
      const verified = verifyLedger(db, roomId);
      if (!verified.ok) {
        throw new Error(`rewriteRakeToPlatform: ledger verification failed for room ${roomId} after rewrite`);
      }

      report.roomsRewritten.push(roomId);
    }
  });
  tx();

  return report;
}
