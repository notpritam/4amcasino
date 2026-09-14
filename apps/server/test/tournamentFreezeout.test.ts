import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createSession, createUser } from '../src/auth.js';
import { DEFAULT_TOURNAMENT_POLICY } from '@4am/shared';
import { setPlatformUserId } from '../src/platform.js';
import { tickTournaments } from '../src/tournaments.js';

let ctx: ReturnType<typeof createApp>;
let users: { id: number; token: string }[];
let platformToken: string;

beforeEach(() => {
  ctx = createApp(':memory:');
  users = ['host', 'alice', 'bob', 'carol'].map((username) => {
    const { userId } = createUser(ctx.db, username, 'a'.repeat(64), 'b'.repeat(64));
    return { id: userId, token: createSession(ctx.db, userId) };
  });
  const platformId = createUser(ctx.db, 'platform', 'c'.repeat(64), 'd'.repeat(64)).userId;
  setPlatformUserId(ctx.db, platformId);
  platformToken = createSession(ctx.db, platformId);
});
afterEach(async () => {
  await ctx.app.close();
});

const request = (path: string, user = 0, body?: any, method?: 'GET' | 'POST' | 'PUT' | 'DELETE') =>
  ctx.app.inject({
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    url: path,
    headers: { authorization: `Bearer ${users[user]!.token}` },
    payload: path.endsWith('/enroll') && body ? { acceptedRevision: 1, ...body } : body,
  });

/** Freezeout terms: the entry fee is the stack, so it must sit inside the arena stack bounds. */
async function freezeout(
  policy: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  const res = await request('/api/tournaments', 0, {
    name: 'Freezeout Cup',
    handLimit: 50,
    capacity: 4,
    sb: 10,
    bb: 20,
    actionSeconds: 60,
    ...overrides,
    policy: { format: 'freezeout', entryFee: 1000, houseBps: 0, prizeBps: 0, ...policy },
  });
  if (res.statusCode !== 200) return { id: null, res };
  const id = res.json().id as string;
  const review = await ctx.app.inject({
    method: 'POST',
    url: `/api/admin/tournaments/${id}/review`,
    headers: { authorization: `Bearer ${platformToken}` },
    payload: { approve: true, revision: 1, note: 'Freezeout test' },
  });
  expect(review.statusCode).toBe(200);
  return { id, res };
}

describe('freezeout policy defaults', () => {
  it('splits the commission bonus 50/30/20 across the top three', () => {
    expect(DEFAULT_TOURNAMENT_POLICY.payoutBps).toEqual([5000, 3000, 2000]);
  });

  it('publishes a sit-out budget so nobody can wait out the field', () => {
    expect(DEFAULT_TOURNAMENT_POLICY.sitOutBudget).toBe(10);
    expect(DEFAULT_TOURNAMENT_POLICY.maxSitOutPerRequest).toBe(5);
  });
});

describe('entry fee is the stack', () => {
  it('seats a freezeout entrant with exactly their entry fee in chips', async () => {
    const { id } = await freezeout({ entryFee: 1500 });
    await request(`/api/tournaments/${id}/enroll`, 1, { agentName: 'Alice', kind: 'human' });
    const state = (await request(`/api/tournaments/${id}`, 1)).json();
    expect(state.entries[0].stack).toBe(1500);
  });

  it('leaves the prize pool empty at enrollment: only commission funds it', async () => {
    const { id } = await freezeout({ entryFee: 1500 });
    await request(`/api/tournaments/${id}/enroll`, 1, { agentName: 'Alice', kind: 'human' });
    const state = (await request(`/api/tournaments/${id}`, 1)).json();
    expect(state.finance.pool).toBe(0);
    expect(state.finance.entryFees).toBe(0);
  });

  it('rejects an entry fee above the arena stack ceiling', async () => {
    const { res } = await freezeout({ entryFee: 1_000_001 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/cannot exceed 1000000 chips/);
  });

  it('rejects an entry fee that cannot cover two big blinds', async () => {
    const { res } = await freezeout({ entryFee: 30 }, { sb: 10, bb: 20 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/must cover two big blinds/);
  });

  it('still allows a fixed-hand league to price entry above the stack ceiling', async () => {
    const res = await request('/api/tournaments', 0, {
      name: 'League Cup',
      capacity: 4,
      policy: { format: 'fixed-hand-league', entryFee: 5_000_000 },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('sit-out budget', () => {
  async function running(policy: Record<string, unknown> = {}) {
    const { id } = await freezeout(policy);
    for (const i of [1, 2, 3])
      await request(`/api/tournaments/${id}/enroll`, i, { agentName: `P${i}`, kind: 'human' });
    await request(`/api/tournaments/${id}/control`, 0, { action: 'start' });
    return id!;
  }

  it('accepts a sit-out within the per-request cap and counts it against the budget', async () => {
    const id = await running();
    const res = await request(`/api/tournaments/${id}/sit-out`, 1, { hands: 3 });
    expect(res.statusCode).toBe(200);
    const state = (await request(`/api/tournaments/${id}`, 1)).json();
    const me = state.entries.find((e: any) => e.userId === users[1]!.id);
    expect(me.satOutHands).toBe(3);
    expect(me.sitOutRemaining).toBe(7);
  });

  it('refuses a single sit-out longer than the per-request cap', async () => {
    const id = await running({ maxSitOutPerRequest: 5 });
    const res = await request(`/api/tournaments/${id}/sit-out`, 1, { hands: 6 });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a sit-out once the budget is spent', async () => {
    const id = await running({ sitOutBudget: 4, maxSitOutPerRequest: 4 });
    expect((await request(`/api/tournaments/${id}/sit-out`, 1, { hands: 4 })).statusCode).toBe(200);
    const spent = await request(`/api/tournaments/${id}/sit-out`, 1, { hands: 1 });
    expect(spent.statusCode).toBe(409);
  });

  it('never eliminates a player for sitting out', async () => {
    const id = await running({ sitOutBudget: 4, maxSitOutPerRequest: 4 });
    await request(`/api/tournaments/${id}/sit-out`, 1, { hands: 4 });
    const state = (await request(`/api/tournaments/${id}`, 1)).json();
    const me = state.entries.find((e: any) => e.userId === users[1]!.id);
    expect(me.eliminatedHand).toBeNull();
  });
});

async function seatedFreezeout(
  players: number[],
  policy: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  const { id } = await freezeout(policy, overrides);
  for (const i of players)
    await request(`/api/tournaments/${id}/enroll`, i, { agentName: `P${i}`, kind: 'human' });
  await request(`/api/tournaments/${id}/control`, 0, { action: 'start' });
  return id!;
}
const state = async (id: string, user = 0) =>
  (await request(`/api/tournaments/${id}`, user)).json();

/** Everyone shoves every hand, so the field collapses to one survivor within a few hands. */
async function playToCompletion(id: string) {
  for (let guard = 0; guard < 200; guard++) {
    const s = await state(id);
    if (s.status === 'completed') break;
    const actor = users.findIndex((u) => u.id === s.round.toActUserId);
    const la = (await state(id, actor)).round.legalActions;
    await request(`/api/tournaments/${id}/actions`, actor, {
      handNumber: s.round.handNumber,
      actionSeq: s.round.actionSeq,
      requestId: `h${s.round.handNumber}-a${s.round.actionSeq}`,
      action: la.canRaise ? { type: 'raise', amount: la.maxRaiseTo } : { type: 'call' },
    });
  }
  return state(id);
}

describe('freezeout ends with one survivor holding every chip', () => {
  it('runs until a single entrant has chips and gives them the whole field of entry fees', async () => {
    const id = await seatedFreezeout([1, 2], { entryFee: 40 }, { sb: 10, bb: 20, handLimit: 60 });
    const done = await playToCompletion(id);
    expect(done.status).toBe('completed');
    const alive = done.entries.filter((e: any) => e.stack > 0);
    expect(alive).toHaveLength(1);
    expect(alive[0].stack).toBe(80);
  });
});

describe('hand cap backstop', () => {
  it('settles an unresolved freezeout at the hand limit with every survivor keeping chips', async () => {
    const id = await seatedFreezeout([1, 2, 3], { entryFee: 1000 }, { handLimit: 10 });
    for (let guard = 0; guard < 60; guard++) {
      const s = await state(id);
      if (s.status === 'completed') break;
      const actor = users.findIndex((u) => u.id === s.round.toActUserId);
      await request(`/api/tournaments/${id}/actions`, actor, {
        handNumber: s.round.handNumber,
        actionSeq: s.round.actionSeq,
        requestId: `h${s.round.handNumber}-a${s.round.actionSeq}`,
        action: { type: 'fold' },
      });
    }
    const done = await state(id);
    expect(done.status).toBe('completed');
    expect(done.completedHands).toBe(10);
    expect(done.entries.filter((e: any) => e.stack > 0).length).toBeGreaterThan(1);
    expect(done.entries.reduce((total: number, e: any) => total + e.stack, 0)).toBe(3000);
  });
});

describe('a sitting-out entrant is folded without waiting for the clock', () => {
  it('leaves the turn alone on a tick when nobody is sitting out', async () => {
    const id = await seatedFreezeout([1, 2, 3]);
    const before = await state(id);
    tickTournaments(ctx.db, Date.now());
    expect((await state(id)).round.toActUserId).toBe(before.round.toActUserId);
  });

  it('acts for the sitting-out entrant on the very next tick', async () => {
    const id = await seatedFreezeout([1, 2, 3]);
    const before = await state(id);
    const actor = users.findIndex((u) => u.id === before.round.toActUserId);
    expect((await request(`/api/tournaments/${id}/sit-out`, actor, { hands: 1 })).statusCode).toBe(
      200,
    );
    tickTournaments(ctx.db, Date.now());
    expect((await state(id)).round.toActUserId).not.toBe(before.round.toActUserId);
  });
});

describe('freezeout settlement counts the chips actually won', () => {
  it('settles a freezeout on play net, because the finishing stack is the prize', async () => {
    const id = await seatedFreezeout([1, 2], { entryFee: 40 }, { sb: 10, bb: 20, handLimit: 60 });
    const done = await playToCompletion(id);
    expect(done.status).toBe('completed');
    const winner = done.entries.find((e: any) => e.stack > 0);
    const loser = done.entries.find((e: any) => e.stack === 0);
    expect(winner.playNet).toBe(40);
    expect(winner.settlementNet).toBe(40);
    expect(loser.playNet).toBe(-40);
    expect(loser.settlementNet).toBe(-40);
  });
});

describe('the bonus pool is funded by commission, never by entry fees', () => {
  it('skims the pool from pots and pays it out ranked, with entry fees untouched', async () => {
    const id = await seatedFreezeout(
      [1, 2, 3],
      { entryFee: 1000, houseBps: 100, prizeBps: 500 },
      { sb: 10, bb: 20, handLimit: 60 },
    );
    const done = await playToCompletion(id);
    expect(done.status).toBe('completed');
    expect(done.finance.entryFees).toBe(0);
    expect(done.finance.house).toBeGreaterThan(0);
    const paid = done.entries.map((e: any) => e.prize).sort((a: number, b: number) => b - a);
    expect(paid.reduce((t: number, n: number) => t + n, 0)).toBe(done.finance.prizes);
    expect(done.finance.prizes).toBeGreaterThan(0);
    expect(paid[0]).toBeGreaterThanOrEqual(paid[1]);
    expect(paid[1]).toBeGreaterThanOrEqual(paid[2]);
    expect(done.finance.pool).toBe(0);
  });
});
