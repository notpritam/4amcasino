import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { verifyLedger } from '../src/ledger.js';

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
const post = (url: string, token: string, payload?: object) =>
  ctx.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as never });
const get = async (url: string, token: string) =>
  (await ctx.app.inject({ method: 'GET', url, headers: auth(token) })).json();

async function makeRoom(hostToken: string) {
  return (
    await post('/api/rooms', hostToken, { name: 'Social', sb: 10, bb: 20 })
  ).json();
}

describe('friends', () => {
  it('request, accept, presence, and mutual listing', async () => {
    const a = await user('ann');
    const b = await user('ben');
    expect((await post('/api/friends/request', a.token, { username: 'ben' })).statusCode).toBe(200);
    // ben sees the incoming request and accepts
    let benView = await get('/api/friends', b.token);
    expect(benView.incoming).toHaveLength(1);
    await post('/api/friends/respond', b.token, { userId: a.userId, accept: true });
    benView = await get('/api/friends', b.token);
    expect(benView.friends).toHaveLength(1);
    expect(benView.friends[0].username).toBe('ann');
    // both hit the API just now, so both read as online
    const annView = await get('/api/friends', a.token);
    expect(annView.friends[0].online).toBe(true);
    // duplicate requests are rejected
    expect((await post('/api/friends/request', a.token, { username: 'ben' })).statusCode).toBe(400);
  });

  it('a reverse request counts as acceptance', async () => {
    const a = await user('cara');
    const b = await user('dev');
    await post('/api/friends/request', a.token, { username: 'dev' });
    const r = (await post('/api/friends/request', b.token, { username: 'cara' })).json();
    expect(r.accepted).toBe(true);
    expect((await get('/api/friends', a.token)).friends).toHaveLength(1);
  });
});

describe('table invites', () => {
  it('invite an online friend; they accept and land in the room', async () => {
    const host = await user('host1');
    const pal = await user('pal1');
    await post('/api/friends/request', host.token, { username: 'pal1' });
    await post('/api/friends/respond', pal.token, { userId: host.userId, accept: true });
    const room = await makeRoom(host.token);
    expect((await post(`/api/rooms/${room.id}/invite`, host.token, { userId: pal.userId })).statusCode).toBe(200);
    const invites = await get('/api/invites', pal.token);
    expect(invites.invites).toHaveLength(1);
    const resp = (await post(`/api/invites/${invites.invites[0].id}/respond`, pal.token, { accept: true })).json();
    expect(resp.roomId).toBe(room.id);
    const state = await get(`/api/rooms/${room.id}`, pal.token);
    expect(state.players.some((p: { username: string }) => p.username === 'pal1')).toBe(true);
  });

  it('auto-join adds the friend without asking; non-friends cannot be invited', async () => {
    const host = await user('host2');
    const pal = await user('pal2');
    const stranger = await user('str2');
    await post('/api/friends/request', host.token, { username: 'pal2' });
    await post('/api/friends/respond', pal.token, { userId: host.userId, accept: true });
    await ctx.app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: auth(pal.token),
      payload: { autoJoinInvites: true },
    });
    const room = await makeRoom(host.token);
    const r = (await post(`/api/rooms/${room.id}/invite`, host.token, { userId: pal.userId })).json();
    expect(r.autoJoined).toBe(true);
    const state = await get(`/api/rooms/${room.id}`, pal.token);
    expect(state.players.some((p: { username: string }) => p.username === 'pal2')).toBe(true);
    expect(
      (await post(`/api/rooms/${room.id}/invite`, host.token, { userId: stranger.userId })).statusCode,
    ).toBe(400);
  });
});

describe('banker invalidation', () => {
  async function fundedRoom() {
    const host = await user('bank3');
    const alice = await user('al3');
    const room = await makeRoom(host.token);
    await post('/api/rooms/join', alice.token, { joinCode: room.joinCode });
    for (const u of [host, alice]) {
      const req = (await post(`/api/rooms/${room.id}/buy`, u.token, { amount: 1000 })).json();
      await post(`/api/rooms/${room.id}/approve`, host.token, { requestId: req.id, approve: true });
    }
    return { host, alice, room };
  }

  it('voiding a table removes it from the global leaderboard and profiles', async () => {
    const { host, alice, room } = await fundedRoom();
    // fake a settled hand directly through the ledger to keep the test light
    const { appendLedger } = await import('../src/ledger.js');
    appendLedger(ctx.db, { roomId: room.id, userId: host.userId, delta: 500, kind: 'hand-settlement', ref: 'hand1' });
    appendLedger(ctx.db, { roomId: room.id, userId: alice.userId, delta: -500, kind: 'hand-settlement', ref: 'hand1' });
    let lb = await get('/api/leaderboard', host.token);
    expect(lb.rows.length).toBeGreaterThan(0);
    expect((await post(`/api/rooms/${room.id}/void`, alice.token, { voided: true })).statusCode).toBe(403);
    expect((await post(`/api/rooms/${room.id}/void`, host.token, { voided: true })).statusCode).toBe(200);
    lb = await get('/api/leaderboard', host.token);
    expect(lb.rows.find((r: { username: string }) => r.username === 'bank3')).toBeUndefined();
    const prof = await get(`/api/users/${host.userId}/profile`, alice.token);
    expect(prof.stats.net).toBe(0);
  });

  it('voiding one hand reverses its chips exactly once and keeps the chain valid', async () => {
    const { host, alice, room } = await fundedRoom();
    const { appendLedger } = await import('../src/ledger.js');
    appendLedger(ctx.db, { roomId: room.id, userId: host.userId, delta: 300, kind: 'hand-settlement', ref: 'handX' });
    appendLedger(ctx.db, { roomId: room.id, userId: alice.userId, delta: -300, kind: 'hand-settlement', ref: 'handX' });
    ctx.db.prepare('UPDATE room_players SET stack = 1300 WHERE room_id = ? AND user_id = ?').run(room.id, host.userId);
    ctx.db.prepare('UPDATE room_players SET stack = 700 WHERE room_id = ? AND user_id = ?').run(room.id, alice.userId);

    expect((await post(`/api/rooms/${room.id}/void-hand`, host.token, { handId: 'handX' })).statusCode).toBe(200);
    const state = await get(`/api/rooms/${room.id}`, host.token);
    const stack = (n: string) => state.players.find((p: { username: string }) => p.username === n).stack;
    expect(stack('bank3')).toBe(1000);
    expect(stack('al3')).toBe(1000);
    expect(verifyLedger(ctx.db, room.id).ok).toBe(true);
    // nets cancel in every downstream sum
    const session = await get(`/api/rooms/${room.id}/session`, host.token);
    expect(session.players.find((p: { username: string }) => p.username === 'bank3').net).toBe(0);
    // and only once
    expect((await post(`/api/rooms/${room.id}/void-hand`, host.token, { handId: 'handX' })).statusCode).toBe(400);
  });
});

describe('public tables and meet links', () => {
  it('public rooms are browsable and joinable without the code', async () => {
    const host = await user('pub_host');
    const guest = await user('pub_guest');
    const created = (
      await post('/api/rooms', host.token, {
        name: 'Open Table',
        sb: 5,
        bb: 10,
        visibility: 'public',
        meetLink: 'https://meet.google.com/abc-defg-hij',
      })
    ).json();
    const list = await get('/api/rooms/public', guest.token);
    const row = list.rooms.find((r: { id: string }) => r.id === created.id);
    expect(row).toBeDefined();
    expect(row.meetLink).toBe('https://meet.google.com/abc-defg-hij');
    expect(row.joinCode).toBeUndefined(); // never leaked in the listing
    expect((await post(`/api/rooms/${created.id}/join-public`, guest.token, {})).statusCode).toBe(200);
    const state = await get(`/api/rooms/${created.id}`, guest.token);
    expect(state.players.some((p: { username: string }) => p.username === 'pub_guest')).toBe(true);
  });

  it('private rooms reject codeless joins and stay unlisted', async () => {
    const host = await user('priv_host');
    const guest = await user('priv_guest');
    const created = (await post('/api/rooms', host.token, { name: 'Secret', sb: 5, bb: 10 })).json();
    const list = await get('/api/rooms/public', guest.token);
    expect(list.rooms.find((r: { id: string }) => r.id === created.id)).toBeUndefined();
    expect((await post(`/api/rooms/${created.id}/join-public`, guest.token, {})).statusCode).toBe(403);
  });
});

describe('watch links', () => {
  it('spectators watch without the join code, ask to join, and get admitted', async () => {
    const host = await user('w_host');
    const viewer = await user('w_viewer');
    const created = (await post('/api/rooms', host.token, { name: 'Stream', sb: 5, bb: 10 })).json();
    // off by default: the link exists but refuses viewers
    const settings = (await post(`/api/rooms/${created.id}/spectate-settings`, host.token, {})).json();
    expect(settings.allow).toBe(false);
    expect(
      (await ctx.app.inject({ method: 'GET', url: `/api/watch/${settings.token}`, headers: auth(viewer.token) }))
        .statusCode,
    ).toBe(403);
    // host turns it on; the viewer gets in as a spectator
    await post(`/api/rooms/${created.id}/spectate-settings`, host.token, { allow: true });
    const watch = (
      await ctx.app.inject({ method: 'GET', url: `/api/watch/${settings.token}`, headers: auth(viewer.token) })
    ).json();
    expect(watch.roomId).toBe(created.id);
    // the room view works but the code is masked
    const view = await get(`/api/rooms/${created.id}`, viewer.token);
    expect(view.youAre).toBe('spectator');
    expect(view.joinCode).toBe('');
    // buying chips is members-only
    expect((await post(`/api/rooms/${created.id}/buy`, viewer.token, { amount: 100 })).statusCode).toBe(403);
    // ask to join, host admits, and full membership follows
    expect((await post(`/api/rooms/${created.id}/ask-join`, viewer.token, {})).statusCode).toBe(200);
    const reqs = await get(`/api/rooms/${created.id}/join-requests`, host.token);
    expect(reqs.requests).toHaveLength(1);
    await post(`/api/rooms/${created.id}/admit`, host.token, { userId: viewer.userId, accept: true });
    const after = await get(`/api/rooms/${created.id}`, viewer.token);
    expect(after.youAre).toBe('member');
    expect(after.joinCode).not.toBe('');
  });
});

describe('chip transfers', () => {
  it('moves chips between members through the ledger, with guards', async () => {
    const host = await user('t_host');
    const pal = await user('t_pal');
    const outsider = await user('t_out');
    const room = (await post('/api/rooms', host.token, { name: 'Loans', sb: 5, bb: 10 })).json();
    await post('/api/rooms/join', pal.token, { joinCode: room.joinCode });
    const buy = (await post(`/api/rooms/${room.id}/buy`, host.token, { amount: 500 })).json();
    await post(`/api/rooms/${room.id}/approve`, host.token, { requestId: buy.id, approve: true });

    expect(
      (await post(`/api/rooms/${room.id}/transfer`, host.token, { toUserId: pal.userId, amount: 200, note: 'loan' }))
        .statusCode,
    ).toBe(200);
    const state = await get(`/api/rooms/${room.id}`, host.token);
    expect(state.players.find((p: { username: string }) => p.username === 't_host').stack).toBe(300);
    expect(state.players.find((p: { username: string }) => p.username === 't_pal').stack).toBe(200);
    const ledger = await get(`/api/rooms/${room.id}/ledger`, host.token);
    expect(ledger.verified.ok).toBe(true);
    expect(ledger.entries.filter((e: { kind: string }) => e.kind === 'transfer')).toHaveLength(2);

    // more than the stack, to a non-member, or to yourself: all refused
    expect(
      (await post(`/api/rooms/${room.id}/transfer`, host.token, { toUserId: pal.userId, amount: 9999 })).statusCode,
    ).toBe(400);
    expect(
      (await post(`/api/rooms/${room.id}/transfer`, host.token, { toUserId: outsider.userId, amount: 10 })).statusCode,
    ).toBe(403);
    expect(
      (await post(`/api/rooms/${room.id}/transfer`, host.token, { toUserId: host.userId, amount: 10 })).statusCode,
    ).toBe(400);
  });
});
