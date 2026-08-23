import { randomBytes } from 'node:crypto';
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
  created_at: number;
}

const createSchema = z.object({
  name: z.string().min(1).max(48),
  sb: z.number().int().positive(),
  bb: z.number().int().positive(),
  auditMode: z.enum(['private', 'strict-audit']).optional(),
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
      `SELECT rp.user_id as userId, u.username, u.pubkey as publicKey, rp.seat, rp.stack, rp.sitting_out as sittingOut
       FROM room_players rp JOIN users u ON u.id = rp.user_id WHERE rp.room_id = ? ORDER BY rp.seat`,
    )
    .all(roomId) as {
    userId: number;
    username: string;
    publicKey: string;
    seat: number | null;
    stack: number;
    sittingOut: number;
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
    players: roomPlayers(db, room.id),
  };
}

export function registerRoomRoutes(app: FastifyInstance, db: DB): void {
  const authed = { preHandler: requireUser(db) };

  app.post('/api/rooms', authed, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { name, sb, bb, auditMode } = parsed.data;
    if (bb < sb) return reply.code(400).send({ error: 'big blind must be >= small blind' });
    const id = randomBytes(6).toString('hex');
    const joinCode = newJoinCode();
    db.prepare(
      `INSERT INTO rooms (id, name, join_code, host_id, banker_id, sb, bb, audit_mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, name, joinCode, req.userId, req.userId, sb, bb, auditMode ?? 'private', Date.now());
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
    if (room.banker_id !== req.userId) return reply.code(403).send({ error: 'banker only' });
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
    if (room.banker_id !== req.userId) return reply.code(403).send({ error: 'banker only' });
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
