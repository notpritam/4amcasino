import {
  legalActions,
  type BettingState,
  type PlayerAction,
  type PokerHotkeyAction,
} from '@4am/shared';

export function mayUsePokerHotkeys(state: {
  enabled: boolean;
  connected: boolean;
  myTurn: boolean;
  pending: boolean;
  settling: boolean;
  blocked: boolean;
}): boolean {
  return (
    state.enabled &&
    state.connected &&
    state.myTurn &&
    !state.pending &&
    !state.settling &&
    !state.blocked
  );
}

export function hotkeyIntent(
  action: PokerHotkeyAction,
  st: BettingState | null,
  mySeat: number | null,
  raiseTo: number,
): { kind: 'send'; action: PlayerAction } | { kind: 'size'; amount: number } | null {
  if (!st || mySeat === null) return null;
  const legal = legalActions(st);
  if (!legal || legal.seat !== mySeat) return null;
  if (action === 'fold') return { kind: 'send', action: { type: 'fold' } };
  if (action === 'check')
    return legal.canCheck ? { kind: 'send', action: { type: 'check' } } : null;
  if (action === 'call')
    return !legal.canCheck && legal.callAmount > 0
      ? { kind: 'send', action: { type: 'call' } }
      : null;
  if (!legal.canRaise) return null;
  let amount = raiseTo;
  if (action === 'allIn') amount = legal.maxRaiseTo;
  else if (action === 'halfPot' || action === 'pot') {
    const pot = st.seats.reduce((sum, seat) => sum + seat.total, 0);
    const target =
      st.currentBet + Math.round((pot + legal.callAmount) * (action === 'halfPot' ? 0.5 : 1));
    amount = Math.round(target / st.sb) * st.sb;
  }
  if (!Number.isFinite(amount)) amount = legal.minRaiseTo;
  return {
    kind: 'size',
    amount: Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(amount))),
  };
}

/** Synchronous: two key events can arrive before React commits pending state. */
export function createActionLatch() {
  let claimed: string | null = null;
  let claimedAt = 0;
  return {
    claim(handId: string, seq: number): boolean {
      const key = JSON.stringify([handId, seq]);
      // Also expire if its control unmounted and cancelled the UI retry timer.
      if (claimed === key && Date.now() - claimedAt < 6000) return false;
      claimed = key;
      claimedAt = Date.now();
      return true;
    },
    release(handId?: string, seq?: number): void {
      if (handId === undefined || claimed === JSON.stringify([handId, seq])) claimed = null;
    },
  };
}

// The phone and desktop controls coexist in the DOM. Resizing while an action
// is pending must not allow the newly visible controls to submit it twice.
export const pokerActionLatch = createActionLatch();

export function pokerOverlayOpen(): boolean {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="menu"], .lounge-panel, [data-poker-hotkeys-blocked]',
    ),
  ].some(
    (element) =>
      element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden',
  );
}

export function pokerTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    !!target.closest(
      'input, textarea, select, [role="textbox"], [role="combobox"], [role="slider"], [contenteditable="true"], [contenteditable=""]',
    )
  );
}
