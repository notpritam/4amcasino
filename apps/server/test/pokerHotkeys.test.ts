import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createUser, createSession } from '../src/auth.js';

const defaults = {
  enabled: true,
  bindings: { fold: 'F', check: 'X', call: 'C', raise: 'R', halfPot: '2', pot: '3', allIn: 'I' },
};
let ctx: ReturnType<typeof createApp>, dir: string, path: string;
let alice: { authorization: string }, bob: { authorization: string }, aliceId: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), '4am-hotkeys-'));
  path = join(dir, 'test.db');
  ctx = createApp(path);
  aliceId = createUser(ctx.db, 'alice', 'a'.repeat(64), 'b'.repeat(64)).userId;
  const bobId = createUser(ctx.db, 'bob', 'a'.repeat(64), 'b'.repeat(64)).userId;
  alice = { authorization: `Bearer ${createSession(ctx.db, aliceId)}` };
  bob = { authorization: `Bearer ${createSession(ctx.db, bobId)}` };
});
afterEach(async () => {
  await ctx.app.close();
  rmSync(dir, { recursive: true, force: true });
});
const get = async (headers = alice) =>
  (await ctx.app.inject({ url: '/api/profile', headers })).json();
const put = (pokerHotkeys: unknown, headers = alice) =>
  ctx.app.inject({ method: 'PUT', url: '/api/profile', headers, payload: { pokerHotkeys } });

describe('account poker shortcuts', () => {
  it('gives existing accounts the default shortcuts', async () => {
    expect((await get()).pokerHotkeys).toEqual(defaults);
  });
  it('disables shortcuts if stored settings are damaged without breaking the profile', async () => {
    for (const raw of ['{invalid', JSON.stringify({ enabled: true })]) {
      ctx.db.prepare('UPDATE users SET poker_hotkeys = ? WHERE id = ?').run(raw, aliceId);
      const profile = await get();
      expect(profile.userId).toBe(aliceId);
      expect(profile.pokerHotkeys).toEqual({ ...defaults, enabled: false });
    }
  });
  it('saves bindings and disabled actions only on the signed-in account and survives restart', async () => {
    const custom = {
      enabled: false,
      bindings: { ...defaults.bindings, fold: 'Shift+Q', call: null },
    };
    expect((await put(custom)).statusCode).toBe(200);
    await ctx.app.close();
    ctx = createApp(path);
    expect((await get()).pokerHotkeys).toEqual(custom);
    expect((await get(bob)).pokerHotkeys).toEqual(defaults);
    await ctx.app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: alice,
      payload: { bio: 'unchanged keys' },
    });
    expect((await get()).pokerHotkeys).toEqual(custom);
    const publicProfile = (
      await ctx.app.inject({ url: `/api/users/${aliceId}/profile`, headers: bob })
    ).json();
    expect(publicProfile.pokerHotkeys).toBeUndefined();
  });
  it.each([
    'A',
    'W',
    'S',
    'D',
    'Shift+W',
    'Enter',
    'Escape',
    'Ctrl+F',
    'Meta+R',
    'F1',
    'q',
    'Shift+Shift+F',
    '💰',
  ])('rejects reserved or malformed key %s', async (key) => {
    expect(
      (await put({ ...defaults, bindings: { ...defaults.bindings, fold: key } })).statusCode,
    ).toBe(400);
  });
  it('rejects duplicate bindings, unknown actions and partial structures atomically', async () => {
    for (const value of [
      { ...defaults, bindings: { ...defaults.bindings, check: 'F' } },
      { ...defaults, bindings: { ...defaults.bindings, deal: 'Z' } },
      { enabled: true, bindings: { fold: 'Q' } },
      null,
      { enabled: 'yes', bindings: defaults.bindings },
    ])
      expect((await put(value)).statusCode).toBe(400);
    expect((await get()).pokerHotkeys).toEqual(defaults);
  });
  it('requires authentication to edit bindings', async () => {
    expect((await put(defaults, {} as typeof alice)).statusCode).toBe(401);
  });
});
