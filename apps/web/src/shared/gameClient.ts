import {
  cardLookup,
  handKeyCommit,
  invScalar,
  maskAndShuffle,
  mulPoint,
  pointFromHex,
  pointHex,
  proveUnmask,
  randScalar,
  randomPerm,
  recoverCard,
  signContent,
} from '@4am/mental-poker';
import type { PlayerAction, ServerMsg } from '@4am/shared';
import { useStore } from './store.ts';
import { wsClient } from './ws.ts';

const lookup = cardLookup();

function handKeyFor(handId: string): bigint {
  const storageKey = `4am/handkey/${handId}`;
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return BigInt('0x' + existing);
  const k = randScalar();
  sessionStorage.setItem(storageKey, k.toString(16));
  return k;
}

function mySeatIn(seats: { seat: number; userId: number }[]): number | null {
  const userId = useStore.getState().auth.userId;
  return seats.find((s) => s.userId === userId)?.seat ?? null;
}

function signed(t: string, body: unknown): string {
  const { auth } = useStore.getState();
  const handId = useStore.getState().hand.handId!;
  return signContent(auth.identity!.secretKey, handId, t, body);
}

/** Send a betting action for the current hand (called from the UI). */
export function act(action: PlayerAction): void {
  const handId = useStore.getState().hand.handId;
  if (!handId) return;
  wsClient.send({ t: 'action', handId, action, sig: signed('action', { action }) });
}

export function sit(seat: number): void {
  wsClient.send({ t: 'sit', seat });
}

export function leaveSeat(): void {
  wsClient.send({ t: 'leave_seat' });
}

export function startHand(): void {
  wsClient.send({ t: 'start_hand' });
}

export function sendChat(text: string): void {
  wsClient.send({ t: 'chat', text });
}

function handle(msg: ServerMsg): void {
  const store = useStore.getState();
  switch (msg.t) {
    case 'room_state':
      store.setRoom(msg);
      return;
    case 'chat':
      store.pushChat({ from: msg.from, text: msg.text, ts: msg.ts });
      return;
    case 'error':
      store.pushError(msg.message);
      return;

    case 'hand_start': {
      const mySeat = mySeatIn(msg.seats);
      store.resetHand({
        handId: msg.handId,
        seats: msg.seats,
        buttonSeat: msg.buttonSeat,
      });
      if (mySeat === null) return; // spectator
      const k = handKeyFor(msg.handId);
      const commit = pointHex(handKeyCommit(k));
      wsClient.send({
        t: 'key_commit',
        handId: msg.handId,
        commit,
        sig: signContent(store.auth.identity!.secretKey, msg.handId, 'key_commit', { commit }),
      });
      return;
    }

    case 'shuffle_turn': {
      const { hand } = useStore.getState();
      if (msg.seat !== mySeatIn(hand.seats)) return;
      const k = handKeyFor(msg.handId);
      const deck = maskAndShuffle(msg.deck.map(pointFromHex), k, randomPerm(52)).map(pointHex);
      wsClient.send({ t: 'shuffle_deck', handId: msg.handId, deck, sig: signed('shuffle_deck', { deck }) });
      return;
    }

    case 'need_share': {
      const k = handKeyFor(msg.handId);
      const { out, proof } = proveUnmask(k, pointFromHex(msg.point));
      const body = { deckIndex: msg.deckIndex, out: pointHex(out), proof };
      wsClient.send({ t: 'unmask_share', handId: msg.handId, ...body, sig: signed('unmask_share', body) });
      return;
    }

    case 'your_card': {
      const k = handKeyFor(msg.handId);
      const plain = mulPoint(pointFromHex(msg.point), invScalar(k));
      const card = recoverCard(plain, lookup);
      if (card === null) {
        store.pushError('could not decode a dealt card — the hand will abort');
        return;
      }
      store.patchHand({ myCards: [...useStore.getState().hand.myCards, card] });
      return;
    }

    case 'board_open': {
      const { hand } = useStore.getState();
      if (!hand.board.includes(msg.card)) store.patchHand({ board: [...hand.board, msg.card] });
      return;
    }

    case 'betting_state': {
      const prev = useStore.getState().hand;
      const streetChanged = prev.betting?.street !== msg.state.street;
      store.patchHand({
        betting: msg.state,
        actionSeq: msg.actionSeq,
        deadline: msg.deadline,
        board: msg.board,
        ...(streetChanged ? { lastActions: {} } : {}),
      });
      return;
    }

    case 'action_applied': {
      const { hand } = useStore.getState();
      store.patchHand({
        lastActions: { ...hand.lastActions, [msg.seat]: { ...msg.action, auto: msg.auto } },
      });
      return;
    }

    case 'showdown':
      store.patchHand({ showdown: msg });
      return;

    case 'hand_end': {
      store.patchHand({ result: msg, deadline: null });
      sessionStorage.removeItem(`4am/handkey/${msg.handId}`);
      return;
    }

    case 'hand_abort': {
      store.patchHand({ abort: msg, deadline: null });
      sessionStorage.removeItem(`4am/handkey/${msg.handId}`);
      return;
    }

    case 'need_keys': {
      const k = handKeyFor(msg.handId);
      const key = k.toString(16);
      wsClient.send({ t: 'reveal_key', handId: msg.handId, key, sig: signed('reveal_key', { key }) });
      return;
    }

    default:
      return;
  }
}

let bound = false;
export function bindGameClient(): void {
  if (bound) return;
  bound = true;
  wsClient.on(handle);
}
