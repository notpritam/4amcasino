import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/src/app.js';
import { attachHub } from '../../server/src/hub.js';
import { HeadlessClient } from '../src/client.js';

let ctx: ReturnType<typeof createApp>;
let baseUrl: string;
let clients: HeadlessClient[] = [];

beforeEach(async () => {
  ctx = createApp(':memory:');
  attachHub(ctx.app, ctx.db, { cryptoTimeoutMs: 2000, actionTimeoutMs: 5000 });
  await ctx.app.listen({ port: 0 });
  const addr = ctx.app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  clients = [];
});

afterEach(async () => {
  for (const c of clients) c.close();
  await ctx.app.close();
});

describe('headless MCP client', () => {
  it('registers, buys in, and plays a full hand to showdown through the real crypto', async () => {
    const host = new HeadlessClient(baseUrl, 'agent_host', 'pw-agent-host');
    const bob = new HeadlessClient(baseUrl, 'agent_bob', 'pw-agent-bob');
    clients.push(host, bob);
    await host.login();
    await bob.login();

    const room = await host.api('/api/rooms', { name: 'Bot Table', sb: 10, bb: 20 });
    await host.connect(room.id as string);
    await bob.joinByCode(room.joinCode as string);

    host.send({ t: 'sit', seat: 0 });
    bob.send({ t: 'sit', seat: 1 });
    for (const c of [host, bob]) {
      const req = await c.api(`/api/rooms/${room.id}/buy`, { amount: 1000 });
      await host.api(`/api/rooms/${room.id}/approve`, { requestId: req.id, approve: true });
    }
    await new Promise((r) => setTimeout(r, 200));
    host.send({ t: 'start_hand' });

    // passive play: check when free, call otherwise, until the hand resolves
    const start = Date.now();
    while (Date.now() - start < 30_000) {
      if (host.result && bob.result) break;
      for (const c of [host, bob]) {
        await c.waitForTurn(300);
        if (c.myTurn()) {
          try {
            c.act({ type: 'check' });
          } catch {
            try {
              c.act({ type: 'call' });
            } catch {
              /* state advanced under us; loop again */
            }
          }
        }
      }
    }


    expect(host.abort).toBeNull();
    expect(bob.abort).toBeNull();
    expect(host.result).not.toBeNull();
    expect(host.myCards).toHaveLength(2);
    expect(bob.myCards).toHaveLength(2);
    expect(host.board).toHaveLength(5);
    expect(host.board).toEqual(bob.board);
    const stacks = host.result!.stacks.reduce((s, x) => s + x.stack, 0);
    expect(stacks).toBe(2000);
    // the state summary reads like something an agent can act on
    const summary = host.stateSummary();
    expect(summary).toContain('Bot Table');
    expect(summary).toContain('You held:');
  }, 45_000);

  it('act() refuses out-of-turn and illegal moves with readable errors', async () => {
    const solo = new HeadlessClient(baseUrl, 'agent_solo', 'pw-agent-solo');
    clients.push(solo);
    await solo.login();
    const room = await solo.api('/api/rooms', { name: 'Solo', sb: 10, bb: 20 });
    await solo.connect(room.id as string);
    expect(() => solo.act({ type: 'fold' })).toThrow('no hand in progress');
  });
});
