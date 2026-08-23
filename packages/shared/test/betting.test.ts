import { describe, expect, it } from 'vitest';
import {
  applyAction,
  legalActions,
  nextStreet,
  startHand,
  streetClosed,
  computePots,
  awardPots,
} from '../src/betting.js';

const seats3 = [
  { seat: 2, stack: 1000 },
  { seat: 5, stack: 800 },
  { seat: 7, stack: 50 },
]; // dealing order: SB=2, BB=5, button=7

describe('startHand', () => {
  it('posts blinds and sets first to act (3-handed)', () => {
    const st = startHand(seats3, 7, 10, 20);
    expect(st.seats[0]).toMatchObject({ seat: 2, committed: 10, stack: 990 });
    expect(st.seats[1]).toMatchObject({ seat: 5, committed: 20, stack: 780 });
    expect(st.currentBet).toBe(20);
    expect(st.toAct).toBe(7); // UTG = button in 3-handed
    expect(st.needToAct).toEqual([7, 2, 5]); // BB has the option
  });
  it('heads-up: button posts SB and acts first', () => {
    const st = startHand(
      [
        { seat: 1, stack: 500 },
        { seat: 3, stack: 500 },
      ],
      1,
      5,
      10,
    );
    expect(st.seats[0]).toMatchObject({ seat: 1, committed: 5 });
    expect(st.seats[1]).toMatchObject({ seat: 3, committed: 10 });
    expect(st.toAct).toBe(1);
  });
  it('short stack posts all-in blind', () => {
    const st = startHand(
      [
        { seat: 0, stack: 8 },
        { seat: 1, stack: 100 },
        { seat: 2, stack: 100 },
      ],
      2,
      10,
      20,
    );
    expect(st.seats[0]).toMatchObject({ seat: 0, committed: 8, stack: 0, allIn: true });
  });
});

const mk = () =>
  startHand(
    [
      { seat: 0, stack: 1000 },
      { seat: 1, stack: 1000 },
      { seat: 2, stack: 1000 },
    ],
    2,
    10,
    20,
  );

describe('preflop action', () => {
  it('call, call, check closes the street (BB option)', () => {
    let st = mk();
    st = applyAction(st, 2, { type: 'call' });
    st = applyAction(st, 0, { type: 'call' });
    expect(streetClosed(st)).toBe(false); // BB still has the option
    st = applyAction(st, 1, { type: 'check' });
    expect(streetClosed(st)).toBe(true);
  });
  it('raise reopens action', () => {
    let st = mk();
    st = applyAction(st, 2, { type: 'call' });
    st = applyAction(st, 0, { type: 'raise', amount: 60 });
    expect(st.currentBet).toBe(60);
    expect(st.needToAct).toEqual([1, 2]);
    const la = legalActions(st)!;
    expect(la).toMatchObject({ seat: 1, callAmount: 40, minRaiseTo: 100, canRaise: true });
  });
  it('rejects illegal moves', () => {
    const st = mk();
    expect(() => applyAction(st, 0, { type: 'call' })).toThrow(); // not their turn
    expect(() => applyAction(st, 2, { type: 'check' })).toThrow(); // facing a bet
    expect(() => applyAction(st, 2, { type: 'raise', amount: 30 })).toThrow(); // below min raise-to 40
  });
  it('fold to one player ends the hand', () => {
    let st = mk();
    st = applyAction(st, 2, { type: 'fold' });
    st = applyAction(st, 0, { type: 'fold' });
    expect(st.winnerByFold).toBe(1);
    expect(streetClosed(st)).toBe(true);
  });
});

describe('postflop', () => {
  const flop = () => {
    let st = mk();
    st = applyAction(st, 2, { type: 'call' });
    st = applyAction(st, 0, { type: 'call' });
    st = applyAction(st, 1, { type: 'check' });
    return nextStreet(st);
  };
  it('first to act is SB; checks around close the street', () => {
    let st = flop();
    expect(st.street).toBe('flop');
    expect(st.toAct).toBe(0);
    st = applyAction(st, 0, { type: 'check' });
    st = applyAction(st, 1, { type: 'check' });
    st = applyAction(st, 2, { type: 'check' });
    expect(streetClosed(st)).toBe(true);
  });
  it('heads-up: BB acts first postflop (button last)', () => {
    let st = startHand(
      [
        { seat: 4, stack: 500 },
        { seat: 6, stack: 500 },
      ],
      4,
      5,
      10,
    );
    st = applyAction(st, 4, { type: 'call' });
    st = applyAction(st, 6, { type: 'check' });
    st = nextStreet(st);
    expect(st.toAct).toBe(6); // BB first, button (seat 4) last
  });
  it('bet must be at least the big blind', () => {
    const st = flop();
    expect(() => applyAction(st, 0, { type: 'bet', amount: 5 })).toThrow();
    expect(applyAction(st, 0, { type: 'bet', amount: 20 }).currentBet).toBe(20);
  });
});

describe('incomplete all-in raise', () => {
  it('does not reopen raise rights', () => {
    // seat 1 has only 70: raise-to 70 over a 60 bet is incomplete (min would be 100)
    let st = startHand(
      [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 70 },
        { seat: 2, stack: 1000 },
      ],
      2,
      10,
      20,
    );
    st = applyAction(st, 2, { type: 'raise', amount: 60 });
    st = applyAction(st, 0, { type: 'call' });
    st = applyAction(st, 1, { type: 'raise', amount: 70 }); // all-in incomplete raise
    expect(st.currentBet).toBe(70);
    // seats 2 and 0 must respond but cannot re-raise
    const la2 = legalActions(st)!;
    expect(la2.seat).toBe(2);
    expect(la2.canRaise).toBe(false);
    st = applyAction(st, 2, { type: 'call' });
    const la0 = legalActions(st)!;
    expect(la0).toMatchObject({ seat: 0, canRaise: false, callAmount: 10 });
  });
});

const potSeat = (seat: number, total: number, folded = false) => ({
  seat,
  stack: 0,
  committed: 0,
  total,
  folded,
  allIn: false,
  lastActedAt: null,
});

describe('computePots', () => {
  it('single pot when everyone matched', () => {
    expect(computePots([potSeat(0, 100), potSeat(1, 100), potSeat(2, 100)])).toEqual([
      { amount: 300, eligible: [0, 1, 2] },
    ]);
  });
  it('side pots for two different all-ins', () => {
    expect(computePots([potSeat(0, 50), potSeat(1, 200), potSeat(2, 500), potSeat(3, 500)])).toEqual([
      { amount: 200, eligible: [0, 1, 2, 3] },
      { amount: 450, eligible: [1, 2, 3] },
      { amount: 600, eligible: [2, 3] },
    ]);
  });
  it('folded chips stay in the pot but folded seats are ineligible', () => {
    expect(computePots([potSeat(0, 100), potSeat(1, 100, true), potSeat(2, 100)])).toEqual([
      { amount: 300, eligible: [0, 2] },
    ]);
  });
});

describe('awardPots', () => {
  it('splits ties and gives odd chip to earliest in order', () => {
    const pots = [{ amount: 101, eligible: [0, 1] }];
    const scores = new Map([
      [0, 5000],
      [1, 5000],
    ]);
    expect(awardPots(pots, scores, [1, 0])).toEqual(
      new Map([
        [1, 51],
        [0, 50],
      ]),
    );
  });
  it('side pot goes to best eligible even if overall best is ineligible', () => {
    const pots = [
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 200, eligible: [1, 2] },
    ];
    const scores = new Map([
      [0, 9000],
      [1, 4000],
      [2, 3000],
    ]);
    expect(awardPots(pots, scores, [0, 1, 2])).toEqual(
      new Map([
        [0, 150],
        [1, 200],
      ]),
    );
  });
});
