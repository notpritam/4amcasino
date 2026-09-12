import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';

it('retries signed webhook delivery and checkpoints only after receiver acknowledgement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arena-relay-'));
  const checkpoint = join(directory, 'cursor.json');
  const key = Buffer.alloc(32, 8);
  const received: { id: string; body: string; timestamp: string; signature: string }[] = [];
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith('/api/agent/events')) {
      const after = new URL(req.url, 'http://localhost').searchParams.get('after');
      if (after === '7') await new Promise((resolve) => setTimeout(resolve, 100));
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          events:
            after === '0'
              ? [
                  {
                    version: 1,
                    id: 7,
                    type: 'tournament.action',
                    scopeKind: 'tournament',
                    scopeId: 'test',
                    data: { action: { type: 'fold' } },
                  },
                ]
              : [],
          oldestCursor: 7,
          nextCursor: 7,
          resyncRecommended: false,
        }),
      );
    } else {
      let body = '';
      for await (const chunk of req) body += chunk;
      received.push({
        id: String(req.headers['webhook-id']),
        timestamp: String(req.headers['webhook-timestamp']),
        signature: String(req.headers['webhook-signature']),
        body,
      });
      res.writeHead(received.length === 1 ? 503 : 204).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/mcp/src/webhook-relay.ts'], {
    env: {
      ...process.env,
      FOURAM_URL: origin,
      FOURAM_TOKEN: 'synthetic-fixture-token',
      FOURAM_SCOPE_KIND: 'tournament',
      FOURAM_SCOPE_ID: 'test',
      FOURAM_WEBHOOK_URL: origin + '/receiver',
      FOURAM_WEBHOOK_SECRET: key.toString('base64'),
      FOURAM_CURSOR_FILE: checkpoint,
    },
    stdio: 'ignore',
  });
  try {
    let saved: any;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        saved = JSON.parse(await readFile(checkpoint, 'utf8'));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    expect(saved).toEqual({ scope: `${origin}/tournament/test`, cursor: 7 });
    expect(received).toHaveLength(2);
    expect(received[0]!.body).toBe(received[1]!.body);
    for (const event of received) {
      expect(event.id).toBe('4am_7');
      expect(event.signature).toBe(
        `v1,${createHmac('sha256', key).update(`${event.id}.${event.timestamp}.${event.body}`).digest('base64')}`,
      );
    }
  } finally {
    child.kill('SIGKILL');
    await once(child, 'close');
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
