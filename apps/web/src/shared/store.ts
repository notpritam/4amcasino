import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_POKER_HOTKEYS, parsePokerHotkeys, type PokerHotkeys } from '@4am/shared';
import type { BettingState, CardId, LoungePosition, PlayerAction, ServerMsg } from '@4am/shared';

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
  pokerHotkeys: PokerHotkeys;
  displayName: string;
  bio: string;
  hasAvatar: boolean;
  avatarVersion: number;
  cardBack: 'indigo' | 'crimson' | 'emerald' | 'slate';
  fourColor: boolean;
  quickPhrases: string[];
  /** Hide my winnings from other players (leaderboards, session report, crown). */
  privateMode: boolean;
  /** Friends' table invites add me to the room automatically. */
  autoJoinInvites: boolean;
  /** Skip the ready check: deal me in without asking every hand. */
  autoReady: boolean;
}

export const defaultPrefs: Prefs = {
  pokerHotkeys: DEFAULT_POKER_HOTKEYS,
  displayName: '',
  bio: '',
  hasAvatar: false,
  avatarVersion: 0,
  cardBack: 'indigo',
  fourColor: false,
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
  /** When the server opens the next automatic ready check. */
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
  lounge: Record<number, LoungePosition>;
  setLoungePosition: (roomId: string, userId: number, position: LoungePosition | null) => void;
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

  pokerHotkeysFor: number | null;
  setPokerHotkeys: (p: PokerHotkeys, userId: number) => void;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;

  voice: {
    joined: boolean;
    muted: boolean;
    mutedByUser: Record<number, boolean>;
    speakingByUser: Record<number, boolean>;
  };
  patchVoice: (v: Partial<Store['voice']>) => void;
}

export const useStore = create<Store>()(
  persist(
    (set) => ({
      auth: { token: null, userId: null, username: null, identity: null },
      setAuth: (auth) =>
        set((s) => ({
          auth,
          pokerHotkeysFor:
            s.auth.token === auth.token && s.auth.userId === auth.userId ? s.pokerHotkeysFor : null,
        })),
      logout: () =>
        set({
          auth: { token: null, userId: null, username: null, identity: null },
          room: null,
          lounge: {},
          chat: [],
          hand: emptyHand,
          pokerHotkeysFor: null,
        }),

      room: null,
      lounge: {},
      setRoom: (room) => set({ room, lounge: room?.lounge ?? {} }),
      setLoungePosition: (roomId, userId, position) =>
        set((s) => {
          if (s.room?.room.id !== roomId) return s;
          const lounge = { ...s.lounge };
          if (position) lounge[userId] = position;
          else delete lounge[userId];
          return { lounge, room: { ...s.room, lounge } };
        }),
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

      pokerHotkeysFor: null,
      setPokerHotkeys: (pokerHotkeys, userId) =>
        set((s) =>
          s.auth.userId === userId
            ? { pokerHotkeysFor: userId, prefs: { ...s.prefs, pokerHotkeys } }
            : {},
        ),
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
          pokerHotkeysFor: null,
          // new pref fields must survive rehydration from an older stored shape
          prefs: Object.fromEntries(
            Object.entries(defaultPrefs).map(([key, fallback]) => [
              key,
              key === 'pokerHotkeys'
                ? (parsePokerHotkeys(p?.prefs?.pokerHotkeys) ?? fallback)
                : (p?.prefs?.[key as keyof Prefs] ?? fallback),
            ]),
          ) as unknown as Prefs,
        };
      },
    },
  ),
);
