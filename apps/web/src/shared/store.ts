import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BettingState, CardId, PlayerAction, ServerMsg } from '@4am/shared';

type RoomStateMsg = Extract<ServerMsg, { t: 'room_state' }>;
type HandStartMsg = Extract<ServerMsg, { t: 'hand_start' }>;
type ShowdownMsg = Extract<ServerMsg, { t: 'showdown' }>;
type HandEndMsg = Extract<ServerMsg, { t: 'hand_end' }>;
type HandAbortMsg = Extract<ServerMsg, { t: 'hand_abort' }>;

export interface ChatMsg {
  from: string;
  text: string;
  ts: number;
}

export interface AuthState {
  token: string | null;
  userId: number | null;
  username: string | null;
  identity: { publicKey: string; secretKey: string } | null;
}

interface HandView {
  handId: string | null;
  seats: HandStartMsg['seats'];
  buttonSeat: number | null;
  myCards: CardId[];
  board: CardId[];
  betting: BettingState | null;
  actionSeq: number;
  deadline: number | null;
  lastActions: Record<number, PlayerAction & { auto?: boolean }>;
  showdown: ShowdownMsg | null;
  result: HandEndMsg | null;
  abort: HandAbortMsg | null;
}

export const emptyHand: HandView = {
  handId: null,
  seats: [],
  buttonSeat: null,
  myCards: [],
  board: [],
  betting: null,
  actionSeq: 0,
  deadline: null,
  lastActions: {},
  showdown: null,
  result: null,
  abort: null,
};

interface Store {
  auth: AuthState;
  setAuth: (a: AuthState) => void;
  logout: () => void;

  room: RoomStateMsg | null;
  setRoom: (r: RoomStateMsg | null) => void;
  chat: ChatMsg[];
  pushChat: (m: ChatMsg) => void;

  hand: HandView;
  patchHand: (p: Partial<HandView>) => void;
  resetHand: (p?: Partial<HandView>) => void;

  errors: string[];
  pushError: (e: string) => void;
  dismissError: () => void;

  wsConnected: boolean;
  setWsConnected: (v: boolean) => void;
}

export const useStore = create<Store>()(
  persist(
    (set) => ({
      auth: { token: null, userId: null, username: null, identity: null },
      setAuth: (auth) => set({ auth }),
      logout: () =>
        set({
          auth: { token: null, userId: null, username: null, identity: null },
          room: null,
          chat: [],
          hand: emptyHand,
        }),

      room: null,
      setRoom: (room) => set({ room }),
      chat: [],
      pushChat: (m) => set((s) => ({ chat: [...s.chat.slice(-199), m] })),

      hand: emptyHand,
      patchHand: (p) => set((s) => ({ hand: { ...s.hand, ...p } })),
      resetHand: (p = {}) => set({ hand: { ...emptyHand, ...p } }),

      errors: [],
      pushError: (e) => set((s) => ({ errors: [...s.errors, e] })),
      dismissError: () => set((s) => ({ errors: s.errors.slice(1) })),

      wsConnected: false,
      setWsConnected: (wsConnected) => set({ wsConnected }),
    }),
    {
      name: '4am-auth',
      partialize: (s) => ({ auth: s.auth }),
    },
  ),
);
