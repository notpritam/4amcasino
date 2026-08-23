import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '@4am/shared';
import {
  GROUP_ORDER,
  cardPoint,
  invScalar,
  mulPoint,
  pointFromHex,
  pointHex,
  randScalar,
} from '../src/group.js';

describe('group ops', () => {
  it('scalars are in range and invertible', () => {
    for (let i = 0; i < 20; i++) {
      const k = randScalar();
      expect(k > 0n && k < GROUP_ORDER).toBe(true);
      expect((k * invScalar(k)) % GROUP_ORDER).toBe(1n);
    }
  });
  it('masking commutes: k1*(k2*P) == k2*(k1*P)', () => {
    const P = cardPoint(0);
    const k1 = randScalar(),
      k2 = randScalar();
    expect(pointHex(mulPoint(mulPoint(P, k1), k2))).toBe(pointHex(mulPoint(mulPoint(P, k2), k1)));
  });
  it('unmasking recovers the point', () => {
    const P = cardPoint(17);
    const k = randScalar();
    expect(pointHex(mulPoint(mulPoint(P, k), invScalar(k)))).toBe(pointHex(P));
  });
  it('52 card points are distinct, deterministic, and hex round-trips', () => {
    const hexes = ALL_CARDS.map((id) => pointHex(cardPoint(id)));
    expect(new Set(hexes).size).toBe(52);
    expect(ALL_CARDS.map((id) => pointHex(cardPoint(id)))).toEqual(hexes); // deterministic
    expect(pointHex(pointFromHex(hexes[3]!))).toBe(hexes[3]);
  });
});
