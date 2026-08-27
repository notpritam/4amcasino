import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from './db.js';
import { createSession, endSession, hashAuthKey, requireUser } from './auth.js';
import { forgive, hitNamed, rateLimit } from './limits.js';

/** Editing your password, your username, and getting back in when you have
 *  forgotten both (requested by notpritam, docs/FEATURES.md).
 *
 *  The whole point of this app is that your password derives your ed25519
 *  card-signing key in the browser, so changing either your password OR your
 *  username re-derives that key: the client must upload a NEW pubkey with the
 *  change, authenticated by the OLD auth key. Old hands stay verifiable because
 *  every transcript entry carries the signer's pubkey inline.
 *
 *  A truly forgotten password is therefore an unrecoverable identity unless a
 *  recovery code was set up in advance - that code is the second door. */

const authKey = z.string().length(64).regex(/^[0-9a-f]+$/);
const pubKey = z.string().length(64).regex(/^[0-9a-f]+$/);
const usernameSchema = z.string().min(2).max(24).regex(/^[a-zA-Z0-9_]+$/);

interface UserSecrets {
  auth_hash: string;
  auth_salt: string;
  recovery_hash: string | null;
  recovery_salt: string | null;
  recovery_set_at: number | null;
}

function secretsFor(db: DB, userId: number): UserSecrets | undefined {
  return db
    .prepare(
      'SELECT auth_hash, auth_salt, recovery_hash, recovery_salt, recovery_set_at FROM users WHERE id = ?',
    )
    .get(userId) as UserSecrets | undefined;
}

function sameHash(candidateHex: string, storedHex: string): boolean {
  const a = Buffer.from(candidateHex, 'hex');
  const b = Buffer.from(storedHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Re-keying while you are sitting in a hand would desync your seat's pubkey
 *  mid-deal, so we refuse rather than corrupt a live game. */
function seatedSomewhere(db: DB, userId: number): boolean {
  return !!db
    .prepare('SELECT 1 FROM room_players WHERE user_id = ? AND seat IS NOT NULL LIMIT 1')
    .get(userId);
}

/** Applies a new credential + identity atomically and cuts every other session
 *  loose: whoever stole the old password does not keep a live token. */
function rekey(
  db: DB,
  userId: number,
  newAuthKey: string,
  newPublicKey: string,
  keepToken: string | null,
  extra?: { username?: string },
): void {
  const salt = randomBytes(16).toString('hex');
  const apply = db.transaction(() => {
    db.prepare('UPDATE users SET auth_hash = ?, auth_salt = ?, pubkey = ? WHERE id = ?').run(
      hashAuthKey(newAuthKey, salt),
      salt,
      newPublicKey,
      userId,
    );
    if (extra?.username !== undefined) {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(extra.username, userId);
    }
    if (keepToken) {
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, keepToken);
    } else {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    }
  });
  apply();
}

function bearer(req: { headers: Record<string, unknown> }): string | null {
  const header = String(req.headers.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

export function registerAccountRoutes(app: FastifyInstance, db: DB): void {
  const authed = { preHandler: requireUser(db) };

  /** Change password: the client re-derives BOTH keys from the new password and
   *  proves it still holds the old one. */
  app.post(
    '/api/me/password',
    {
      preHandler: [
        requireUser(db),
        rateLimit({ name: 'pwchange', limit: 10, windowMs: 15 * 60_000, by: 'user' }),
      ],
    },
    async (req, reply) => {
      const parsed = z
        .object({ currentAuthKey: authKey, newAuthKey: authKey, newPublicKey: pubKey })
        .safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
      const me = secretsFor(db, req.userId);
      if (!me) return reply.code(404).send({ error: 'no such user' });
      if (!sameHash(hashAuthKey(parsed.data.currentAuthKey, me.auth_salt), me.auth_hash)) {
        return reply.code(403).send({ error: 'that is not your current password' });
      }
      if (parsed.data.newAuthKey === parsed.data.currentAuthKey) {
        return reply.code(400).send({ error: 'that is already your password' });
      }
      if (seatedSomewhere(db, req.userId)) {
        return reply
          .code(409)
          .send({ error: 'stand up from your seat first - changing your password re-keys your cards' });
      }
      rekey(db, req.userId, parsed.data.newAuthKey, parsed.data.newPublicKey, bearer(req));
      return { ok: true, publicKey: parsed.data.newPublicKey };
    },
  );

  /** Change username. Both derivation domains include the name, so this re-keys
   *  exactly like a password change - and the new name must be free. */
  app.post(
    '/api/me/username',
    {
      preHandler: [
        requireUser(db),
        rateLimit({ name: 'namechange', limit: 5, windowMs: 60 * 60_000, by: 'user' }),
      ],
    },
    async (req, reply) => {
      const parsed = z
        .object({
          username: usernameSchema,
          currentAuthKey: authKey,
          newAuthKey: authKey,
          newPublicKey: pubKey,
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: '2-24 characters, letters, numbers and _ only' });
      }
      const me = secretsFor(db, req.userId);
      if (!me) return reply.code(404).send({ error: 'no such user' });
      if (!sameHash(hashAuthKey(parsed.data.currentAuthKey, me.auth_salt), me.auth_hash)) {
        return reply.code(403).send({ error: 'wrong password' });
      }
      if (seatedSomewhere(db, req.userId)) {
        return reply
          .code(409)
          .send({ error: 'stand up from your seat first - renaming re-keys your cards' });
      }
      const taken = db
        .prepare('SELECT 1 FROM users WHERE username = ? AND id != ?')
        .get(parsed.data.username, req.userId);
      if (taken) return reply.code(409).send({ error: 'that name is taken' });
      try {
        rekey(db, req.userId, parsed.data.newAuthKey, parsed.data.newPublicKey, bearer(req), {
          username: parsed.data.username,
        });
      } catch (e) {
        // the uniqueness check above races; the UNIQUE index is the real referee
        if (e instanceof Error && e.message.includes('UNIQUE')) {
          return reply.code(409).send({ error: 'that name is taken' });
        }
        throw e;
      }
      return { ok: true, username: parsed.data.username, publicKey: parsed.data.newPublicKey };
    },
  );

  app.get('/api/me/recovery', authed, async (req) => {
    const me = secretsFor(db, req.userId);
    return { enabled: !!me?.recovery_hash, setAt: me?.recovery_set_at ?? null };
  });

  /** Arm (or clear) the recovery code. Re-authenticates, because an attacker on a
   *  borrowed session must not be able to mint themselves a permanent back door. */
  app.put(
    '/api/me/recovery',
    {
      preHandler: [
        requireUser(db),
        rateLimit({ name: 'recovery-set', limit: 10, windowMs: 60 * 60_000, by: 'user' }),
      ],
    },
    async (req, reply) => {
      const parsed = z
        .object({ currentAuthKey: authKey, recoveryAuthKey: authKey.nullable() })
        .safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
      const me = secretsFor(db, req.userId);
      if (!me) return reply.code(404).send({ error: 'no such user' });
      if (!sameHash(hashAuthKey(parsed.data.currentAuthKey, me.auth_salt), me.auth_hash)) {
        return reply.code(403).send({ error: 'wrong password' });
      }
      if (parsed.data.recoveryAuthKey === null) {
        db.prepare(
          'UPDATE users SET recovery_hash = NULL, recovery_salt = NULL, recovery_set_at = NULL WHERE id = ?',
        ).run(req.userId);
        return { ok: true, enabled: false };
      }
      const salt = randomBytes(16).toString('hex');
      db.prepare(
        'UPDATE users SET recovery_hash = ?, recovery_salt = ?, recovery_set_at = ? WHERE id = ?',
      ).run(hashAuthKey(parsed.data.recoveryAuthKey, salt), salt, Date.now(), req.userId);
      return { ok: true, enabled: true };
    },
  );

  /** The forgotten-password door. Unauthenticated by nature, so it is throttled
   *  by IP and by the name being targeted, and answers identically whether or not
   *  the account exists. */
  app.post(
    '/api/recover',
    { preHandler: rateLimit({ name: 'recover-ip', limit: 10, windowMs: 15 * 60_000, by: 'ip' }) },
    async (req, reply) => {
      const parsed = z
        .object({
          username: usernameSchema,
          recoveryAuthKey: authKey,
          newAuthKey: authKey,
          newPublicKey: pubKey,
        })
        .safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
      const perName = hitNamed('recover-name', parsed.data.username, 10, 15 * 60_000);
      if (!perName.ok) {
        return reply
          .code(429)
          .header('retry-after', String(perName.retryAfterSecs))
          .send({ error: `too many attempts - try again in ${perName.retryAfterSecs}s` });
      }

      const row = db
        .prepare('SELECT id, recovery_hash, recovery_salt FROM users WHERE username = ?')
        .get(parsed.data.username) as
        | { id: number; recovery_hash: string | null; recovery_salt: string | null }
        | undefined;

      // same shape and roughly the same cost whether the account exists, has no
      // code, or the code is wrong - none of those should be distinguishable
      const salt = row?.recovery_salt ?? 'f'.repeat(32);
      const candidate = hashAuthKey(parsed.data.recoveryAuthKey, salt);
      const good = !!row?.recovery_hash && sameHash(candidate, row.recovery_hash);
      if (!good) {
        return reply.code(403).send({ error: 'that recovery code does not match' });
      }
      if (seatedSomewhere(db, row!.id)) {
        return reply
          .code(409)
          .send({ error: 'you are seated at a table - leave the seat before recovering' });
      }

      // burn the code: one use only, and every existing session dies
      const userId = row!.id;
      rekey(db, userId, parsed.data.newAuthKey, parsed.data.newPublicKey, null);
      db.prepare(
        'UPDATE users SET recovery_hash = NULL, recovery_salt = NULL, recovery_set_at = NULL WHERE id = ?',
      ).run(userId);
      forgive(`recover-name|n:${parsed.data.username.toLowerCase()}`);
      forgive(`recover-ip|ip:${req.ip}`);
      return { userId, username: parsed.data.username, token: createSession(db, userId) };
    },
  );

  /** Ends this session server-side. Clearing localStorage never did that, so a
   *  token copied off a shared machine outlived the "log out" click. */
  app.post('/api/logout', authed, async (req) => {
    const token = bearer(req);
    if (token) endSession(db, token);
    return { ok: true };
  });

  /** Sign out every other device without changing anything else. */
  app.post('/api/me/sessions/revoke-others', authed, async (req) => {
    const token = bearer(req);
    const info = token
      ? db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.userId, token)
      : db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.userId);
    return { ok: true, revoked: info.changes };
  });

  app.get('/api/me/sessions', authed, async (req) => {
    const rows = db
      .prepare('SELECT token, created_at as createdAt FROM sessions WHERE user_id = ?')
      .all(req.userId) as { token: string; createdAt: number }[];
    const mine = bearer(req);
    // never hand back the raw tokens - a short fingerprint is enough to tell
    // "this one is the browser I am using right now" from the rest
    return {
      sessions: rows.map((r) => ({
        id: r.token.slice(0, 8),
        createdAt: r.createdAt,
        current: r.token === mine,
      })),
    };
  });
}
