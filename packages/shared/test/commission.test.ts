import { describe, expect, it } from 'vitest';
import {
  commissionForPot,
  commissionRateLabel,
  NEW_ROOM_COMMISSION_BPS,
  LEGACY_ROOM_COMMISSION_BPS,
} from '../src/commission.js';

describe('platform commission', () => {
  it.each([
    [0, 0],
    [100, 0],
    [199, 0],
    [200, 1],
    [1999, 9],
    [2000, 10],
    [10_000, 50],
  ])('deducts %i chips at 0.5% as %i whole chips', (pot, expected) => {
    expect(commissionForPot(pot, NEW_ROOM_COMMISSION_BPS)).toBe(expected);
  });

  it('floors the main pot and side pot separately', () => {
    const pots = [1999, 999];
    expect(
      pots.reduce((sum, amount) => sum + commissionForPot(amount, NEW_ROOM_COMMISSION_BPS), 0),
    ).toBe(13);
  });

  it('preserves the original rate and labels for legacy rooms and older servers', () => {
    expect(commissionForPot(2000, LEGACY_ROOM_COMMISSION_BPS)).toBe(20);
    expect(commissionRateLabel(NEW_ROOM_COMMISSION_BPS)).toBe('0.5%');
    expect(commissionRateLabel(LEGACY_ROOM_COMMISSION_BPS)).toBe('1%');
    expect(commissionRateLabel()).toBe('1%');
  });
});
