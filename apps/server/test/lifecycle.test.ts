import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';

describe('lifecycle schema (Task 1)', () => {
  it('adds rooms.deleted / rooms.deleted_at columns', () => {
    const db = openDb(':memory:');
    const cols = db.pragma('table_info(rooms)') as { name: string }[];
    expect(cols.some((c) => c.name === 'deleted')).toBe(true);
    expect(cols.some((c) => c.name === 'deleted_at')).toBe(true);
    db.close();
  });

  it('round-trips a row through room_lifecycle_requests', () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO room_lifecycle_requests (room_id, action, requested_by, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('r1', 'archive', 1, 'pending', 'please', Date.now());
    const row = db
      .prepare('SELECT * FROM room_lifecycle_requests WHERE room_id = ?')
      .get('r1') as
      | {
          id: number;
          room_id: string;
          action: string;
          requested_by: number;
          status: string;
          note: string | null;
          created_at: number;
          decided_at: number | null;
          decided_by: number | null;
        }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.action).toBe('archive');
    expect(row?.requested_by).toBe(1);
    expect(row?.status).toBe('pending');
    expect(row?.note).toBe('please');
    expect(row?.decided_at).toBeNull();
    expect(row?.decided_by).toBeNull();
    db.close();
  });
});
