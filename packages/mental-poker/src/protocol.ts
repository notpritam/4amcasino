import { ALL_CARDS, type CardId } from '@4am/shared';
import { randomBytes } from '@noble/hashes/utils';
import { type Point, cardPoint, invScalar, mulPoint, pointHex } from './group.js';

export function initialDeck(): Point[] {
  return ALL_CARDS.map(cardPoint);
}

export function randomPerm(n: number): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    // rejection sampling for unbiased index in [0, i]
    let j: number;
    do {
      const b = randomBytes(4);
      j = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
    } while (j >= Math.floor(0xffffffff / (i + 1)) * (i + 1));
    j %= i + 1;
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return p;
}

export function maskAndShuffle(deck: Point[], k: bigint, perm: number[]): Point[] {
  if (perm.length !== deck.length) throw new Error('perm/deck length mismatch');
  return perm.map((i) => mulPoint(deck[i]!, k));
}

export function unmaskShare(P: Point, k: bigint): Point {
  return mulPoint(P, invScalar(k));
}

export function cardLookup(): Map<string, CardId> {
  const m = new Map<string, CardId>();
  for (const id of ALL_CARDS) m.set(pointHex(cardPoint(id)), id);
  return m;
}

export function recoverCard(P: Point, lookup: Map<string, CardId>): CardId | null {
  return lookup.get(pointHex(P)) ?? null;
}
