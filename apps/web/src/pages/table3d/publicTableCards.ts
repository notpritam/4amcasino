import type { CardId } from '@4am/shared';

/** Only public reveals may appear on opponents or on the shared felt. */
export function publicCardsBySeat(hand: {
  shown: Record<number, CardId[]>;
  showdown: { reveals: { seat: number; cards: CardId[] }[] } | null;
}): Record<number, CardId[]> {
  return {
    ...hand.shown,
    ...Object.fromEntries((hand.showdown?.reveals ?? []).map((r) => [r.seat, r.cards])),
  };
}
