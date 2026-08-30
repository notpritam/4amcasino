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
  userId: number;
  text: string;
  kind: 'text' | 'sticker' | 'phrase';
  ts: number;
}

export interface Prefs {
  displayName: string;
  bio: string;
  hasAvatar: boolean;
  avatarVersion: number;
  cardBack: 'indigo' | 'crimson' | 'emerald' | 'slate';
  fourColor: boolean;
  theme: 'light' | 'dark' | 'cyber';
  quickPhrases: string[];
  /** Hide my winnings from other players (leaderboards, session report, crown). */
  privateMode: boolean;
  /** Friends' table invites add me to the room automatically. */
  autoJoinInvites: boolean;
  /** Skip the ready check: deal me in without asking every hand. */
  autoReady: boolean;
}

export const defaultPrefs: Prefs = {
  displayName: '',
  bio: '',
  hasAvatar: false,
  avatarVersion: 0,
  cardBack: 'indigo',
  fourColor: false,
  theme: 'cyber',
  quickPhrases: [],
  privateMode: false,
  autoJoinInvites: false,
  autoReady: false,
};

export interface AuthState {
  token: string | null;
  userId: number | null;
  username: string | null;
  identity: { publicKey: string; secretKey: string } | null;
  /** Whether this account is the platform (house) account; gates the admin console. */
  isPlatform?: boolean;
  /** 1-based leaderboard placement, or null if unranked/hidden. */
  leaderboardRank?: number | null;
}

interface HandView {
  handId: string | null;
  seats: HandStartMsg['seats'];
  buttonSeat: number | null;
  myCards: CardId[];
  myCardPoints: { deckIndex: number; point: string }[];
  shown: Record<number, CardId[]>;
  board: CardId[];
  betting: BettingState | null;
  actionSeq: number;
  deadline: number | null;
  lastActions: Record<number, PlayerAction & { auto?: boolean }>;
  showdown: ShowdownMsg | null;
  result: HandEndMsg | null;
  abort: HandAbortMsg | null;
  /** Armed before your turn; the game client fires it the moment you are to act. */
  preAction: 'check-fold' | 'check' | 'call' | 'call-any' | null;
  /** The call price a 'call' pre-action was armed at; it never pays more. */
  preActionCallAt: number | null;
  /** Paid-peek offers waiting for my answer, and reveals only I can see. */
  peekOffers: { offerId: string; fromUserId: number; fromName: string; amount: number }[];
  peekResults: Record<number, CardId[]>;
  /** When the server will deal the next hand by itself (host online). */
  autoDealAt: number | null;
  /** Pre-deal ready check: nobody is dealt in without clicking I'm ready. */
  readyCheck: { deadlineTs: number; eligible: number[]; ready: number[] } | null;
  /** Run-it-twice vote in progress (everyone all-in before the river). */
  ritOffer: { deadlineTs: number; voters: number[]; voted: boolean } | null;
  /** The second runout's board, filled progressively after a unanimous yes. */
  board2: CardId[];
}

/** Everything the last-hand recap needs, frozen at hand_end. */
export interface LastHandSnap {
  handId: string;
  ts: number;
  board: CardId[];
  board2: CardId[];
  reveals: { seat: number; cards: CardId[]; score: number }[];
  shown: Record<number, CardId[]>;
  deltas: { seat: number; delta: number }[];
  runTwice: {
    boards: [CardId[], CardId[]];
    awards: [{ seat: number; amount: number }[], { seat: number; amount: number }[]];
  } | null;
  names: Record<number, string>;
}

export const emptyHand: HandView = {
  handId: null,
  seats: [],
  buttonSeat: null,
  myCards: [],
  myCardPoints: [],
  shown: {},
  board: [],
  betting: null,
  actionSeq: 0,
  deadline: null,
  lastActions: {},
  showdown: null,
  result: null,
  abort: null,
  preAction: null,
  preActionCallAt: null,
  peekOffers: [],
  peekResults: {},
  autoDealAt: null,
  readyCheck: null,
  ritOffer: null,
  board2: [],
};

interface Store {
  auth: AuthState;
  setAuth: (a: AuthState) => void;
  logout: () => void;

  room: RoomStateMsg | null;
  setRoom: (r: RoomStateMsg | null) => void;
  chat: ChatMsg[];
  pushChat: (m: ChatMsg) => void;
  setChat: (msgs: ChatMsg[]) => void;

  hand: HandView;
  patchHand: (p: Partial<HandView>) => void;
  resetHand: (p?: Partial<HandView>) => void;

  /** The previous completed hand, kept after the next deal wipes `hand` -
   *  feeds the toggleable "last hand" recap strip. */
  lastHand: LastHandSnap | null;
  setLastHand: (h: LastHandSnap | null) => void;

  errors: string[];
  pushError: (e: string) => void;
  dismissError: () => void;

  wsConnected: boolean;
  setWsConnected: (v: boolean) => void;

  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;

  voice: { joined: boolean; muted: boolean; mutedByUser: Record<number, boolean>; speakingByUser: Record<number, boolean> };
  patchVoice: (v: Partial<Store['voice']>) => void;
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
      setChat: (chat) => set({ chat }),

      hand: emptyHand,
      patchHand: (p) => set((s) => ({ hand: { ...s.hand, ...p } })),
      resetHand: (p = {}) => set({ hand: { ...emptyHand, ...p } }),
      lastHand: null,
      setLastHand: (lastHand) => set({ lastHand }),

      errors: [],
      pushError: (e) => set((s) => ({ errors: [...s.errors, e] })),
      dismissError: () => set((s) => ({ errors: s.errors.slice(1) })),

      wsConnected: false,
      setWsConnected: (wsConnected) => set({ wsConnected }),

      prefs: defaultPrefs,
      setPrefs: (p) => set((s) => ({ prefs: { ...s.prefs, ...p } })),

      voice: { joined: false, muted: false, mutedByUser: {}, speakingByUser: {} },
      patchVoice: (v) => set((s) => ({ voice: { ...s.voice, ...v } })),
    }),
    {
      name: '4am-auth',
      partialize: (s) => ({ auth: s.auth, prefs: s.prefs }),
      merge: (persisted, current) => {
        const p = persisted as Partial<Store> | undefined;
        return {
          ...current,
          ...(p ?? {}),
          // new pref fields must survive rehydration from an older stored shape
          prefs: { ...defaultPrefs, ...(p?.prefs ?? {}) },
        };
      },
    },
  ),
);
