import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from './db.js';
import { isPlatform, platformUserId, requirePlatform } from './platform.js';
import { requireUser } from './auth.js';
import { roomEvents } from './rooms.js';
import { mergeAccounts } from './merge.js';
import { rekey } from './account.js';
import { activeHands } from './liveHands.js';

const authKey = z.string().length(64).regex(/^[0-9a-f]+$/);
const pubKey = z.string().length(64).regex(/^[0-9a-f]+$/);

/** Same guard as account.ts's seatedSomewhere: re-keying while seated would
 *  desync a live seat's pubkey mid-deal, whether the change is self-served
 *  or admin-initiated. */
function seatedSomewhere(db: DB, userId: number): boolean {
  return !!db
    .prepare('SELECT 1 FROM room_players WHERE user_id = ? AND seat IS NOT NULL LIMIT 1')
    .get(userId);
}

interface PendingLifecycleRow {
  id: number;
  roomId: string;
  roomName: string;
  action: string;
  status: string;
  requestedBy: number;
  requesterName: string;
  note: string | null;
  createdAt: number;
}

/** Net hand-settlement balance and distinct room count for one user - the
 *  manual "does this look right" surface an admin checks before approving a
 *  merge (task-3 brief §7). Mirrors the aggregation leaderboard/social.ts use. */
function balanceSummary(db: DB, userId: number): { balance: number; rooms: number } {
  const { balance } = db
    .prepare(
      `SELECT COALESCE(SUM(delta), 0) AS balance FROM ledger WHERE user_id = ? AND kind = 'hand-settlement'`,
    )
    .get(userId) as { balance: number };
  const { rooms } = db
    .prepare(`SELECT COUNT(DISTINCT room_id) AS rooms FROM ledger WHERE user_id = ?`)
    .get(userId) as { rooms: number };
  return { balance, rooms };
}

/** The Platform account's console for room lifecycle requests: archive,
 *  unarchive and delete are all requested by a host or banker (see social.ts)
 *  but only take effect once approved here. Rejecting leaves the room as-is. */
export function registerAdminRoutes(app: FastifyInstance, db: DB): void {
  const platformOnly = { preHandler: requirePlatform(db) };

  app.get('/api/admin/lifecycle', platformOnly, async () => {
    const rows = db
      .prepare(
        `SELECT lr.id AS id, lr.room_id AS roomId, r.name AS roomName, lr.action AS action,
                lr.status AS status, lr.requested_by AS requestedBy,
                COALESCE(u.display_name, u.username) AS requesterName,
                lr.note AS note, lr.created_at AS createdAt
         FROM room_lifecycle_requests lr
         JOIN rooms r ON r.id = lr.room_id
         JOIN users u ON u.id = lr.requested_by
         WHERE lr.status = 'pending'
         ORDER BY lr.created_at ASC`,
      )
      .all() as PendingLifecycleRow[];
    return { requests: rows };
  });

  app.post('/api/admin/lifecycle/:id', platformOnly, async (req, reply) => {
    const parsed = z.object({ approve: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });

    const { id } = req.params as { id: string };
    const requestId = Number(id);
    if (!Number.isInteger(requestId)) return reply.code(400).send({ error: 'invalid input' });

    const lifecycleRequest = db
      .prepare(
        `SELECT id, room_id AS roomId, action, status FROM room_lifecycle_requests WHERE id = ?`,
      )
      .get(requestId) as { id: number; roomId: string; action: string; status: string } | undefined;
    if (!lifecycleRequest) return reply.code(404).send({ error: 'no such request' });
    if (lifecycleRequest.status !== 'pending')
      return reply.code(400).send({ error: 'already decided' });

    const approve = parsed.data.approve;
    const decide = db.transaction(() => {
      db.prepare(
        `UPDATE room_lifecycle_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?`,
      ).run(approve ? 'approved' : 'rejected', Date.now(), req.userId, requestId);

      if (approve) {
        if (lifecycleRequest.action === 'archive') {
          db.prepare('UPDATE rooms SET archived = 1, archived_at = ? WHERE id = ?').run(
            Date.now(),
            lifecycleRequest.roomId,
          );
        } else if (lifecycleRequest.action === 'unarchive') {
          db.prepare('UPDATE rooms SET archived = 0, archived_at = NULL WHERE id = ?').run(
            lifecycleRequest.roomId,
          );
        } else if (lifecycleRequest.action === 'delete') {
          db.prepare('UPDATE rooms SET deleted = 1, deleted_at = ? WHERE id = ?').run(
            Date.now(),
            lifecycleRequest.roomId,
          );
        }
      }
    });
    decide();

    roomEvents.emit('changed', lifecycleRequest.roomId);
    return { ok: true, status: approve ? 'approved' : 'rejected' };
  });

  /** Any authed user can ask that another username be folded into their own
   *  (or vice versa) - filing the request never merges anything by itself,
   *  it only queues the ask for a human at the platform account to review. */
  app.post('/api/me/merge-request', { preHandler: requireUser(db) }, async (req, reply) => {
    const parsed = z
      .object({
        fromUsername: z.string().min(1),
        intoUsername: z.string().min(1),
        note: z.string().max(500).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });

    const { fromUsername, intoUsername, note } = parsed.data;
    if (fromUsername === intoUsername) {
      return reply.code(400).send({ error: 'cannot merge an account into itself' });
    }

    const from = db.prepare('SELECT id FROM users WHERE username = ?').get(fromUsername) as
      | { id: number }
      | undefined;
    if (!from) return reply.code(404).send({ error: `no such user: ${fromUsername}` });
    // Filing this request is the front door mergeAccounts guards against too
    // (merge.ts) - refuse here as well so a request naming the platform
    // account as `from` never even reaches the pending queue.
    if (isPlatform(db, from.id)) {
      return reply.code(400).send({ error: 'cannot merge the platform account' });
    }
    const into = db.prepare('SELECT id FROM users WHERE username = ?').get(intoUsername) as
      | { id: number }
      | undefined;
    if (!into) return reply.code(404).send({ error: `no such user: ${intoUsername}` });
    if (from.id === into.id) {
      return reply.code(400).send({ error: 'cannot merge an account into itself' });
    }

    const info = db
      .prepare(
        `INSERT INTO account_merge_requests (from_user, into_user, requested_by, note, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(from.id, into.id, req.userId, note ?? null, Date.now());
    return { requestId: Number(info.lastInsertRowid) };
  });

  interface PendingMergeRow {
    id: number;
    fromUser: number;
    fromUsername: string;
    intoUser: number;
    intoUsername: string;
    note: string | null;
    createdAt: number;
  }

  /** The manual-check surface: every pending merge request alongside a net
   *  hand-settlement balance and room count for BOTH sides, so the platform
   *  operator can eyeball "does folding these two together look right"
   *  before approving (task-3 brief §7) - mergeAccounts itself trusts nothing
   *  here, this is purely for the human decision. */
  app.get('/api/admin/merges', platformOnly, async () => {
    const rows = db
      .prepare(
        `SELECT mr.id AS id, mr.from_user AS fromUser, fu.username AS fromUsername,
                mr.into_user AS intoUser, iu.username AS intoUsername,
                mr.note AS note, mr.created_at AS createdAt
         FROM account_merge_requests mr
         JOIN users fu ON fu.id = mr.from_user
         JOIN users iu ON iu.id = mr.into_user
         WHERE mr.status = 'pending'
         ORDER BY mr.created_at ASC`,
      )
      .all() as PendingMergeRow[];

    const requests = rows.map((r) => {
      const fromSummary = balanceSummary(db, r.fromUser);
      const intoSummary = balanceSummary(db, r.intoUser);
      return {
        id: r.id,
        fromUser: r.fromUser,
        fromUsername: r.fromUsername,
        intoUser: r.intoUser,
        intoUsername: r.intoUsername,
        note: r.note,
        createdAt: r.createdAt,
        fromBalance: fromSummary.balance,
        fromRooms: fromSummary.rooms,
        intoBalance: intoSummary.balance,
        intoRooms: intoSummary.rooms,
      };
    });
    return { requests };
  });

  /** Approve -> actually run mergeAccounts (its own transaction; a failure
   *  there - e.g. someone sat down mid-review - leaves the request pending
   *  and disables nobody, reported as 409 rather than silently swallowed.
   *  Reject -> just records the decision, never touches either account. */
  app.post('/api/admin/merges/:id', platformOnly, async (req, reply) => {
    const parsed = z.object({ approve: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });

    const { id } = req.params as { id: string };
    const requestId = Number(id);
    if (!Number.isInteger(requestId)) return reply.code(400).send({ error: 'invalid input' });

    const mergeRequest = db
      .prepare(
        `SELECT id, from_user AS fromUser, into_user AS intoUser, status FROM account_merge_requests WHERE id = ?`,
      )
      .get(requestId) as { id: number; fromUser: number; intoUser: number; status: string } | undefined;
    if (!mergeRequest) return reply.code(404).send({ error: 'no such request' });
    if (mergeRequest.status !== 'pending')
      return reply.code(400).send({ error: 'already decided' });

    const approve = parsed.data.approve;
    if (!approve) {
      db.prepare(
        `UPDATE account_merge_requests SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?`,
      ).run(Date.now(), req.userId, requestId);
      return { ok: true, status: 'rejected' };
    }

    // Second line of defense: the filing route above already blocks this,
    // but a request could predate the platform account being (re)assigned -
    // never let approval reach mergeAccounts with the platform as `from`.
    if (isPlatform(db, mergeRequest.fromUser)) {
      return reply.code(400).send({ error: 'cannot merge the platform account' });
    }

    try {
      mergeAccounts(db, mergeRequest.fromUser, mergeRequest.intoUser);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'merge failed';
      return reply.code(409).send({ error: message });
    }

    db.prepare(
      `UPDATE account_merge_requests SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ?`,
    ).run(Date.now(), req.userId, requestId);
    return { ok: true, status: 'approved' };
  });

  /** Skip the request queue entirely: merge two accounts right now. Guarded
   *  the same way the approval path above is - mergeAccounts's own checks,
   *  plus the platform-as-`from` guard duplicated here - but still records
   *  an (already-decided) row in account_merge_requests so a direct merge
   *  leaves the same audit trail an approved request would. */
  app.post('/api/admin/merge', platformOnly, async (req, reply) => {
    const parsed = z
      .object({
        fromUsername: z.string().min(1),
        intoUsername: z.string().min(1),
        note: z.string().max(500).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });

    const { fromUsername, intoUsername, note } = parsed.data;
    if (fromUsername === intoUsername) {
      return reply.code(400).send({ error: 'cannot merge an account into itself' });
    }

    const from = db.prepare('SELECT id FROM users WHERE username = ?').get(fromUsername) as
      | { id: number }
      | undefined;
    if (!from) return reply.code(404).send({ error: `no such user: ${fromUsername}` });
    const into = db.prepare('SELECT id FROM users WHERE username = ?').get(intoUsername) as
      | { id: number }
      | undefined;
    if (!into) return reply.code(404).send({ error: `no such user: ${intoUsername}` });
    if (from.id === into.id) {
      return reply.code(400).send({ error: 'cannot merge an account into itself' });
    }
    if (isPlatform(db, from.id)) {
      return reply.code(400).send({ error: 'cannot merge the platform account' });
    }

    try {
      mergeAccounts(db, from.id, into.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'merge failed';
      return reply.code(409).send({ error: message });
    }

    const platformId = platformUserId(db)!;
    const now = Date.now();
    db.prepare(
      `INSERT INTO account_merge_requests
         (from_user, into_user, requested_by, note, status, created_at, decided_at, decided_by)
       VALUES (?, ?, ?, ?, 'approved', ?, ?, ?)`,
    ).run(from.id, into.id, platformId, note ?? null, now, now, platformId);

    return { ok: true };
  });

  interface AdminRoomRow {
    id: string;
    name: string;
    archived: number;
    hostName: string;
    playerCount: number;
  }

  /** Every non-deleted room, newest first, for the platform's own room
   *  management - this mutates rooms directly rather than queuing a request.
   *  Player counts exclude the platform account itself, same as the
   *  public/my-rooms listings in rooms.ts, so an idle house seat never
   *  inflates a headcount. */
  app.get('/api/admin/rooms', platformOnly, async (req) => {
    const { q } = req.query as { q?: string };
    const like = q && q.trim() ? `%${q.trim()}%` : '%';
    const rows = db
      .prepare(
        `SELECT r.id AS id, r.name AS name, r.archived AS archived,
                COALESCE(u.display_name, u.username) AS hostName,
                (SELECT COUNT(*) FROM room_players rp WHERE rp.room_id = r.id
                   AND rp.user_id NOT IN (SELECT CAST(value AS INTEGER) FROM meta WHERE key='platform_user_id')) AS playerCount
         FROM rooms r
         JOIN users u ON u.id = r.host_id
         WHERE r.deleted = 0 AND r.name LIKE ?
         ORDER BY r.created_at DESC
         LIMIT 50`,
      )
      .all(like) as AdminRoomRow[];
    return { rooms: rows };
  });

  /** Archive/unarchive a room directly - same mid-hand guard the self-serve
   *  request in social.ts uses (only refuse when turning archiving *on*;
   *  restoring a room is always safe). */
  app.post('/api/admin/rooms/:id/archive', platformOnly, async (req, reply) => {
    const parsed = z.object({ archived: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });

    const { id } = req.params as { id: string };
    const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(id);
    if (!room) return reply.code(404).send({ error: 'no such room' });

    const { archived } = parsed.data;
    if (archived && activeHands.has(id)) {
      return reply.code(400).send({ error: 'a hand is in progress - wait for it to finish' });
    }

    if (archived) {
      db.prepare('UPDATE rooms SET archived = 1, archived_at = ? WHERE id = ?').run(Date.now(), id);
    } else {
      db.prepare('UPDATE rooms SET archived = 0, archived_at = NULL WHERE id = ?').run(id);
    }
    roomEvents.emit('changed', id);
    return { ok: true, archived };
  });

  /** Delete a room directly - always refuses mid-hand, same as the
   *  self-serve request in social.ts (delete has no "undo" toggle, so unlike
   *  archive there's no safe direction to allow while a hand is live). */
  app.post('/api/admin/rooms/:id/delete', platformOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(id);
    if (!room) return reply.code(404).send({ error: 'no such room' });

    if (activeHands.has(id)) {
      return reply.code(400).send({ error: 'a hand is in progress - wait for it to finish' });
    }

    db.prepare('UPDATE rooms SET deleted = 1, deleted_at = ? WHERE id = ?').run(Date.now(), id);
    roomEvents.emit('changed', id);
    return { ok: true };
  });

  /** Force-disable an account outright, no merge involved (a spam signup, a
   *  cheater, someone who asked to be removed). Kills every session so the
   *  disable takes effect on their very next request (see auth.ts's
   *  requireUser, which rejects disabled users with 401). Refuses to target
   *  the platform account itself - that would lock the admin console. */
  app.post('/api/admin/users/:id/disable', platformOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const targetId = Number(id);
    if (!Number.isInteger(targetId)) return reply.code(400).send({ error: 'invalid input' });

    if (isPlatform(db, targetId)) {
      return reply.code(400).send({ error: 'cannot disable the platform account' });
    }
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
    if (!target) return reply.code(404).send({ error: 'no such user' });

    db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(targetId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
    return { ok: true };
  });

  /** Reset another user's credentials - the "I lost my recovery code too"
   *  escape hatch, done by a human at the platform account instead of the
   *  self-serve /api/recover flow. Reuses account.ts's rekey() so the atomic
   *  swap + full session purge is identical to every other credential
   *  rotation in this app; refuses while the target is seated for the same
   *  reason account.ts does (a live hand's pubkey must not shift mid-deal). */
  app.post('/api/admin/users/:id/password', platformOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const targetId = Number(id);
    if (!Number.isInteger(targetId)) return reply.code(400).send({ error: 'invalid input' });

    const parsed = z.object({ newAuthKey: authKey, newPublicKey: pubKey }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });

    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
    if (!target) return reply.code(404).send({ error: 'no such user' });

    if (seatedSomewhere(db, targetId)) {
      return reply
        .code(409)
        .send({ error: 'that user is seated at a table - they must stand up before a reset' });
    }

    rekey(db, targetId, parsed.data.newAuthKey, parsed.data.newPublicKey, null);
    return { ok: true };
  });
}
