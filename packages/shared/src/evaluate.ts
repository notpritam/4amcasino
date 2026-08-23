import { type CardId, rankOf, suitOf } from './cards.js';

export const HAND_CATEGORY_NAMES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
] as const;

export function handCategory(score: number): number {
  return score >> 20;
}

function pack(category: number, tiebreaks: number[]): number {
  let s = category << 20;
  for (let i = 0; i < 5; i++) s |= (tiebreaks[i] ?? 0) << (16 - 4 * i);
  return s;
}

/** Returns the high-card rank index of a straight in `ranks` (unique, sorted desc), or -1. */
function straightHigh(ranks: number[]): number {
  const withWheelAce = ranks.includes(12) ? [...ranks, -1] : ranks; // ace also plays low
  let run = 1;
  for (let i = 1; i < withWheelAce.length; i++) {
    if (withWheelAce[i]! === withWheelAce[i - 1]! - 1) {
      run++;
      if (run >= 5) return withWheelAce[i]! + 4;
    } else run = 1;
  }
  return -1;
}

export function evaluate5(cards: CardId[]): number {
  if (cards.length !== 5) throw new Error('evaluate5 needs exactly 5 cards');
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const isFlush = new Set(cards.map(suitOf)).size === 1;
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // group ranks by count desc, then rank desc
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const uniq = [...new Set(ranks)];
  const sHigh = uniq.length === 5 ? straightHigh(uniq) : -1;

  if (isFlush && sHigh >= 0) return pack(8, [sHigh]);
  if (groups[0]![1] === 4) return pack(7, [groups[0]![0], groups[1]![0]]);
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return pack(6, [groups[0]![0], groups[1]![0]]);
  if (isFlush) return pack(5, ranks);
  if (sHigh >= 0) return pack(4, [sHigh]);
  if (groups[0]![1] === 3) return pack(3, [groups[0]![0], groups[1]![0], groups[2]![0]]);
  if (groups[0]![1] === 2 && groups[1]![1] === 2)
    return pack(2, [groups[0]![0], groups[1]![0], groups[2]![0]]);
  if (groups[0]![1] === 2)
    return pack(1, [groups[0]![0], groups[1]![0], groups[2]![0], groups[3]![0]]);
  return pack(0, ranks);
}

const RANK_NAMES = [
  'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace',
] as const;

function pluralRank(rank: number): string {
  const name = RANK_NAMES[rank]!;
  return name === 'Six' ? 'Sixes' : `${name}s`;
}

function tiebreak(score: number, i: number): number {
  return (score >> (16 - 4 * i)) & 0xf;
}

/** Human explanation of a hand score, e.g. "a Full House, Queens full of Nines". */
export function describeScore(score: number): string {
  const t0 = tiebreak(score, 0);
  const t1 = tiebreak(score, 1);
  switch (handCategory(score)) {
    case 8:
      return t0 === 12 ? 'a Royal Flush' : `a Straight Flush, ${RANK_NAMES[t0]} high`;
    case 7:
      return `Four ${pluralRank(t0)}`;
    case 6:
      return `a Full House, ${pluralRank(t0)} full of ${pluralRank(t1)}`;
    case 5:
      return `a Flush, ${RANK_NAMES[t0]} high`;
    case 4:
      return `a Straight, ${RANK_NAMES[t0]} high`;
    case 3:
      return `Three ${pluralRank(t0)}`;
    case 2:
      return `Two Pair, ${pluralRank(t0)} and ${pluralRank(t1)}`;
    case 1:
      return `a Pair of ${pluralRank(t0)}`;
    default:
      return `${RANK_NAMES[t0]} high`;
  }
}

/** The five cards (of seven) that make the best hand — for showing WHY a hand won. */
export function bestFive(cards: CardId[]): CardId[] {
  if (cards.length !== 7) throw new Error('bestFive needs exactly 7 cards');
  let best = -1;
  let pick: CardId[] = [];
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++) {
      const five = cards.filter((_, i) => i !== a && i !== b);
      const s = evaluate5(five);
      if (s > best) {
        best = s;
        pick = five;
      }
    }
  return pick;
}

export function evaluate7(cards: CardId[]): number {
  if (cards.length !== 7) throw new Error('evaluate7 needs exactly 7 cards');
  let best = 0;
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++) {
      const five = cards.filter((_, i) => i !== a && i !== b);
      const s = evaluate5(five);
      if (s > best) best = s;
    }
  return best;
}
