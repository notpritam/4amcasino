import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { openDb, type DB } from './db.js';
import { checkLogin, createSession, createUser, requireUser } from './auth.js';

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

  app.get('/api/health', async () => ({ ok: true }));

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

  return { app, db };
}
