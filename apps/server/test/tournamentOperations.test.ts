import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createUser, createSession } from '../src/auth.js';
import { setPlatformUserId } from '../src/platform.js';
import { tickTournaments } from '../src/tournaments.js';
let ctx: ReturnType<typeof createApp>;
let users: { id: number; token: string }[];
beforeEach(() => {
  ctx = createApp(':memory:');
  users = ['platform', 'organizer', 'alice', 'bob'].map((name) => {
    const id = createUser(ctx.db, name, 'a'.repeat(64), 'b'.repeat(64)).userId;
    return { id, token: createSession(ctx.db, id) };
  });
  setPlatformUserId(ctx.db, users[0]!.id);
});
afterEach(async () => ctx.app.close());
function request(
  url: string,
  user: number | null = null,
  payload?: Record<string, unknown>,
  method?: 'GET' | 'POST' | 'PUT',
) {
  return ctx.app.inject({
    url,
    method: method ?? (payload === undefined ? 'GET' : 'POST'),
    headers: user === null ? {} : { authorization: `Bearer ${users[user]!.token}` },
    payload,
  });
}
async function create(user = 0, policy: Record<string, unknown> = {}) {
  const r = await request('/api/tournaments', user, {
    name: 'Championship',
    handLimit: 10,
    capacity: 2,
    policy,
  });
  expect(r.statusCode).toBe(200);
  return r.json().id as string;
}
async function enroll(id: string, user: number) {
  const state = (await request(`/api/tournaments/${id}`, user)).json();
  return request(`/api/tournaments/${id}/enroll`, user, {
    agentName: `Player ${user}`,
    kind: 'human',
    acceptedRevision: state.revision,
  });
}
it('requires platform approval for member proposals and keeps them private', async () => {
  const id = await create(1);
  expect((await request(`/api/tournaments/${id}`, 1)).json().approvalStatus).toBe('pending');
  expect((await request('/api/tournaments')).json().tournaments).toHaveLength(0);
  expect((await request(`/api/tournaments/${id}`)).statusCode).toBe(404);
  expect(
    (
      await request(`/api/tournaments/${id}/enroll`, 2, {
        agentName: 'Alice',
        kind: 'human',
        acceptedRevision: 1,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request(`/api/admin/tournaments/${id}/review`, 1, {
        approve: true,
        revision: 1,
        note: 'yes',
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request(`/api/admin/tournaments/${id}/review`, 0, {
        approve: true,
        revision: 1,
        note: 'Approved rules',
      })
    ).statusCode,
  ).toBe(200);
  expect((await request('/api/tournaments')).json().tournaments).toHaveLength(1);
  expect((await enroll(id, 2)).statusCode).toBe(200);
});
it('requires accepted terms and permanently locks rates on first enrollment', async () => {
  const id = await create();
  expect(
    (await request(`/api/tournaments/${id}/enroll`, 2, { agentName: 'Alice', kind: 'human' }))
      .statusCode,
  ).toBe(409);
  expect((await enroll(id, 2)).statusCode).toBe(200);
  await request(`/api/tournaments/${id}/withdraw`, 2, {});
  expect(
    (
      await request(
        `/api/tournaments/${id}/terms`,
        0,
        { revision: 1, policy: { entryFee: 10 } },
        'PUT',
      )
    ).statusCode,
  ).toBe(409);
});
it('starts scheduled approved events once and explains insufficient enrollment', async () => {
  const startsAt = Date.now() + 10000;
  const id = await create(0, { startsAt });
  tickTournaments(ctx.db, startsAt + 1);
  expect((await request(`/api/tournaments/${id}`)).json().scheduleNote).toMatch(/two/i);
  await enroll(id, 2);
  await enroll(id, 3);
  tickTournaments(ctx.db, startsAt + 1);
  tickTournaments(ctx.db, startsAt + 2);
  const s = (await request(`/api/tournaments/${id}`)).json();
  expect(s.status).toBe('running');
  expect(s.round.handNumber).toBe(1);
});
it('watch is anonymous and never returns live cards, reveals every finished hand only', async () => {
  const id = await create();
  await enroll(id, 2);
  await enroll(id, 3);
  await request(`/api/tournaments/${id}/control`, 0, { action: 'start' });
  let s = (await request(`/api/tournaments/${id}/watch`, 2)).json();
  expect(s.round.myCards).toEqual([]);
  expect(s.round.legalActions).toBeNull();
  expect(s.seed).toBeUndefined();
  const actor = users.findIndex((u) => u.id === s.round.toActUserId);
  await request(`/api/tournaments/${id}/actions`, actor, {
    handNumber: 1,
    actionSeq: 0,
    requestId: 'fold-first',
    action: { type: 'fold' },
  });
  s = (await request(`/api/tournaments/${id}/watch`)).json();
  expect(s.lastResult.revealed).toHaveLength(2);
  expect(s.round.handNumber).toBe(2);
  expect(s.round.myCards).toEqual([]);
  expect((await request(`/api/tournaments/${id}/hands/2`)).statusCode).toBe(409);
  const replay = (await request(`/api/tournaments/${id}/hands/1`)).json();
  expect(replay.actions).toHaveLength(1);
  expect(replay.result.revealed).toHaveLength(2);
});
it('fee/guarantee/reward/prizes remain tournament-local and cancellation is idempotent', async () => {
  const id = await create(0, { entryFee: 100, joiningReward: 10, guaranteedPool: 1000 });
  await enroll(id, 2);
  await enroll(id, 3);
  let s = (await request(`/api/tournaments/${id}`)).json();
  expect(s.finance.pool).toBe(1200);
  await request(`/api/tournaments/${id}/control`, 0, { action: 'start' });
  s = (await request(`/api/tournaments/${id}`)).json();
  expect(s.finance.pool).toBe(1180);
  expect(s.entries[0].joiningReward).toBe(10);
  await request(`/api/tournaments/${id}/control`, 0, { action: 'pause' });
  await request(`/api/tournaments/${id}/control`, 0, { action: 'cancel' });
  s = (await request(`/api/tournaments/${id}`)).json();
  expect(s.finance.pool).toBe(0);
  expect(s.entries.reduce((sum: number, e: any) => sum + e.prize, 0)).toBe(1180);
  expect(ctx.db.prepare('SELECT COUNT(*) n FROM ledger').get()).toEqual({ n: 0 });
  expect((await request('/api/me/tournament-earnings', 2)).json().earnings).toHaveLength(1);
});
it('knockout stacks carry between hands, bust-outs leave the table, and prizes allocate once', async () => {
  const id = await create(0, { format: 'knockout', guaranteedPool: 1000, blindEveryHands: 1 });
  await enroll(id, 2);
  await enroll(id, 3);
  await request(`/api/tournaments/${id}/control`, 0, { action: 'start' });
  let s = (await request(`/api/tournaments/${id}`, 2)).json();
  let actions = 0;
  while (s.status === 'running' && actions++ < 300) {
    const actor = users.findIndex((u) => u.id === s.round.toActUserId);
    const mine = (await request(`/api/tournaments/${id}`, actor)).json();
    const l = mine.round.legalActions;
    const action = l.canRaise
      ? { type: mine.round.betting.currentBet ? 'raise' : 'bet', amount: l.maxRaiseTo }
      : { type: l.canCheck ? 'check' : 'call' };
    const r = await request(`/api/tournaments/${id}/actions`, actor, {
      handNumber: mine.round.handNumber,
      actionSeq: mine.round.actionSeq,
      requestId: `action-${actions}`,
      action,
    });
    expect(r.statusCode, r.body).toBe(200);
    s = (await request(`/api/tournaments/${id}`, 2)).json();
  }
  expect(s.status).toBe('completed');
  expect(s.completedHands).toBeLessThanOrEqual(10);
  expect(s.entries.filter((e: any) => e.eliminatedHand !== null)).toHaveLength(1);
  const totalStacks = s.entries.reduce((a: number, e: any) => a + e.stack, 0);
  const handResults = (await request(`/api/tournaments/${id}/results`)).json().results;
  const fees = handResults.reduce((a: number, h: any) => a + h.fees.house + h.fees.prize, 0);
  expect(totalStacks + fees).toBe(4000);
  expect(s.finance.pool).toBe(0);
  expect(s.entries.reduce((a: number, e: any) => a + e.prize, 0)).toBe(
    1000 + handResults.reduce((a: number, h: any) => a + h.fees.prize, 0),
  );
});
it('rejects stale approval/edits and unsafe media while keeping private play out of public endpoints', async () => {
  const id = await create(1, { publicWatch: false });
  expect(
    (
      await request(
        `/api/tournaments/${id}/terms`,
        1,
        { revision: 1, name: 'Updated championship' },
        'PUT',
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await request(`/api/admin/tournaments/${id}/review`, 0, {
        revision: 1,
        approve: true,
        note: '',
      })
    ).statusCode,
  ).toBe(409);
  await request(`/api/admin/tournaments/${id}/review`, 0, {
    revision: 2,
    approve: true,
    note: 'Approved',
  });
  await enroll(id, 2);
  await enroll(id, 3);
  await request(`/api/tournaments/${id}/control`, 1, { action: 'start' });
  expect((await request(`/api/tournaments/${id}/watch`)).statusCode).toBe(403);
  expect((await request(`/api/tournaments/${id}/results`)).statusCode).toBe(403);
  expect((await request(`/api/tournaments/${id}`)).json().round).toBeNull();
  expect((await request(`/api/tournaments/${id}`, 2)).json().round.myCards).toHaveLength(2);
  expect(
    (
      await request(
        `/api/tournaments/${id}/media`,
        0,
        { streamUrl: 'javascript:alert(1)', meetUrl: '' },
        'PUT',
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (await request(`/api/tournaments/${id}/media`, 1, { streamUrl: '', meetUrl: '' }, 'PUT'))
      .statusCode,
  ).toBe(403);
});
it('retains old published tournament policy and history through repeat migrations', async () => {
  const now = Date.now();
  ctx.db
    .prepare(
      'INSERT INTO tournaments(id,owner_id,name,capacity,hand_limit,starting_stack,sb,bb,action_seconds,seed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run('legacy', users[1]!.id, 'Legacy event', 2, 10, 2000, 10, 20, 60, 'b'.repeat(64), now, now);
  const { migrateAgentPlatform } = await import('../src/agentSchema.js');
  migrateAgentPlatform(ctx.db);
  migrateAgentPlatform(ctx.db);
  const s = (await request('/api/tournaments/legacy')).json();
  expect(s.approvalStatus).toBe('approved');
  expect(s.revision).toBe(0);
  expect(s.policy.houseBps + s.policy.prizeBps).toBe(0);
  expect(s.policy.revealAllAfterHand).toBe(false);
  expect(
    (await request('/api/tournaments/legacy/enroll', 2, { agentName: 'Alice', kind: 'human' }))
      .statusCode,
  ).toBe(200);
});
it('does not resurrect a cancelled proposal through a stale approval request', async () => {
  const id = await create(1);
  expect(
    (await request(`/api/tournaments/${id}/control`, 1, { action: 'cancel' })).statusCode,
  ).toBe(200);
  expect(
    (
      await request(`/api/admin/tournaments/${id}/review`, 0, {
        revision: 1,
        approve: true,
        note: 'Stale review',
      })
    ).statusCode,
  ).toBe(409);
  expect((await request(`/api/tournaments/${id}`, 1)).json().status).toBe('cancelled');
});
it('under-enrolled scheduled events cannot starve an eligible event behind them', async () => {
  const startsAt = Date.now() + 1000,
    id = await create(0, { startsAt });
  for (let i = 0; i < 55; i++)
    ctx.db
      .prepare(
        'INSERT INTO tournaments(id,owner_id,name,capacity,hand_limit,starting_stack,sb,bb,action_seconds,seed,created_at,updated_at,policy_json) SELECT ?,owner_id,name,capacity,hand_limit,starting_stack,sb,bb,action_seconds,seed,0,0,policy_json FROM tournaments WHERE id=?',
      )
      .run(`waiting-${i}`, id);
  await enroll(id, 2);
  await enroll(id, 3);
  tickTournaments(ctx.db, startsAt + 1);
  expect((await request(`/api/tournaments/${id}`)).json().status).toBe('running');
});
it('an eliminated spectator cannot keep offline knockout players timing out', async () => {
  const created = await request('/api/tournaments', 0, {
    name: 'Knockout presence',
    capacity: 3,
    handLimit: 10,
    policy: { format: 'knockout' },
  });
  const id = created.json().id;
  for (const u of [1, 2, 3]) expect((await enroll(id, u)).statusCode).toBe(200);
  await request(`/api/tournaments/${id}/control`, 0, { action: 'start' });
  ctx.db.prepare('UPDATE tournament_entries SET last_seen=0 WHERE tournament_id=?').run(id);
  ctx.db
    .prepare(
      'UPDATE tournament_entries SET stack=0,eliminated_hand=1,last_seen=? WHERE tournament_id=? AND user_id=?',
    )
    .run(Date.now(), id, users[1]!.id);
  tickTournaments(ctx.db, Date.now() + 60001);
  expect((await request(`/api/tournaments/${id}`)).json().status).toBe('paused');
  expect(
    ctx.db.prepare('SELECT COUNT(*) n FROM tournament_actions WHERE tournament_id=?').get(id),
  ).toEqual({ n: 0 });
});

it('offers only house and prize deductions and rejects a banker cut in API writes', async () => {
  const id = await create();
  const s = (await request(`/api/tournaments/${id}`)).json();
  expect(s.policy.houseBps).toBe(50);
  expect(s.policy.prizeBps).toBe(50);
  expect(s.policy).not.toHaveProperty('bankerBps');
  expect(s.policy).not.toHaveProperty('bankerUserId');
  expect(s.finance).not.toHaveProperty('banker');
  expect(
    (
      await request('/api/tournaments', 0, {
        name: 'Forbidden commission',
        policy: { bankerBps: 50 },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request(
        `/api/tournaments/${id}/terms`,
        0,
        {
          revision: 1,
          policy: { bankerBps: 50 },
        },
        'PUT',
      )
    ).statusCode,
  ).toBe(400);
});

it('strips obsolete banker fields when reading persisted tournament terms', async () => {
  const id = await create();
  const s = (await request(`/api/tournaments/${id}`)).json();
  ctx.db
    .prepare('UPDATE tournaments SET policy_json=? WHERE id=?')
    .run(JSON.stringify({ ...s.policy, bankerBps: 50, bankerUserId: users[1]!.id }), id);
  const policy = (await request(`/api/tournaments/${id}`)).json().policy;
  expect(policy.houseBps).toBe(50);
  expect(policy.prizeBps).toBe(50);
  expect(policy).not.toHaveProperty('bankerBps');
  expect(policy).not.toHaveProperty('bankerUserId');
});
