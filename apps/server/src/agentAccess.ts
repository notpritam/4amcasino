import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DB } from './db.js';
import { requireUser, userForToken } from './auth.js';
import { rateLimit } from './limits.js';
import { getRoom, presentablePlayers } from './rooms.js';
import { activeHands } from './liveHands.js';

export type ScopeKind = 'room' | 'tournament';
export interface AgentGrant {
  id: string;
  user_id: number;
  scope_kind: ScopeKind;
  scope_id: string;
  can_play: number;
  expires_at: number;
}
export class AgentError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const bearerToken = (req: FastifyRequest) =>
  (req.headers.authorization ?? '').replace(/^Bearer /, '');
function enabledUser(db: DB, userId: number): boolean {
  return !!db.prepare('SELECT 1 FROM users WHERE id = ? AND disabled = 0').get(userId);
}
export function scopeMember(db: DB, userId: number, kind: ScopeKind, id: string): boolean {
  return kind === 'room'
    ? !!db.prepare('SELECT 1 FROM room_players WHERE room_id = ? AND user_id = ?').get(id, userId)
    : !!db
        .prepare('SELECT 1 FROM tournament_entries WHERE tournament_id = ? AND user_id = ?')
        .get(id, userId);
}
export function resolveAgentGrant(db: DB, token: string): AgentGrant | null {
  if (!token.startsWith('4am_agent_') || token.length > 150) return null;
  const grant = db
    .prepare(
      'SELECT * FROM agent_grants WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?',
    )
    .get(tokenHash(token), Date.now()) as AgentGrant | undefined;
  return grant &&
    enabledUser(db, grant.user_id) &&
    scopeMember(db, grant.user_id, grant.scope_kind, grant.scope_id)
    ? grant
    : null;
}
const PLAY_MESSAGES = new Set([
  'sit',
  'leave_seat',
  'sit_out',
  'start_hand',
  'key_commit',
  'shuffle_deck',
  'unmask_share',
  'action',
  'reveal_key',
  'show_cards',
  'fold_key',
  'rit_vote',
  'im_ready',
]);
export function agentMaySend(grant: AgentGrant, msg: { t: string; roomId?: string }): boolean {
  if (grant.scope_kind !== 'room') return false;
  if (msg.t === 'join_room') return msg.roomId === grant.scope_id;
  return !!grant.can_play && PLAY_MESSAGES.has(msg.t);
}
export function scopeUser(
  db: DB,
  req: FastifyRequest,
  kind: ScopeKind,
  id: string,
  play = false,
): number {
  const token = bearerToken(req);
  const userId = userForToken(db, token);
  if (userId !== null && enabledUser(db, userId)) {
    req.userId = userId;
    return userId;
  }
  const grant = resolveAgentGrant(db, token);
  if (!grant) throw new AgentError(401, 'Sign in or use a valid agent token.');
  if (grant.scope_kind !== kind || grant.scope_id !== id || (play && !grant.can_play))
    throw new AgentError(403, 'This agent token does not allow that action.');
  req.userId = grant.user_id;
  return grant.user_id;
}
export function registerAgentAccess(app: FastifyInstance, db: DB): void {
  app.get('/api/me/agent-scopes', { preHandler: requireUser(db) }, async (req) => ({
    scopes: [
      ...db
        .prepare(
          "SELECT r.id, r.name, 'room' AS kind FROM rooms r JOIN room_players p ON p.room_id = r.id WHERE p.user_id = ? AND r.archived = 0",
        )
        .all(req.userId),
      ...db
        .prepare(
          "SELECT t.id, t.name, 'tournament' AS kind FROM tournaments t JOIN tournament_entries e ON e.tournament_id = t.id WHERE e.user_id = ? AND t.status NOT IN ('completed','cancelled')",
        )
        .all(req.userId),
    ],
  }));
  app.get('/api/agent/rooms/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = scopeUser(db, req, 'room', id);
    if (!scopeMember(db, userId, 'room', id))
      return reply.code(403).send({ error: 'Join this room first.' });
    const room = getRoom(db, id);
    if (!room) return reply.code(404).send({ error: 'Room not found.' });
    const latest = (type: string) => {
      const row = db
        .prepare(
          'SELECT data_json FROM agent_events WHERE scope_kind = ? AND scope_id = ? AND type = ? ORDER BY id DESC LIMIT 1',
        )
        .get('room', id, type) as { data_json: string } | undefined;
      return row ? JSON.parse(row.data_json) : null;
    };
    const handActive = activeHands.has(id);
    const handStart = latest('room.hand_start');
    const betting = latest('room.betting_state');
    const players = presentablePlayers(db, id).map((p) => ({
      userId: p.userId,
      username: p.username,
      displayName: p.displayName,
      seat: p.seat,
      stack: p.stack,
      sittingOut: !!p.sittingOut,
    }));
    const eventCursor = (
      db
        .prepare(
          "SELECT COALESCE(MAX(id),0) AS id FROM agent_events WHERE scope_kind = 'room' AND scope_id = ?",
        )
        .get(id) as { id: number }
    ).id;
    return reply.header('cache-control', 'no-store').send({
      room: {
        id,
        name: room.name,
        joinCode: room.join_code,
        sb: room.sb,
        bb: room.bb,
        hostId: room.host_id,
        bankerId: room.banker_id,
      },
      players,
      handActive,
      eventCursor,
      betting: handActive && betting?.handId === handStart?.handId ? betting : null,
      cards: 'Private cards are available only inside your local encrypted-room client.',
      recentResult: latest('room.hand_end'),
    });
  });
  app.get('/api/agent/identity', async (req, reply) => {
    const grant = resolveAgentGrant(db, bearerToken(req));
    if (!grant) return reply.code(401).send({ error: 'Agent token is expired or revoked.' });
    const user = db
      .prepare('SELECT id AS userId, username, pubkey AS publicKey FROM users WHERE id = ?')
      .get(grant.user_id) as object;
    return {
      ...user,
      scopeKind: grant.scope_kind,
      scopeId: grant.scope_id,
      canPlay: !!grant.can_play,
      expiresAt: grant.expires_at,
    };
  });
  app.get('/api/me/agent-grants', { preHandler: requireUser(db) }, async (req) => ({
    grants: db
      .prepare(
        'SELECT id, label, scope_kind AS scopeKind, scope_id AS scopeId, can_play AS canPlay, created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt FROM agent_grants WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
      )
      .all(req.userId),
  }));
  app.post(
    '/api/me/agent-grants',
    {
      preHandler: [
        requireUser(db),
        rateLimit({ name: 'agent-grants', limit: 20, windowMs: 3600_000, by: 'user' }),
      ],
    },
    async (req, reply) => {
      const parsed = z
        .object({
          label: z.string().trim().min(1).max(60),
          scopeKind: z.enum(['room', 'tournament']),
          scopeId: z.string().min(1).max(80),
          canPlay: z.boolean().default(false),
          days: z.number().int().min(1).max(30).default(7),
        })
        .safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid agent access settings.' });
      const b = parsed.data;
      if (!scopeMember(db, req.userId, b.scopeKind, b.scopeId))
        return reply
          .code(403)
          .send({ error: 'Join this room or enroll in this tournament first.' });
      const count = db
        .prepare(
          'SELECT COUNT(*) AS n FROM agent_grants WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?',
        )
        .get(req.userId, Date.now()) as { n: number };
      if (count.n >= 20)
        return reply
          .code(409)
          .send({ error: 'Revoke an existing agent token first (20 active tokens maximum).' });
      const id = randomBytes(12).toString('hex');
      const token = `4am_agent_${randomBytes(32).toString('hex')}`;
      const expiresAt = Date.now() + b.days * 86400_000;
      db.prepare(
        'INSERT INTO agent_grants(id,user_id,token_hash,label,scope_kind,scope_id,can_play,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        req.userId,
        tokenHash(token),
        b.label,
        b.scopeKind,
        b.scopeId,
        Number(b.canPlay),
        Date.now(),
        expiresAt,
      );
      return { id, token, expiresAt };
    },
  );
  app.delete('/api/me/agent-grants/:id', { preHandler: requireUser(db) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = db
      .prepare('UPDATE agent_grants SET revoked_at = ? WHERE id = ? AND user_id = ?')
      .run(Date.now(), id, req.userId);
    return res.changes ? { ok: true } : reply.code(404).send({ error: 'Agent token not found.' });
  });
}
