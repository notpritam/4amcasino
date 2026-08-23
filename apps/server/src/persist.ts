import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MongoClient } from 'mongodb';
import type { DB } from './db.js';

// Durability layer: SQLite stays the live database (synchronous, transactional,
// keeps the hash-chained ledger intact); MongoDB holds full snapshots of it so
// the data survives hosts whose local filesystem resets on every deploy.
// Restore happens once at boot when no local file exists; uploads happen every
// SNAPSHOT_EVERY_MS when the content hash changed, plus a final flush on SIGTERM.

const DEFAULT_CHUNK = 8 * 1024 * 1024; // stay well under MongoDB's 16MB document cap
const SNAPSHOT_EVERY_MS = 15_000;

export interface SnapDoc {
  _id: string;
  kind?: string;
  gen?: number;
  i?: number;
  data?: unknown;
  chunks?: number;
  hash?: string;
  size?: number;
  ts?: number;
}

/** The slice of the MongoDB collection API the snapshot store uses (kept narrow for tests). */
export interface SnapCollection {
  findOne(filter: { _id: string }): Promise<SnapDoc | null>;
  find(filter: { kind: string; gen: number }): { toArray(): Promise<SnapDoc[]> };
  insertMany(docs: SnapDoc[]): Promise<unknown>;
  updateOne(
    filter: { _id: string },
    update: { $set: Partial<SnapDoc> },
    opts: { upsert: boolean },
  ): Promise<unknown>;
  deleteMany(filter: { kind: string; gen: { $ne: number } }): Promise<unknown>;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  const bin = data as { buffer?: Uint8Array };
  if (bin && bin.buffer) return Buffer.from(bin.buffer);
  return Buffer.from(data as Uint8Array);
}

let lastGen = 0;

export async function uploadSnapshot(
  col: SnapCollection,
  buf: Buffer,
  chunkSize = DEFAULT_CHUNK,
): Promise<void> {
  const gen = (lastGen = Math.max(Date.now(), lastGen + 1));
  const chunks: SnapDoc[] = [];
  for (let i = 0; i === 0 || i * chunkSize < buf.length; i++) {
    chunks.push({
      _id: `chunk:${gen}:${i}`,
      kind: 'chunk',
      gen,
      i,
      data: buf.subarray(i * chunkSize, (i + 1) * chunkSize),
    });
  }
  await col.insertMany(chunks);
  // the manifest flips atomically to the new generation; older chunks are then swept
  await col.updateOne(
    { _id: 'manifest' },
    { $set: { gen, chunks: chunks.length, hash: sha256(buf), size: buf.length, ts: gen } },
    { upsert: true },
  );
  await col.deleteMany({ kind: 'chunk', gen: { $ne: gen } });
}

export async function downloadSnapshot(col: SnapCollection): Promise<Buffer | null> {
  const m = await col.findOne({ _id: 'manifest' });
  if (!m || m.gen === undefined || m.chunks === undefined) return null;
  const docs = await col.find({ kind: 'chunk', gen: m.gen }).toArray();
  if (docs.length !== m.chunks) return null;
  docs.sort((a, b) => (a.i ?? 0) - (b.i ?? 0));
  const buf = Buffer.concat(docs.map((d) => toBuffer(d.data)));
  if (buf.length !== m.size || sha256(buf) !== m.hash) return null;
  return buf;
}

export class SnapshotPersistence {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastHash: string | null = null;
  private lastTs: number | null = null;
  private inFlight = false;
  private db: DB | null = null;

  private constructor(
    private client: MongoClient,
    private col: SnapCollection,
  ) {}

  /** Connects, and restores the latest snapshot when no local database exists yet. */
  static async connect(mongoUrl: string, dbPath: string): Promise<SnapshotPersistence> {
    const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    const col = client
      .db('fouramcasino')
      .collection<SnapDoc>('sqlite_snapshots') as unknown as SnapCollection;
    if (dbPath !== ':memory:' && !existsSync(dbPath)) {
      const bytes = await downloadSnapshot(col);
      if (bytes && bytes.length > 0) {
        mkdirSync(dirname(dbPath), { recursive: true });
        // a restored main file must not pair with stale WAL journals
        rmSync(`${dbPath}-wal`, { force: true });
        rmSync(`${dbPath}-shm`, { force: true });
        writeFileSync(dbPath, bytes);
        console.log(`restored database from MongoDB snapshot (${bytes.length} bytes)`);
      } else {
        console.log('no MongoDB snapshot yet; starting with a fresh database');
      }
    }
    return new SnapshotPersistence(client, col);
  }

  start(db: DB): void {
    this.db = db;
    this.timer = setInterval(() => void this.snapshot(), SNAPSHOT_EVERY_MS);
    this.timer.unref();
    void this.snapshot();
  }

  lastBackupTs(): number | null {
    return this.lastTs;
  }

  private async snapshot(): Promise<void> {
    if (!this.db || !this.db.open || this.inFlight) return;
    this.inFlight = true;
    try {
      const buf = this.db.serialize();
      const hash = sha256(buf);
      if (hash !== this.lastHash) {
        await uploadSnapshot(this.col, buf);
        this.lastHash = hash;
        this.lastTs = Date.now();
      }
    } catch (err) {
      console.error('MongoDB snapshot failed:', err);
    } finally {
      this.inFlight = false;
    }
  }

  /** Final backup on shutdown; waits out any in-flight upload first. */
  async flush(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    while (this.inFlight) await new Promise((r) => setTimeout(r, 50));
    await this.snapshot();
    await this.client.close().catch(() => {});
  }
}
