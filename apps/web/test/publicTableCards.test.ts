import { describe, expect, it } from 'vitest';
import { publicCardsBySeat } from '../src/pages/table3d/publicTableCards.ts';

describe('public 3D cards', () => {
  it('never promotes private cards or paid peeks into the public display', () => {
    const hand = { shown: {}, showdown: null, myCards: [0, 1], peekResults: { 2: [8, 9] } };
    expect(publicCardsBySeat(hand)).toEqual({});
  });

  it('keeps voluntarily shown cards, including folded hands, and prefers showdown reveals', () => {
    const hand = {
      shown: { 1: [2, 3], 4: [10, 11] },
      showdown: { reveals: [{ seat: 1, cards: [6, 7] }] },
    };
    expect(publicCardsBySeat(hand)).toEqual({ 1: [6, 7], 4: [10, 11] });
    expect(hand.shown[1]).toEqual([2, 3]);
  });
});
