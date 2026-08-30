import type { DB } from './db.js';
import { rechainRoom, verifyLedger } from './ledger.js';
import { activeHands } from './liveHands.js';

/** Folds `fromUser`'s entire identity into `intoUser`: every table that
 *  references a user_id is repointed, `fromUser` is left disabled with
 *  `merged_into` set, and its sessions are killed so it can never
 *  authenticate again (see auth.ts's requireUser).
 *
 *  Runs as a single transaction - a merge that fails partway must leave the
 *  database exactly as it was, because this touches real money records
 *  (stacks, the hash-chained ledger, settlements). */
export function mergeAccounts(db: DB, fromUser: number, intoUser: number): void {
  if (fromUser === intoUser) {
    throw new Error('cannot merge an account into itself');
  }

  const from = db.prepare('SELECT id, disabled FROM users WHERE id = ?').get(fromUser) as
    | { id: number; disabled: number }
    | undefined;
  if (!from) throw new Error(`no such user: ${fromUser}`);
  if (from.disabled) throw new Error(`user ${fromUser} is already disabled`);

  const into = db.prepare('SELECT id, disabled FROM users WHERE id = ?').get(intoUser) as
    | { id: number; disabled: number }
    | undefined;
  if (!into) throw new Error(`no such user: ${intoUser}`);
  if (into.disabled) throw new Error(`user ${intoUser} is already disabled`);

  // Re-keying/merging while either side is seated in a hand that is actually
  // in progress would desync a live game (see account.ts's identical guard
  // for password/username changes) - refuse rather than corrupt a live deal.
  const seatedRooms = db
    .prepare(
      `SELECT DISTINCT room_id FROM room_players WHERE user_id IN (?, ?) AND seat IS NOT NULL`,
    )
    .all(fromUser, intoUser) as { room_id: string }[];
  for (const { room_id } of seatedRooms) {
    if (activeHands.has(room_id)) {
      throw new Error(`cannot merge: a hand is in progress in room ${room_id}`);
    }
  }

  const apply = db.transaction(() => {
    // 1. room_players: stack-merge if `into` is already at that table, else
    // just move the seatless row over.
    const fromRooms = db
      .prepare('SELECT room_id, stack FROM room_players WHERE user_id = ?')
      .all(fromUser) as { room_id: string; stack: number }[];
    for (const { room_id, stack } of fromRooms) {
      const existing = db
        .prepare('SELECT 1 FROM room_players WHERE room_id = ? AND user_id = ?')
        .get(room_id, intoUser);
      if (existing) {
        db.prepare(
          'UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?',
        ).run(stack, room_id, intoUser);
        db.prepare('DELETE FROM room_players WHERE room_id = ? AND user_id = ?').run(
          room_id,
          fromUser,
        );
      } else {
        db.prepare('UPDATE room_players SET user_id = ? WHERE room_id = ? AND user_id = ?').run(
          intoUser,
          room_id,
          fromUser,
        );
      }
    }

    // 2. ledger: repoint both the money row's owner and whoever approved it,
    // then rechain and re-verify the hash chain for every room the rewrite
    // touched. A merge that leaves a broken chain is worse than no merge, so
    // this throws (and the whole transaction rolls back) rather than proceed.
    const touchedLedgerRooms = new Set<string>(
      (
        db
          .prepare('SELECT DISTINCT room_id FROM ledger WHERE user_id = ? OR approved_by = ?')
          .all(fromUser, fromUser) as { room_id: string }[]
      ).map((r) => r.room_id),
    );
    db.prepare('UPDATE ledger SET user_id = ? WHERE user_id = ?').run(intoUser, fromUser);
    db.prepare('UPDATE ledger SET approved_by = ? WHERE approved_by = ?').run(intoUser, fromUser);
    for (const roomId of touchedLedgerRooms) {
      rechainRoom(db, roomId);
      const check = verifyLedger(db, roomId);
      if (!check.ok) {
        throw new Error(
          `ledger integrity check failed for room ${roomId} after merge (bad entry id ${check.badId})`,
        );
      }
    }

    // 3. rooms: host/banker/co-banker seats repoint to the surviving account.
    db.prepare('UPDATE rooms SET host_id = ? WHERE host_id = ?').run(intoUser, fromUser);
    db.prepare('UPDATE rooms SET banker_id = ? WHERE banker_id = ?').run(intoUser, fromUser);
    db.prepare('UPDATE rooms SET co_banker_id = ? WHERE co_banker_id = ?').run(intoUser, fromUser);

    // 4. Plain autoincrement-PK tables keyed only by user_id - no collision
    // risk, so a straight repoint is enough.
    db.prepare('UPDATE buy_requests SET user_id = ? WHERE user_id = ?').run(intoUser, fromUser);
    db.prepare('UPDATE join_requests SET user_id = ? WHERE user_id = ?').run(intoUser, fromUser);
    db.prepare('UPDATE house_payments SET user_id = ? WHERE user_id = ?').run(intoUser, fromUser);

    // 5. spectators / settlement_marks: user_id is part of the primary key, so
    // a plain UPDATE can collide with a row `into` already owns. OR IGNORE
    // keeps into's existing row and drops the (now-losing) from row.
    db.prepare('UPDATE OR IGNORE spectators SET user_id = ? WHERE user_id = ?').run(
      intoUser,
      fromUser,
    );
    db.prepare('DELETE FROM spectators WHERE user_id = ?').run(fromUser);
    db.prepare('UPDATE OR IGNORE settlement_marks SET user_id = ? WHERE user_id = ?').run(
      intoUser,
      fromUser,
    );
    db.prepare('DELETE FROM settlement_marks WHERE user_id = ?').run(fromUser);

    // 6. friends: composite PK on (requester_id, target_id) on both sides.
    // Move-then-dedupe each side, then drop any self-friend row the merge
    // just created (from and into were friends with each other).
    db.prepare('UPDATE OR IGNORE friends SET requester_id = ? WHERE requester_id = ?').run(
      intoUser,
      fromUser,
    );
    db.prepare('UPDATE OR IGNORE friends SET target_id = ? WHERE target_id = ?').run(
      intoUser,
      fromUser,
    );
    db.prepare('DELETE FROM friends WHERE requester_id = ? OR target_id = ?').run(
      fromUser,
      fromUser,
    );
    db.prepare('DELETE FROM friends WHERE requester_id = target_id').run();

    // 7. invites: no composite PK today, but follow the same move-then-dedupe
    // shape for safety against a future unique index, and always drop any
    // self-invite the merge would otherwise create.
    db.prepare('UPDATE OR IGNORE invites SET from_id = ? WHERE from_id = ?').run(
      intoUser,
      fromUser,
    );
    db.prepare('UPDATE OR IGNORE invites SET to_id = ? WHERE to_id = ?').run(intoUser, fromUser);
    db.prepare('DELETE FROM invites WHERE from_id = ? OR to_id = ?').run(fromUser, fromUser);
    db.prepare('DELETE FROM invites WHERE from_id = to_id').run();

    // 8. settlements: the subtle one. `low_user`/`high_user` are a POSITIONAL
    // pair (low_user is always numerically the smaller id - see pairOf() in
    // social.ts) that only exists to give every (room, pair) a canonical row.
    // `debtor` is NOT positional: it is an ABSOLUTE user id naming whoever
    // owes the money (see the settlements INSERT in social.ts, which always
    // writes `debtor: debt.from`), and `confirmed_low`/`confirmed_high` ARE
    // positional (they answer "did the low-id side confirm?", not "did the
    // debtor confirm?").
    //
    // So substituting `intoUser` for `fromUser` can only ever require:
    //   - relabelling low_user/high_user for the row's `into`-linked side, and
    //   - possibly re-sorting the pair if `intoUser`'s id lands on the other
    //     side of the *other* (non-merged) party's id than `fromUser`'s did -
    //     in which case confirmed_low/confirmed_high (positional) must swap
    //     together to keep tracking the same side, while `debtor` (absolute)
    //     is carried over untouched except for the from->into substitution
    //     itself. This never inverts who owes whom.
    // `settlements.id` is the only key (no unique index on the pair - see
    // idx_settlements_pair, which is a plain non-unique lookup index), so a
    // plain UPDATE by id is enough; no OR IGNORE/dedupe pass is needed here.
    interface SettlementRow {
      id: number;
      low_user: number;
      high_user: number;
      debtor: number;
      confirmed_low: number;
      confirmed_high: number;
    }
    const touchedSettlements = db
      .prepare(
        'SELECT id, low_user, high_user, debtor, confirmed_low, confirmed_high FROM settlements WHERE low_user = ? OR high_user = ?',
      )
      .all(fromUser, fromUser) as SettlementRow[];
    for (const row of touchedSettlements) {
      const newLow = row.low_user === fromUser ? intoUser : row.low_user;
      const newHigh = row.high_user === fromUser ? intoUser : row.high_user;
      const newDebtor = row.debtor === fromUser ? intoUser : row.debtor;
      if (newLow === newHigh) {
        // A settlement between from and into collapses onto one identity -
        // you cannot owe yourself, so the debt is dropped.
        db.prepare('DELETE FROM settlements WHERE id = ?').run(row.id);
      } else if (newLow < newHigh) {
        db.prepare(
          'UPDATE settlements SET low_user = ?, high_user = ?, debtor = ? WHERE id = ?',
        ).run(newLow, newHigh, newDebtor, row.id);
      } else {
        // intoUser's id sorts the other way relative to the untouched party -
        // swap the pair AND the positional confirmation flags together so
        // each still names the same physical side; debtor is an absolute id
        // and is written as-is.
        db.prepare(
          `UPDATE settlements
           SET low_user = ?, high_user = ?, debtor = ?, confirmed_low = ?, confirmed_high = ?
           WHERE id = ?`,
        ).run(newHigh, newLow, newDebtor, row.confirmed_high, row.confirmed_low, row.id);
      }
    }

    // 9. sessions: force re-login under the surviving identity.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(fromUser);

    // 10. users: retire the identity. requireUser (auth.ts) rejects it from here on.
    db.prepare('UPDATE users SET disabled = 1, merged_into = ? WHERE id = ?').run(
      intoUser,
      fromUser,
    );
  });
  apply();
}
