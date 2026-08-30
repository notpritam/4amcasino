import { openDb } from '../src/db.js';
import { platformUserId } from '../src/platform.js';
import { backupDatabaseConsistent, rewriteRakeToPlatform } from '../src/rake.js';

// Usage: npx tsx apps/server/scripts/rewrite-rake-to-platform.ts [dbPath]
// Re-attributes historical, banker-keyed rake ('commission' ledger rows) to
// the platform account, moving the corresponding chips. Backs up the db
// file first and refuses to run if the backup fails. Never deletes or
// overwrites the original db.
const dbPath = process.argv[2] ?? process.env.DB_PATH ?? '4amcasino.db';

const backupPath = `${dbPath}.bak-${Date.now()}`;
try {
  // The live server opens this db in WAL mode, so a raw file copy could miss
  // committed rows still sitting in the -wal file; backupDatabaseConsistent
  // checkpoints first so the backup is a complete, consistent snapshot.
  backupDatabaseConsistent(dbPath, backupPath);
} catch (err) {
  console.error(`failed to back up '${dbPath}' to '${backupPath}': ${(err as Error).message}`);
  process.exit(1);
}
console.log(`backed up '${dbPath}' to '${backupPath}'`);

const db = openDb(dbPath);

const platformId = platformUserId(db);
if (platformId === null) {
  console.error('platform account is not configured (run seed-platform.ts first) - aborting');
  process.exit(1);
}

const report = rewriteRakeToPlatform(db, platformId);

console.log(`rewrote ${report.roomsRewritten.length} room(s): ${report.roomsRewritten.join(', ') || '(none)'}`);
if (report.roomsSkippedBankerSpent.length > 0) {
  console.log(`skipped ${report.roomsSkippedBankerSpent.length} room(s) - banker stack below reclaim, review manually:`);
  for (const s of report.roomsSkippedBankerSpent) {
    console.log(
      `  room ${s.roomId}: banker ${s.bankerId} owes ${s.reclaim} but only has ${s.bankerStack} left`,
    );
  }
}
