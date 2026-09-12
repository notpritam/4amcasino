import { describe, expect, it } from 'vitest';
import { createArenaRound, actArena, arenaView } from '../src/arena.js';

const deck = Array.from({ length: 52 }, (_, i) => i);
const config = { playerIds: [10, 20, 30], stack: 2000, sb: 10, bb: 20, handNumber: 1 };
describe('fixed-hand arena', () => {
  it('reveals only the requesting seat and public board', () => {
    const round = createArenaRound(config, deck);
    expect(arenaView(round, 10).myCards).toHaveLength(2);
    expect(arenaView(round, 999).myCards).toEqual([]);
    expect(arenaView(round, 10)).not.toHaveProperty('deck');
    expect(arenaView(round, 10)).not.toHaveProperty('holes');
    expect(arenaView(round, 10).board).toEqual([]);
  });
  it('rotates the button and resets equal stacks on each hand', () => {
    const first = createArenaRound(config, deck);
    const next = createArenaRound({ ...config, handNumber: 2 }, deck);
    expect(first.betting.buttonSeat).toBe(0);
    expect(next.betting.buttonSeat).toBe(1);
    expect(next.betting.seats.every((s) => s.stack + s.total === 2000)).toBe(true);
  });
  it('rejects duplicates, fractional amounts and stale/non-acting seats without mutation', () => {
    expect(() => createArenaRound(config, Array(52).fill(0))).toThrow();
    const round = createArenaRound(config, deck);
    const original = JSON.stringify(round);
    expect(() => actArena(round, 999, { type: 'fold' })).toThrow();
    const actor = round.playerIds[round.betting.toAct!]!;
    expect(() => actArena(round, actor, { type: 'raise', amount: 100.5 })).toThrow();
    expect(JSON.stringify(round)).toBe(original);
  });
  it('plays all streets and all-ins with zero-sum settlement and no hidden folded cards', () => {
    for (const allIn of [false, true]) {
      let round = createArenaRound(config, deck);
      for (let steps = 0; !round.result && steps < 100; steps++) {
        const view = arenaView(round, round.playerIds[round.betting.toAct!]!);
        const la = view.legalActions!;
        round = actArena(
          round,
          view.toActUserId!,
          allIn && la.canRaise
            ? { type: round.betting.currentBet ? 'raise' : 'bet', amount: la.maxRaiseTo }
            : { type: la.canCheck ? 'check' : 'call' },
        );
      }
      expect(round.result).not.toBeNull();
      expect(round.result!.net.reduce((sum, p) => sum + p.net, 0)).toBe(0);
      expect(round.result!.board).toHaveLength(5);
    }
    let round = createArenaRound(config, deck);
    while (!round.result)
      round = actArena(round, round.playerIds[round.betting.toAct!]!, { type: 'fold' });
    expect(round.result.net.reduce((sum, p) => sum + p.net, 0)).toBe(0);
    expect(round.result.revealed).toEqual([]);
  });
});
