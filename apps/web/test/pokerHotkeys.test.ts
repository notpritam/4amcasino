import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POKER_HOTKEYS,
  pokerBindingFromEvent,
  parsePokerHotkeys,
  startHand,
  applyAction,
} from '@4am/shared';
import {
  hotkeyIntent,
  mayUsePokerHotkeys,
  createActionLatch,
} from '../src/features/table/pokerHotkeys.ts';

const event = {
  key: 'f',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
};
const open = {
  enabled: true,
  connected: true,
  myTurn: true,
  pending: false,
  settling: false,
  blocked: false,
};
const betting = () =>
  startHand(
    [
      { seat: 0, stack: 1000 },
      { seat: 1, stack: 1000 },
    ],
    0,
    10,
    20,
  );

describe('poker shortcut safety and intent', () => {
  it('allows retry after a pending control unmounts without releasing its latch', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const latch = createActionLatch();
      expect(latch.claim('reconnect', 1)).toBe(true);
      clock.mockReturnValue(6999);
      expect(latch.claim('reconnect', 1)).toBe(false);
      clock.mockReturnValue(7000);
      expect(latch.claim('reconnect', 1)).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
  it('normalizes letters without confusing caps lock and shift, and rejects browser/repeated/composing keys', () => {
    expect(pokerBindingFromEvent(event)).toBe('F');
    expect(pokerBindingFromEvent({ ...event, key: 'F' })).toBe('F');
    expect(pokerBindingFromEvent({ ...event, key: 'Q', shiftKey: true })).toBe('Shift+Q');
    expect(pokerBindingFromEvent({ ...event, key: '#', code: 'Digit3', shiftKey: true })).toBe(
      'Shift+3',
    );
    for (const flag of [
      'ctrlKey',
      'metaKey',
      'altKey',
      'repeat',
      'isComposing',
      'defaultPrevented',
    ])
      expect(pokerBindingFromEvent({ ...event, [flag]: true })).toBeNull();
    for (const key of ['w', 'A', 'ArrowLeft', 'Enter', 'Tab', 'Dead', '💰'])
      expect(pokerBindingFromEvent({ ...event, key })).toBeNull();
  });
  it('keeps shifted bindings distinct while rejecting duplicates and allowing cleared keys', () => {
    expect(
      parsePokerHotkeys({
        ...DEFAULT_POKER_HOTKEYS,
        bindings: { ...DEFAULT_POKER_HOTKEYS.bindings, check: 'Shift+F', call: null },
      }),
    ).not.toBeNull();
    expect(
      parsePokerHotkeys({
        ...DEFAULT_POKER_HOTKEYS,
        bindings: { ...DEFAULT_POKER_HOTKEYS.bindings, check: 'F' },
      }),
    ).toBeNull();
  });
  it('only allows a connected live turn outside pending, settling and blocked UI', () => {
    expect(mayUsePokerHotkeys(open)).toBe(true);
    for (const flag of ['enabled', 'connected', 'myTurn'])
      expect(mayUsePokerHotkeys({ ...open, [flag]: false })).toBe(false);
    for (const flag of ['pending', 'settling', 'blocked'])
      expect(mayUsePokerHotkeys({ ...open, [flag]: true })).toBe(false);
  });
  it('never substitutes a call for a check or queues an out-of-turn action', () => {
    const st = betting();
    expect(hotkeyIntent('check', st, 0, 40)).toBeNull();
    expect(hotkeyIntent('call', st, 0, 40)).toEqual({ kind: 'send', action: { type: 'call' } });
    expect(hotkeyIntent('fold', st, 1, 40)).toBeNull();
    const checked = applyAction(st, 0, { type: 'call' });
    expect(hotkeyIntent('check', checked, 1, 40)).toEqual({
      kind: 'send',
      action: { type: 'check' },
    });
    expect(hotkeyIntent('call', checked, 1, 40)).toBeNull();
  });
  it('prepares raise, half-pot, pot and all-in amounts without sending a bet', () => {
    const st = betting();
    expect(hotkeyIntent('raise', st, 0, 60)).toEqual({ kind: 'size', amount: 60 });
    expect(hotkeyIntent('raise', st, 0, NaN)).toEqual({ kind: 'size', amount: 40 });
    expect(hotkeyIntent('halfPot', st, 0, 40)).toEqual({ kind: 'size', amount: 40 });
    expect(hotkeyIntent('pot', st, 0, 40)).toEqual({ kind: 'size', amount: 60 });
    expect(hotkeyIntent('allIn', st, 0, 40)).toEqual({ kind: 'size', amount: 1000 });
    st.seats[0]!.lastActedAt = st.lastFullRaiseAt;
    expect(hotkeyIntent('allIn', st, 0, 40)).toBeNull();
  });
  it('synchronously prevents duplicate sends but unlocks for a new turn or hand', () => {
    const latch = createActionLatch();
    expect(latch.claim('one', 1)).toBe(true);
    expect(latch.claim('one', 1)).toBe(false);
    expect(latch.claim('one', 2)).toBe(true);
    expect(latch.claim('two', 2)).toBe(true);
    latch.release('one', 2);
    expect(latch.claim('two', 2)).toBe(false);
    latch.release();
    expect(latch.claim('two', 2)).toBe(true);
  });
});
