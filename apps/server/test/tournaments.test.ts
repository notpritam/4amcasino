import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createSession, createUser } from '../src/auth.js';
import { tickTournaments } from '../src/tournaments.js';
import { mergeAccounts } from '../src/merge.js';
import { actArena, createArenaRound } from '@4am/shared';
import { arenaDeck, seedCommitment } from '../src/arenaRandom.js';
import { setPlatformUserId } from '../src/platform.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let ctx: ReturnType<typeof createApp>;
let directory: string | undefined;
let users: { id: number; token: string }[];
let platformToken: string;
beforeEach(() => {
  ctx = createApp(':memory:');
  users = ['host', 'alice', 'bob'].map((username) => {
    const { userId } = createUser(ctx.db, username, 'a'.repeat(64), 'b'.repeat(64));
    return { id: userId, token: createSession(ctx.db, userId) };
  });
  const platformId = createUser(ctx.db, 'platform', 'c'.repeat(64), 'd'.repeat(64)).userId;
  setPlatformUserId(ctx.db, platformId);
  platformToken = createSession(ctx.db, platformId);
});
afterEach(async () => {
  await ctx.app.close();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
});
const request = (path: string, user = 0, body?: any, method?: 'GET' | 'POST' | 'PUT' | 'DELETE') =>
  ctx.app.inject({
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    url: path,
    headers: { authorization: `Bearer ${users[user]!.token}` },
    payload: path.endsWith('/enroll') && body ? { ...body, acceptedRevision: 1 } : body,
  });
async function tournament() {
  const res = await request('/api/tournaments', 0, {
    name: 'Agent Cup',
    handLimit: 10,
    capacity: 2,
    startingStack: 2000,
    sb: 10,
    bb: 20,
    actionSeconds: 60,
    policy: { bankerBps: 0, houseBps: 0, prizeBps: 0 },
  });
  expect(res.statusCode).toBe(200);
  const review = await ctx.app.inject({
    method: 'POST',
    url: `/api/admin/tournaments/${res.json().id}/review`,
    headers: { authorization: `Bearer ${platformToken}` },
    payload: { approve: true, revision: 1, note: 'Test event' },
  });
  expect(review.statusCode).toBe(200);
  return res.json().id as string;
}
describe('tournaments', () => {
  it('keeps subscribers present while waiting for a long decision timer', async () => {
    const id = await tournament();
    for (const i of [1, 2])
      await request(`/api/tournaments/${id}/enroll`, i, { agentName: `Agent ${i}`, kind: 'agent' });
    await request(`/api/tournaments/${id}/control`, 0, { action: 'start' });
    ctx.db.prepare('UPDATE tournament_entries SET last_seen = 0 WHERE tournament_id = ?').run(id);
    expect(
      (await request(`/api/agent/events?scopeKind=tournament&scopeId=${id}`, 1)).statusCode,
    ).toBe(200);
    tickTournaments(ctx.db, Date.now() + 60_001);
    expect((await request(`/api/tournaments/${id}`)).json().status).toBe('running');
  });
  it('blocks identity merges involving active organizers or entrants on either side', async () => {
    const id = await tournament();
    await request(`/api/tournaments/${id}/enroll`, 1, { agentName: 'Agent Alice', kind: 'agent' });
    for (const [from, into] of [
      [0, 2],
      [2, 0],
      [1, 2],
      [2, 1],
    ]) {
      expect(() => mergeAccounts(ctx.db, users[from!]!.id, users[into!]!.id)).toThrow(
        /tournament/i,
      );
    }
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled = 1').get()).toEqual({
      n: 0,
    });
    await request(`/api/tournaments/${id}/control`, 0, { action: 'cancel' });
    expect(() => mergeAccounts(ctx.db, users[1]!.id, users[2]!.id)).not.toThrow();
  });
  it('isolates a damaged league from other tournament deadlines', async () => {
    const ids = [await tournament(), await tournament()];
    for (const id of ids) {
      for (const i of [1, 2])
        await request(`/api/tournaments/${id}/enroll`, i, {
          agentName: `Agent ${i}`,
          kind: 'agent',
        });
      await request(`/api/tournaments/${id}/control`, 0, { action: 'start' });
    }
    ctx.db
      .prepare('UPDATE tournaments SET round_json = ? WHERE id = ?')
      .run('damaged state', ids[0]);
    expect(() => tickTournaments(ctx.db, Date.now() + 60_001)).not.toThrow();
    expect(ctx.db.prepare('SELECT status FROM tournaments WHERE id = ?').get(ids[0])).toEqual({
      status: 'paused',
    });
    expect((await request(`/api/tournaments/${ids[1]}`)).json().completedHands).toBe(1);
  });
  it('keeps user request IDs separate from automatic timeouts', async () => {
    const id = await tournament();
    for (const i of [1, 2])
      await request(`/api/tournaments/${id}/enroll`, i, { agentName: `Agent ${i}`, kind: 'agent' });
    await request(`/api/tournaments/${id}/control`, 0, { action: 'start' });
    for (let h = 1; h <= 2; h++) {
      const s = (await request(`/api/tournaments/${id}`)).json();
      const actor = users.findIndex((u) => u.id === s.round.toActUserId);
      expect(
        (
          await request(`/api/tournaments/${id}/actions`, actor, {
            handNumber: h,
            actionSeq: 0,
            requestId: h === 1 ? 'timeout-3-0' : 'hand-2',
            action: { type: 'fold' },
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(() => tickTournaments(ctx.db, Date.now() + 60_001)).not.toThrow();
    expect((await request(`/api/tournaments/${id}`)).json().completedHands).toBe(3);
  });
  it('enrolls, locks enrollment, scopes control and exposes only each player’s cards', async () => {
    const id = await tournament();
    for (const i of [1, 2])
      expect(
        (
          await request(`/api/tournaments/${id}/enroll`, i, {
            agentName: `Agent ${i}`,
            kind: 'agent',
          })
        ).statusCode,
      ).toBe(200);
    expect(
      (await request(`/api/tournaments/${id}/enroll`, 0, { agentName: 'Extra', kind: 'human' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await request(`/api/tournaments/${id}/control`, 1, { action: 'start' })).statusCode,
    ).toBe(403);
    expect(
      (await request(`/api/tournaments/${id}/control`, 0, { action: 'start' })).statusCode,
    ).toBe(200);
    const host = (await request(`/api/tournaments/${id}`)).json();
    const alice = (await request(`/api/tournaments/${id}`, 1)).json();
    expect(host.round.myCards).toEqual([]);
    expect(alice.round.myCards).toHaveLength(2);
    expect(JSON.stringify(alice)).not.toContain('"deck"');
    expect(alice.seed).toBeUndefined();
    expect((await request(`/api/tournaments/${id}/withdraw`, 1, {})).statusCode).toBe(409);
  });
  it('finishes a league idempotently with zero-sum scores and no cash ledger entries', async () => {
    const id = await tournament();
    for (const i of [1, 2])
      await request(`/api/tournaments/${id}/enroll`, i, { agentName: `Agent ${i}`, kind: 'agent' });
    await request(`/api/tournaments/${id}/control`, 0, { action: 'start' });
    let first: { user: number; body: any } | null = null;
    for (let n = 0; n < 10; n++) {
      const state = (await request(`/api/tournaments/${id}`)).json();
      const actor = users.findIndex((u) => u.id === state.round.toActUserId);
      const body = {
        handNumber: state.round.handNumber,
        actionSeq: state.round.actionSeq,
        requestId: `decision-${n}`,
        action: { type: 'fold' },
      };
      const res = await request(`/api/tournaments/${id}/actions`, actor, body);
      expect(res.statusCode).toBe(200);
      if (n === 0) {
        first = { user: actor, body };
        expect(
          (await request(`/api/tournaments/${id}/actions`, actor, body)).json().duplicate,
        ).toBe(true);
      }
    }
    const done = (await request(`/api/tournaments/${id}`)).json();
    expect(done.status).toBe('completed');
    expect(done.completedHands).toBe(10);
    expect(done.seed).toHaveLength(64);
    expect(done.entries.reduce((n: number, p: any) => n + p.net, 0)).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual({ n: 0 });
    const audit = (await request(`/api/tournaments/${id}/audit`)).json();
    expect(audit.actions).toHaveLength(10);
    expect(seedCommitment(audit.seed)).toBe(done.seedCommitment);
    const results = (await request(`/api/tournaments/${id}/results`)).json().results;
    for (let hand = 1; hand <= 10; hand++) {
      let replay = createArenaRound(
        {
          playerIds: audit.playerIds,
          stack: done.startingStack,
          sb: done.sb,
          bb: done.bb,
          handNumber: hand,
          commission: { bankerBps: 0, houseBps: 0, prizeBps: 0 },
          revealAllAfterHand: true,
        },
        arenaDeck(audit.seed, hand),
      );
      for (const action of audit.actions.filter((a: any) => a.handNumber === hand))
        replay = actArena(replay, action.userId, action.action);
      expect(replay.result).toEqual(results[hand - 1]);
    }
    expect(
      (await request(`/api/tournaments/${id}/actions`, first!.user, first!.body)).json().duplicate,
    ).toBe(true);
  });
  it('restores the live round, seed, deadline and action deduplication after restart', async () => {
    const id = await tournament();
    for (const i of [1, 2])
      await request(`/api/tournaments/${id}/enroll`, i, { agentName: `Agent ${i}`, kind: 'agent' });
    await request(`/api/tournaments/${id}/control`, 0, { action: 'start' });
    expect((await request(`/api/tournaments/${id}/audit`)).statusCode).toBe(409);
    const s = (await request(`/api/tournaments/${id}`)).json();
    const actor = users.findIndex((u) => u.id === s.round.toActUserId);
    const body = {
      handNumber: 1,
      actionSeq: 0,
      requestId: 'before-restart',
      action: { type: 'fold' },
    };
    await request(`/api/tournaments/${id}/actions`, actor, body);
    const before = (await request(`/api/tournaments/${id}`, 1)).json();
    directory = await mkdtemp(join(tmpdir(), 'arena-restart-'));
    const path = join(directory, 'test.db');
    await ctx.db.backup(path);
    await ctx.app.close();
    ctx = createApp(path);
    const after = (await request(`/api/tournaments/${id}`, 1)).json();
    expect(after.round).toEqual(before.round);
    expect(after.deadline).toBe(before.deadline);
    expect(after.seedCommitment).toBe(before.seedCommitment);
    expect((await request(`/api/tournaments/${id}/actions`, actor, body)).json().duplicate).toBe(
      true,
    );
    expect(after.completedHands).toBe(1);
  });
  it('rejects stale actions and keeps state unchanged when paused', async () => {
    const id = await tournament();
    for (const i of [1, 2])
      await request(`/api/tournaments/${id}/enroll`, i, { agentName: `Agent ${i}`, kind: 'human' });
    await request(`/api/tournaments/${id}/control`, 0, { action: 'start' });
    const s = (await request(`/api/tournaments/${id}`)).json();
    const actor = users.findIndex((u) => u.id === s.round.toActUserId);
    expect(
      (
        await request(`/api/tournaments/${id}/actions`, actor, {
          handNumber: 99,
          actionSeq: 0,
          requestId: 'stale',
          action: { type: 'fold' },
        })
      ).statusCode,
    ).toBe(409);
    await request(`/api/tournaments/${id}/control`, 0, { action: 'pause' });
    expect(
      (
        await request(`/api/tournaments/${id}/actions`, actor, {
          handNumber: 1,
          actionSeq: 0,
          requestId: 'paused',
          action: { type: 'fold' },
        })
      ).statusCode,
    ).toBe(409);
  });
});
