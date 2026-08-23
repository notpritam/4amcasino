import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let ctx: ReturnType<typeof createApp>;
beforeEach(() => {
  ctx = createApp(':memory:');
});
afterEach(async () => {
  await ctx.app.close();
});

async function user(name: string) {
  const r = await ctx.app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username: name, authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) },
  });
  return { token: r.json().token as string, userId: r.json().userId as number };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('my-rooms and hand history', () => {
  it('lists only my rooms', async () => {
    const host = await user('host');
    const stranger = await user('stranger');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(host.token),
        payload: { name: 'Mine', sb: 5, bb: 10 },
      })
    ).json();
    const mine = (
      await ctx.app.inject({ method: 'GET', url: '/api/my-rooms', headers: auth(host.token) })
    ).json();
    expect(mine.rooms).toHaveLength(1);
    expect(mine.rooms[0]).toMatchObject({ id: room.id, name: 'Mine', playerCount: 1 });
    const none = (
      await ctx.app.inject({ method: 'GET', url: '/api/my-rooms', headers: auth(stranger.token) })
    ).json();
    expect(none.rooms).toHaveLength(0);
  });

  it('lists and fetches stored hand transcripts for members only', async () => {
    const host = await user('host');
    const stranger = await user('stranger');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(host.token),
        payload: { name: 'x', sb: 1, bb: 2 },
      })
    ).json();
    ctx.db
      .prepare('INSERT INTO transcripts (hand_id, room_id, head, entries, ts) VALUES (?, ?, ?, ?, ?)')
      .run('hand1', room.id, 'deadbeef', JSON.stringify([{ seq: 0, type: 'hand_start' }]), 123);

    const list = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}/hands`, headers: auth(host.token) })
    ).json();
    expect(list.hands).toEqual([{ handId: 'hand1', head: 'deadbeef', ts: 123 }]);

    const detail = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/rooms/${room.id}/hands/hand1`,
        headers: auth(host.token),
      })
    ).json();
    expect(detail.head).toBe('deadbeef');
    expect(detail.entries[0].type).toBe('hand_start');

    const denied = await ctx.app.inject({
      method: 'GET',
      url: `/api/rooms/${room.id}/hands`,
      headers: auth(stranger.token),
    });
    expect(denied.statusCode).toBe(403);
  });
});
