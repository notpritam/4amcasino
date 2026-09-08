import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { appendLedger, verifyLedger } from '../src/ledger.js';

describe('room commission rates', () => {
  it('creates rooms at 0.1% and keeps the platform rate outside host settings', async () => {
    const ctx = createApp(':memory:');
    try {
      const user = (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/register',
          payload: { username: 'ratehost', authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) },
        })
      ).json();
      const headers = { authorization: `Bearer ${user.token}` };
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers,
        payload: { name: 'New table', sb: 10, bb: 20, commissionBps: 0 },
      });
      expect(created.statusCode).toBe(200);
      const room = created.json();
      expect(room.commissionBps).toBe(10);
      await ctx.app.inject({
        method: 'PUT',
        url: `/api/rooms/${room.id}/settings`,
        headers,
        payload: { commissionBps: 0 },
      });
      const reloaded = await ctx.app.inject({
        method: 'GET',
        url: `/api/rooms/${room.id}`,
        headers,
      });
      expect(reloaded.json().commissionBps).toBe(10);
      expect(ctx.db.prepare('SELECT commission_bps FROM rooms WHERE id = ?').get(room.id)).toEqual({
        commission_bps: 10,
      });
    } finally {
      await ctx.app.close();
    }
  });

  it('preserves existing rooms at 1%, leaves their ledger intact, and survives a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), '4am-commission-'));
    const path = join(dir, 'test.db');
    let db = openDb(path);
    const seed = (id: string) =>
      db
        .prepare(
          `
      INSERT INTO rooms (id, name, join_code, host_id, banker_id, sb, bb, created_at)
      VALUES (?, 'Table', ?, 1, 1, 10, 20, 1)
    `,
        )
        .run(id, id);
    try {
      // Simulate the schema and accounting records from before room-specific rates.
      if (
        (db.pragma('table_info(rooms)') as { name: string }[]).some(
          (c) => c.name === 'commission_bps',
        )
      ) {
        db.exec('ALTER TABLE rooms DROP COLUMN commission_bps');
      }
      seed('legacy');
      appendLedger(db, {
        roomId: 'legacy',
        userId: 1,
        delta: 20,
        kind: 'commission',
        ref: 'old-hand',
        note: '1% table commission',
      });
      const ledger = db.prepare('SELECT * FROM ledger').all();
      db.close();

      db = openDb(path);
      expect(db.prepare('SELECT commission_bps FROM rooms WHERE id = ?').get('legacy')).toEqual({
        commission_bps: 100,
      });
      seed('new');
      expect(db.prepare('SELECT commission_bps FROM rooms WHERE id = ?').get('new')).toEqual({
        commission_bps: 10,
      });
      expect(db.prepare('SELECT * FROM ledger').all()).toEqual(ledger);
      expect(verifyLedger(db, 'legacy').ok).toBe(true);
      db.close();

      db = openDb(path);
      expect(db.prepare('SELECT id, commission_bps FROM rooms ORDER BY id').all()).toEqual([
        { id: 'legacy', commission_bps: 100 },
        { id: 'new', commission_bps: 10 },
      ]);
      expect(db.prepare('SELECT * FROM ledger').all()).toEqual(ledger);
    } finally {
      if (db.open) db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
