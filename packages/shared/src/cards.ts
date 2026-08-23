export type CardId = number; // 0..51
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['c', 'd', 'h', 's'] as const;
export const ALL_CARDS: readonly CardId[] = Array.from({ length: 52 }, (_, i) => i);

export function rankOf(id: CardId): number {
  return Math.floor(id / 4);
}
export function suitOf(id: CardId): number {
  return id % 4;
}

export function cardName(id: CardId): string {
  if (!Number.isInteger(id) || id < 0 || id > 51) throw new Error(`bad card id: ${id}`);
  return RANKS[rankOf(id)]! + SUITS[suitOf(id)]!;
}

export function cardFromName(name: string): CardId {
  if (name.length !== 2) throw new Error(`bad card name: ${name}`);
  const r = RANKS.indexOf(name[0] as (typeof RANKS)[number]);
  const s = SUITS.indexOf(name[1] as (typeof SUITS)[number]);
  if (r < 0 || s < 0) throw new Error(`bad card name: ${name}`);
  return r * 4 + s;
}
