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
import { voice } from './voice.ts';
import { play } from './sounds.ts';

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

/** Sign against the hand named in the server's message, not local state, so
 *  crypto responses still work right after a reconnect or page reload. */
function signed(handId: string, t: string, body: unknown): string {
  const { auth } = useStore.getState();
  return signContent(auth.identity!.secretKey, handId, t, body);
}

/** Send a betting action for the current hand (called from the UI). */
export function act(action: PlayerAction): void {
  const handId = useStore.getState().hand.handId;
  if (!handId) return;
  wsClient.send({ t: 'action', handId, action, sig: signed(handId, 'action', { action }) });
}

/** Voluntarily reveal your hole cards to the table (after folding, or once the hand is over). */
export function showMyCards(): void {
  const { hand } = useStore.getState();
  if (!hand.handId || hand.myCardPoints.length === 0) return;
  const k = handKeyFor(hand.handId);
  const shares = hand.myCardPoints.map(({ deckIndex, point }) => {
    const { out, proof } = proveUnmask(k, pointFromHex(point));
    return { deckIndex, out: pointHex(out), proof };
  });
  wsClient.send({ t: 'show_cards', handId: hand.handId, shares, sig: signed(hand.handId, 'show_cards', { shares }) });
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

export function sendChat(text: string, kind: 'text' | 'sticker' | 'phrase' = 'text'): void {
  wsClient.send({ t: 'chat', text, kind });
}

function handle(msg: ServerMsg): void {
  const store = useStore.getState();
  switch (msg.t) {
    case 'room_state': {
      store.setRoom(msg);
      // after a reconnect (deploy or network drop): if the server no longer has
      // our hand, stop showing it as live instead of freezing the table
      if (wsClient.consumeResync() && !msg.handActive) {
        const h = useStore.getState().hand;
        if (h.handId && !h.result && !h.abort) {
          store.patchHand({
            abort: {
              t: 'hand_abort',
              handId: h.handId,
              reason: 'The server restarted during this hand. Bets were returned; the host can deal again.',
              blamedSeat: null,
            },
            deadline: null,
          });
          sessionStorage.removeItem(`4am/handkey/${h.handId}`);
        }
      }
      voice.syncPeers(msg.players);
      return;
    }
    case 'chat':
      store.pushChat({ from: msg.from, userId: msg.userId, text: msg.text, kind: msg.kind, ts: msg.ts });
      return;
    case 'rtc':
      void voice.handleRtc(msg.from, msg.data);
      return;
    case 'voice_state': {
      const { voice: v } = useStore.getState();
      store.patchVoice({ mutedByUser: { ...v.mutedByUser, [msg.userId]: msg.muted } });
      return;
    }
    case 'error':
      store.pushError(msg.message);
      return;

    case 'hand_start': {
      const mySeat = mySeatIn(msg.seats);
      // re-sent on reconnect: never wipe state we already have for this hand
      const fresh = useStore.getState().hand.handId !== msg.handId;
      if (fresh) {
        store.resetHand({
          handId: msg.handId,
          seats: msg.seats,
          buttonSeat: msg.buttonSeat,
        });
        // previous hands' keys are no longer needed: the voluntary-show window
        // for the last hand closes when a new one is dealt
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i);
          if (key?.startsWith('4am/handkey/') && key !== `4am/handkey/${msg.handId}`) {
            sessionStorage.removeItem(key);
          }
        }
      }
      if (mySeat === null) return; // spectator
      if (fresh) play('shuffle');
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
      wsClient.send({ t: 'shuffle_deck', handId: msg.handId, deck, sig: signed(msg.handId, 'shuffle_deck', { deck }) });
      return;
    }

    case 'need_share': {
      const k = handKeyFor(msg.handId);
      const { out, proof } = proveUnmask(k, pointFromHex(msg.point));
      const body = { deckIndex: msg.deckIndex, out: pointHex(out), proof };
      wsClient.send({ t: 'unmask_share', handId: msg.handId, ...body, sig: signed(msg.handId, 'unmask_share', body) });
      return;
    }

    case 'your_card': {
      const h = useStore.getState().hand;
      if (h.myCardPoints.some((c) => c.deckIndex === msg.deckIndex)) return; // re-delivered on reconnect
      const k = handKeyFor(msg.handId);
      const plain = mulPoint(pointFromHex(msg.point), invScalar(k));
      const card = recoverCard(plain, lookup);
      if (card === null) {
        store.pushError('Could not decode a dealt card. The hand will abort.');
        return;
      }
      play('deal');
      store.patchHand({
        myCards: [...h.myCards, card],
        myCardPoints: [...h.myCardPoints, { deckIndex: msg.deckIndex, point: msg.point }],
      });
      return;
    }

    case 'board_open': {
      const { hand } = useStore.getState();
      if (!hand.board.includes(msg.card)) {
        play('flip');
        store.patchHand({ board: [...hand.board, msg.card] });
      }
      return;
    }

    case 'betting_state': {
      const prev = useStore.getState().hand;
      const streetChanged = prev.betting?.street !== msg.state.street;
      const myUserId = useStore.getState().auth.userId;
      const mySeat = prev.seats.find((s) => s.userId === myUserId)?.seat;
      if (mySeat !== undefined && msg.state.toAct === mySeat && prev.betting?.toAct !== mySeat) {
        play('turn');
      }
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
      const soundFor = { fold: 'muck', check: 'knock', call: 'chip', bet: 'chip', raise: 'chip' } as const;
      play(soundFor[msg.action.type]);
      store.patchHand({
        lastActions: { ...hand.lastActions, [msg.seat]: { ...msg.action, auto: msg.auto } },
      });
      return;
    }

    case 'cards_shown': {
      const h = useStore.getState().hand;
      if (h.handId !== msg.handId) return;
      play('flip');
      store.patchHand({ shown: { ...h.shown, [msg.seat]: msg.cards } });
      return;
    }

    case 'showdown':
      store.patchHand({ showdown: msg });
      return;

    case 'hand_end': {
      const mySeat = mySeatIn(useStore.getState().hand.seats);
      const myDelta = msg.deltas.find((d) => d.seat === mySeat)?.delta ?? 0;
      play(myDelta > 0 ? 'win' : 'end');
      store.patchHand({ result: msg, deadline: null });
      // the hand key stays until the next deal so "Show cards" can still prove reveals
      return;
    }

    case 'hand_abort': {
      store.patchHand({ abort: msg, deadline: null });
      return;
    }

    case 'need_keys': {
      const k = handKeyFor(msg.handId);
      const key = k.toString(16);
      wsClient.send({ t: 'reveal_key', handId: msg.handId, key, sig: signed(msg.handId, 'reveal_key', { key }) });
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
