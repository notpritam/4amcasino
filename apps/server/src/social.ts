import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from './db.js';
import { ONLINE_WINDOW_MS, requireUser } from './auth.js';
import { canBank, getRoom, isMember, isSpectator, roomEvents, roomPlayers } from './rooms.js';
import { appendLedger } from './ledger.js';
import { activeHands } from './liveHands.js';
import { LIMITS } from './limits.js';
import { decodeProof, registerSettleRoutes } from './settle.js';
import { randomBytes } from 'node:crypto';

/** Friends, presence, room invites, and banker invalidation. */
export function registerSocialRoutes(app: FastifyInstance, db: DB): void {
  const authed = { preHandler: requireUser(db) };

  const userCols = `u.id as userId, u.username, COALESCE(u.display_name, u.username) as displayName,
                    u.avatar_version as avatarVersion, u.last_seen as lastSeen`;
  const withOnline = <T extends { lastSeen: number }>(rows: T[]) =>
    rows.map((r) => ({ ...r, online: Date.now() - r.lastSeen < ONLINE_WINDOW_MS }));

  app.get('/api/friends', authed, async (req) => {
    const friends = db
      .prepare(
        `SELECT ${userCols} FROM friends f
         JOIN users u ON u.id = CASE WHEN f.requester_id = @me THEN f.target_id ELSE f.requester_id END
         WHERE (f.requester_id = @me OR f.target_id = @me) AND f.status = 'accepted'
         ORDER BY u.last_seen DESC`,
      )
      .all({ me: req.userId }) as { userId: number; username: string; displayName: string; avatarVersion: number; lastSeen: number }[];
    const incoming = db
      .prepare(
        `SELECT ${userCols} FROM friends f JOIN users u ON u.id = f.requester_id
         WHERE f.target_id = @me AND f.status = 'pending'`,
      )
      .all({ me: req.userId }) as typeof friends;
    const outgoing = db
      .prepare(
        `SELECT ${userCols} FROM friends f JOIN users u ON u.id = f.target_id
         WHERE f.requester_id = @me AND f.status = 'pending'`,
      )
      .all({ me: req.userId }) as typeof friends;
    return { friends: withOnline(friends), incoming: withOnline(incoming), outgoing: withOnline(outgoing) };
  });

  app.post('/api/friends/request', authed, async (req, reply) => {
    const parsed = z.object({ username: z.string().min(2).max(24) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const target = db.prepare('SELECT id FROM users WHERE username = ?').get(parsed.data.username) as
      | { id: number }
      | undefined;
    if (!target) return reply.code(404).send({ error: 'no player with that username' });
    if (target.id === req.userId) return reply.code(400).send({ error: 'that is you' });
    const existing = db
      .prepare(
        'SELECT requester_id, status FROM friends WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)',
      )
      .get(req.userId, target.id, target.id, req.userId) as { requester_id: number; status: string } | undefined;
    if (existing?.status === 'accepted') return reply.code(400).send({ error: 'already friends' });
    if (existing && existing.requester_id === req.userId)
      return reply.code(400).send({ error: 'request already sent' });
    if (existing) {
      // they asked first: this counts as accepting
      db.prepare("UPDATE friends SET status = 'accepted' WHERE requester_id = ? AND target_id = ?").run(
        target.id,
        req.userId,
      );
      return { ok: true, accepted: true };
    }
    db.prepare('INSERT INTO friends (requester_id, target_id, status, created_at) VALUES (?, ?, ?, ?)').run(
      req.userId,
      target.id,
      'pending',
      Date.now(),
    );
    return { ok: true, accepted: false };
  });

  app.post('/api/friends/respond', authed, async (req, reply) => {
    const parsed = z.object({ userId: z.number().int(), accept: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const row = db
      .prepare("SELECT 1 FROM friends WHERE requester_id = ? AND target_id = ? AND status = 'pending'")
      .get(parsed.data.userId, req.userId);
    if (!row) return reply.code(404).send({ error: 'no such request' });
    if (parsed.data.accept) {
      db.prepare("UPDATE friends SET status = 'accepted' WHERE requester_id = ? AND target_id = ?").run(
        parsed.data.userId,
        req.userId,
      );
    } else {
      db.prepare('DELETE FROM friends WHERE requester_id = ? AND target_id = ?').run(
        parsed.data.userId,
        req.userId,
      );
    }
    return { ok: true };
  });

  app.delete('/api/friends/:userId', authed, async (req) => {
    const other = Number((req.params as { userId: string }).userId);
    db.prepare(
      'DELETE FROM friends WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)',
    ).run(req.userId, other, other, req.userId);
    return { ok: true };
  });

  const areFriends = (a: number, b: number): boolean =>
    !!db
      .prepare(
        "SELECT 1 FROM friends WHERE status = 'accepted' AND ((requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?))",
      )
      .get(a, b, b, a);

  app.post('/api/rooms/:id/invite', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ userId: z.number().int() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (!isMember(db, id, req.userId)) return reply.code(403).send({ error: 'not a member' });
    if (!areFriends(req.userId, parsed.data.userId))
      return reply.code(400).send({ error: 'you can only invite friends' });
    if (isMember(db, id, parsed.data.userId))
      return reply.code(400).send({ error: 'already at this table' });
    const target = db
      .prepare('SELECT auto_join_invites as autoJoin FROM users WHERE id = ?')
      .get(parsed.data.userId) as { autoJoin: number } | undefined;
    if (!target) return reply.code(404).send({ error: 'no such player' });
    if (target.autoJoin) {
      db.prepare('INSERT OR IGNORE INTO room_players (room_id, user_id) VALUES (?, ?)').run(
        id,
        parsed.data.userId,
      );
      db.prepare('INSERT INTO invites (room_id, from_id, to_id, status, ts) VALUES (?, ?, ?, ?, ?)').run(
        id,
        req.userId,
        parsed.data.userId,
        'accepted',
        Date.now(),
      );
      roomEvents.emit('changed', id);
      return { ok: true, autoJoined: true };
    }
    const pending = db
      .prepare("SELECT 1 FROM invites WHERE room_id = ? AND to_id = ? AND status = 'pending'")
      .get(id, parsed.data.userId);
    if (pending) return reply.code(400).send({ error: 'already invited' });
    db.prepare('INSERT INTO invites (room_id, from_id, to_id, status, ts) VALUES (?, ?, ?, ?, ?)').run(
      id,
      req.userId,
      parsed.data.userId,
      'pending',
      Date.now(),
    );
    return { ok: true, autoJoined: false };
  });

  app.get('/api/invites', authed, async (req) => {
    const rows = db
      .prepare(
        `SELECT i.id, i.room_id as roomId, r.name as roomName, r.join_code as joinCode, r.sb, r.bb, i.ts,
                COALESCE(u.display_name, u.username) as fromName
         FROM invites i JOIN rooms r ON r.id = i.room_id JOIN users u ON u.id = i.from_id
         WHERE i.to_id = ? AND i.status = 'pending' ORDER BY i.ts DESC`,
      )
      .all(req.userId);
    return { invites: rows };
  });

  app.post('/api/invites/:id/respond', authed, async (req, reply) => {
    const inviteId = Number((req.params as { id: string }).id);
    const parsed = z.object({ accept: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const invite = db
      .prepare("SELECT room_id FROM invites WHERE id = ? AND to_id = ? AND status = 'pending'")
      .get(inviteId, req.userId) as { room_id: string } | undefined;
    if (!invite) return reply.code(404).send({ error: 'no such invite' });
    db.prepare('UPDATE invites SET status = ? WHERE id = ?').run(
      parsed.data.accept ? 'accepted' : 'declined',
      inviteId,
    );
    if (parsed.data.accept) {
      db.prepare('INSERT OR IGNORE INTO room_players (room_id, user_id) VALUES (?, ?)').run(
        invite.room_id,
        req.userId,
      );
      roomEvents.emit('changed', invite.room_id);
    }
    return { ok: true, roomId: parsed.data.accept ? invite.room_id : null };
  });

  // ---------- spectators: a watch-only share link ----------

  // the host controls whether the watch link works, and fetches it here
  app.post('/api/rooms/:id/spectate-settings', authed, async (req, reply) => {
    const parsed = z.object({ allow: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { id } = req.params as { id: string };
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (room.host_id !== req.userId && !canBank(room, req.userId))
      return reply.code(403).send({ error: 'host or banker only' });
    let token = room.spectate_token;
    if (!token) {
      token = randomBytes(9).toString('hex');
      db.prepare('UPDATE rooms SET spectate_token = ? WHERE id = ?').run(token, id);
    }
    if (parsed.data.allow !== undefined) {
      db.prepare('UPDATE rooms SET allow_spectators = ? WHERE id = ?').run(parsed.data.allow ? 1 : 0, id);
    }
    const fresh = getRoom(db, id)!;
    return { allow: !!fresh.allow_spectators, token };
  });

  // anyone with the link (and an account) becomes a watch-only spectator
  app.get('/api/watch/:token', authed, async (req, reply) => {
    const { token } = req.params as { token: string };
    const room = db.prepare('SELECT * FROM rooms WHERE spectate_token = ?').get(token) as
      | { id: string; name: string; allow_spectators: number }
      | undefined;
    if (!room) return reply.code(404).send({ error: 'no such watch link' });
    if (isMember(db, room.id, req.userId)) return { roomId: room.id, name: room.name, member: true };
    if (!room.allow_spectators)
      return reply.code(403).send({ error: 'the host turned watching off for this table' });
    db.prepare('INSERT OR IGNORE INTO spectators (room_id, user_id, ts) VALUES (?, ?, ?)').run(
      room.id,
      req.userId,
      Date.now(),
    );
    return { roomId: room.id, name: room.name, member: false };
  });

  // a spectator can raise a hand; the host or a banker lets them in
  app.post('/api/rooms/:id/ask-join', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getRoom(db, id)) return reply.code(404).send({ error: 'no such room' });
    if (!isSpectator(db, id, req.userId)) return reply.code(403).send({ error: 'watchers only' });
    const pending = db
      .prepare("SELECT 1 FROM join_requests WHERE room_id = ? AND user_id = ? AND status = 'pending'")
      .get(id, req.userId);
    if (pending) return { ok: true, already: true };
    db.prepare('INSERT INTO join_requests (room_id, user_id, status, ts) VALUES (?, ?, ?, ?)').run(
      id,
      req.userId,
      'pending',
      Date.now(),
    );
    return { ok: true, already: false };
  });

  app.get('/api/rooms/:id/join-requests', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (room.host_id !== req.userId && !canBank(room, req.userId))
      return reply.code(403).send({ error: 'host or banker only' });
    const rows = db
      .prepare(
        `SELECT jr.id, jr.user_id as userId, COALESCE(u.display_name, u.username) as displayName, jr.ts
         FROM join_requests jr JOIN users u ON u.id = jr.user_id
         WHERE jr.room_id = ? AND jr.status = 'pending' ORDER BY jr.id`,
      )
      .all(id);
    return { requests: rows };
  });

  app.post('/api/rooms/:id/admit', authed, async (req, reply) => {
    const parsed = z.object({ userId: z.number().int(), accept: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { id } = req.params as { id: string };
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (room.host_id !== req.userId && !canBank(room, req.userId))
      return reply.code(403).send({ error: 'host or banker only' });
    db.prepare("UPDATE join_requests SET status = ? WHERE room_id = ? AND user_id = ? AND status = 'pending'").run(
      parsed.data.accept ? 'accepted' : 'declined',
      id,
      parsed.data.userId,
    );
    if (parsed.data.accept) {
      db.prepare('INSERT OR IGNORE INTO room_players (room_id, user_id) VALUES (?, ?)').run(
        id,
        parsed.data.userId,
      );
      db.prepare('DELETE FROM spectators WHERE room_id = ? AND user_id = ?').run(id, parsed.data.userId);
      roomEvents.emit('changed', id);
    }
    return { ok: true };
  });

  // ---------- peer-to-peer chips: send, lend, settle up between players ----------

  // The banker can stand any player up from their seat, any time - even
  // mid-hand, where it means "auto-kicked from the next deal" while the
  // current hand plays out on its own snapshot. Chips stay put on the
  // ledger; the player stays a member and can sit again any time.
  // Requested by notpritam - see docs/FEATURES.md.
  app.post('/api/rooms/:id/stand-up', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ userId: z.number().int() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (!canBank(room, req.userId)) return reply.code(403).send({ error: 'banker only' });
    if (!isMember(db, id, parsed.data.userId))
      return reply.code(400).send({ error: 'not a member of this table' });
    // works mid-hand too: the running hand keeps its own seat snapshot, so
    // this simply guarantees the player is out of the NEXT deal
    db.prepare('UPDATE room_players SET seat = NULL WHERE room_id = ? AND user_id = ?').run(
      id,
      parsed.data.userId,
    );
    roomEvents.emit('changed', id);
    return { ok: true };
  });

  app.post('/api/rooms/:id/transfer', authed, async (req, reply) => {
    const parsed = z
      .object({
        toUserId: z.number().int(),
        // bounded for the same reason buy-ins are: past 2^63 the stack column
        // silently becomes a float and every later debit rounds away
        amount: z.number().int().positive().max(LIMITS.maxChipAmount),
        note: z.string().max(120).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { id } = req.params as { id: string };
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (!isMember(db, id, req.userId) || !isMember(db, id, parsed.data.toUserId))
      return reply.code(403).send({ error: 'both players must be at this table' });
    if (parsed.data.toUserId === req.userId)
      return reply.code(400).send({ error: 'that is your own stack' });
    if (activeHands.has(id))
      return reply.code(400).send({ error: 'wait for the hand to finish before moving chips' });
    const sender = db
      .prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?')
      .get(id, req.userId) as { stack: number } | undefined;
    if (!sender || sender.stack < parsed.data.amount)
      return reply.code(400).send({ error: 'not enough chips to send that' });
    // Same idempotency as buy-ins: a double-tap on Send used to move the chips
    // twice, and the second one is indistinguishable from a deliberate repeat
    // once it is on the ledger. An identical transfer to the same person
    // moments later is treated as the same transfer.
    const dupe = db
      .prepare(
        `SELECT 1 FROM ledger WHERE room_id = ? AND user_id = ? AND kind = 'transfer'
           AND delta = ? AND ts > ? LIMIT 1`,
      )
      .get(id, parsed.data.toUserId, parsed.data.amount, Date.now() - LIMITS.dedupWindowMs);
    if (dupe) return { ok: true, duplicate: true };
    const names = db
      .prepare('SELECT id, COALESCE(display_name, username) as name FROM users WHERE id IN (?, ?)')
      .all(req.userId, parsed.data.toUserId) as { id: number; name: string }[];
    const nameOf = (uid: number) => names.find((n) => n.id === uid)?.name ?? `#${uid}`;
    const apply = db.transaction(() => {
      appendLedger(db, {
        roomId: id,
        userId: req.userId,
        delta: -parsed.data.amount,
        kind: 'transfer',
        note: `sent to ${nameOf(parsed.data.toUserId)}${parsed.data.note ? `: ${parsed.data.note}` : ''}`,
      });
      appendLedger(db, {
        roomId: id,
        userId: parsed.data.toUserId,
        delta: parsed.data.amount,
        kind: 'transfer',
        note: `from ${nameOf(req.userId)}${parsed.data.note ? `: ${parsed.data.note}` : ''}`,
      });
      db.prepare('UPDATE room_players SET stack = stack - ? WHERE room_id = ? AND user_id = ?').run(
        parsed.data.amount,
        id,
        req.userId,
      );
      db.prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?').run(
        parsed.data.amount,
        id,
        parsed.data.toUserId,
      );
    });
    apply();
    roomEvents.emit('changed', id);
    return { ok: true };
  });

  // ---------- banker invalidation ----------

  /** Retire a finished table.
   *
   *  Archiving is deliberately NOT a delete. The ledger, every hand transcript
   *  and the whole history stay exactly where they are and stay readable - the
   *  room simply leaves the active list, stops dealing, and its results stop
   *  counting towards stats and the leaderboard.
   *
   *  Debts between players survive on purpose. Making money owed disappear by
   *  archiving would hand the person who is down the most a one-click way to
   *  erase it, which is the same hole the audit flagged on /void. Settle up
   *  first, or settle up after - either way the number does not move because a
   *  table was tidied away.
   *
   *  Host or banker, reversible, and refused mid-hand so nothing is retired out
   *  from under a live deal. */
  app.post('/api/rooms/:id/archive', authed, async (req, reply) => {
    const parsed = z.object({ archived: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { id } = req.params as { id: string };
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (room.host_id !== req.userId && !canBank(room, req.userId))
      return reply.code(403).send({ error: 'only the host or the banker can archive a table' });
    if (parsed.data.archived && activeHands.has(id))
      return reply.code(400).send({ error: 'a hand is in progress - wait for it to finish' });
    db.prepare('UPDATE rooms SET archived = ?, archived_at = ? WHERE id = ?').run(
      parsed.data.archived ? 1 : 0,
      parsed.data.archived ? Date.now() : null,
      id,
    );
    roomEvents.emit('changed', id);
    return { ok: true, archived: parsed.data.archived };
  });

  // void a whole table: its results stop counting anywhere outside the room
  app.post('/api/rooms/:id/void', authed, async (req, reply) => {
    const parsed = z.object({ voided: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { id } = req.params as { id: string };
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (!canBank(room, req.userId)) return reply.code(403).send({ error: 'banker only' });
    db.prepare('UPDATE rooms SET voided = ? WHERE id = ?').run(parsed.data.voided ? 1 : 0, id);
    roomEvents.emit('changed', id);
    return { ok: true };
  });

  // void one hand: compensating entries reverse its settlement, chips return
  app.post('/api/rooms/:id/void-hand', authed, async (req, reply) => {
    const parsed = z.object({ handId: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { id } = req.params as { id: string };
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (!canBank(room, req.userId)) return reply.code(403).send({ error: 'banker only' });
    // chips at risk in a live hand are not deducted from the stack yet, so
    // reversing an older hand now can settle a player straight into a negative
    if (activeHands.has(id)) {
      return reply.code(400).send({ error: 'wait for the hand to finish' });
    }
    const already = db
      .prepare("SELECT 1 FROM ledger WHERE room_id = ? AND kind = 'void-hand' AND ref = ?")
      .get(id, parsed.data.handId);
    if (already) return reply.code(400).send({ error: 'that hand was already voided' });
    // The commission rides the same ref as the settlement. Reversing only the
    // settlements made every player whole while the banker kept the rake, so
    // each void quietly minted 1% of the pot out of nothing.
    const entries = db
      .prepare(
        "SELECT user_id, delta FROM ledger WHERE room_id = ? AND kind IN ('hand-settlement', 'commission') AND ref = ?",
      )
      .all(id, parsed.data.handId) as { user_id: number; delta: number }[];
    if (entries.length === 0) return reply.code(404).send({ error: 'no settled hand with that id' });
    // winners must still hold enough chips to give the pot back
    for (const e of entries) {
      if (e.delta > 0) {
        const row = db
          .prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?')
          .get(id, e.user_id) as { stack: number } | undefined;
        if (!row || row.stack < e.delta)
          return reply.code(400).send({ error: 'a winner no longer has enough chips to reverse this hand' });
      }
    }
    const apply = db.transaction(() => {
      for (const e of entries) {
        appendLedger(db, {
          roomId: id,
          userId: e.user_id,
          delta: -e.delta,
          kind: 'void-hand',
          approvedBy: req.userId,
          ref: parsed.data.handId,
          note: 'hand voided by the banker',
        });
        db.prepare('UPDATE room_players SET stack = stack - ? WHERE room_id = ? AND user_id = ?').run(
          e.delta,
          id,
          e.user_id,
        );
      }
    });
    apply();
    roomEvents.emit('changed', id);
    return { ok: true, reversed: entries.length };
  });

  // ---- profile settle-up: cross-room debts + two-sided settlement marks ----
  // On your own profile you see, per room and per friend, who owes whom what
  // to conclude the game. Both sides mark "settled" and the debt resolves on
  // the platform too. Requested by notpritam, docs/FEATURES.md.

  /** The room's who-owes-whom pairing, greedy largest-first for determinism. */
  const roomDebts = (roomId: string): { from: number; to: number; amount: number }[] => {
    const nets = roomPlayers(db, roomId)
      .map((p) => ({ userId: p.userId, net: p.stack - p.totalBought }))
      .filter((n) => n.net !== 0);
    const debtors = nets
      .filter((n) => n.net < 0)
      .map((n) => ({ userId: n.userId, amt: -n.net }))
      .sort((a, b) => b.amt - a.amt || a.userId - b.userId);
    const creditors = nets
      .filter((n) => n.net > 0)
      .map((n) => ({ userId: n.userId, amt: n.net }))
      .sort((a, b) => b.amt - a.amt || a.userId - b.userId);
    const out: { from: number; to: number; amount: number }[] = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i]!.amt, creditors[j]!.amt);
      if (pay > 0) out.push({ from: debtors[i]!.userId, to: creditors[j]!.userId, amount: pay });
      debtors[i]!.amt -= pay;
      creditors[j]!.amt -= pay;
      if (debtors[i]!.amt === 0) i++;
      if (creditors[j]!.amt === 0) j++;
    }
    return out;
  };

  const pairOf = (a: number, b: number) => (a < b ? [a, b] : [b, a]) as [number, number];

  /** Settled amounts between two people, signed against `debtor`.
   *
   *  This used to sum the pair regardless of who had owed whom, so a debt that
   *  was properly settled in one direction silently cancelled the next debt in
   *  the other direction: A pays B 500 and settles, B later loses 500 back, and
   *  the platform reports a clean slate while A keeps the money. Netting by
   *  direction is the whole point - a settlement in the opposite direction is a
   *  reason the current debt is LARGER, not smaller. */
  const settledSum = (roomId: string, debtor: number, creditor: number): number => {
    const [low, high] = pairOf(debtor, creditor);
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN debtor = ? THEN amount ELSE -amount END), 0) as total
         FROM settlements
         WHERE room_id = ? AND low_user = ? AND high_user = ? AND settled_ts IS NOT NULL`,
      )
      .get(debtor, roomId, low, high) as { total: number };
    return row.total;
  };

  app.get('/api/me/debts', authed, async (req) => {
    const rooms = db
      .prepare(
        `SELECT r.id, r.name FROM rooms r JOIN room_players rp ON rp.room_id = r.id
         WHERE rp.user_id = ? AND r.voided = 0 ORDER BY r.created_at DESC`,
      )
      .all(req.userId) as { id: string; name: string }[];
    const nameOf = db.prepare(
      'SELECT COALESCE(display_name, username) as name, avatar_version as avatarVersion FROM users WHERE id = ?',
    );
    const rows: unknown[] = [];
    const settled: unknown[] = [];
    for (const room of rooms) {
      for (const d of roomDebts(room.id)) {
        if (d.from !== req.userId && d.to !== req.userId) continue;
        const other = d.from === req.userId ? d.to : d.from;
        const outstanding = d.amount - settledSum(room.id, d.from, d.to);
        const [low, high] = pairOf(d.from, d.to);
        const open = db
          .prepare(
            'SELECT id, amount, confirmed_low, confirmed_high FROM settlements WHERE room_id = ? AND low_user = ? AND high_user = ? AND settled_ts IS NULL',
          )
          .get(room.id, low, high) as
          | { id: number; amount: number; confirmed_low: number; confirmed_high: number }
          | undefined;
        if (outstanding <= 0 && !open) continue;
        const info = nameOf.get(other) as { name: string; avatarVersion: number };
        const myConfirmed = open ? (req.userId === low ? !!open.confirmed_low : !!open.confirmed_high) : false;
        const otherConfirmed = open ? (other === low ? !!open.confirmed_low : !!open.confirmed_high) : false;
        rows.push({
          roomId: room.id,
          roomName: room.name,
          otherUserId: other,
          otherName: info.name,
          otherAvatarVersion: info.avatarVersion,
          direction: d.from === req.userId ? 'owe' : 'owed',
          amount: outstanding > 0 ? outstanding : (open?.amount ?? 0),
          myConfirmed,
          otherConfirmed,
        });
      }
      const done = db
        .prepare(
          `SELECT room_id as roomId, low_user as low, high_user as high, amount, debtor, settled_ts as ts
           FROM settlements WHERE room_id = ? AND settled_ts IS NOT NULL AND (low_user = ? OR high_user = ?)
           ORDER BY settled_ts DESC LIMIT 5`,
        )
        .all(room.id, req.userId, req.userId) as {
        roomId: string;
        low: number;
        high: number;
        amount: number;
        debtor: number;
        ts: number;
      }[];
      for (const row of done) {
        const other = row.low === req.userId ? row.high : row.low;
        const info = nameOf.get(other) as { name: string; avatarVersion: number };
        settled.push({
          roomId: row.roomId,
          roomName: room.name,
          otherUserId: other,
          otherName: info.name,
          direction: row.debtor === req.userId ? 'owe' : 'owed',
          amount: row.amount,
          ts: row.ts,
        });
      }
    }
    return { debts: rows, settled };
  });

  app.post('/api/settlements', authed, async (req, reply) => {
    const parsed = z
      .object({
        roomId: z.string(),
        otherUserId: z.number().int(),
        // what you want on the record: "sent on UPI at 9pm", plus a screenshot
        note: z.string().max(300).optional(),
        proof: z.string().max(1_000_000).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { roomId, otherUserId, note } = parsed.data;
    if (otherUserId === req.userId) return reply.code(400).send({ error: 'you cannot settle with yourself' });
    if (!getRoom(db, roomId)) return reply.code(404).send({ error: 'no such room' });
    if (!isMember(db, roomId, req.userId) || !isMember(db, roomId, otherUserId))
      return reply.code(403).send({ error: 'both players must be in this room' });
    let proofBytes: Buffer | null = null;
    let proofMime: string | null = null;
    if (parsed.data.proof) {
      const decoded = decodeProof(parsed.data.proof);
      if (!decoded) return reply.code(400).send({ error: 'that photo is not a usable image' });
      proofBytes = decoded.bytes;
      proofMime = decoded.mime;
    }
    /** Both sides get to leave their own remark and their own photo. */
    const mark = (settlementId: number) =>
      db
        .prepare(
          `INSERT INTO settlement_marks (settlement_id, user_id, note, proof, proof_mime, ts)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(settlement_id, user_id) DO UPDATE SET
             note = COALESCE(excluded.note, note),
             proof = COALESCE(excluded.proof, proof),
             proof_mime = COALESCE(excluded.proof_mime, proof_mime),
             ts = excluded.ts`,
        )
        .run(settlementId, req.userId, note ?? null, proofBytes, proofMime, Date.now());
    const [low, high] = pairOf(req.userId, otherUserId);
    const mySide = req.userId === low ? 'confirmed_low' : 'confirmed_high';
    const open = db
      .prepare(
        'SELECT id, confirmed_low, confirmed_high FROM settlements WHERE room_id = ? AND low_user = ? AND high_user = ? AND settled_ts IS NULL',
      )
      .get(roomId, low, high) as { id: number; confirmed_low: number; confirmed_high: number } | undefined;
    if (open) {
      db.prepare(`UPDATE settlements SET ${mySide} = 1 WHERE id = ?`).run(open.id);
      mark(open.id);
      const both =
        (mySide === 'confirmed_low' ? 1 : open.confirmed_low) &&
        (mySide === 'confirmed_high' ? 1 : open.confirmed_high);
      if (both) db.prepare('UPDATE settlements SET settled_ts = ? WHERE id = ?').run(Date.now(), open.id);
      return { ok: true, settled: !!both, settlementId: open.id };
    }
    // first mark: pin the settlement to the CURRENT outstanding amount
    const debt = roomDebts(roomId).find(
      (d) =>
        (d.from === req.userId && d.to === otherUserId) ||
        (d.from === otherUserId && d.to === req.userId),
    );
    const outstanding = debt ? debt.amount - settledSum(roomId, debt.from, debt.to) : 0;
    if (!debt || outstanding <= 0) return reply.code(400).send({ error: 'nothing to settle between you two here' });
    const info = db
      .prepare(
        `INSERT INTO settlements (room_id, low_user, high_user, amount, debtor, ${mySide}, created_ts)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(roomId, low, high, outstanding, debt.from, Date.now());
    const settlementId = Number(info.lastInsertRowid);
    mark(settlementId);
    return { ok: true, settled: false, settlementId };
  });

  /** Rooms two players share - the places one can send the other points. */
  app.get('/api/users/:id/shared-rooms', authed, async (req, reply) => {
    const otherId = Number((req.params as { id: string }).id);
    if (!Number.isInteger(otherId)) return reply.code(400).send({ error: 'bad user id' });
    const rooms = db
      .prepare(
        `SELECT r.id, r.name, me.stack as myStack FROM rooms r
         JOIN room_players me ON me.room_id = r.id AND me.user_id = ?
         JOIN room_players them ON them.room_id = r.id AND them.user_id = ?
         WHERE r.voided = 0 ORDER BY r.created_at DESC`,
      )
      .all(req.userId, otherId) as { id: string; name: string; myStack: number }[];
    return { rooms: rooms.map((r) => ({ ...r, handActive: activeHands.has(r.id) })) };
  });

  // the cross-room settle view, payment redirects and house dues all need the
  // same debt maths, so they are handed the helpers rather than reimplementing them
  registerSettleRoutes(app, db, { roomDebts, settledSum, pairOf });
}
