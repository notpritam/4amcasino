import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { openDb, type DB } from './db.js';
import { checkLogin, createSession, createUser, requireUser } from './auth.js';
import { registerRoomRoutes } from './rooms.js';
import { registerProfileRoutes } from './profile.js';
import { registerSocialRoutes } from './social.js';
import { registerAccountRoutes } from './account.js';
import { forgive, hitNamed, LIMITS, rateLimit } from './limits.js';

const registerSchema = z.object({
  username: z.string().min(2).max(24).regex(/^[a-zA-Z0-9_]+$/),
  authKey: z.string().length(64).regex(/^[0-9a-f]+$/),
  publicKey: z.string().length(64).regex(/^[0-9a-f]+$/),
});
const loginSchema = registerSchema.omit({ publicKey: true });

export function createApp(
  dbPath: string,
  storageInfo?: () => Record<string, unknown>,
): { app: FastifyInstance; db: DB } {
  const db = openDb(dbPath);
  // Trust exactly one hop - the immediate peer, which in production is Render's
  // load balancer. req.ip then resolves to the address that balancer observed
  // rather than the left-most X-Forwarded-For entry, which any client can forge
  // to sidestep the rate limiter. Typed as FastifyServerOptions so TS picks the
  // plain-HTTP overload.
  const serverOptions: FastifyServerOptions = {
    forceCloseConnections: true,
    trustProxy: (_address: string, hop: number) => hop === 0,
    bodyLimit: LIMITS.bodyBytes,
  };
  const app = Fastify(serverOptions);
  // Reflecting every origin let any page on the internet call the credential
  // routes and read the answer, which spreads a login-guessing campaign across
  // its visitors' IPs and defeats a per-IP limit. Auth is Bearer-only so there
  // was never CSRF exposure, but the allowlist costs nothing.
  const allowedOrigins = [
    'https://poker.notpritam.in',
    ...(process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  ];
  void app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl, native clients, same-origin
      if (allowedOrigins.includes(origin)) return cb(null, true);
      try {
        const host = new URL(origin).hostname;
        const local =
          host === 'localhost' || host === '127.0.0.1' || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host);
        return cb(null, local);
      } catch {
        return cb(null, false);
      }
    },
  });

  // The web app persists a card-signing key in localStorage, so anything that
  // can run script on this origin can walk off with a player's identity. A CSP
  // is the difference between "an injected script exfiltrates it" and "an
  // injected script cannot reach a network it is allowed to talk to".
  app.addHook('onSend', async (_req, reply) => {
    void reply.headers({
      'content-security-policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        'font-src https://fonts.gstatic.com data:',
        "img-src 'self' data: blob:",
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'none'",
      ].join('; '),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
    });
  });

  app.addHook('onClose', async () => {
    db.close();
  });

  // storage: 'disk' or 'mongodb' when data survives deploys, 'ephemeral' when it resets
  app.get('/api/health', async () => ({
    ok: true,
    ...(storageInfo?.() ?? { storage: dbPath.startsWith('/data') ? 'disk' : 'ephemeral' }),
  }));

  app.post(
    '/api/register',
    // Generous on purpose: the common case is a house game where nine people
    // sign up from the same wifi inside ten minutes, and they all share one IP.
    { preHandler: rateLimit({ name: 'register', limit: 40, windowMs: 60 * 60_000, by: 'ip' }) },
    async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { username, authKey, publicKey } = parsed.data;
    try {
      const { userId, joinNumber } = createUser(db, username, authKey, publicKey);
      return { userId, joinNumber, token: createSession(db, userId) };
    } catch (e) {
      if (e instanceof Error && e.message.includes('UNIQUE')) {
        return reply.code(409).send({ error: 'username taken' });
      }
      throw e;
    }
    },
  );

  app.post(
    '/api/login',
    { preHandler: rateLimit({ name: 'login-ip', limit: 30, windowMs: 15 * 60_000, by: 'ip' }) },
    async (req, reply) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
      // also cap attempts against a single NAME, so spraying one account from a
      // botnet is throttled even though every request comes from a fresh IP
      const perName = hitNamed('login-name', parsed.data.username, 20, 15 * 60_000);
      if (!perName.ok) {
        return reply
          .code(429)
          .header('retry-after', String(perName.retryAfterSecs))
          .send({ error: `too many attempts - try again in ${perName.retryAfterSecs}s` });
      }
      const res = checkLogin(db, parsed.data.username, parsed.data.authKey);
      if (!res) return reply.code(401).send({ error: 'bad credentials' });
      forgive(`login-name|n:${parsed.data.username.toLowerCase()}`);
      return { userId: res.userId, publicKey: res.publicKey, token: createSession(db, res.userId) };
    },
  );

  app.get('/api/me', { preHandler: requireUser(db) }, async (req) => {
    const row = db
      .prepare('SELECT id, username, pubkey, join_number as joinNumber FROM users WHERE id = ?')
      .get(req.userId) as {
      id: number;
      username: string;
      pubkey: string;
      joinNumber: number | null;
    };
    return {
      userId: row.id,
      username: row.username,
      publicKey: row.pubkey,
      joinNumber: row.joinNumber,
    };
  });

  registerRoomRoutes(app, db);
  registerProfileRoutes(app, db);
  registerSocialRoutes(app, db);
  registerAccountRoutes(app, db);

  // self-host convenience: serve the built web app when it exists
  const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    void app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return { app, db };
}
