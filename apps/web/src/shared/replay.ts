import {
  applyAction,
  nextStreet,
  startHand,
  type BettingState,
  type CardId,
  type PlayerAction,
} from '@4am/shared';
import type { TranscriptEntry } from '@4am/mental-poker';

export interface ReplaySeatInfo {
  seat: number;
  userId: number;
  stack: number;
}

export interface ReplayStep {
  label: string;
  board: CardId[];
  betting: BettingState | null;
  reveals: Record<number, CardId[]>;
  awards: { seat: number; amount: number }[] | null;
  actor: number | null;
}

export interface Replay {
  seats: ReplaySeatInfo[];
  buttonSeat: number;
  sb: number;
  bb: number;
  steps: ReplayStep[];
  /** True when post-hand key reveals put every player's hole cards in the
   *  transcript (TV replays), so the whole hand plays back broadcast-style. */
  tv: boolean;
}

const ACTION_WORDS: Record<PlayerAction['type'], string> = {
  fold: 'folds',
  check: 'checks',
  call: 'calls',
  bet: 'bets',
  raise: 'raises to',
};

/**
 * Rebuild a hand's public timeline from its stored transcript.
 * Normally only public information exists: actions, opened board cards, and
 * showdown reveals. In TV-replay rooms every player's hand key is saved after
 * the hand, the server decrypts each seat's hole cards into `hole_cards`
 * entries, and the replay shows all of them from the deal - WSOP broadcast
 * style (requested by notpritam, docs/FEATURES.md).
 */
export function buildReplay(entries: TranscriptEntry[]): Replay | null {
  const start = entries.find((e) => e.type === 'hand_start');
  if (!start) return null;
  // broadcast test: key-reveal decryptions (folders) plus showdown reveals
  // both live at the transcript's tail - when together they cover every dealt
  // seat, this replay is a TV replay and every hole card shows from step 0
  const tvBySeat: Record<number, CardId[]> = {};
  for (const e of entries) {
    if (e.type === 'hole_cards') {
      const p = e.payload as { seat: number; cards: CardId[] };
      tvBySeat[p.seat] = p.cards;
    } else if (e.type === 'settlement') {
      const rl = ((e.payload as Record<string, unknown>).reveals as
        | { seat: number; cards: CardId[] }[]
        | undefined) ?? [];
      for (const r of rl) tvBySeat[r.seat] = r.cards;
    }
  }

  const sp = start.payload as {
    seats: { seat: number; userId: number; stack: number }[];
    buttonSeat: number;
    sb: number;
    bb: number;
  };
  const startSeats = (start.payload as { seats: { seat: number }[] }).seats;
  const tv = startSeats.length > 0 && startSeats.every((x) => tvBySeat[x.seat] !== undefined);
  if (!tv) for (const k of Object.keys(tvBySeat)) delete tvBySeat[+k];
  const steps: ReplayStep[] = [];
  let betting: BettingState | null = null;
  let board: CardId[] = [];
  let reveals: Record<number, CardId[]> = {};

  const push = (label: string, actor: number | null = null, awards: ReplayStep['awards'] = null) =>
    steps.push({
      label,
      board: [...board],
      betting: betting ? { ...betting, seats: betting.seats.map((s) => ({ ...s })), needToAct: [...betting.needToAct] } : null,
      reveals: { ...tvBySeat, ...reveals },
      awards,
      actor,
    });

  push('Cards dealt face down');

  for (const e of entries) {
    const p = e.payload as Record<string, unknown>;
    try {
      switch (e.type) {
        case 'betting_start': {
          betting = startHand(
            sp.seats.map((s) => ({ seat: s.seat, stack: s.stack })),
            sp.buttonSeat,
            sp.sb,
            sp.bb,
          );
          push('Blinds posted');
          break;
        }
        case 'action': {
          if (!betting) break;
          const action = p.action as PlayerAction;
          const seat = (p.seat as number) ?? betting.toAct;
          betting = applyAction(betting, seat!, action);
          const amount = action.amount !== undefined ? ` ${action.amount}` : '';
          push(`Seat ${seat! + 1} ${ACTION_WORDS[action.type]}${amount}`, seat);
          break;
        }
        case 'timeout_fold': {
          if (!betting) break;
          const seat = p.seat as number;
          betting = applyAction(betting, seat, { type: 'fold' });
          push(`Seat ${seat + 1} timed out and folds`, seat);
          break;
        }
        case 'board_open': {
          board.push(p.card as CardId);
          push('Board card revealed');
          break;
        }
        case 'street': {
          if (betting) betting = nextStreet(betting);
          push(`${String(p.street)[0]?.toUpperCase()}${String(p.street).slice(1)} betting`);
          break;
        }
        case 'settlement': {
          board = (p.board as CardId[]) ?? board;
          const rl = (p.reveals as { seat: number; cards: CardId[] }[]) ?? [];
          reveals = Object.fromEntries(rl.map((r) => [r.seat, r.cards]));
          push('Result', null, (p.awards as { seat: number; amount: number }[]) ?? []);
          break;
        }
        case 'hand_abort': {
          push(`Hand aborted: ${String(p.reason ?? '')}`);
          break;
        }
        default:
          break;
      }
    } catch {
      // an entry the engine rejects (e.g. an invalid action a client sent) is skipped
    }
  }
  return { seats: sp.seats, buttonSeat: sp.buttonSeat, sb: sp.sb, bb: sp.bb, steps, tv };
}
