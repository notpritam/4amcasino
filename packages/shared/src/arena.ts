import {
  applyAction,
  awardPots,
  computePots,
  legalActions,
  nextStreet,
  startHand,
  streetClosed,
  type BettingState,
  type PlayerAction,
} from './betting.js';
import { evaluate7 } from './evaluate.js';

export interface ArenaConfig {
  playerIds: number[];
  stack: number;
  sb: number;
  bb: number;
  handNumber: number;
}
export interface ArenaResult {
  handNumber: number;
  board: number[];
  net: { userId: number; net: number; won: number }[];
  revealed: { userId: number; cards: number[] }[];
}
/** Server-private state. Only arenaView may cross an API boundary. Requested by notpritam. */
export interface ArenaRound extends ArenaConfig {
  deck: number[];
  holes: number[][];
  betting: BettingState;
  actionSeq: number;
  result: ArenaResult | null;
}
export function createArenaRound(config: ArenaConfig, deck: readonly number[]): ArenaRound {
  const { playerIds, stack, sb, bb, handNumber } = config;
  if (
    playerIds.length < 2 ||
    playerIds.length > 9 ||
    new Set(playerIds).size !== playerIds.length ||
    ![stack, sb, bb, handNumber].every(Number.isSafeInteger) ||
    handNumber < 1 ||
    sb < 1 ||
    bb < sb ||
    stack < 2 * bb ||
    stack > 1_000_000
  )
    throw new Error('invalid arena configuration');
  if (
    deck.length !== 52 ||
    new Set(deck).size !== 52 ||
    !deck.every((c) => Number.isInteger(c) && c >= 0 && c < 52)
  )
    throw new Error('invalid deck');
  const button = (handNumber - 1) % playerIds.length;
  const smallBlind = playerIds.length === 2 ? button : (button + 1) % playerIds.length;
  const order = playerIds.map((_, i) => ({ seat: (smallBlind + i) % playerIds.length, stack }));
  // Deal two rounds around the table, starting at the small blind.
  const holes = playerIds.map(() => [] as number[]);
  for (let i = 0; i < playerIds.length * 2; i++)
    holes[(smallBlind + i) % playerIds.length]!.push(deck[i]!);
  return {
    ...config,
    playerIds: [...playerIds],
    deck: [...deck],
    holes,
    betting: startHand(order, button, sb, bb),
    actionSeq: 0,
    result: null,
  };
}
function boardFor(round: ArenaRound): number[] {
  const count = round.result
    ? round.result.board.length
    : { preflop: 0, flop: 3, turn: 4, river: 5 }[round.betting.street];
  return round.deck.slice(round.playerIds.length * 2, round.playerIds.length * 2 + count);
}
export function actArena(previous: ArenaRound, userId: number, action: PlayerAction): ArenaRound {
  if (previous.result) throw new Error('hand completed');
  if (!['fold', 'check', 'call', 'bet', 'raise'].includes(action.type))
    throw new Error('invalid action');
  if (action.amount !== undefined && (!Number.isSafeInteger(action.amount) || action.amount <= 0))
    throw new Error('invalid amount');
  const seat = previous.playerIds.indexOf(userId);
  const round: ArenaRound = {
    ...previous,
    betting: applyAction(previous.betting, seat, action),
    actionSeq: previous.actionSeq + 1,
  };
  while (
    streetClosed(round.betting) &&
    round.betting.winnerByFold === null &&
    round.betting.street !== 'river'
  )
    round.betting = nextStreet(round.betting);
  if (streetClosed(round.betting)) {
    const foldWinner = round.betting.winnerByFold;
    const board = boardFor(round);
    const scores = new Map<number, number>();
    for (const s of round.betting.seats)
      if (!s.folded)
        scores.set(
          s.seat,
          foldWinner !== null ? 1 : evaluate7([...round.holes[s.seat]!, ...board]),
        );
    // Odd chips start left of the button, including the heads-up special case.
    const order = round.playerIds.map(
      (_, i) => (round.betting.buttonSeat + i + 1) % round.playerIds.length,
    );
    const won = awardPots(computePots(round.betting.seats), scores, order);
    round.result = {
      handNumber: round.handNumber,
      board,
      net: round.betting.seats.map((s) => ({
        userId: round.playerIds[s.seat]!,
        net: (won.get(s.seat) ?? 0) - s.total,
        won: won.get(s.seat) ?? 0,
      })),
      revealed:
        foldWinner !== null
          ? []
          : round.betting.seats
              .filter((s) => !s.folded)
              .map((s) => ({ userId: round.playerIds[s.seat]!, cards: [...round.holes[s.seat]!] })),
    };
  }
  return round;
}
export function arenaView(round: ArenaRound, userId: number | null) {
  const mySeat = userId === null ? -1 : round.playerIds.indexOf(userId);
  return {
    handNumber: round.handNumber,
    actionSeq: round.actionSeq,
    board: boardFor(round),
    myCards: mySeat < 0 ? [] : [...round.holes[mySeat]!],
    toActUserId: round.betting.toAct === null ? null : round.playerIds[round.betting.toAct]!,
    legalActions: mySeat === round.betting.toAct ? legalActions(round.betting) : null,
    betting: structuredClone(round.betting),
    seats: round.betting.seats.map((s) => ({ ...s, userId: round.playerIds[s.seat]! })),
    result: round.result,
  };
}
export type ArenaView = ReturnType<typeof arenaView>;

export interface TournamentSummary {
  id: string;
  ownerId: number;
  name: string;
  description: string;
  status: string;
  capacity: number;
  handLimit: number;
  startingStack: number;
  sb: number;
  bb: number;
  actionSeconds: number;
  prizeDescription: string;
  rules: string;
  completedHands: number;
  createdAt: number;
  updatedAt: number;
  format: 'fixed-hand-league';
  dealing: 'server-dealt';
  entryFee: number;
  seedCommitment: string;
  entrantCount?: number;
}
export interface TournamentEntry {
  userId: number;
  agentName: string;
  kind: string;
  net: number;
  hands: number;
  wins: number;
  timeouts: number;
  awardNote: string;
  rank: number;
  bbPer100: number;
  online: boolean;
}
export interface TournamentState extends TournamentSummary {
  entries: TournamentEntry[];
  round: ArenaView | null;
  deadline: number | null;
  lastResult: ArenaResult | null;
  seed?: string;
  eventCursor: number;
}
