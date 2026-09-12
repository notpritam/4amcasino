import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createSession, createUser } from '../src/auth.js';
import { publishAgentEvent, publishRoomEvent } from '../src/agentEvents.js';
import { resolveAgentGrant, agentMaySend } from '../src/agentAccess.js';
import { attachHub } from '../src/hub.js';
import WebSocket from 'ws';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
let ctx: ReturnType<typeof createApp>;
let token: string;
let uid: number;
let room: string;
beforeEach(async () => {
  ctx = createApp(':memory:');
  attachHub(ctx.app, ctx.db);
  uid = createUser(ctx.db, 'agent_owner', 'a'.repeat(64), 'b'.repeat(64)).userId;
  token = createSession(ctx.db, uid);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/rooms',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Agent room', sb: 10, bb: 20 },
  });
  room = res.json().id;
});
afterEach(async () => ctx.app.close());
async function grant(canPlay = true) {
  return (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/me/agent-grants',
      headers: { authorization: `Bearer ${token}` },
      payload: { scopeKind: 'room', scopeId: room, label: 'Local agent', canPlay },
    })
  ).json();
}
it('stores only a token hash and denies account/bank access', async () => {
  const g = await grant();
  const row = ctx.db.prepare('SELECT * FROM agent_grants').get();
  expect(JSON.stringify(row)).not.toContain(g.token);
  expect(resolveAgentGrant(ctx.db, g.token)?.scope_id).toBe(room);
  const res = await ctx.app.inject({
    url: '/api/me',
    headers: { authorization: `Bearer ${g.token}` },
  });
  expect(res.statusCode).toBe(401);
  expect(agentMaySend(resolveAgentGrant(ctx.db, g.token)!, { t: 'action' })).toBe(true);
  expect(agentMaySend(resolveAgentGrant(ctx.db, g.token)!, { t: 'kick' })).toBe(false);
  const read = await grant(false);
  expect(agentMaySend(resolveAgentGrant(ctx.db, read.token)!, { t: 'action' })).toBe(false);
});
it('denies read-only gameplay sockets and disconnects a revoked playing grant', async () => {
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const url = `ws://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}/ws`;
  const read = await grant(false);
  const denied = new WebSocket(url, ['bearer', read.token]);
  const failure = await new Promise<Error>((resolve) => denied.once('error', resolve));
  expect(failure.message).toContain('403');
  const play = await grant(true);
  const socket = new WebSocket(url, ['bearer', play.token]);
  await once(socket, 'open');
  const closed = once(socket, 'close');
  await ctx.app.inject({
    method: 'DELETE',
    url: `/api/me/agent-grants/${play.id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect((await closed)[0]).toBe(1008);
});
it('does not present a persisted room event as a live hand after restart', async () => {
  publishAgentEvent(ctx.db, 'room', room, 'room.room_state', { handActive: true });
  publishAgentEvent(ctx.db, 'room', room, 'room.betting_state', { handId: 'old-hand', toAct: 1 });
  const g = await grant(false);
  const res = await ctx.app.inject({
    url: `/api/agent/rooms/${room}`,
    headers: { authorization: `Bearer ${g.token}` },
  });
  expect(res.json().handActive).toBe(false);
  expect(res.json().betting).toBeNull();
});
it('revokes access immediately, including membership and expiry', async () => {
  const g = await grant();
  await ctx.app.inject({
    method: 'DELETE',
    url: `/api/me/agent-grants/${g.id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(resolveAgentGrant(ctx.db, g.token)).toBeNull();
  const expired = await grant();
  ctx.db.prepare('UPDATE agent_grants SET expires_at = 0 WHERE id = ?').run(expired.id);
  expect(resolveAgentGrant(ctx.db, expired.token)).toBeNull();
  const member = await grant();
  ctx.db.prepare('DELETE FROM room_players WHERE room_id = ? AND user_id = ?').run(room, uid);
  expect(resolveAgentGrant(ctx.db, member.token)).toBeNull();
});
it('replays public events with cursors and never includes private protocol messages', async () => {
  const g = await grant(false);
  publishRoomEvent(ctx.db, room, {
    t: 'your_card',
    handId: 'private',
    deckIndex: 0,
    point: 'private-secret',
  });
  publishRoomEvent(ctx.db, room, { t: 'need_keys', handId: 'private' });
  publishRoomEvent(ctx.db, room, { t: 'auto_deal', inMs: 1000 });
  const url = `/api/agent/events?scopeKind=room&scopeId=${room}`;
  const first = await ctx.app.inject({ url, headers: { authorization: `Bearer ${g.token}` } });
  expect(first.statusCode).toBe(200);
  expect(first.json().events).toHaveLength(1);
  expect(first.body).not.toContain('private');
  const next = await ctx.app.inject({
    url: `${url}&after=${first.json().nextCursor}`,
    headers: { authorization: `Bearer ${g.token}` },
  });
  expect(next.json().events).toEqual([]);
  const wrong = await ctx.app.inject({
    url: url.replace(room, 'different-room'),
    headers: { authorization: `Bearer ${g.token}` },
  });
  expect(wrong.statusCode).toBe(403);
});
