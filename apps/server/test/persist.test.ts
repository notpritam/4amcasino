import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { downloadSnapshot, uploadSnapshot, type SnapCollection, type SnapDoc } from '../src/persist.js';

/** In-memory stand-in for the few MongoDB collection calls the snapshot store makes. */
class FakeCol implements SnapCollection {
  docs = new Map<string, SnapDoc>();

  async findOne(filter: { _id: string }): Promise<SnapDoc | null> {
    return this.docs.get(filter._id) ?? null;
  }

  find(filter: { kind: string; gen: number }) {
    const rows = [...this.docs.values()].filter(
      (d) => d.kind === filter.kind && d.gen === filter.gen,
    );
    return { toArray: async () => rows };
  }

  async insertMany(docs: SnapDoc[]): Promise<unknown> {
    for (const d of docs) {
      if (this.docs.has(d._id)) throw new Error(`duplicate _id ${d._id}`);
      this.docs.set(d._id, d);
    }
    return null;
  }

  async updateOne(
    filter: { _id: string },
    update: { $set: Partial<SnapDoc> },
  ): Promise<unknown> {
    const doc = this.docs.get(filter._id) ?? { _id: filter._id };
    Object.assign(doc, update.$set);
    this.docs.set(filter._id, doc);
    return null;
  }

  async deleteMany(filter: { kind: string; gen: { $ne: number } }): Promise<unknown> {
    for (const [id, d] of this.docs) {
      if (d.kind === filter.kind && d.gen !== filter.gen.$ne) this.docs.delete(id);
    }
    return null;
  }
}

describe('snapshot persistence', () => {
  it('round-trips a small buffer', async () => {
    const col = new FakeCol();
    const buf = Buffer.from('hello ledger');
    await uploadSnapshot(col, buf);
    expect(await downloadSnapshot(col)).toEqual(buf);
  });

  it('round-trips a buffer split across many chunks', async () => {
    const col = new FakeCol();
    const buf = randomBytes(10_000);
    await uploadSnapshot(col, buf, 1024);
    const chunkCount = [...col.docs.values()].filter((d) => d.kind === 'chunk').length;
    expect(chunkCount).toBe(10);
    expect((await downloadSnapshot(col))?.equals(buf)).toBe(true);
  });

  it('replaces the previous generation instead of accumulating chunks', async () => {
    const col = new FakeCol();
    await uploadSnapshot(col, randomBytes(5000), 1024);
    const second = randomBytes(3000);
    await uploadSnapshot(col, second, 1024);
    const chunkCount = [...col.docs.values()].filter((d) => d.kind === 'chunk').length;
    expect(chunkCount).toBe(3);
    expect((await downloadSnapshot(col))?.equals(second)).toBe(true);
  });

  it('rejects a snapshot whose bytes do not match the manifest hash', async () => {
    const col = new FakeCol();
    await uploadSnapshot(col, randomBytes(2000), 1024);
    const chunk = [...col.docs.values()].find((d) => d.kind === 'chunk')!;
    chunk.data = randomBytes((chunk.data as Buffer).length);
    expect(await downloadSnapshot(col)).toBeNull();
  });

  it('returns null when no snapshot exists yet', async () => {
    expect(await downloadSnapshot(new FakeCol())).toBeNull();
  });
});
