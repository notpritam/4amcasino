import { openDb } from '../src/db.js';
import { ensurePlatformAccount } from '../src/platform.js';
import { derivePlatformCredentials } from './platform-crypto.js';

// Usage: npx tsx apps/server/scripts/seed-platform.ts [dbPath]
// Env: PLATFORM_USERNAME (default 4amcasino), PLATFORM_PASSWORD (default Fun99312@, LOCAL create only)
const dbPath = process.argv[2] ?? process.env.DB_PATH ?? '4amcasino.db';
const username = process.env.PLATFORM_USERNAME ?? '4amcasino';
const password = process.env.PLATFORM_PASSWORD ?? 'Fun99312@';

const db = openDb(dbPath);
const res = ensurePlatformAccount(db, {
  username,
  createCreds: () => derivePlatformCredentials(username, password),
});
console.log(
  res.adopted
    ? `adopted existing '${username}' as platform (id ${res.userId})`
    : res.created
      ? `created platform account '${username}' (id ${res.userId})`
      : `platform already configured (id ${res.userId})`,
);
