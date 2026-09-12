import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';
import type { ServerMsg } from '@4am/shared';
import { z } from 'zod';
import type { DB } from './db.js';
import { scopeMember, scopeUser, type ScopeKind } from './agentAccess.js';
const streams = new WeakMap<DB, EventEmitter>();
function stream(db: DB) {
  let bus = streams.get(db);
  if (!bus) {
    bus = new EventEmitter();
    bus.setMaxListeners(200);
    streams.set(db, bus);
  }
  return bus;
}
export function publishAgentEvent(
  db: DB,
  kind: ScopeKind,
  id: string,
  type: string,
  data: unknown,
): void {
  if (!db.open) return;
  db.prepare(
    'INSERT INTO agent_events(scope_kind,scope_id,type,data_json,ts) VALUES(?,?,?,?,?)',
  ).run(kind, id, type, JSON.stringify(data), Date.now());
  const cutoff = db
    .prepare(
      'SELECT id FROM agent_events WHERE scope_kind = ? AND scope_id = ? ORDER BY id DESC LIMIT 1 OFFSET 4999',
    )
    .get(kind, id) as { id: number } | undefined;
  if (cutoff)
    db.prepare('DELETE FROM agent_events WHERE scope_kind = ? AND scope_id = ? AND id < ?').run(
      kind,
      id,
      cutoff.id,
    );
  stream(db).emit(`${kind}:${id}`);
}
// Only messages broadcast to the entire table. Never emit raw transcripts,
// encrypted deck traffic, private peeks, need_share, need_keys or your_card.
const ROOM_EVENTS = new Set([
  'room_state',
  'hand_start',
  'betting_state',
  'board_open',
  'action_applied',
  'hand_end',
  'hand_abort',
  'showdown',
  'cards_shown',
  'ready_check',
  'ready_end',
  'auto_deal',
  'chat',
]);
export function publishRoomEvent(db: DB, roomId: string, msg: ServerMsg): void {
  if (ROOM_EVENTS.has(msg.t)) publishAgentEvent(db, 'room', roomId, `room.${msg.t}`, msg);
}
export function readAgentEvents(db: DB, kind: ScopeKind, id: string, after: number) {
  const rows = db
    .prepare(
      'SELECT id, type, data_json, ts FROM agent_events WHERE scope_kind = ? AND scope_id = ? AND id > ? ORDER BY id LIMIT 100',
    )
    .all(kind, id, after) as { id: number; type: string; data_json: string; ts: number }[];
  const oldest = db
    .prepare('SELECT MIN(id) AS id FROM agent_events WHERE scope_kind = ? AND scope_id = ?')
    .get(kind, id) as { id: number | null };
  return {
    events: rows.map((r) => ({
      version: 1,
      id: r.id,
      type: r.type,
      scopeKind: kind,
      scopeId: id,
      createdAt: r.ts,
      data: JSON.parse(r.data_json) as unknown,
    })),
    nextCursor: rows.at(-1)?.id ?? after,
    oldestCursor: oldest.id,
    retainedLimit: 5000,
    resyncRecommended: after > 0 && oldest.id !== null && after < oldest.id,
  };
}
export function registerAgentEvents(app: FastifyInstance, db: DB): void {
  const waiting = new Map<number, number>();
  app.get('/api/agent/events', async (req, reply) => {
    const parsed = z
      .object({
        scopeKind: z.enum(['room', 'tournament']),
        scopeId: z.string().min(1).max(80),
        after: z.coerce.number().int().nonnegative().safe().default(0),
        wait: z.coerce.number().int().min(0).max(25).default(0),
      })
      .safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid event subscription.' });
    const q = parsed.data;
    const userId = scopeUser(db, req, q.scopeKind, q.scopeId);
    const allowed = () =>
      scopeMember(db, userId, q.scopeKind, q.scopeId) ||
      (q.scopeKind === 'tournament' &&
        !!db
          .prepare('SELECT 1 FROM tournaments WHERE id = ? AND owner_id = ?')
          .get(q.scopeId, userId));
    if (!allowed())
      return reply.code(403).send({ error: 'Join this room or tournament to subscribe.' });
    if ((waiting.get(userId) ?? 0) >= 3)
      return reply
        .code(429)
        .send({ error: 'At most three simultaneous subscriptions per account.' });
    const keepPresent = () => {
      if (q.scopeKind === 'tournament')
        db.prepare(
          'UPDATE tournament_entries SET last_seen = ? WHERE tournament_id = ? AND user_id = ?',
        ).run(Date.now(), q.scopeId, userId);
    };
    keepPresent();
    let result = readAgentEvents(db, q.scopeKind, q.scopeId, q.after);
    if (!result.events.length && q.wait) {
      waiting.set(userId, (waiting.get(userId) ?? 0) + 1);
      await new Promise<void>((resolve) => {
        const key = `${q.scopeKind}:${q.scopeId}`;
        const bus = stream(db);
        const done = () => {
          clearTimeout(timer);
          bus.off(key, done);
          bus.off('shutdown', done);
          reply.raw.off('close', done);
          resolve();
        };
        const timer = setTimeout(done, q.wait * 1000);
        bus.once(key, done);
        bus.once('shutdown', done);
        reply.raw.once('close', done);
      });
      waiting.set(userId, (waiting.get(userId) ?? 1) - 1);
      if (!db.open) return reply.code(503).send({ error: 'Server restarting.' });
      scopeUser(db, req, q.scopeKind, q.scopeId); // revocation during a wait takes effect
      if (!allowed()) return reply.code(403).send({ error: 'Subscription access ended.' });
      keepPresent();
      result = readAgentEvents(db, q.scopeKind, q.scopeId, q.after);
    }
    return reply.header('cache-control', 'no-store').send(result);
  });
  app.addHook('onClose', async () => {
    stream(db).emit('shutdown');
    stream(db).removeAllListeners();
  });
}
