import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from './db.js';
import { ONLINE_WINDOW_MS, requireUser } from './auth.js';
import { canBank, getRoom, isMember, isSpectator, roomEvents } from './rooms.js';
import { appendLedger } from './ledger.js';
import { activeHands } from './game.js';
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

  // The banker can stand any player up from their seat - the cure for a
  // disconnected player whose seat keeps stalling deals. Chips stay put on
  // the ledger; the player stays a member and can sit again any time.
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
    if (activeHands.has(id))
      return reply.code(400).send({ error: 'wait for the hand to end first' });
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
        amount: z.number().int().positive(),
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
    const already = db
      .prepare("SELECT 1 FROM ledger WHERE room_id = ? AND kind = 'void-hand' AND ref = ?")
      .get(id, parsed.data.handId);
    if (already) return reply.code(400).send({ error: 'that hand was already voided' });
    const entries = db
      .prepare(
        "SELECT user_id, delta FROM ledger WHERE room_id = ? AND kind = 'hand-settlement' AND ref = ?",
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
}
