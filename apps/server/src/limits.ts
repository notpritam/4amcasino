import type { FastifyReply, FastifyRequest } from 'fastify';

/** Rate limits and hard caps, in one place so every route can be audited against
 *  the same table (requested by notpritam, docs/FEATURES.md).
 *
 *  Deliberately in-process: this app runs as a single Render instance with a
 *  single SQLite file, so a shared store would buy nothing. If it ever scales
 *  horizontally, swap `buckets` for Redis and nothing else changes. */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Off under vitest: the suite drives hundreds of requests from one address in
 *  seconds, and every bucket here is process-wide, so tests would throttle each
 *  other rather than the thing under test. */
const DISABLED = !!process.env.VITEST || process.env.RATE_LIMITS === 'off';

/** Drops every bucket. For tests and for a deliberate operational reset. */
export function resetLimits(): void {
  buckets.clear();
}

// the limiter's own memory is an attack surface: an attacker who can mint
// unlimited distinct keys would grow this map forever, so sweep dead buckets
const SWEEP_MS = 60_000;
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_MS) return;
  lastSweep = now;
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
  // pathological growth backstop - drop everything rather than run out of heap
  if (buckets.size > 50_000) buckets.clear();
}

/** Counts one hit against `key`. Returns false once the window's budget is spent. */
export function hit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSecs: number; remaining: number } {
  if (DISABLED) return { ok: true, retryAfterSecs: 0, remaining: limit };
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSecs: 0, remaining: limit - 1 };
  }
  b.count++;
  if (b.count > limit) {
    return { ok: false, retryAfterSecs: Math.ceil((b.resetAt - now) / 1000), remaining: 0 };
  }
  return { ok: true, retryAfterSecs: 0, remaining: limit - b.count };
}

/** Clears a key's budget - call after a success so a legitimate user who
 *  fat-fingered a password twice isn't punished for the rest of the window. */
export function forgive(key: string): void {
  buckets.delete(key);
}

type By = 'ip' | 'user' | 'ip+user';

/** A preHandler that throttles a route. Put it AFTER requireUser when `by`
 *  involves the user, so req.userId is populated. */
export function rateLimit(opts: { name: string; limit: number; windowMs: number; by?: By }) {
  const by = opts.by ?? 'ip';
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const who =
      by === 'user'
        ? `u:${req.userId ?? 'anon'}`
        : by === 'ip+user'
          ? `u:${req.userId ?? 'anon'}|ip:${req.ip}`
          : `ip:${req.ip}`;
    const res = hit(`${opts.name}|${who}`, opts.limit, opts.windowMs);
    if (!res.ok) {
      void reply
        .code(429)
        .header('retry-after', String(res.retryAfterSecs))
        .send({ error: `too many requests - try again in ${res.retryAfterSecs}s` });
      return reply;
    }
  };
}

/** Throttles by a value from the body (a username on a credential endpoint), so
 *  spraying one account from many IPs is still capped. Never reveals whether the
 *  value exists. */
export function hitNamed(
  name: string,
  value: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSecs: number } {
  return hit(`${name}|n:${value.toLowerCase()}`, limit, windowMs);
}

/** Hard caps. Anything unbounded is a slow-motion outage, so everything that can
 *  grow gets a ceiling here rather than at each call site. */
export const LIMITS = {
  /** JSON bodies. Avatars are the big one and they arrive as base64 data URLs. */
  bodyBytes: 2 * 1024 * 1024,
  avatarBytes: 1_500_000,
  /** Rooms a single user may own. */
  roomsPerUser: 60,
  /** Buy requests a player may leave pending in one room. */
  pendingBuysPerRoom: 5,
  /** A single buy-in, and a single transfer. */
  maxChipAmount: 10_000_000,
  /** How close together two identical money requests count as the same one.
   *  Long enough to swallow a double-click or a client retry, short enough that
   *  two deliberate identical buys a few seconds apart both land. */
  dedupWindowMs: 2_500,
  /** Friend requests you may send per day. */
  friendRequestsPerDay: 100,
  /** Inbound WebSocket frame size and rate, per connection. */
  wsFrameBytes: 256 * 1024,
  wsMessagesPerSec: 30,
  /** Chat message length and rate. */
  chatChars: 400,
  chatPerTenSec: 12,
} as const;
