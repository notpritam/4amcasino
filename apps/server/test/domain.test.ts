import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { attachHub } from '../src/hub.js';

let ctx: ReturnType<typeof createApp>;
beforeEach(() => {
  vi.stubEnv('ALLOWED_ORIGINS', '');
  ctx = createApp(':memory:');
});
afterEach(async () => {
  await ctx.app.close();
  vi.unstubAllEnvs();
});

describe('canonical casino domain', () => {
  it.each([
    '/',
    '/j/ABC123?view=3d&from=friend',
    '/room/example/replay/hand?name=hello%20world&next=%2Flobby',
    '//example.org/path?next=https%3A%2F%2Fexample.org',
  ])('permanently redirects the old host while preserving %s', async (url) => {
    const res = await ctx.app.inject({ url, headers: { host: 'poker.notpritam.in' } });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe(`https://4amcasino.com${url}`);
  });

  it('redirects HEAD requests', async () => {
    const res = await ctx.app.inject({
      method: 'HEAD',
      url: '/api/health',
      headers: { host: 'poker.notpritam.in' },
    });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe('https://4amcasino.com/api/health');
    expect(res.body).toBe('');
  });

  it('keeps server-wide OPTIONS requests on the fixed destination', async () => {
    const address = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    const res = await new Promise<{ status: number | undefined; location: string | undefined }>(
      (resolve, reject) => {
        const req = request(
          address,
          {
            method: 'OPTIONS',
            path: '*',
            headers: { host: 'poker.notpritam.in' },
          },
          (response) => {
            response.resume();
            resolve({ status: response.statusCode, location: response.headers.location });
          },
        );
        req.on('error', reject);
        req.end();
      },
    );
    expect(res.status).toBe(308);
    expect(res.location).toBe('https://4amcasino.com/');
  });

  it('redirects a POST before executing the old-host request', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/register',
      headers: { host: 'poker.notpritam.in' },
      payload: { username: 'redirect_test', authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) },
    });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe('https://4amcasino.com/api/register');
    expect(
      ctx.db.prepare('SELECT id FROM users WHERE username = ?').get('redirect_test'),
    ).toBeUndefined();
  });

  it('recognizes host capitalization, a trailing dot and an explicit port', async () => {
    const res = await ctx.app.inject({
      url: '/api/health',
      headers: { host: 'POKER.NOTPRITAM.IN.:443' },
    });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe('https://4amcasino.com/api/health');
  });

  it.each([
    '4amcasino.com',
    'admin.4amcasino.com',
    'www.4amcasino.com',
    'fouramcasino.onrender.com',
    'localhost:8787',
    'poker.notpritam.in.example.org',
  ])('does not redirect requests to %s', async (host) => {
    const res = await ctx.app.inject({ url: '/api/health', headers: { host } });
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.json().ok).toBe(true);
  });

  it('does not let a forwarded host trigger a redirect on the new domain', async () => {
    const res = await ctx.app.inject({
      url: '/api/health',
      headers: { host: '4amcasino.com', 'x-forwarded-host': 'poker.notpritam.in' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
  });

  it('does not let a forwarded host bypass the old-domain redirect', async () => {
    const res = await ctx.app.inject({
      url: '/api/health',
      headers: { host: 'poker.notpritam.in', 'x-forwarded-host': '4amcasino.com' },
    });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe('https://4amcasino.com/api/health');
  });

  it.each(['https://4amcasino.com', 'https://www.4amcasino.com', 'https://admin.4amcasino.com'])(
    'allows API requests from %s without environment overrides',
    async (origin) => {
      const res = await ctx.app.inject({
        method: 'OPTIONS',
        url: '/api/login',
        headers: { origin, 'access-control-request-method': 'POST' },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    },
  );

  it('keeps unrelated API origins disallowed', async () => {
    const res = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/login',
      headers: {
        origin: 'https://4amcasino.com.example.org',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([
    ['https://4amcasino.com', 401],
    ['https://www.4amcasino.com', 401],
    ['https://admin.4amcasino.com', 401],
    ['https://4amcasino.com.example.org', 403],
  ])('checks the game origin %s before requiring authentication', async (origin, expected) => {
    attachHub(ctx.app, ctx.db);
    const address = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        `${address}/ws`,
        {
          headers: {
            host: '4amcasino.com',
            origin,
            connection: 'Upgrade',
            upgrade: 'websocket',
            'sec-websocket-version': '13',
            'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(expected);
  });
});
