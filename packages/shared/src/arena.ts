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
  /** Persistent stacks in playerIds order; omit for the original equal-stack mode. */
  stacks?: number[];
  buttonUserId?: number;
  commission?: { houseBps: number; prizeBps: number };
  revealAllAfterHand?: boolean;
  sb: number;
  bb: number;
  handNumber: number;
}
export interface ArenaResult {
  handNumber: number;
  board: number[];
  /** won/net include commissions; grossWon includes pre-fee awards and uncalled returns. */
  net: { userId: number; net: number; won: number; endStack?: number; grossWon?: number }[];
  revealed: { userId: number; cards: number[] }[];
  /** Commission totals and their pre-fee chip basis, excluding uncalled returns. */
  fees?: { house: number; prize: number; contested: number };
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
  const { playerIds, stack, stacks, buttonUserId, commission, sb, bb, handNumber } = config;
  if (
    playerIds.length < 2 ||
    playerIds.length > 9 ||
    new Set(playerIds).size !== playerIds.length ||
    ![stack, sb, bb, handNumber].every(Number.isSafeInteger) ||
    handNumber < 1 ||
    sb < 1 ||
    bb < sb ||
    stack < 1 ||
    stack > 1_000_000 ||
    (stacks === undefined && stack < 2 * bb) ||
    (stacks !== undefined &&
      (!Array.isArray(stacks) ||
        stacks.length !== playerIds.length ||
        !Array.from(stacks).every((s) => Number.isSafeInteger(s) && s > 0 && s <= 9_000_000))) ||
    (buttonUserId !== undefined && !playerIds.includes(buttonUserId)) ||
    (commission !== undefined &&
      (!commission ||
        ![commission.houseBps, commission.prizeBps].every(
          (bps) => Number.isSafeInteger(bps) && bps >= 0 && bps <= 1000,
        ) ||
        commission.houseBps + commission.prizeBps > 2000)) ||
    (config.revealAllAfterHand !== undefined && typeof config.revealAllAfterHand !== 'boolean')
  )
    throw new Error('invalid arena configuration');
  if (
    deck.length !== 52 ||
    new Set(deck).size !== 52 ||
    !deck.every((c) => Number.isInteger(c) && c >= 0 && c < 52)
  )
    throw new Error('invalid deck');
  const button =
    buttonUserId === undefined
      ? (handNumber - 1) % playerIds.length
      : playerIds.indexOf(buttonUserId);
  const smallBlind = playerIds.length === 2 ? button : (button + 1) % playerIds.length;
  const order = playerIds.map((_, i) => {
    const seat = (smallBlind + i) % playerIds.length;
    return { seat, stack: stacks?.[seat] ?? stack };
  });
  // Deal two rounds around the table, starting at the small blind.
  const holes = playerIds.map(() => [] as number[]);
  for (let i = 0; i < playerIds.length * 2; i++)
    holes[(smallBlind + i) % playerIds.length]!.push(deck[i]!);
  return advanceArena({
    ...config,
    playerIds: [...playerIds],
    ...(stacks !== undefined ? { stacks: [...stacks] } : {}),
    ...(commission !== undefined ? { commission: { ...commission } } : {}),
    deck: [...deck],
    holes,
    betting: startHand(order, button, sb, bb),
    actionSeq: 0,
    result: null,
  });
}
function boardFor(round: ArenaRound): number[] {
  const count = round.result
    ? round.result.board.length
    : { preflop: 0, flop: 3, turn: 4, river: 5 }[round.betting.street];
  return round.deck.slice(round.playerIds.length * 2, round.playerIds.length * 2 + count);
}
function hasRaiseOpponent(round: ArenaRound): boolean {
  return (
    round.stacks === undefined ||
    round.betting.seats.some((s) => s.seat !== round.betting.toAct && !s.folded && !s.allIn)
  );
}
export function actArena(previous: ArenaRound, userId: number, action: PlayerAction): ArenaRound {
  if (previous.result) throw new Error('hand completed');
  if (!['fold', 'check', 'call', 'bet', 'raise'].includes(action.type))
    throw new Error('invalid action');
  if (action.amount !== undefined && (!Number.isSafeInteger(action.amount) || action.amount <= 0))
    throw new Error('invalid amount');
  if ((action.type === 'bet' || action.type === 'raise') && !hasRaiseOpponent(previous))
    throw new Error('no opponent can call');
  const seat = previous.playerIds.indexOf(userId);
  const round: ArenaRound = {
    ...previous,
    betting: applyAction(previous.betting, seat, action),
    actionSeq: previous.actionSeq + 1,
  };
  return advanceArena(round);
}
/** Advances only freshly created state, including hands completed by posting blinds. */
function advanceArena(round: ArenaRound): ArenaRound {
  if (round.stacks !== undefined && round.betting.winnerByFold === null) {
    const live = round.betting.seats.filter((s) => !s.folded);
    const actors = live.filter((s) => !s.allIn);
    if (actors.length <= 1) {
      // A lone player can only match an all-in, not the nominal full big blind.
      // Once matched, there is no opponent left for a betting decision.
      round.betting.currentBet = Math.max(...live.map((s) => s.committed));
      if (actors.length === 0 || actors[0]!.committed >= round.betting.currentBet) {
        round.betting.needToAct = [];
        round.betting.toAct = null;
      }
    }
  }
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
    const grossWon = awardPots(computePots(round.betting.seats), scores, order);
    let won = grossWon;
    let fees: ArenaResult['fees'];
    if (round.commission !== undefined) {
      fees = { house: 0, prize: 0, contested: 0 };
      // computePots merges equal-eligibility layers. Remove the unique largest
      // contribution's uncalled excess first so it can never enter the fee base.
      const totals = round.betting.seats.map((s) => s.total).sort((a, b) => b - a);
      const matched = totals[1]!;
      const pots = computePots(
        round.betting.seats.map((s) => ({ ...s, total: Math.min(s.total, matched) })),
      );
      const netPots = pots.map((pot) => {
        const house = Math.floor((pot.amount * round.commission!.houseBps) / 10_000);
        const prize = Math.floor((pot.amount * round.commission!.prizeBps) / 10_000);
        fees!.house += house;
        fees!.prize += prize;
        fees!.contested += pot.amount;
        return { ...pot, amount: pot.amount - house - prize };
      });
      won = awardPots(netPots, scores, order);
      for (const s of round.betting.seats) {
        const returned = Math.max(0, s.total - matched);
        if (returned) won.set(s.seat, (won.get(s.seat) ?? 0) + returned);
      }
    }
    round.result = {
      handNumber: round.handNumber,
      board,
      net: round.betting.seats.map((s) => ({
        userId: round.playerIds[s.seat]!,
        net: (won.get(s.seat) ?? 0) - s.total,
        won: won.get(s.seat) ?? 0,
        ...(round.stacks !== undefined || round.commission !== undefined
          ? { endStack: s.stack + (won.get(s.seat) ?? 0), grossWon: grossWon.get(s.seat) ?? 0 }
          : {}),
      })),
      revealed:
        foldWinner !== null && !round.revealAllAfterHand
          ? []
          : round.betting.seats
              .filter((s) => round.revealAllAfterHand || !s.folded)
              .map((s) => ({ userId: round.playerIds[s.seat]!, cards: [...round.holes[s.seat]!] })),
      ...(fees ? { fees } : {}),
    };
  }
  return round;
}
export function arenaView(round: ArenaRound, userId: number | null) {
  const mySeat = userId === null ? -1 : round.playerIds.indexOf(userId);
  const actions = mySeat === round.betting.toAct ? legalActions(round.betting) : null;
  return {
    handNumber: round.handNumber,
    actionSeq: round.actionSeq,
    board: boardFor(round),
    myCards: mySeat < 0 ? [] : [...round.holes[mySeat]!],
    toActUserId: round.betting.toAct === null ? null : round.playerIds[round.betting.toAct]!,
    legalActions: actions
      ? { ...actions, canRaise: actions.canRaise && hasRaiseOpponent(round) }
      : null,
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
  format: 'fixed-hand-league' | 'knockout';
  policy: import('./tournamentPolicy.js').TournamentPolicy;
  approvalStatus: 'approved' | 'pending' | 'rejected';
  reviewNote: string;
  revision: number;
  termsLocked: boolean;
  scheduleNote: string;
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
  stack: number;
  eliminatedHand: number | null;
  entryFee: number;
  joiningReward: number;
  prize: number;
  recordedPaid: number;
  outstanding: number;
}
export interface TournamentState extends TournamentSummary {
  finance: import('./tournamentPolicy.js').TournamentFinance;
  entries: TournamentEntry[];
  round: ArenaView | null;
  deadline: number | null;
  lastResult: ArenaResult | null;
  seed?: string;
  eventCursor: number;
}
