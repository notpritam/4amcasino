import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  pokerBindingFromEvent,
  POKER_HOTKEY_ACTIONS,
  type PokerHotkeyAction,
  type PlayerAction,
} from '@4am/shared';
import { useStore } from '../../shared/store.ts';
import {
  hotkeyIntent,
  mayUsePokerHotkeys,
  pokerOverlayOpen,
  pokerTypingTarget,
} from './pokerHotkeys.ts';

/** One keyboard path for desktop, phone and 3D controls. Hidden layouts never act. */
export function usePokerHotkeys({
  mySeat,
  myTurn,
  pending,
  settling,
  raiseTo,
  onAmount,
  send,
  onConfirm,
  rootRef,
  amountRef,
}: {
  mySeat: number | null;
  myTurn: boolean;
  pending: boolean;
  settling: boolean;
  raiseTo: number;
  onAmount: (amount: number) => void;
  send: (action: PlayerAction) => void;
  onConfirm: () => void;
  rootRef: RefObject<HTMLDivElement>;
  amountRef: RefObject<HTMLInputElement>;
}) {
  const hand = useStore((s) => s.hand),
    hotkeys = useStore((s) => s.prefs.pokerHotkeys),
    owner = useStore((s) => s.pokerHotkeysFor),
    userId = useStore((s) => s.auth.userId),
    connected = useStore((s) => s.wsConnected);
  const enabled = hotkeys.enabled && owner === userId && userId !== null;
  const turnKey = JSON.stringify([hand.handId, hand.actionSeq]);
  const sizingAt = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ turnKey: string } | null>(null);
  useEffect(() => {
    sizingAt.current = null;
    if (document.activeElement === amountRef.current) amountRef.current?.blur();
  }, [turnKey, amountRef]);
  useEffect(() => {
    if (focusRequest?.turnKey === turnKey) {
      amountRef.current?.focus();
      amountRef.current?.select();
    }
  }, [focusRequest, turnKey, amountRef]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = pokerBindingFromEvent(event);
      if (!key) return;
      const action = POKER_HOTKEY_ACTIONS.find((name) => hotkeys.bindings[name] === key);
      if (!action) return;
      const root = rootRef.current;
      const blocked =
        !root ||
        !root.getClientRects().length ||
        !!root.closest('[inert],[aria-hidden="true"]') ||
        document.hidden ||
        pokerTypingTarget(event.target) ||
        pokerTypingTarget(document.activeElement) ||
        pokerOverlayOpen();
      if (!mayUsePokerHotkeys({ enabled, connected, myTurn, pending, settling, blocked })) return;
      const intent = hotkeyIntent(action, hand.betting, mySeat, raiseTo);
      if (!intent) return;
      event.preventDefault();
      if (intent.kind === 'send') send(intent.action);
      else {
        onAmount(intent.amount);
        setFocusRequest({ turnKey });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    hotkeys,
    enabled,
    connected,
    myTurn,
    pending,
    settling,
    hand.betting,
    mySeat,
    raiseTo,
    turnKey,
    rootRef,
    onAmount,
    send,
  ]);
  return {
    binding: (action: PokerHotkeyAction) =>
      enabled ? (hotkeys.bindings[action] ?? undefined) : undefined,
    amountInput: {
      onFocus: () => {
        sizingAt.current = turnKey;
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          sizingAt.current = null;
          event.currentTarget.blur();
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (
            !event.repeat &&
            !event.nativeEvent.isComposing &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.shiftKey &&
            sizingAt.current === turnKey &&
            document.activeElement === amountRef.current &&
            !document.hidden &&
            !pokerOverlayOpen()
          )
            onConfirm();
        }
      },
    },
  };
}
