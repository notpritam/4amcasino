import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let ctx: ReturnType<typeof createApp>;
beforeEach(() => {
  ctx = createApp(':memory:');
});
afterEach(async () => {
  await ctx.app.close();
});

const reg = (u = 'alice') =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username: u, authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) },
  });

describe('auth', () => {
  it('registers and returns a token', async () => {
    const res = await reg();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: expect.any(Number), token: expect.any(String) });
  });
  it('rejects duplicate usernames', async () => {
    await reg();
    expect((await reg()).statusCode).toBe(409);
  });
  it('logs in with the same authKey and rejects a wrong one', async () => {
    await reg();
    const good = await ctx.app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alice', authKey: 'a'.repeat(64) },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().publicKey).toBe('b'.repeat(64));
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alice', authKey: 'c'.repeat(64) },
    });
    expect(bad.statusCode).toBe(401);
  });
  it('me requires a valid token', async () => {
    const token = (await reg()).json().token as string;
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json()).toMatchObject({ username: 'alice' });
    const nope = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: 'Bearer junk' },
    });
    expect(nope.statusCode).toBe(401);
  });
});
