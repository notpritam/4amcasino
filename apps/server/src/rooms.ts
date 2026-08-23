import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from './db.js';
import { requireUser } from './auth.js';
import { appendLedger, verifyLedger } from './ledger.js';

export interface RoomRow {
  id: string;
  name: string;
  join_code: string;
  host_id: number;
  banker_id: number;
  sb: number;
  bb: number;
  audit_mode: string;
  action_secs: number | null;
  co_banker_id: number | null;
  min_settle_hands: number;
  seven_deuce_bonus: number;
  created_at: number;
}

/** The main banker and the backup banker both hold banking powers. */
export function canBank(room: RoomRow, userId: number): boolean {
  return room.banker_id === userId || room.co_banker_id === userId;
}

/** Emits ('changed', roomId) when REST mutations alter room membership or stacks. */
export const roomEvents = new EventEmitter();

const actionSecsSchema = z.union([z.literal(0), z.number().int().min(5).max(180)]); // 0 = no limit

const minSettleSchema = z.number().int().min(0).max(500);

const createSchema = z.object({
  name: z.string().min(1).max(48),
  sb: z.number().int().positive(),
  bb: z.number().int().positive(),
  auditMode: z.enum(['private', 'strict-audit']).optional(),
  actionSecs: actionSecsSchema.optional(),
  minSettleHands: minSettleSchema.optional(),
});

function newJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(6), (b) => chars[b % chars.length]!).join('');
}

export function getRoom(db: DB, roomId: string): RoomRow | undefined {
  return db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
}

export function isMember(db: DB, roomId: string, userId: number): boolean {
  return !!db
    .prepare('SELECT 1 FROM room_players WHERE room_id = ? AND user_id = ?')
    .get(roomId, userId);
}

export function roomPlayers(db: DB, roomId: string) {
  return db
    .prepare(
      `SELECT rp.user_id as userId, u.username, COALESCE(u.display_name, u.username) as displayName,
              u.avatar_version as avatarVersion, u.pubkey as publicKey, rp.seat, rp.stack,
              rp.sitting_out as sittingOut, u.private_mode as privateMode,
              COALESCE(b.total, 0) as totalBought
       FROM room_players rp
       JOIN users u ON u.id = rp.user_id
       LEFT JOIN (
         SELECT user_id, SUM(delta) as total FROM ledger
         WHERE room_id = ? AND kind IN ('purchase', 'revert') GROUP BY user_id
       ) b ON b.user_id = rp.user_id
       WHERE rp.room_id = ? ORDER BY rp.seat`,
    )
    .all(roomId, roomId) as {
    userId: number;
    username: string;
    displayName: string;
    avatarVersion: number;
    publicKey: string;
    seat: number | null;
    stack: number;
    sittingOut: number;
    privateMode: number;
    totalBought: number;
  }[];
}

function roomJson(db: DB, room: RoomRow) {
  return {
    id: room.id,
    name: room.name,
    joinCode: room.join_code,
    hostId: room.host_id,
    bankerId: room.banker_id,
    sb: room.sb,
    bb: room.bb,
    auditMode: room.audit_mode,
    actionSecs: room.action_secs,
    coBankerId: room.co_banker_id,
    minSettleHands: room.min_settle_hands,
    sevenDeuceBonus: room.seven_deuce_bonus,
    players: roomPlayers(db, room.id).map((p) => ({
      ...p,
      privateMode: undefined,
      privateStats: !!p.privateMode,
      totalBought: p.privateMode ? 0 : p.totalBought,
    })),
  };
}

export function registerRoomRoutes(app: FastifyInstance, db: DB): void {
  const authed = { preHandler: requireUser(db) };

  app.post('/api/rooms', authed, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { name, sb, bb, auditMode, actionSecs, minSettleHands } = parsed.data;
    if (bb < sb) return reply.code(400).send({ error: 'big blind must be >= small blind' });
    const id = randomBytes(6).toString('hex');
    const joinCode = newJoinCode();
    db.prepare(
      `INSERT INTO rooms (id, name, join_code, host_id, banker_id, sb, bb, audit_mode, action_secs, min_settle_hands, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, name, joinCode, req.userId, req.userId, sb, bb, auditMode ?? 'private', actionSecs ?? null, minSettleHands ?? 0, Date.now());
    db.prepare('INSERT INTO room_players (room_id, user_id) VALUES (?, ?)').run(id, req.userId);
    return roomJson(db, getRoom(db, id)!);
  });

  app.post('/api/rooms/join', authed, async (req, reply) => {
    const parsed = z.object({ joinCode: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const room = db
      .prepare('SELECT * FROM rooms WHERE join_code = ?')
      .get(parsed.data.joinCode.toUpperCase()) as RoomRow | undefined;
    if (!room) return reply.code(404).send({ error: 'no such room' });
    db.prepare('INSERT OR IGNORE INTO room_players (room_id, user_id) VALUES (?, ?)').run(
      room.id,
      req.userId,
    );
    roomEvents.emit('changed', room.id);
    return roomJson(db, room);
  });

  app.get('/api/rooms/:id', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (!isMember(db, id, req.userId)) return reply.code(403).send({ error: 'not a member' });
    return roomJson(db, room);
  });

  app.post('/api/rooms/:id/buy', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ amount: z.number().int().positive(), note: z.string().max(200).optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    if (!getRoom(db, id)) return reply.code(404).send({ error: 'no such room' });
    if (!isMember(db, id, req.userId)) return reply.code(403).send({ error: 'not a member' });
    const info = db
      .prepare('INSERT INTO buy_requests (room_id, user_id, amount, note, ts) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.userId, parsed.data.amount, parsed.data.note ?? null, Date.now());
    return { id: Number(info.lastInsertRowid), status: 'pending' };
  });

  app.get('/api/rooms/:id/requests', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (!canBank(room, req.userId)) return reply.code(403).send({ error: 'banker only' });
    const rows = db
      .prepare(
        `SELECT br.id, br.user_id as userId, u.username, br.amount, br.note, br.ts
         FROM buy_requests br JOIN users u ON u.id = br.user_id
         WHERE br.room_id = ? AND br.status = 'pending' ORDER BY br.id`,
      )
      .all(id);
    return { requests: rows };
  });

  app.post('/api/rooms/:id/approve', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ requestId: z.number().int(), approve: z.boolean() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (!canBank(room, req.userId)) return reply.code(403).send({ error: 'banker only' });
    const request = db
      .prepare("SELECT * FROM buy_requests WHERE id = ? AND room_id = ? AND status = 'pending'")
      .get(parsed.data.requestId, id) as
      | { id: number; user_id: number; amount: number; note: string | null }
      | undefined;
    if (!request) return reply.code(404).send({ error: 'no such pending request' });

    const apply = db.transaction(() => {
      db.prepare('UPDATE buy_requests SET status = ? WHERE id = ?').run(
        parsed.data.approve ? 'approved' : 'rejected',
        request.id,
      );
      if (parsed.data.approve) {
        appendLedger(db, {
          roomId: id,
          userId: request.user_id,
          delta: request.amount,
          kind: 'purchase',
          approvedBy: req.userId,
          note: request.note ?? undefined,
        });
        db.prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?').run(
          request.amount,
          id,
          request.user_id,
        );
      }
    });
    apply();
    roomEvents.emit('changed', id);
    return { ok: true };
  });

  // the main banker names (or clears) a backup banker with the same powers
  app.put('/api/rooms/:id/co-banker', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ userId: z.number().int().nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (room.banker_id !== req.userId)
      return reply.code(403).send({ error: 'only the main banker can pick a backup' });
    if (parsed.data.userId !== null && !isMember(db, id, parsed.data.userId))
      return reply.code(400).send({ error: 'the backup banker must be a room member' });
    db.prepare('UPDATE rooms SET co_banker_id = ? WHERE id = ?').run(parsed.data.userId, id);
    roomEvents.emit('changed', id);
    return { ok: true };
  });

  // banker reverses a specific earlier purchase with a compensating ledger entry
  app.post('/api/rooms/:id/revert', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ entryId: z.number().int() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (!canBank(room, req.userId)) return reply.code(403).send({ error: 'banker only' });
    const entry = db
      .prepare('SELECT * FROM ledger WHERE id = ? AND room_id = ?')
      .get(parsed.data.entryId, id) as
      | { id: number; user_id: number; delta: number; kind: string; entry_hash: string }
      | undefined;
    if (!entry) return reply.code(404).send({ error: 'no such ledger entry' });
    if (entry.kind !== 'purchase')
      return reply.code(400).send({ error: 'only purchases can be reverted' });
    const already = db
      .prepare("SELECT 1 FROM ledger WHERE room_id = ? AND kind = 'revert' AND ref = ?")
      .get(id, entry.entry_hash);
    if (already) return reply.code(400).send({ error: 'that purchase was already reverted' });
    const player = db
      .prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?')
      .get(id, entry.user_id) as { stack: number } | undefined;
    if (!player || player.stack < entry.delta)
      return reply.code(400).send({ error: 'the player no longer has enough chips to revert this' });
    const apply = db.transaction(() => {
      appendLedger(db, {
        roomId: id,
        userId: entry.user_id,
        delta: -entry.delta,
        kind: 'revert',
        approvedBy: req.userId,
        ref: entry.entry_hash,
        note: `revert of purchase #${entry.id}`,
      });
      db.prepare('UPDATE room_players SET stack = stack - ? WHERE room_id = ? AND user_id = ?').run(
        entry.delta,
        id,
        entry.user_id,
      );
    });
    apply();
    roomEvents.emit('changed', id);
    return { ok: true };
  });

  app.put('/api/rooms/:id/settings', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        actionSecs: actionSecsSchema.optional(),
        minSettleHands: minSettleSchema.optional(),
        sevenDeuceBonus: z.number().int().min(0).max(100_000).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'turn time must be 0 (no limit) or 5-180 seconds' });
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (room.host_id !== req.userId && !canBank(room, req.userId))
      return reply.code(403).send({ error: 'host or banker only' });
    if (parsed.data.actionSecs !== undefined)
      db.prepare('UPDATE rooms SET action_secs = ? WHERE id = ?').run(parsed.data.actionSecs, id);
    if (parsed.data.minSettleHands !== undefined)
      db.prepare('UPDATE rooms SET min_settle_hands = ? WHERE id = ?').run(parsed.data.minSettleHands, id);
    if (parsed.data.sevenDeuceBonus !== undefined)
      db.prepare('UPDATE rooms SET seven_deuce_bonus = ? WHERE id = ?').run(parsed.data.sevenDeuceBonus, id);
    roomEvents.emit('changed', id);
    return { ok: true };
  });

  app.get('/api/my-rooms', authed, async (req) => {
    const rows = db
      .prepare(
        `SELECT r.id, r.name, r.join_code as joinCode, r.sb, r.bb,
                (SELECT COUNT(*) FROM room_players rp2 WHERE rp2.room_id = r.id) as playerCount
         FROM rooms r JOIN room_players rp ON rp.room_id = r.id
         WHERE rp.user_id = ? ORDER BY r.created_at DESC`,
      )
      .all(req.userId);
    return { rooms: rows };
  });

  app.get('/api/rooms/:id/hands', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getRoom(db, id)) return reply.code(404).send({ error: 'no such room' });
    if (!isMember(db, id, req.userId)) return reply.code(403).send({ error: 'not a member' });
    const hands = db
      .prepare('SELECT hand_id as handId, head, ts FROM transcripts WHERE room_id = ? ORDER BY ts DESC')
      .all(id);
    return { hands };
  });

  app.get('/api/rooms/:id/hands/:handId', authed, async (req, reply) => {
    const { id, handId } = req.params as { id: string; handId: string };
    if (!getRoom(db, id)) return reply.code(404).send({ error: 'no such room' });
    if (!isMember(db, id, req.userId)) return reply.code(403).send({ error: 'not a member' });
    const row = db
      .prepare('SELECT hand_id as handId, head, entries, ts FROM transcripts WHERE room_id = ? AND hand_id = ?')
      .get(id, handId) as { handId: string; head: string; entries: string; ts: number } | undefined;
    if (!row) return reply.code(404).send({ error: 'no such hand' });
    return { handId: row.handId, head: row.head, ts: row.ts, entries: JSON.parse(row.entries) };
  });

  app.get('/api/rooms/:id/ledger', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'no such room' });
    if (!isMember(db, id, req.userId)) return reply.code(403).send({ error: 'not a member' });
    const entries = db
      .prepare(
        `SELECT l.id, l.user_id as userId, u.username, l.delta, l.kind, l.approved_by as approvedBy,
                l.note, l.ref, l.ts, l.prev_hash as prevHash, l.entry_hash as entryHash
         FROM ledger l JOIN users u ON u.id = l.user_id WHERE l.room_id = ? ORDER BY l.id`,
      )
      .all(id);
    return { entries, verified: verifyLedger(db, id) };
  });
}
