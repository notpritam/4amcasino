import { describe, expect, it } from 'vitest';
import { ALL_CARDS, cardFromName, cardName, rankOf, suitOf } from '../src/cards.js';

describe('card codec', () => {
  it('round-trips all 52 cards through names', () => {
    const names = ALL_CARDS.map(cardName);
    expect(new Set(names).size).toBe(52);
    for (const id of ALL_CARDS) expect(cardFromName(cardName(id))).toBe(id);
  });
  it('maps known cards', () => {
    expect(cardName(0)).toBe('2c');
    expect(cardName(51)).toBe('As');
    expect(cardFromName('Td')).toBe(8 * 4 + 1);
    expect(rankOf(cardFromName('As'))).toBe(12);
    expect(suitOf(cardFromName('Ah'))).toBe(2);
  });
  it('rejects invalid names', () => {
    expect(() => cardFromName('Xz')).toThrow();
    expect(() => cardFromName('A')).toThrow();
  });
});
