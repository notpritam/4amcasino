import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from './db.js';

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
      'INSERT INTO users (username, auth_hash, auth_salt, pubkey, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(username, hashAuthKey(authKey, salt), salt, publicKey, Date.now());
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
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    Date.now(),
  );
  return token;
}

export function userForToken(db: DB, token: string): number | null {
  const row = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as
    | { user_id: number }
    | undefined;
  return row ? row.user_id : null;
}

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
  };
}
