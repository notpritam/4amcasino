import type { DB } from './db.js';
import { createUser } from './auth.js';

const KEY = 'platform_user_id';

/** The Platform (house/admin) account id, or null if not configured yet. */
export function platformUserId(db: DB): number | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(KEY) as
    | { value: string }
    | undefined;
  if (!row) return null;
  const n = Number(row.value);
  return Number.isInteger(n) ? n : null;
}

/** Upsert the Platform account id into the meta table. */
export function setPlatformUserId(db: DB, id: number): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(KEY, String(id));
}

/** True iff userId is the configured Platform account. */
export function isPlatform(db: DB, userId: number): boolean {
  return platformUserId(db) === userId;
}

/** Idempotent: use the configured platform id if set; else adopt an existing
 *  same-named user (the prod case); else create one (the local case). */
export function ensurePlatformAccount(
  db: DB,
  opts: { username: string; createCreds: () => { authKey: string; publicKey: string } },
): { userId: number; created: boolean; adopted: boolean } {
  const existing = platformUserId(db);
  if (existing !== null) return { userId: existing, created: false, adopted: false };

  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(opts.username) as
    | { id: number }
    | undefined;
  if (row) {
    setPlatformUserId(db, row.id);
    return { userId: row.id, created: false, adopted: true };
  }

  const { authKey, publicKey } = opts.createCreds();
  const { userId } = createUser(db, opts.username, authKey, publicKey);
  setPlatformUserId(db, userId);
  return { userId, created: true, adopted: false };
}
