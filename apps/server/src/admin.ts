import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from './db.js';
import { requirePlatform } from './platform.js';
import { roomEvents } from './rooms.js';

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
}
