import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { openDb, type DB } from './db.js';
import { checkLogin, createSession, createUser, requireUser } from './auth.js';
import { registerRoomRoutes } from './rooms.js';
import { registerProfileRoutes } from './profile.js';

const registerSchema = z.object({
  username: z.string().min(2).max(24).regex(/^[a-zA-Z0-9_]+$/),
  authKey: z.string().length(64).regex(/^[0-9a-f]+$/),
  publicKey: z.string().length(64).regex(/^[0-9a-f]+$/),
});
const loginSchema = registerSchema.omit({ publicKey: true });

export function createApp(dbPath: string): { app: FastifyInstance; db: DB } {
  const db = openDb(dbPath);
  const app = Fastify();
  void app.register(cors, { origin: true });

  app.addHook('onClose', async () => {
    db.close();
  });

  // storage: 'disk' when the DB lives on a mounted volume that survives deploys
  app.get('/api/health', async () => ({
    ok: true,
    storage: dbPath.startsWith('/data') ? 'disk' : 'ephemeral',
  }));

  app.post('/api/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { username, authKey, publicKey } = parsed.data;
    try {
      const { userId } = createUser(db, username, authKey, publicKey);
      return { userId, token: createSession(db, userId) };
    } catch (e) {
      if (e instanceof Error && e.message.includes('UNIQUE')) {
        return reply.code(409).send({ error: 'username taken' });
      }
      throw e;
    }
  });

  app.post('/api/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const res = checkLogin(db, parsed.data.username, parsed.data.authKey);
    if (!res) return reply.code(401).send({ error: 'bad credentials' });
    return { userId: res.userId, publicKey: res.publicKey, token: createSession(db, res.userId) };
  });

  app.get('/api/me', { preHandler: requireUser(db) }, async (req) => {
    const row = db.prepare('SELECT id, username, pubkey FROM users WHERE id = ?').get(req.userId) as {
      id: number;
      username: string;
      pubkey: string;
    };
    return { userId: row.id, username: row.username, publicKey: row.pubkey };
  });

  registerRoomRoutes(app, db);
  registerProfileRoutes(app, db);

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
