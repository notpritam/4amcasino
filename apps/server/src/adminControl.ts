import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdminOverview } from '@4am/shared';
import type { DB } from './db.js';
import { platformUserId, requirePlatform } from './platform.js';
import {
  adminCommissionSettings,
  changeCommission,
  commissionSettings,
} from './platformSettings.js';
import { platformDues } from './house.js';
import { roomEvents } from './rooms.js';

export function registerPlatformControl(app: FastifyInstance, db: DB): void {
  const platformOnly = { preHandler: requirePlatform(db) };
  app.get('/api/platform/settings', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    const { commissionBps, revision, updatedAt } = commissionSettings(db);
    return { commissionBps, revision, updatedAt };
  });
  app.get('/api/admin/settings', platformOnly, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return adminCommissionSettings(db);
  });
  app.put('/api/admin/settings/commission', platformOnly, async (req, reply) => {
    const parsed = z
      .object({
        commissionBps: z.number().int().min(0).max(10000),
        scope: z.enum(['new_rooms', 'all_rooms']),
        revision: z.number().int().min(0),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({
          error:
            'Enter a rate from 0% to 100% with at most two decimal places, and choose where to apply it.',
        });
    const result = changeCommission(db, parsed.data, req.userId);
    if (!result)
      return reply
        .code(409)
        .send({
          error:
            'The house cut changed in another session. Reload the settings before saving again.',
        });
    const { roomIds, ...settings } = result;
    for (const roomId of roomIds) roomEvents.emit('changed', roomId);
    return settings;
  });

  app.get('/api/admin/overview', platformOnly, async (): Promise<AdminOverview> => {
    const platformId = platformUserId(db);
    const count = (sql: string, ...args: (string | number | null)[]) =>
      (db.prepare(sql).get(...args) as { n: number }).n;
    const days = Array.from({ length: 14 }, (_, i) =>
      new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10),
    );
    const revenueRows = db
      .prepare(
        `SELECT strftime('%Y-%m-%d', l.ts / 1000, 'unixepoch') AS date, SUM(l.delta) AS commission
      FROM ledger l JOIN rooms r ON r.id = l.room_id
      WHERE l.kind = 'commission' AND l.ts >= ? AND r.voided = 0 AND r.archived = 0 AND r.deleted = 0
      AND NOT EXISTS (SELECT 1 FROM ledger v WHERE v.room_id = l.room_id AND v.ref = l.ref AND v.kind = 'void-hand')
      GROUP BY date`,
      )
      .all(Date.parse(days[0]! + 'T00:00:00Z')) as { date: string; commission: number }[];
    const byDay = new Map(revenueRows.map((r) => [r.date, r.commission]));
    return {
      users: count('SELECT COUNT(*) AS n FROM users WHERE id != ?', platformId ?? -1),
      rooms: count('SELECT COUNT(*) AS n FROM rooms WHERE deleted = 0'),
      activeRooms: count(
        'SELECT COUNT(*) AS n FROM rooms WHERE deleted = 0 AND archived = 0 AND voided = 0',
      ),
      hands: count(`SELECT COUNT(*) AS n FROM transcripts t JOIN rooms r ON r.id = t.room_id
        WHERE r.deleted = 0 AND r.archived = 0 AND r.voided = 0
        AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.room_id = t.room_id AND l.ref = t.head AND l.kind = 'void-hand')`),
      pendingRequests:
        count("SELECT COUNT(*) AS n FROM room_lifecycle_requests WHERE status = 'pending'") +
        count("SELECT COUNT(*) AS n FROM account_merge_requests WHERE status = 'pending'"),
      commissionBps: commissionSettings(db).commissionBps,
      dues: platformDues(db).totals,
      revenue: days.map((date) => ({ date, commission: byDay.get(date) ?? 0 })),
    };
  });

  app.get('/api/admin/users', platformOnly, async (req, reply) => {
    const parsed = z
      .object({
        q: z.string().max(100).default(''),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
      })
      .safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid user search.' });
    const { q, offset } = parsed.data;
    const params = { q: `%${q.trim().replace(/^@/, '')}%`, offset };
    const where =
      "u.username LIKE @q OR COALESCE(u.display_name, '') LIKE @q OR CAST(u.id AS TEXT) LIKE @q";
    const users = db
      .prepare(
        `SELECT u.id AS userId, u.username, COALESCE(u.display_name, u.username) AS displayName,
      u.disabled, u.created_at AS createdAt, u.last_seen AS lastSeen, u.avatar_version AS avatarVersion,
      (SELECT COUNT(*) FROM room_players rp JOIN rooms r ON r.id = rp.room_id WHERE rp.user_id = u.id AND r.deleted = 0) AS rooms
      FROM users u WHERE ${where} ORDER BY u.id DESC LIMIT 50 OFFSET @offset`,
      )
      .all(params) as { userId: number }[];
    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`)
      .get({ q: params.q }) as { total: number };
    return {
      users: users.map((u) => ({ ...u, isPlatform: u.userId === platformUserId(db) })),
      total,
      offset,
      hasMore: offset + users.length < total,
    };
  });
}
