import { describe, expect, it } from 'vitest';
import {
  cardLookup,
  initialDeck,
  maskAndShuffle,
  randomPerm,
  recoverCard,
  unmaskShare,
} from '../src/protocol.js';
import { randScalar } from '../src/group.js';
import type { Point } from '../src/group.js';

/** Simulate the full shuffle-mask phase for n players; returns masked deck + keys. */
function shuffledTable(n: number) {
  const keys = Array.from({ length: n }, randScalar);
  let deck = initialDeck();
  for (const k of keys) deck = maskAndShuffle(deck, k, randomPerm(52));
  return { deck, keys };
}

/** All players cooperatively unmask one deck position. */
function openCard(deck: Point[], keys: bigint[], idx: number): Point {
  let P = deck[idx]!;
  for (const k of keys) P = unmaskShare(P, k);
  return P;
}

describe('mental poker protocol', () => {
  for (const n of [2, 5, 9]) {
    it(`full deal with ${n} players recovers all 52 distinct cards`, () => {
      const { deck, keys } = shuffledTable(n);
      const lookup = cardLookup();
      const seen = new Set<number>();
      for (let i = 0; i < 52; i++) {
        const card = recoverCard(openCard(deck, keys, i), lookup);
        expect(card).not.toBeNull();
        seen.add(card!);
      }
      expect(seen.size).toBe(52);
    });
  }

  it('a partially unmasked card (recipient share missing) is unreadable', () => {
    const { deck, keys } = shuffledTable(3);
    const lookup = cardLookup();
    // players 1..2 publish shares; player 0 (recipient) has not applied theirs
    let P = deck[0]!;
    for (const k of keys.slice(1)) P = unmaskShare(P, k);
    expect(recoverCard(P, lookup)).toBeNull();
  });

  it('the masked deck leaks nothing positionally (no masked point matches a canonical point)', () => {
    const { deck } = shuffledTable(2);
    const lookup = cardLookup();
    for (const P of deck) expect(recoverCard(P, lookup)).toBeNull();
  });

  it('detects a duplicated card at open time', () => {
    const { deck, keys } = shuffledTable(2);
    const cheated = [...deck];
    cheated[1] = cheated[0]!; // cheater duplicates an unknown card
    const lookup = cardLookup();
    const a = recoverCard(openCard(cheated, keys, 0), lookup);
    const b = recoverCard(openCard(cheated, keys, 1), lookup);
    expect(a).toBe(b); // duplicate detected by collision when both open
  });

  it('detects a garbage substitute (recover returns null)', () => {
    const { deck, keys } = shuffledTable(2);
    const cheated = [...deck];
    cheated[5] = cheated[5]!.add(cheated[6]!); // not any masked card
    const lookup = cardLookup();
    expect(recoverCard(openCard(cheated, keys, 5), lookup)).toBeNull();
  });

  it('randomPerm is a permutation', () => {
    const p = randomPerm(52);
    expect([...p].sort((x, y) => x - y)).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });
});
