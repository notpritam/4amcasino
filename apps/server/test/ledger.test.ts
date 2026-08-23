import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { verifyLedger } from '../src/ledger.js';
import { isSevenDeuce } from '../src/game.js';
import { cardFromName } from '@4am/shared';

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

describe('rooms', () => {
  it('create + join by code; membership required to view', async () => {
    const host = await user('host');
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: auth(host.token),
      payload: { name: 'Friday Night', sb: 10, bb: 20 },
    });
    expect(created.statusCode).toBe(200);
    const room = created.json();
    expect(room.joinCode).toHaveLength(6);

    const alice = await user('alice');
    const outsider = await ctx.app.inject({
      method: 'GET',
      url: `/api/rooms/${room.id}`,
      headers: auth(alice.token),
    });
    expect(outsider.statusCode).toBe(403);

    const badJoin = await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms/join',
      headers: auth(alice.token),
      payload: { joinCode: 'ZZZZZZ' },
    });
    expect(badJoin.statusCode).toBe(404);

    const join = await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms/join',
      headers: auth(alice.token),
      payload: { joinCode: room.joinCode },
    });
    expect(join.statusCode).toBe(200);

    const state = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}`, headers: auth(alice.token) })
    ).json();
    expect(state.players.map((p: { username: string }) => p.username).sort()).toEqual([
      'alice',
      'host',
    ]);
  });
});

describe('bank flow', () => {
  it('buy -> banker approve credits stack and appends verifiable ledger', async () => {
    const host = await user('host');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(host.token),
        payload: { name: 'Friday', sb: 10, bb: 20 },
      })
    ).json();
    const alice = await user('alice');
    await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms/join',
      headers: auth(alice.token),
      payload: { joinCode: room.joinCode },
    });
    const req = (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/buy`,
        headers: auth(alice.token),
        payload: { amount: 500 },
      })
    ).json();
    // non-banker cannot approve
    const forbidden = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/approve`,
      headers: auth(alice.token),
      payload: { requestId: req.id, approve: true },
    });
    expect(forbidden.statusCode).toBe(403);
    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/approve`,
      headers: auth(host.token),
      payload: { requestId: req.id, approve: true },
    });
    expect(ok.statusCode).toBe(200);
    const state = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}`, headers: auth(alice.token) })
    ).json();
    expect(state.players.find((p: { username: string }) => p.username === 'alice').stack).toBe(500);
    const ledger = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/rooms/${room.id}/ledger`,
        headers: auth(alice.token),
      })
    ).json();
    expect(ledger.verified.ok).toBe(true);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({ delta: 500, kind: 'purchase' });
  });

  it('rejecting a request credits nothing', async () => {
    const host = await user('host');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(host.token),
        payload: { name: 'x', sb: 1, bb: 2 },
      })
    ).json();
    const req = (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/buy`,
        headers: auth(host.token),
        payload: { amount: 100 },
      })
    ).json();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/approve`,
      headers: auth(host.token),
      payload: { requestId: req.id, approve: false },
    });
    const state = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}`, headers: auth(host.token) })
    ).json();
    expect(state.players[0].stack).toBe(0);
    const ledger = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/rooms/${room.id}/ledger`,
        headers: auth(host.token),
      })
    ).json();
    expect(ledger.entries).toHaveLength(0);
  });

  it('detects a tampered ledger row', async () => {
    const host = await user('host');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(host.token),
        payload: { name: 'x', sb: 1, bb: 2 },
      })
    ).json();
    const req = (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/buy`,
        headers: auth(host.token),
        payload: { amount: 100 },
      })
    ).json();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/approve`,
      headers: auth(host.token),
      payload: { requestId: req.id, approve: true },
    });
    ctx.db.prepare('UPDATE ledger SET delta = 9999 WHERE id = 1').run();
    expect(verifyLedger(ctx.db, room.id).ok).toBe(false);
  });
});

describe('banker revert', () => {
  it('reverts one specific purchase with a compensating entry, exactly once', async () => {
    const host = await user('banker');
    const alice = await user('al');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(host.token),
        payload: { name: 'Revert Test', sb: 10, bb: 20 },
      })
    ).json();
    await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms/join',
      headers: auth(alice.token),
      payload: { joinCode: room.joinCode },
    });
    // alice buys twice by mistake
    for (let i = 0; i < 2; i++) {
      const req = (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/rooms/${room.id}/buy`,
          headers: auth(alice.token),
          payload: { amount: 500 },
        })
      ).json();
      await ctx.app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/approve`,
        headers: auth(host.token),
        payload: { requestId: req.id, approve: true },
      });
    }
    let state = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}`, headers: auth(alice.token) })
    ).json();
    expect(state.players.find((p: any) => p.username === 'al').stack).toBe(1000);

    const ledger = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}/ledger`, headers: auth(host.token) })
    ).json();
    const purchase = ledger.entries.find((e: any) => e.kind === 'purchase');

    // only the banker may revert
    const notBanker = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/revert`,
      headers: auth(alice.token),
      payload: { entryId: purchase.id },
    });
    expect(notBanker.statusCode).toBe(403);

    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/revert`,
      headers: auth(host.token),
      payload: { entryId: purchase.id },
    });
    expect(ok.statusCode).toBe(200);

    state = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}`, headers: auth(alice.token) })
    ).json();
    expect(state.players.find((p: any) => p.username === 'al').stack).toBe(500);

    // the chain still verifies and the same purchase cannot be reverted twice
    expect(verifyLedger(ctx.db, room.id).ok).toBe(true);
    const twice = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/revert`,
      headers: auth(host.token),
      payload: { entryId: purchase.id },
    });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().error).toContain('already reverted');
  });
});

describe('backup banker', () => {
  it('a co-banker can approve buys and revert purchases; only the banker appoints one', async () => {
    const host = await user('mainbank');
    const alice = await user('cobank');
    const bob = await user('buyer');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(host.token),
        payload: { name: 'CoBank', sb: 10, bb: 20 },
      })
    ).json();
    for (const u of [alice, bob]) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms/join',
        headers: auth(u.token),
        payload: { joinCode: room.joinCode },
      });
    }

    // only the main banker can appoint
    const sneaky = await ctx.app.inject({
      method: 'PUT',
      url: `/api/rooms/${room.id}/co-banker`,
      headers: auth(alice.token),
      payload: { userId: alice.userId },
    });
    expect(sneaky.statusCode).toBe(403);
    const appoint = await ctx.app.inject({
      method: 'PUT',
      url: `/api/rooms/${room.id}/co-banker`,
      headers: auth(host.token),
      payload: { userId: alice.userId },
    });
    expect(appoint.statusCode).toBe(200);

    // co-banker approves a buy while the main banker is away
    const buyReq = (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/buy`,
        headers: auth(bob.token),
        payload: { amount: 700 },
      })
    ).json();
    const approved = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/approve`,
      headers: auth(alice.token),
      payload: { requestId: buyReq.id, approve: true },
    });
    expect(approved.statusCode).toBe(200);
    let state = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}`, headers: auth(bob.token) })
    ).json();
    expect(state.players.find((p: any) => p.username === 'buyer').stack).toBe(700);
    expect(state.coBankerId).toBe(alice.userId);

    // and can revert it too
    const ledger = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}/ledger`, headers: auth(alice.token) })
    ).json();
    const purchase = ledger.entries.find((e: any) => e.kind === 'purchase');
    const reverted = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/revert`,
      headers: auth(alice.token),
      payload: { entryId: purchase.id },
    });
    expect(reverted.statusCode).toBe(200);
    state = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}`, headers: auth(bob.token) })
    ).json();
    expect(state.players.find((p: any) => p.username === 'buyer').stack).toBe(0);
    expect(verifyLedger(ctx.db, room.id).ok).toBe(true);
  });
});

describe('seven-deuce rule', () => {
  it('recognizes exactly 7-2 offsuit', () => {
    const h = (a: string, b: string) => [cardFromName(a), cardFromName(b)];
    expect(isSevenDeuce(h('7c', '2d'))).toBe(true);
    expect(isSevenDeuce(h('2s', '7h'))).toBe(true);
    expect(isSevenDeuce(h('7c', '2c'))).toBe(false); // suited does not count
    expect(isSevenDeuce(h('7c', '3d'))).toBe(false);
    expect(isSevenDeuce(h('Ac', '2d'))).toBe(false);
  });

  it('the banker can set the bounty and it lands in room state', async () => {
    const host = await user('bounty_host');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(host.token),
        payload: { name: 'Bounty', sb: 10, bb: 20 },
      })
    ).json();
    const set = await ctx.app.inject({
      method: 'PUT',
      url: `/api/rooms/${room.id}/settings`,
      headers: auth(host.token),
      payload: { sevenDeuceBonus: 50 },
    });
    expect(set.statusCode).toBe(200);
    const state = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}`, headers: auth(host.token) })
    ).json();
    expect(state.sevenDeuceBonus).toBe(50);
  });
});

describe('private mode', () => {
  it('hides winnings from other players but not from the banker', async () => {
    const host = await user('pm_host');
    const alice = await user('pm_alice');
    const bob = await user('pm_bob');
    const room = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth(host.token),
        payload: { name: 'Private', sb: 10, bb: 20 },
      })
    ).json();
    for (const u of [alice, bob]) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms/join',
        headers: auth(u.token),
        payload: { joinCode: room.joinCode },
      });
    }
    // alice buys 500 and turns on private mode
    const buyReq = (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/buy`,
        headers: auth(alice.token),
        payload: { amount: 500 },
      })
    ).json();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/approve`,
      headers: auth(host.token),
      payload: { requestId: buyReq.id, approve: true },
    });
    await ctx.app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: auth(alice.token),
      payload: { privateMode: true },
    });

    // room state masks her buy-in for everyone
    const state = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}`, headers: auth(bob.token) })
    ).json();
    const aliceRow = state.players.find((p: any) => p.username === 'pm_alice');
    expect(aliceRow.privateStats).toBe(true);
    expect(aliceRow.totalBought).toBe(0);

    // session report: masked for bob, visible for the banker
    const asBob = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}/session`, headers: auth(bob.token) })
    ).json();
    const bobView = asBob.players.find((p: any) => p.username === 'pm_alice');
    expect(bobView.hidden).toBe(true);
    expect(bobView.bought).toBe(0);
    const asBanker = (
      await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}/session`, headers: auth(host.token) })
    ).json();
    const bankerView = asBanker.players.find((p: any) => p.username === 'pm_alice');
    expect(bankerView.hidden).toBe(false);
    expect(bankerView.bought).toBe(500);
  });
});
