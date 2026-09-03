import { createApp } from './app.js';
import { attachHub } from './hub.js';
import { SnapshotPersistence } from './persist.js';
import { ensurePlatformAccount } from './platform.js';
import { derivePlatformCredentials } from './platform-crypto.js';

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.DB_PATH ?? './4amcasino.db';

async function main(): Promise<void> {
  let persist: SnapshotPersistence | null = null;
  if (process.env.MONGO_URL) {
    try {
      persist = await SnapshotPersistence.connect(process.env.MONGO_URL, dbPath);
    } catch (err) {
      console.error('MongoDB unreachable; continuing with local storage only:', err);
    }
  }

  const { app, db } = createApp(dbPath, () => ({
    storage: persist ? 'mongodb' : dbPath.startsWith('/data') ? 'disk' : 'ephemeral',
    lastBackup: persist?.lastBackupTs() ?? null,
  }));

  // Seed (or adopt) the platform/house account on boot so the mandatory 1% rake
  // routes to it instead of falling back to the room banker - a plain deploy is
  // enough, no manual seed script needed. Idempotent: adopts the existing account
  // by username when it already exists (the prod case), creates it otherwise.
  // Requested by notpritam (docs/FEATURES.md).
  const platformUsername = process.env.PLATFORM_USERNAME ?? '4amcasino';
  const seeded = ensurePlatformAccount(db, {
    username: platformUsername,
    createCreds: () =>
      derivePlatformCredentials(platformUsername, process.env.PLATFORM_PASSWORD ?? 'Fun99312@'),
  });
  console.log(
    `platform account ${seeded.adopted ? 'adopted' : seeded.created ? 'created' : 'ready'} (id ${seeded.userId})`,
  );

  attachHub(app, db);
  persist?.start(db);

  await app.listen({ port, host: '0.0.0.0' });
  console.log(`4amcasino server on :${port}`);

  // deploys send SIGTERM: take a final backup, close sockets, flush SQLite, exit
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      void (async () => {
        await persist?.flush().catch(() => {});
        await app.close();
        process.exit(0);
      })();
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
