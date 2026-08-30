import type { DB } from './db.js';

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
