import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_TTL_MS, type DB } from './db.js';

export function hashAuthKey(authKey: string, salt: string): string {
  return scryptSync(authKey, salt, 32).toString('hex');
}

export function createUser(
  db: DB,
  username: string,
  authKey: string,
  publicKey: string,
): { userId: number } {
  const salt = randomBytes(16).toString('hex');
  const info = db
    .prepare(
      'INSERT INTO users (username, auth_hash, auth_salt, pubkey, created_at, theme) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(username, hashAuthKey(authKey, salt), salt, publicKey, Date.now(), 'cyber');
  return { userId: Number(info.lastInsertRowid) };
}

export function checkLogin(
  db: DB,
  username: string,
  authKey: string,
): { userId: number; publicKey: string } | null {
  const row = db
    .prepare('SELECT id, auth_hash, auth_salt, pubkey FROM users WHERE username = ?')
    .get(username) as { id: number; auth_hash: string; auth_salt: string; pubkey: string } | undefined;
  if (!row) return null;
  const candidate = Buffer.from(hashAuthKey(authKey, row.auth_salt), 'hex');
  const actual = Buffer.from(row.auth_hash, 'hex');
  if (candidate.length !== actual.length || !timingSafeEqual(candidate, actual)) return null;
  return { userId: row.id, publicKey: row.pubkey };
}

export function createSession(db: DB, userId: number): string {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, last_used, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(token, userId, now, now, now + SESSION_TTL_MS);
  // opportunistic sweep so the table cannot grow forever on dead logins
  if (Math.random() < 0.02) db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  return token;
}

export function userForToken(db: DB, token: string): number | null {
  const row = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
    .get(token) as { user_id: number; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return row.user_id;
}

/** Ends one session - the logout the app never had. */
export function endSession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

const seenCache = new Map<number, number>();

/** Marks a user online; writes at most one row update per 30s per user. */
export function touchPresence(db: DB, userId: number): void {
  const now = Date.now();
  if (now - (seenCache.get(userId) ?? 0) < 30_000) return;
  seenCache.set(userId, now);
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, userId);
}

export const ONLINE_WINDOW_MS = 2 * 60_000;

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
  }
}

export function requireUser(db: DB) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const userId = token ? userForToken(db, token) : null;
    if (userId === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return reply;
    }
    req.userId = userId;
    touchPresence(db, userId);
  };
}
