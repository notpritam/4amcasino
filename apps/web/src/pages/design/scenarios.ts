import { cardFromName, evaluate7, type BettingState, type CardId } from '@4am/shared';
import { useStore, type ChatMsg } from '../../shared/store.ts';
import type { SeatView } from '../../widgets/table/players.tsx';

/** Mock data driving the design board. Everything renders through the real
 *  components and the real zustand store; nothing here touches the network. */

const c = (s: string): CardId => cardFromName(s);

export const CAST = [
  { seat: 0, userId: 9001, username: 'you', displayName: 'You', avatarVersion: 0 },
  { seat: 1, userId: 9002, username: 'meera', displayName: 'Meera', avatarVersion: 0 },
  { seat: 2, userId: 9003, username: 'ishaan', displayName: 'Ishaan', avatarVersion: 0 },
  { seat: 4, userId: 9004, username: 'zoya', displayName: 'Zoya', avatarVersion: 0 },
  { seat: 6, userId: 9005, username: 'arjun', displayName: 'Arjun', avatarVersion: 0 },
] as const;

export const MY_SEAT = 0;
export const MY_CARDS: CardId[] = [c('As'), c('Ks')];
export const FLOP: CardId[] = [c('Qs'), c('Js'), c('9h')];
export const FULL_BOARD: CardId[] = [c('Qs'), c('Js'), c('9h'), c('Ts'), c('2d')];

export type ScenarioName = 'idle' | 'yourTurn' | 'waiting' | 'urgent' | 'showdown' | 'abort';

export const SCENARIOS: { name: ScenarioName; label: string; blurb: string }[] = [
  { name: 'idle', label: 'Idle', blurb: 'Between hands. Host sees Start hand.' },
  { name: 'yourTurn', label: 'Your turn', blurb: 'Facing a raise to 60 preflop. Quick bets live.' },
  { name: 'waiting', label: 'Waiting', blurb: 'Flop out, Ishaan is thinking.' },
  { name: 'urgent', label: 'Urgent', blurb: 'Your clock is under 10 seconds.' },
  { name: 'showdown', label: 'Showdown', blurb: 'Royal flush beats a set. Confetti earned.' },
  { name: 'abort', label: 'Abort', blurb: 'A player stalled the crypto; hand rolled back.' },
];

const mockRoom = {
  t: 'room_state' as const,
  room: {
    id: 'design',
    name: 'Design Board',
    joinCode: 'DESIGN',
    hostId: 9001,
    bankerId: 9001,
    sb: 10,
    bb: 20,
    auditMode: 'private',
    actionTimeoutMs: 30_000,
    actionSecs: 30,
    coBankerId: null,
    minSettleHands: 0,
  },
  players: CAST.map((p) => ({
    ...p,
    publicKey: 'ab'.repeat(32),
    stack: p.seat === MY_SEAT ? 1980 : 1500 + p.seat * 137,
    sittingOut: false,
    connected: p.username !== 'arjun', // one disconnected player, for the dimmed state
    totalBought: 2000,
  })),
  handActive: true,
};

const handSeats = CAST.map((p) => ({
  seat: p.seat,
  userId: p.userId,
  username: p.username,
  publicKey: 'ab'.repeat(32),
  stack: p.seat === MY_SEAT ? 1980 : 1500 + p.seat * 137,
}));

function betting(partial: Partial<BettingState>): BettingState {
  return {
    street: 'preflop',
    seats: CAST.map((p) => ({
      seat: p.seat,
      stack: (p.seat === MY_SEAT ? 1980 : 1500 + p.seat * 137) - (p.seat === 1 ? 10 : p.seat === 2 ? 60 : 0),
      committed: p.seat === 1 ? 10 : p.seat === 2 ? 60 : 0,
      total: p.seat === 1 ? 10 : p.seat === 2 ? 60 : 0,
      folded: p.seat === 6,
      allIn: false,
      lastActedAt: null,
    })),
    buttonSeat: 6,
    sb: 10,
    bb: 20,
    currentBet: 60,
    lastRaiseSize: 40,
    lastFullRaiseAt: 60,
    toAct: MY_SEAT,
    needToAct: [MY_SEAT, 1],
    winnerByFold: null,
    ...partial,
  };
}

const mockChat: ChatMsg[] = [
  { from: 'Meera', userId: 9002, text: 'blinds up next round?', kind: 'text', ts: Date.now() - 200000 },
  { from: 'You', userId: 9001, text: 'nice hand 👏', kind: 'phrase', ts: Date.now() - 120000 },
  { from: 'Ishaan', userId: 9003, text: '🔥', kind: 'sticker', ts: Date.now() - 60000 },
  { from: 'Zoya', userId: 9004, text: 'pay up 💸', kind: 'phrase', ts: Date.now() - 30000 },
];

export function applyScenario(name: ScenarioName): void {
  const s = useStore.getState();
  s.setRoom(mockRoom);
  s.setChat(mockChat);
  const base = { handId: 'design-hand', seats: handSeats, buttonSeat: 6 };

  switch (name) {
    case 'idle':
      s.resetHand({});
      return;
    case 'yourTurn':
      s.resetHand({
        ...base,
        myCards: MY_CARDS,
        board: [],
        betting: betting({}),
        deadline: Date.now() + 24_000,
        lastActions: { 2: { type: 'raise', amount: 60 } },
      });
      return;
    case 'waiting':
      s.resetHand({
        ...base,
        myCards: MY_CARDS,
        board: FLOP,
        betting: betting({ street: 'flop', currentBet: 40, toAct: 2, needToAct: [2, 0] }),
        deadline: Date.now() + 18_000,
        lastActions: { 1: { type: 'check' }, 4: { type: 'bet', amount: 40 } },
      });
      return;
    case 'urgent':
      s.resetHand({
        ...base,
        myCards: MY_CARDS,
        board: FLOP,
        betting: betting({ street: 'flop', currentBet: 120 }),
        deadline: Date.now() + 8_000,
        lastActions: { 4: { type: 'bet', amount: 120 } },
      });
      return;
    case 'showdown': {
      const myScore = evaluate7([...MY_CARDS, ...FULL_BOARD]);
      const meeraCards = [cardFromName('9c'), cardFromName('9d')];
      const meeraScore = evaluate7([...meeraCards, ...FULL_BOARD]);
      s.resetHand({
        ...base,
        myCards: MY_CARDS,
        board: FULL_BOARD,
        betting: betting({ street: 'river', toAct: null, needToAct: [] }),
        showdown: {
          t: 'showdown',
          handId: 'design-hand',
          reveals: [
            { seat: MY_SEAT, cards: MY_CARDS, score: myScore },
            { seat: 1, cards: meeraCards, score: meeraScore },
          ],
          awards: [{ seat: MY_SEAT, amount: 480 }],
        },
        result: {
          t: 'hand_end',
          handId: 'design-hand',
          head: 'design',
          stacks: handSeats.map((x) => ({ seat: x.seat, stack: x.stack })),
          deltas: [
            { seat: MY_SEAT, delta: 240 },
            { seat: 1, delta: -240 },
          ],
        },
      });
      return;
    }
    case 'abort':
      s.resetHand({
        ...base,
        myCards: MY_CARDS,
        abort: { t: 'hand_abort', handId: 'design-hand', reason: 'unmask timeout', blamedSeat: 4 },
      });
      return;
  }
}

export function clearScenario(): void {
  const s = useStore.getState();
  s.resetHand({});
  s.setRoom(null);
  s.setChat([]);
}

/** Seat views for the composed table previews, derived from the active scenario. */
export function buildSeatViews(scenario: ScenarioName, urgentFlag: boolean): SeatView[] {
  const st = useStore.getState().hand;
  return CAST.map((p) => {
    const es = st.betting?.seats.find((x) => x.seat === p.seat);
    const reveal = st.showdown?.reveals.find((r) => r.seat === p.seat);
    const won = (st.result?.deltas.find((d) => d.seat === p.seat)?.delta ?? 0) > 0;
    return {
      seat: p.seat,
      userId: p.userId,
      username: p.username,
      displayName: p.displayName,
      avatarVersion: 0,
      stack: es?.stack ?? 1500 + p.seat * 137,
      broke: false,
      sittingOut: false,
      isLeader: false,
      isButton: st.buttonSeat === p.seat && scenario !== 'idle',
      isToAct: st.betting?.toAct === p.seat && !st.result && !st.abort,
      folded: !!es?.folded,
      allIn: !!es?.allIn,
      inHand: scenario !== 'idle' && !st.abort,
      connected: p.username !== 'arjun',
      speaking: p.username === 'meera',
      voiceMuted: p.username === 'zoya',
      revealed: reveal?.cards,
      won,
      lastAction: st.lastActions[p.seat],
    };
  }).filter((v) => scenario !== 'idle' || true);
}
