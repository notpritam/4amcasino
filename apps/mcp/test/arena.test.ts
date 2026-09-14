import { expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApp } from '../../server/src/app.js';
import { createSession, createUser } from '../../server/src/auth.js';
import { setPlatformUserId } from '../../server/src/platform.js';
import { registerArenaTools } from '../src/arenaTools.js';
import { runBenchmark, baselineAgents } from '../src/benchmark.js';
import { assertContinuousHistory, webhookHeaders } from '../src/webhook-relay.js';
it('requires an explicit resync when retained webhook history is lost', () => {
  expect(() => assertContinuousHistory(12, { oldestCursor: 50, resyncRecommended: true })).toThrow(
    /resynchroniz/i,
  );
  expect(() =>
    assertContinuousHistory(0, { oldestCursor: 50, resyncRecommended: false }),
  ).not.toThrow();
  expect(() =>
    assertContinuousHistory(50, { oldestCursor: 50, resyncRecommended: false }),
  ).not.toThrow();
});
it('reproduces benchmark results and preserves chips across 100 hands', async () => {
  const a = await runBenchmark(baselineAgents, 100, 'test-reproducibility');
  const b = await runBenchmark(baselineAgents, 100, 'test-reproducibility');
  expect(a).toEqual(b);
  expect(a.history).toHaveLength(100);
  expect(a.history.every((h) => h.net.reduce((sum, n) => sum + n, 0) === 0)).toBe(true);
});
it('signs the exact webhook body, event ID and timestamp', () => {
  const key = Buffer.alloc(32, 7);
  const body = '{"event":"hand"}';
  const headers = webhookHeaders('id-1', 123, body, `whsec_${key.toString('base64')}`);
  expect(headers['webhook-signature']).toBe(
    `v1,${createHmac('sha256', key).update(`id-1.123.${body}`).digest('base64')}`,
  );
  expect(webhookHeaders('id-2', 123, body, key.toString('base64'))['webhook-signature']).not.toBe(
    headers['webhook-signature'],
  );
});
it('exposes a real MCP tournament flow and reports rejected tool calls as errors', async () => {
  const { app, db } = createApp(':memory:');
  const uid = createUser(db, 'mcp_entrant', 'a'.repeat(64), 'b'.repeat(64)).userId;
  const token = createSession(db, uid);
  const headers = { authorization: `Bearer ${token}` };
  const tournament = (
    await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      headers,
      payload: { name: 'MCP protocol test', handLimit: 10 },
    })
  ).json();
  const platformId = createUser(db, 'mcp_platform', 'c'.repeat(64), 'd'.repeat(64)).userId;
  setPlatformUserId(db, platformId);
  await app.inject({
    method: 'POST',
    url: `/api/admin/tournaments/${tournament.id}/review`,
    headers: { authorization: `Bearer ${createSession(db, platformId)}` },
    payload: { approve: true, revision: 1, note: 'Approved' },
  });
  const server = new McpServer({ name: 'test-arena', version: '1.0.0' });
  registerArenaTools(server, async (path, body) => {
    const r = await app.inject({
      url: path,
      method: body === undefined ? 'GET' : 'POST',
      headers,
      payload: body as any,
    });
    if (r.statusCode >= 400) throw new Error(r.json().error);
    return r.json();
  });
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    expect((await client.listTools()).tools.some((t) => t.name === 'subscribe_events')).toBe(true);
    const enrolled = await client.callTool({
      name: 'enroll_tournament',
      arguments: { tournamentId: tournament.id, agentName: 'MCP Entry', acceptedRevision: 1 },
    });
    expect(enrolled.isError).not.toBe(true);
    const state = await client.callTool({
      name: 'tournament_state',
      arguments: { tournamentId: tournament.id },
    });
    expect(JSON.stringify(state)).toContain('MCP Entry');
    const bad = await client.callTool({
      name: 'tournament_act',
      arguments: {
        tournamentId: tournament.id,
        handNumber: 1,
        actionSeq: 0,
        requestId: 'not-started',
        action: 'fold',
      },
    });
    expect(bad.isError).toBe(true);
    expect((await client.readResource({ uri: 'casino://agent-guide' })).contents).toHaveLength(1);
  } finally {
    await client.close();
    await server.close();
    await app.close();
  }
});
