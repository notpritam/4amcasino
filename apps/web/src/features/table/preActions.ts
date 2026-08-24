import type { BettingState } from '@4am/shared';
import { useStore } from '../../shared/store.ts';
import { fmt } from '../../shared/lib/cn.ts';

/** Ahead-of-turn actions that track the live table (requested by notpritam,
 *  see docs/FEATURES.md). The options change with what you are facing:
 *  no bet -> Check / Fold, Check, Call any; facing a bet -> Fold, Call at
 *  today's price, Call any. A price-armed Call remembers the amount it was
 *  armed at and gameClient disarms it if a raise makes the hand dearer. */
export type PreActionKey = 'check-fold' | 'check' | 'call' | 'call-any';

export function myToCall(st: BettingState, mySeat: number): number {
  const me = st.seats.find((s) => s.seat === mySeat);
  if (!me) return 0;
  return Math.min(Math.max(0, st.currentBet - me.committed), me.stack);
}

export function preActionOptions(
  st: BettingState,
  mySeat: number,
): { key: PreActionKey; label: string }[] {
  const toCall = myToCall(st, mySeat);
  if (toCall > 0)
    return [
      { key: 'check-fold', label: 'Fold' },
      { key: 'call', label: `Call ${fmt(toCall)}` },
      { key: 'call-any', label: 'Call any' },
    ];
  return [
    { key: 'check-fold', label: 'Check / Fold' },
    { key: 'check', label: 'Check' },
    { key: 'call-any', label: 'Call any' },
  ];
}

/** Arm (or disarm, when tapped again) an ahead-of-turn action. A 'call'
 *  selection is armed at the current price so it can never pay more. */
export function togglePreAction(key: PreActionKey, st: BettingState, mySeat: number): void {
  const { hand, patchHand } = useStore.getState();
  if (hand.preAction === key) {
    patchHand({ preAction: null, preActionCallAt: null });
    return;
  }
  patchHand({ preAction: key, preActionCallAt: key === 'call' ? myToCall(st, mySeat) : null });
}
