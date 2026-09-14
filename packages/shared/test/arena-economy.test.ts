import { describe, expect, it } from 'vitest';
import { actArena, arenaView, createArenaRound, type ArenaRound } from '../src/arena.js';
import { cardFromName } from '../src/cards.js';

const config = { playerIds: [10, 20, 30], stack: 2000, sb: 10, bb: 20, handNumber: 1 };
const deck = Array.from({ length: 52 }, (_, i) => i);
const commission = { bankerBps: 1000, houseBps: 1000, prizeBps: 1000 };
function tieDeck(players = 3) {
  const holes = '2c 3d 4c 5d 6c 7d'
    .split(' ')
    .slice(0, players * 2)
    .map(cardFromName);
  const board = 'Ts Js Qs Ks As'.split(' ').map(cardFromName);
  const prefix = [...holes, ...board];
  return [...prefix, ...deck.filter((card) => !prefix.includes(card))];
}
function finish(round: ArenaRound, allIn = false): ArenaRound {
  for (let steps = 0; !round.result && steps < 100; steps++) {
    const actor = arenaView(round, round.playerIds[round.betting.toAct!]!);
    const legal = actor.legalActions!;
    expect(legal).not.toBeNull();
    round = actArena(
      round,
      actor.toActUserId!,
      allIn && legal.canRaise
        ? { type: round.betting.currentBet ? 'raise' : 'bet', amount: legal.maxRaiseTo }
        : { type: legal.canCheck ? 'check' : 'call' },
    );
  }
  expect(round.result).not.toBeNull();
  return round;
}
function winnings(round: ArenaRound) {
  return [...round.result!.net].sort((a, b) => a.userId - b.userId);
}
function expectConservation(round: ArenaRound) {
  const { fees, net } = round.result!;
  const removed = fees ? fees.banker + fees.house + fees.prize : 0;
  expect(net.reduce((sum, p) => sum + p.net, 0) + removed).toBe(0);
  const initial = round.stacks ?? round.playerIds.map(() => round.stack);
  expect(net.reduce((sum, p) => sum + p.endStack!, 0) + removed).toBe(
    initial.reduce((sum, stack) => sum + stack, 0),
  );
  expect(net.reduce((sum, p) => sum + p.grossWon!, 0)).toBe(
    round.betting.seats.reduce((sum, p) => sum + p.total, 0),
  );
}

describe('persistent arena stacks', () => {
  it('assigns stacks by player ID order and preserves an explicit button after elimination', () => {
    const stacks = [70, 400, 9_000_000];
    const round = createArenaRound({ ...config, stacks, buttonUserId: 30 }, deck);
    expect(round.betting.buttonSeat).toBe(2);
    expect(round.betting.seats.map((s) => [round.playerIds[s.seat], s.stack + s.total])).toEqual([
      [10, 70],
      [20, 400],
      [30, 9_000_000],
    ]);
    stacks[0] = 999;
    expect(round.stacks).toEqual([70, 400, 9_000_000]);
    const next = createArenaRound(
      { ...config, playerIds: [10, 30], stacks: [300, 500], buttonUserId: 30, handNumber: 8 },
      deck,
    );
    expect(next.betting.buttonSeat).toBe(1);
    expect(next.betting.seats[0]).toMatchObject({ seat: 1, committed: 10 });
    expect(next.betting.toAct).toBe(1);
  });

  it.each(
    [
      [1, 2],
      [0, 20, 30],
      [1.5, 20, 30],
      [-1, 20, 30],
      [9_000_001, 20, 30],
      [NaN, 20, 30],
      [Infinity, 20, 30],
    ].map((stacks) => ({ stacks })),
  )('rejects invalid persistent stacks $stacks', ({ stacks }) => {
    expect(() => createArenaRound({ ...config, stacks }, deck)).toThrow(
      'invalid arena configuration',
    );
  });

  it('rejects a button outside the remaining table', () => {
    expect(() => createArenaRound({ ...config, buttonUserId: 999 }, deck)).toThrow(
      'invalid arena configuration',
    );
  });

  it.each(
    [
      [5, 7],
      [5, 100],
      [100, 7],
    ].map((stacks) => ({ stacks })),
  )('runs out short blinds without a player decision: $stacks', ({ stacks }) => {
    const round = createArenaRound(
      { ...config, playerIds: [10, 20], stacks, commission },
      tieDeck(2),
    );
    expect(round.result).not.toBeNull();
    expect(round.actionSeq).toBe(0);
    expect(round.betting.toAct).toBeNull();
    expect(round.result!.board).toHaveLength(5);
    expectConservation(round);
    expect(() => actArena(round, 10, { type: 'fold' })).toThrow('hand completed');
  });

  it('retains a real call decision when a short big blind exceeds the small blind', () => {
    let round = createArenaRound({ ...config, playerIds: [10, 20], stacks: [100, 15] }, tieDeck(2));
    expect(round.result).toBeNull();
    expect(arenaView(round, 10).legalActions!.callAmount).toBe(5);
    expect(arenaView(round, 10).legalActions!.canRaise).toBe(false);
    expect(() => actArena(round, 10, { type: 'raise', amount: 100 })).toThrow(
      'no opponent can call',
    );
    round = actArena(round, 10, { type: 'call' });
    expect(round.result!.board).toHaveLength(5);
    expect(winnings(round)).toEqual([
      { userId: 10, net: 0, won: 15, grossWon: 15, endStack: 100 },
      { userId: 20, net: 0, won: 15, grossWon: 15, endStack: 15 },
    ]);
    expectConservation(round);
  });
});

describe('arena commission settlement', () => {
  it.each([
    { bankerBps: -1, houseBps: 0, prizeBps: 0 },
    { bankerBps: 1001, houseBps: 0, prizeBps: 0 },
    { bankerBps: 0, houseBps: 0.5, prizeBps: 0 },
    { bankerBps: 0, houseBps: 0, prizeBps: NaN },
  ])('rejects invalid rates %j', (commission) => {
    expect(() => createArenaRound({ ...config, commission }, deck)).toThrow(
      'invalid arena configuration',
    );
  });

  it('charges each contested side pot and returns uncalled excess in full', () => {
    const round = finish(
      createArenaRound(
        { ...config, stacks: [101, 202, 303], buttonUserId: 30, commission },
        tieDeck(),
      ),
      true,
    );
    expect(round.result!.fees).toEqual({ banker: 50, house: 50, prize: 50, contested: 505 });
    expect(winnings(round)).toEqual([
      { userId: 10, net: -30, won: 71, grossWon: 101, endStack: 71 },
      { userId: 20, net: -60, won: 142, grossWon: 202, endStack: 142 },
      { userId: 30, net: -60, won: 243, grossWon: 303, endStack: 243 },
    ]);
    expectConservation(round);
  });

  it('floors commission per pot and awards post-fee odd chips left of the button', () => {
    const round = finish(
      createArenaRound(
        {
          ...config,
          stacks: [101, 202, 303],
          buttonUserId: 30,
          commission: { bankerBps: 50, houseBps: 0, prizeBps: 0 },
        },
        tieDeck(),
      ),
      true,
    );
    expect(round.result!.fees).toEqual({ banker: 2, house: 0, prize: 0, contested: 505 });
    expect(winnings(round).map((p) => p.won)).toEqual([101, 202, 301]);
    expectConservation(round);
  });

  it('awards separate side pots only to their eligible winning hands', () => {
    const prefix = 'Ac Kc Qc Ad Kd Qd 2c 4d 6h 8s Tc'.split(' ').map(cardFromName);
    const cards = [...prefix, ...deck.filter((card) => !prefix.includes(card))];
    const round = finish(
      createArenaRound({ ...config, stacks: [100, 200, 300], buttonUserId: 30, commission }, cards),
      true,
    );
    expect(round.result!.fees).toEqual({ banker: 50, house: 50, prize: 50, contested: 500 });
    expect(winnings(round)).toEqual([
      { userId: 10, net: 110, won: 210, grossWon: 300, endStack: 210 },
      { userId: 20, net: -60, won: 140, grossWon: 200, endStack: 140 },
      { userId: 30, net: -200, won: 100, grossWon: 100, endStack: 100 },
    ]);
    expectConservation(round);
  });

  it('exempts an uncalled raise even when folded contributors merge into one pot', () => {
    let round = createArenaRound({ ...config, commission }, deck);
    round = actArena(round, 10, { type: 'raise', amount: 1000 });
    round = actArena(round, 20, { type: 'fold' });
    round = actArena(round, 30, { type: 'fold' });
    expect(round.result!.fees).toEqual({ banker: 5, house: 5, prize: 5, contested: 50 });
    expect(winnings(round)[0]).toEqual({
      userId: 10,
      net: 15,
      won: 1015,
      grossWon: 1030,
      endStack: 2015,
    });
    expectConservation(round);
  });

  it('keeps the zero-rate opt-in chip-neutral and snapshots mutable rates', () => {
    const rates = { bankerBps: 0, houseBps: 0, prizeBps: 0 };
    let round = createArenaRound({ ...config, commission: rates }, tieDeck());
    rates.bankerBps = 1000;
    round = finish(round);
    expect(round.result!.fees).toEqual({ banker: 0, house: 0, prize: 0, contested: 60 });
    expect(winnings(round).map((p) => p.net)).toEqual([0, 0, 0]);
    expectConservation(round);
  });
});

describe('completed arena disclosure and compatibility', () => {
  it('reveals folded cards only after completion and never exposes the future deck', () => {
    let round = createArenaRound({ ...config, revealAllAfterHand: true }, deck);
    round = actArena(round, 10, { type: 'fold' });
    for (const userId of [null, 999, 20]) {
      const view = arenaView(round, userId);
      expect(view.result).toBeNull();
      expect(view).not.toHaveProperty('holes');
      expect(view).not.toHaveProperty('deck');
      expect(view.board).toEqual([]);
      expect(view.myCards).toEqual(userId === 20 ? round.holes[1] : []);
    }
    round = actArena(round, 20, { type: 'fold' });
    expect(arenaView(round, null).result!.revealed).toHaveLength(3);
    expect(round.result!.revealed.find((p) => p.userId === 10)!.cards).toEqual(round.holes[0]);
    expect(arenaView(round, null).board).toEqual([]);
    expect(arenaView(round, null)).not.toHaveProperty('deck');
    expect(arenaView(round, null)).not.toHaveProperty('holes');
  });

  it('preserves the exact legacy serialized settlement when options are absent', () => {
    let round = createArenaRound(config, deck);
    while (!round.result)
      round = actArena(round, round.playerIds[round.betting.toAct!]!, { type: 'fold' });
    expect(JSON.stringify(round.result)).toBe(
      '{"handNumber":1,"board":[],"net":[{"userId":20,"net":-10,"won":0},{"userId":30,"net":10,"won":30},{"userId":10,"net":0,"won":0}],"revealed":[]}',
    );
  });
});
