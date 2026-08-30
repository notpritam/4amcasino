import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

async function register(app: ReturnType<typeof createApp>['app'], username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username, authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) },
  });
  return res.json() as { userId: number; token: string };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('Task 1: schema + disabled-user rejection', () => {
  it('users table has disabled and merged_into columns; account_merge_requests round-trips', () => {
    const db = openDb(':memory:');
    const cols = db.pragma('table_info(users)') as { name: string }[];
    expect(cols.some((c) => c.name === 'disabled')).toBe(true);
    expect(cols.some((c) => c.name === 'merged_into')).toBe(true);

    const now = Date.now();
    db.prepare(
      `INSERT INTO account_merge_requests (from_user, into_user, requested_by, created_at) VALUES (1, 2, 1, ?)`,
    ).run(now);
    const row = db.prepare('SELECT * FROM account_merge_requests').get() as {
      id: number;
      from_user: number;
      into_user: number;
      requested_by: number;
      status: string;
      note: string | null;
      created_at: number;
      decided_at: number | null;
      decided_by: number | null;
    };
    expect(row.from_user).toBe(1);
    expect(row.into_user).toBe(2);
    expect(row.requested_by).toBe(1);
    expect(row.status).toBe('pending');
    expect(row.note).toBeNull();
    expect(row.decided_at).toBeNull();
    expect(row.decided_by).toBeNull();
  });

  it("a disabled user's token is rejected with 401 on any authed route", async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');

    // sanity: works before disabling
    const before = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(alice.token),
    });
    expect(before.statusCode).toBe(200);

    ctx.db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(alice.userId);

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(alice.token),
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().error).toBe('account merged');
    await ctx.app.close();
  });

  it('a non-disabled user is unaffected', async () => {
    const ctx = createApp(':memory:');
    const bob = await register(ctx.app, 'bob');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(bob.token),
    });
    expect(res.statusCode).toBe(200);
    await ctx.app.close();
  });
});
