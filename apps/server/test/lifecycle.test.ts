import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { appendLedger, verifyLedger } from '../src/ledger.js';
import { settleRake } from '../src/rake.js';
import { setPlatformUserId } from '../src/platform.js';

async function register(app: ReturnType<typeof createApp>['app'], username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username, authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) },
  });
  return res.json() as { userId: number; token: string };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

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

describe('exclude archived/deleted rooms from money and listings (Task 2)', () => {
  it('drops settle/house/public entries once a room is archived, then deleted', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 't2_alice');
    const bob = await register(ctx.app, 't2_bob');
    const house = await register(ctx.app, 't2_house');
    setPlatformUserId(ctx.db, house.userId);

    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(alice.token),
        payload: { name: 'Lifecycle Test', sb: 10, bb: 20, visibility: 'public' },
      })
    ).json() as { id: string; joinCode: string };

    await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms/join',
      headers: auth(bob.token),
      payload: { joinCode: room.joinCode },
    });

    for (const p of [alice, bob]) {
      const buyRes = (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/rooms/${room.id}/buy`,
          headers: auth(p.token),
          payload: { amount: 500 },
        })
      ).json() as { id: number };
      await ctx.app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/approve`,
        headers: auth(alice.token),
        payload: { requestId: buyRes.id, approve: true },
      });
    }

    // Simulate a settled hand: alice wins 200, bob loses 250, 50 goes to rake.
    ctx.db
      .prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?')
      .run(200, room.id, alice.userId);
    ctx.db
      .prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?')
      .run(-250, room.id, bob.userId);
    appendLedger(ctx.db, {
      roomId: room.id,
      userId: alice.userId,
      delta: 200,
      kind: 'hand-settlement',
      ref: 'h1',
    });
    appendLedger(ctx.db, {
      roomId: room.id,
      userId: bob.userId,
      delta: -250,
      kind: 'hand-settlement',
      ref: 'h1',
    });
    settleRake(ctx.db, { roomId: room.id, recipientId: house.userId, rake: 50, ref: 'h1' });
    expect(verifyLedger(ctx.db, room.id).ok).toBe(true);

    async function settleOtherIds(token: string) {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/me/settle', headers: auth(token) });
      const body = res.json() as { people: { otherUserId: number }[] };
      return body.people.map((p) => p.otherUserId);
    }
    async function houseAccrued(token: string) {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/me/house', headers: auth(token) });
      return (res.json() as { accrued: number }).accrued;
    }
    async function myRoomIds(token: string) {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/my-rooms', headers: auth(token) });
      const body = res.json() as { rooms: { id: string }[] };
      return body.rooms.map((r) => r.id);
    }
    async function publicRoomIds() {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/rooms/public', headers: auth(alice.token) });
      const body = res.json() as { rooms: { id: string }[] };
      return body.rooms.map((r) => r.id);
    }

    // Before any lifecycle change: debt + commission + listings are all visible.
    expect(await settleOtherIds(bob.token)).toContain(alice.userId);
    expect(await houseAccrued(alice.token)).toBe(50);
    expect(await myRoomIds(bob.token)).toContain(room.id);
    expect(await publicRoomIds()).toContain(room.id);

    // Archived: drops out of settle + house, but stays in /api/my-rooms.
    ctx.db.prepare('UPDATE rooms SET archived = 1, archived_at = ? WHERE id = ?').run(Date.now(), room.id);
    expect(await settleOtherIds(bob.token)).not.toContain(alice.userId);
    expect(await houseAccrued(alice.token)).toBe(0);
    expect(await myRoomIds(bob.token)).toContain(room.id);

    // Reset archived, then delete: drops out of settle + house + my-rooms + public.
    ctx.db.prepare('UPDATE rooms SET archived = 0, archived_at = NULL WHERE id = ?').run(room.id);
    expect(await settleOtherIds(bob.token)).toContain(alice.userId); // sanity: back once unarchived

    ctx.db.prepare('UPDATE rooms SET deleted = 1, deleted_at = ? WHERE id = ?').run(Date.now(), room.id);
    expect(await settleOtherIds(bob.token)).not.toContain(alice.userId);
    expect(await houseAccrued(alice.token)).toBe(0);
    expect(await myRoomIds(bob.token)).not.toContain(room.id);
    expect(await publicRoomIds()).not.toContain(room.id);

    await ctx.app.close();
  });
});

describe('archive and delete become platform-approved requests (Task 3)', () => {
  async function createRoom(ctx: ReturnType<typeof createApp>, token: string) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: auth(token),
      payload: { name: 'Lifecycle Requests', sb: 10, bb: 20 },
    });
    return res.json() as { id: string; joinCode: string };
  }

  function pendingRows(
    ctx: ReturnType<typeof createApp>,
    roomId: string,
    action: string,
  ): { id: number; requested_by: number; status: string }[] {
    return ctx.db
      .prepare(
        `SELECT id, requested_by, status FROM room_lifecycle_requests WHERE room_id = ? AND action = ?`,
      )
      .all(roomId, action) as { id: number; requested_by: number; status: string }[];
  }

  it('archive no longer mutates rooms.archived and is idempotent on a duplicate pending request', async () => {
    const ctx = createApp(':memory:');
    const host = await register(ctx.app, 't3_host');
    const room = await createRoom(ctx, host.token);

    const first = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/archive`,
      headers: auth(host.token),
      payload: { archived: true },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { pending: boolean; requestId: number };
    expect(firstBody.pending).toBe(true);
    expect(typeof firstBody.requestId).toBe('number');

    const roomRow = ctx.db.prepare('SELECT archived FROM rooms WHERE id = ?').get(room.id) as {
      archived: number;
    };
    expect(roomRow.archived).toBe(0);

    const rows = pendingRows(ctx, room.id, 'archive');
    expect(rows).toHaveLength(1);
    expect(rows[0].requested_by).toBe(host.userId);
    expect(rows[0].status).toBe('pending');

    // Calling again with the same action returns the existing request instead
    // of creating a second pending row.
    const second = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/archive`,
      headers: auth(host.token),
      payload: { archived: true },
    });
    const secondBody = second.json() as { pending: boolean; requestId: number };
    expect(secondBody.requestId).toBe(firstBody.requestId);
    expect(pendingRows(ctx, room.id, 'archive')).toHaveLength(1);

    await ctx.app.close();
  });

  it('delete creates a pending delete request', async () => {
    const ctx = createApp(':memory:');
    const host = await register(ctx.app, 't3_host2');
    const room = await createRoom(ctx, host.token);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/delete`,
      headers: auth(host.token),
      payload: { note: 'duplicate table' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { pending: boolean; requestId: number };
    expect(body.pending).toBe(true);
    expect(typeof body.requestId).toBe('number');

    const roomRow = ctx.db.prepare('SELECT deleted FROM rooms WHERE id = ?').get(room.id) as {
      deleted: number;
    };
    expect(roomRow.deleted).toBe(0);

    const rows = pendingRows(ctx, room.id, 'delete');
    expect(rows).toHaveLength(1);
    expect(rows[0].requested_by).toBe(host.userId);
    expect(rows[0].status).toBe('pending');

    await ctx.app.close();
  });

  it('rejects archive and delete requests from a non-member', async () => {
    const ctx = createApp(':memory:');
    const host = await register(ctx.app, 't3_host3');
    const stranger = await register(ctx.app, 't3_stranger');
    const room = await createRoom(ctx, host.token);

    const archiveRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/archive`,
      headers: auth(stranger.token),
      payload: { archived: true },
    });
    expect(archiveRes.statusCode).toBe(403);

    const deleteRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/delete`,
      headers: auth(stranger.token),
      payload: {},
    });
    expect(deleteRes.statusCode).toBe(403);

    await ctx.app.close();
  });
});

describe('platform admin approves room lifecycle (Task 4)', () => {
  async function createRoom(ctx: ReturnType<typeof createApp>, token: string) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: auth(token),
      payload: { name: 'Admin Lifecycle', sb: 10, bb: 20 },
    });
    return res.json() as { id: string; joinCode: string };
  }

  it('rejects a non-platform user on both admin routes with 403', async () => {
    const ctx = createApp(':memory:');
    const host = await register(ctx.app, 't4_host');
    const stranger = await register(ctx.app, 't4_stranger');
    const room = await createRoom(ctx, host.token);

    const archiveRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/archive`,
      headers: auth(host.token),
      payload: { archived: true },
    });
    const { requestId } = archiveRes.json() as { requestId: number };

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin/lifecycle',
      headers: auth(stranger.token),
    });
    expect(listRes.statusCode).toBe(403);

    const decideRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/lifecycle/${requestId}`,
      headers: auth(stranger.token),
      payload: { approve: true },
    });
    expect(decideRes.statusCode).toBe(403);

    await ctx.app.close();
  });

  it('lists and approves a pending archive request', async () => {
    const ctx = createApp(':memory:');
    const host = await register(ctx.app, 't4_host2');
    const platform = await register(ctx.app, 't4_platform');
    setPlatformUserId(ctx.db, platform.userId);
    const room = await createRoom(ctx, host.token);

    const archiveRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/archive`,
      headers: auth(host.token),
      payload: { archived: true },
    });
    const { requestId } = archiveRes.json() as { requestId: number };

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin/lifecycle',
      headers: auth(platform.token),
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json() as {
      requests: { id: number; roomId: string; action: string; status: string }[];
    };
    const pending = listBody.requests.find((r) => r.id === requestId);
    expect(pending).toBeDefined();
    expect(pending?.roomId).toBe(room.id);
    expect(pending?.action).toBe('archive');
    expect(pending?.status).toBe('pending');

    const decideRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/lifecycle/${requestId}`,
      headers: auth(platform.token),
      payload: { approve: true },
    });
    expect(decideRes.statusCode).toBe(200);

    const roomRow = ctx.db.prepare('SELECT archived FROM rooms WHERE id = ?').get(room.id) as {
      archived: number;
    };
    expect(roomRow.archived).toBe(1);

    const requestRow = ctx.db
      .prepare('SELECT status, decided_by, decided_at FROM room_lifecycle_requests WHERE id = ?')
      .get(requestId) as { status: string; decided_by: number | null; decided_at: number | null };
    expect(requestRow.status).toBe('approved');
    expect(requestRow.decided_by).toBe(platform.userId);
    expect(requestRow.decided_at).not.toBeNull();

    await ctx.app.close();
  });

  it('rejecting a request leaves the room unchanged', async () => {
    const ctx = createApp(':memory:');
    const host = await register(ctx.app, 't4_host3');
    const platform = await register(ctx.app, 't4_platform2');
    setPlatformUserId(ctx.db, platform.userId);
    const room = await createRoom(ctx, host.token);

    const archiveRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/archive`,
      headers: auth(host.token),
      payload: { archived: true },
    });
    const { requestId } = archiveRes.json() as { requestId: number };

    const decideRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/lifecycle/${requestId}`,
      headers: auth(platform.token),
      payload: { approve: false },
    });
    expect(decideRes.statusCode).toBe(200);

    const roomRow = ctx.db.prepare('SELECT archived FROM rooms WHERE id = ?').get(room.id) as {
      archived: number;
    };
    expect(roomRow.archived).toBe(0);

    const requestRow = ctx.db
      .prepare('SELECT status FROM room_lifecycle_requests WHERE id = ?')
      .get(requestId) as { status: string };
    expect(requestRow.status).toBe('rejected');

    await ctx.app.close();
  });

  it('approving a delete request sets rooms.deleted=1, and the room then drops from /api/me/settle', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 't4_alice');
    const bob = await register(ctx.app, 't4_bob');
    const house = await register(ctx.app, 't4_house');
    setPlatformUserId(ctx.db, house.userId);

    const room = await createRoom(ctx, alice.token);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms/join',
      headers: auth(bob.token),
      payload: { joinCode: room.joinCode },
    });
    for (const p of [alice, bob]) {
      const buyRes = (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/rooms/${room.id}/buy`,
          headers: auth(p.token),
          payload: { amount: 500 },
        })
      ).json() as { id: number };
      await ctx.app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/approve`,
        headers: auth(alice.token),
        payload: { requestId: buyRes.id, approve: true },
      });
    }
    ctx.db
      .prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?')
      .run(200, room.id, alice.userId);
    ctx.db
      .prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?')
      .run(-250, room.id, bob.userId);
    appendLedger(ctx.db, {
      roomId: room.id,
      userId: alice.userId,
      delta: 200,
      kind: 'hand-settlement',
      ref: 'h1',
    });
    appendLedger(ctx.db, {
      roomId: room.id,
      userId: bob.userId,
      delta: -250,
      kind: 'hand-settlement',
      ref: 'h1',
    });
    settleRake(ctx.db, { roomId: room.id, recipientId: house.userId, rake: 50, ref: 'h1' });
    expect(verifyLedger(ctx.db, room.id).ok).toBe(true);

    async function settleOtherIds(token: string) {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/me/settle', headers: auth(token) });
      const body = res.json() as { people: { otherUserId: number }[] };
      return body.people.map((p) => p.otherUserId);
    }

    expect(await settleOtherIds(bob.token)).toContain(alice.userId);

    const deleteRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/delete`,
      headers: auth(alice.token),
      payload: {},
    });
    const { requestId } = deleteRes.json() as { requestId: number };

    const decideRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/lifecycle/${requestId}`,
      headers: auth(house.token),
      payload: { approve: true },
    });
    expect(decideRes.statusCode).toBe(200);

    const roomRow = ctx.db.prepare('SELECT deleted FROM rooms WHERE id = ?').get(room.id) as {
      deleted: number;
    };
    expect(roomRow.deleted).toBe(1);

    expect(await settleOtherIds(bob.token)).not.toContain(alice.userId);

    await ctx.app.close();
  });
});
