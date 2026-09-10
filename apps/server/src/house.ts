import type { HouseDues, HouseRoom, PlatformDuesReport, PlatformDuesUser } from '@4am/shared';
import type { DB } from './db.js';
import { platformUserId } from './platform.js';

/** One source for personal dues and the platform's receivables. Allocation keeps
 * the established rule (net winners share each hand's commission), but assigns
 * each odd chip once, instead of rounding each person's share independently.
 * Retired rooms and voided hands follow the existing settle-up exclusions. */
export function platformDues(db: DB, onlyUserId: number | null = null): PlatformDuesReport {
  const platformId = platformUserId(db);
  const rows = db
    .prepare(
      `
    WITH commissions AS (
      SELECT l.room_id AS roomId, l.ref, SUM(l.delta) AS rake,
             r.name AS roomName, r.commission_bps AS commissionBps
      FROM ledger l JOIN rooms r ON r.id = l.room_id
      WHERE l.kind = 'commission' AND r.voided = 0 AND r.archived = 0 AND r.deleted = 0
        AND NOT EXISTS (SELECT 1 FROM ledger v WHERE v.room_id = l.room_id AND v.kind = 'void-hand' AND v.ref = l.ref)
        AND (@userId IS NULL OR EXISTS (
          SELECT 1 FROM ledger m WHERE m.room_id = l.room_id AND m.ref = l.ref
            AND m.kind = 'hand-settlement' AND m.user_id = @userId))
      GROUP BY l.room_id, l.ref HAVING SUM(l.delta) > 0
    ), winners AS (
      SELECT room_id, ref, user_id AS userId, SUM(delta) AS net
      FROM ledger WHERE kind = 'hand-settlement' AND (@platformId IS NULL OR user_id != @platformId)
      GROUP BY room_id, ref, user_id HAVING SUM(delta) > 0
    )
    SELECT c.*, w.userId, w.net FROM commissions c
    LEFT JOIN winners w ON w.room_id = c.roomId AND w.ref = c.ref
    ORDER BY c.roomId, c.ref, w.userId
  `,
    )
    .all({ userId: onlyUserId, platformId }) as {
    roomId: string;
    roomName: string;
    commissionBps: number;
    ref: string | null;
    rake: number;
    userId: number | null;
    net: number | null;
  }[];
  const hands = new Map<
    string,
    { room: HouseRoom; rake: number; winners: { userId: number; net: number }[] }
  >();
  for (const row of rows) {
    const key = JSON.stringify([row.roomId, row.ref]);
    let hand = hands.get(key);
    if (!hand) {
      hand = {
        room: {
          roomId: row.roomId,
          roomName: row.roomName,
          commissionBps: row.commissionBps,
          accrued: 0,
        },
        rake: row.rake,
        winners: [],
      };
      hands.set(key, hand);
    }
    if (row.userId !== null && row.net !== null)
      hand.winners.push({ userId: row.userId, net: row.net });
  }
  const roomsByUser = new Map<number, Map<string, HouseRoom>>();
  let unallocated = 0;
  for (const hand of hands.values()) {
    const total = hand.winners.reduce((sum, w) => sum + BigInt(w.net), 0n);
    if (total === 0n) {
      unallocated += hand.rake;
      continue;
    }
    const shares = hand.winners
      .map((w) => {
        const numerator = BigInt(hand.rake) * BigInt(w.net);
        return {
          userId: w.userId,
          amount: Number(numerator / total),
          remainder: numerator % total,
        };
      })
      .sort((a, b) =>
        a.remainder === b.remainder ? a.userId - b.userId : a.remainder > b.remainder ? -1 : 1,
      );
    let remaining = hand.rake - shares.reduce((sum, s) => sum + s.amount, 0);
    for (const share of shares) {
      if (remaining > 0) {
        share.amount++;
        remaining--;
      }
      if (share.amount === 0 || (onlyUserId !== null && share.userId !== onlyUserId)) continue;
      let rooms = roomsByUser.get(share.userId);
      if (!rooms) {
        rooms = new Map();
        roomsByUser.set(share.userId, rooms);
      }
      const room = rooms.get(hand.room.roomId) ?? { ...hand.room };
      room.accrued += share.amount;
      rooms.set(room.roomId, room);
    }
  }
  const payments = db
    .prepare(
      `SELECT user_id AS userId, SUM(amount) AS paid FROM house_payments
    WHERE (@userId IS NULL OR user_id = @userId) GROUP BY user_id`,
    )
    .all({ userId: onlyUserId }) as { userId: number; paid: number }[];
  const paidByUser = new Map(payments.map((p) => [p.userId, p.paid]));
  const users = db
    .prepare(
      `SELECT id AS userId, username, COALESCE(display_name, username) AS displayName,
    avatar_version AS avatarVersion FROM users WHERE (@userId IS NULL OR id = @userId)
    AND (@platformId IS NULL OR id != @platformId)`,
    )
    .all({ userId: onlyUserId, platformId }) as {
    userId: number;
    username: string;
    displayName: string;
    avatarVersion: number;
  }[];
  const people: PlatformDuesUser[] = [];
  for (const user of users) {
    const rooms = [...(roomsByUser.get(user.userId)?.values() ?? [])].sort(
      (a, b) => b.accrued - a.accrued || a.roomName.localeCompare(b.roomName),
    );
    const accrued = rooms.reduce((sum, room) => sum + room.accrued, 0);
    const paid = paidByUser.get(user.userId) ?? 0;
    if (!accrued && !paid) continue;
    people.push({
      ...user,
      rooms,
      accrued,
      paid,
      outstanding: Math.max(0, accrued - paid),
      credit: Math.max(0, paid - accrued),
    });
  }
  people.sort(
    (a, b) =>
      b.outstanding - a.outstanding ||
      a.displayName.localeCompare(b.displayName) ||
      a.userId - b.userId,
  );
  const totals = people.reduce(
    (sum, user) => ({
      accrued: sum.accrued + user.accrued,
      paid: sum.paid + user.paid,
      outstanding: sum.outstanding + user.outstanding,
      credit: sum.credit + user.credit,
      usersOwing: sum.usersOwing + (user.outstanding > 0 ? 1 : 0),
      unallocated: sum.unallocated,
    }),
    { accrued: 0, paid: 0, outstanding: 0, credit: 0, usersOwing: 0, unallocated },
  );
  return { people, totals };
}

export function houseDues(db: DB, userId: number): HouseDues {
  const person = platformDues(db, userId).people[0];
  if (!person) return { accrued: 0, paid: 0, outstanding: 0, credit: 0, rooms: [] };
  const { accrued, paid, outstanding, credit, rooms } = person;
  return { accrued, paid, outstanding, credit, rooms };
}
