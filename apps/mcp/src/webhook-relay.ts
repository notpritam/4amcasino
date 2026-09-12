#!/usr/bin/env node
import { createHmac } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function assertContinuousHistory(
  cursor: number,
  batch: { oldestCursor: number | null; resyncRecommended?: boolean },
) {
  if (
    cursor > 0 &&
    (batch.resyncRecommended || (batch.oldestCursor !== null && cursor < batch.oldestCursor))
  ) {
    throw new Error(
      'Event history expired. Cursor retained: fetch current room/tournament state, resynchronize your receiver, and explicitly set its eventCursor in the checkpoint before restarting.',
    );
  }
}
export function webhookHeaders(id: string, timestamp: number, body: string, secret: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  if (key.length < 32)
    throw new Error('FOURAM_WEBHOOK_SECRET requires at least 32 random bytes, base64 encoded.');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': `v1,${signature}`,
  };
}
async function main() {
  const baseUrl = (process.env.FOURAM_URL ?? 'https://4amcasino.com').replace(/\/$/, '');
  const token = process.env.FOURAM_TOKEN,
    kind = process.env.FOURAM_SCOPE_KIND,
    scopeId = process.env.FOURAM_SCOPE_ID;
  const target = process.env.FOURAM_WEBHOOK_URL,
    secret = process.env.FOURAM_WEBHOOK_SECRET;
  if (!token || !scopeId || !['room', 'tournament'].includes(kind ?? '') || !target || !secret)
    throw new Error(
      'Set FOURAM_TOKEN, FOURAM_SCOPE_KIND, FOURAM_SCOPE_ID, FOURAM_WEBHOOK_URL and FOURAM_WEBHOOK_SECRET.',
    );
  const destination = new URL(target);
  if (
    destination.username ||
    destination.password ||
    (destination.protocol !== 'https:' &&
      !(
        ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname) &&
        destination.protocol === 'http:'
      ))
  )
    throw new Error('Use an HTTPS receiver (HTTP permitted only on localhost).');
  webhookHeaders('validation', 0, '', secret);
  const checkpoint = process.env.FOURAM_CURSOR_FILE ?? '.4am-webhook-cursor.json';
  const scope = `${baseUrl}/${kind}/${scopeId}`;
  let cursor = 0;
  try {
    const saved = JSON.parse(await readFile(checkpoint, 'utf8'));
    if (saved.scope !== scope)
      throw new Error(
        'Cursor file belongs to a different scope. Choose another FOURAM_CURSOR_FILE.',
      );
    cursor = saved.cursor;
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid cursor file.');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      stopping = true;
    });
  while (!stopping) {
    const params = new URLSearchParams({
      scopeKind: kind!,
      scopeId,
      after: String(cursor),
      wait: '25',
    });
    const response = await fetch(`${baseUrl}/api/agent/events?${params}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Subscription failed (${response.status}); cursor retained.`);
    const batch = (await response.json()) as {
      events: { id: number }[];
      oldestCursor: number | null;
      resyncRecommended: boolean;
    };
    assertContinuousHistory(cursor, batch);
    for (const event of batch.events) {
      const body = JSON.stringify(event);
      let delivered = false;
      for (let attempt = 0; attempt < 8 && !stopping; attempt++) {
        const headers = webhookHeaders(
          `4am_${event.id}`,
          Math.floor(Date.now() / 1000),
          body,
          secret,
        );
        try {
          const result = await fetch(target, {
            method: 'POST',
            headers,
            body,
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
          });
          delivered = result.ok;
          await result.body?.cancel();
        } catch {
          /* retry with the original event ID */
        }
        if (delivered) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 500 * 2 ** attempt)));
      }
      if (!delivered) {
        if (stopping) return;
        throw new Error(
          `Delivery failed for event ${event.id}. Cursor retained; restart to retry.`,
        );
      }
      cursor = event.id;
      await writeFile(`${checkpoint}.tmp`, JSON.stringify({ scope, cursor }), { mode: 0o600 });
      await rename(`${checkpoint}.tmp`, checkpoint);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((err) => {
    console.error(err instanceof Error ? err.message : 'Webhook relay failed.');
    process.exitCode = 1;
  });
