import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  CornersIn,
  CornersOut,
  Cube,
  UsersThree,
  CardsThree,
  ChatCircle,
  DotsThreeVertical,
  Eye,
  Microphone,
  MicrophoneSlash,
  Moon,
  PauseCircle,
  Play,
  Receipt,
  ShareNetwork,
  Sun,
  Timer,
  Trophy,
  UserPlus,
  VideoCamera,
  X,
} from '@phosphor-icons/react';
import NumberFlow from '@number-flow/react';
import confetti from 'canvas-confetti';
import { HAND_CATEGORY_NAMES, bestFive, describeScore, evaluate7, handCategory } from '@4am/shared';
import {
  answerPeek,
  bindGameClient,
  offerPeek,
  ritVote,
  setSitOut,
  sit,
  startHand,
} from '../../shared/gameClient.ts';
import { wsClient } from '../../shared/ws.ts';
import { useStore } from '../../shared/store.ts';
import { api } from '../../shared/api.ts';
import { voice } from '../../shared/voice.ts';
import { play } from '../../shared/sounds.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Dialog, Panel, Spinner } from '../../shared/ui/index.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { PlayerRow, YouRow, type SeatView } from '../../widgets/table/players.tsx';
import { ActionBar } from '../../widgets/table/ActionBar.tsx';
import { ChatPanel } from '../../widgets/table/ChatPanel.tsx';
import { MobileTable } from '../../widgets/table/MobileTable.tsx';
import { RoundTable } from '../../widgets/table/RoundTable.tsx';
import { FloatingCards } from '../../widgets/table/FloatingCards.tsx';
import { ChipStack } from '../../widgets/table/ChipStack.tsx';
import { BankControls } from '../../widgets/table/BankControls.tsx';
import { BrokeBuyInDialog } from '../../features/bank/BrokeBuyInDialog.tsx';
import { InviteFriendsDialogBody } from '../../features/friends/FriendsPanel.tsx';
import { LeaderboardTable, type LeaderboardRow } from '../leaderboard/LeaderboardPage.tsx';
import { ShareHandDialog } from '../../features/share/ShareHandDialog.tsx';
import type { ShareData } from '../../features/share/shareCard.ts';
import {
  tableUtilityGroups,
  unreadChatCount,
  type TableUtilityAction,
  type TableUtilityGroupId,
} from './tableUi.ts';

/** The hand's ending, per player: THEIR two cards, what they made, their net.
 *  Everyone sees exactly what they won or lost to, not just the winning five
 *  (requested by notpritam, docs/FEATURES.md). */
function ShowdownCards({
  reveals,
  shown,
  deltas,
  nameOf,
  light,
}: {
  reveals: { seat: number; cards: number[]; score: number }[];
  shown: Record<number, number[]>;
  deltas: { seat: number; delta: number }[];
  nameOf: (seat: number) => string;
  light: boolean;
}) {
  const rows: { seat: number; cards: number[]; score: number | null }[] = [
    ...reveals.map((r) => ({ seat: r.seat, cards: r.cards, score: r.score as number | null })),
    ...Object.entries(shown)
      .filter(([seat]) => !reveals.some((r) => r.seat === +seat))
      .map(([seat, cards]) => ({ seat: +seat, cards, score: null })),
  ];
  const deltaOf = (seat: number) => deltas.find((d) => d.seat === seat)?.delta ?? 0;
  rows.sort((a, b) => deltaOf(b.seat) - deltaOf(a.seat));
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2.5">
      {rows.map((r) => {
        const delta = deltaOf(r.seat);
        return (
          <div
            key={r.seat}
            className={cn(
              'flex items-center gap-2.5 rounded-xl p-2 pr-3',
              light
                ? 'bg-white/10'
                : 'bg-slate-100/80 ring-1 ring-slate-200/70 dark:bg-slate-800/60 dark:ring-slate-700/60',
            )}
          >
            <div className="flex gap-1">
              {r.cards.map((c) => (
                <PlayingCard key={c} card={c} size="sm" deal />
              ))}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight">{nameOf(r.seat)}</div>
              <div className={cn('text-xs', light ? 'text-white/60' : 'text-slate-500')}>
                {r.score !== null
                  ? HAND_CATEGORY_NAMES[handCategory(r.score)]
                  : 'showed after folding'}
              </div>
            </div>
            <div
              className={cn(
                'font-display text-sm font-bold',
                delta > 0
                  ? light
                    ? 'text-emerald-300'
                    : 'text-emerald-600'
                  : delta < 0
                    ? light
                      ? 'text-rose-300'
                      : 'text-rose-600'
                    : light
                      ? 'text-white/50'
                      : 'text-slate-400',
              )}
            >
              {delta > 0 ? '+' : ''}
              {fmt(delta)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Both runouts side by side with who took each half of the pot. */
function RitBoards({
  rt,
  nameOf,
  light,
}: {
  rt: { boards: [number[], number[]]; awards: [{ seat: number; amount: number }[], { seat: number; amount: number }[]] };
  nameOf: (seat: number) => string;
  light: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {[0, 1].map((k) => (
        <div key={k} className="flex flex-wrap items-center gap-1.5">
          <span className="w-11 text-[0.65rem] font-bold uppercase tracking-wide text-fuchsia-500">
            Run {k + 1}
          </span>
          {rt.boards[k]!.map((c) => (
            <PlayingCard key={c} card={c} size="xs" deal />
          ))}
          <span
            className={cn(
              'ml-1 text-xs font-semibold',
              light ? 'text-emerald-300' : 'text-emerald-600 dark:text-emerald-400',
            )}
          >
            {rt.awards[k]!
              .filter((a) => a.amount > 0)
              .map((a) => `${nameOf(a.seat)} +${fmt(a.amount)}`)
              .join(' & ')}
          </span>
        </div>
      ))}
    </div>
  );
}

function useNow(tickMs = 500): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(iv);
  }, [tickMs]);
  return now;
}

interface FloatingReaction {
  id: number;
  emoji: string;
  left: number;
}

const desktopIconClass =
  'relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-[color,background-color,transform] duration-200 hover:bg-slate-200/70 hover:text-slate-900 active:scale-[0.96] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white';

function DesktopIconButton({
  label,
  onClick,
  children,
  active = false,
  badge = 0,
  buttonRef,
  className,
  hasPopup,
  expanded,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  badge?: number;
  buttonRef?: React.Ref<HTMLButtonElement>;
  className?: string;
  hasPopup?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup={hasPopup ? 'menu' : undefined}
      aria-expanded={hasPopup ? expanded : undefined}
      className={cn(
        desktopIconClass,
        active && 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
        className,
      )}
    >
      {children}
      {badge > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1 text-[0.62rem] font-bold text-white ring-2 ring-slate-100 dark:ring-slate-950">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

export function TablePage() {
  const { id: roomId } = useParams<{ id: string }>();
  const room = useStore((s) => s.room);
  const hand = useStore((s) => s.hand);
  const auth = useStore((s) => s.auth);
  const voiceState = useStore((s) => s.voice);
  const chat = useStore((s) => s.chat);
  const errors = useStore((s) => s.errors);
  const dismissError = useStore((s) => s.dismissError);
  const resetHand = useStore((s) => s.resetHand);
  const [resultDismissed, setResultDismissed] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [brokeDismissed, setBrokeDismissed] = useState(false);
  const [joinSlow, setJoinSlow] = useState(false);
  const wsConnected = useStore((s) => s.wsConnected);
  const [chatOpen, setChatOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // your hole cards as a big draggable panel; hide/show is remembered
  const [bigCards, setBigCards] = useState(() => localStorage.getItem('4am-big-cards') !== 'off');
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const [chatSeenCount, setChatSeenCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const toggleTheme = () => {
    const theme = prefs.theme === 'dark' ? 'light' : 'dark';
    setPrefs({ theme });
    void api.updateProfile({ theme }).catch(() => {});
  };
  const [peekAmtStr, setPeekAmtStr] = useState('');
  const [peekSent, setPeekSent] = useState<Record<number, boolean>>({});
  const [shareOpen, setShareOpen] = useState(false);
  const [standingsOpen, setStandingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchInfo, setWatchInfo] = useState<{ allow: boolean; token: string } | null>(null);
  const [joinReqs, setJoinReqs] = useState<{ id: number; userId: number; displayName: string }[]>(
    [],
  );
  const [askedToJoin, setAskedToJoin] = useState(false);
  const [standings, setStandings] = useState<LeaderboardRow[] | null>(null);
  const [floats, setFloats] = useState<FloatingReaction[]>([]);
  const floatId = useRef(0);
  const lastChatLen = useRef(0);
  const beepedUrgent = useRef<string | null>(null);
  const desktopChatCloseRef = useRef<HTMLButtonElement>(null);
  const desktopChatDrawerRef = useRef<HTMLElement>(null);
  const desktopChatTriggerRef = useRef<HTMLButtonElement>(null);
  const desktopMenuRef = useRef<HTMLDivElement>(null);
  const desktopMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const now = useNow();
  const reduceMotion = useReducedMotion();
  // lightning on every showdown reveal; keyed so back-to-back hands re-flash
  const [thunderKey, setThunderKey] = useState(0);
  useEffect(() => {
    const boom = () => setThunderKey((k) => k + 1);
    window.addEventListener('4am-thunder', boom);
    return () => window.removeEventListener('4am-thunder', boom);
  }, []);
  const unreadChat = unreadChatCount(chat.length, chatSeenCount, chatOpen);

  useEffect(() => {
    if (!chatOpen) return;
    setChatSeenCount(chat.length);
  }, [chatOpen, chat.length]);

  useEffect(() => {
    if (!chatOpen) return;
    const desktopMedia = window.matchMedia('(min-width: 768px)');
    const closeAtBreakpoint = () => setChatOpen(false);
    desktopMedia.addEventListener('change', closeAtBreakpoint);
    if (!desktopMedia.matches) {
      return () => desktopMedia.removeEventListener('change', closeAtBreakpoint);
    }
    desktopChatCloseRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChatOpen(false);
      if (event.key !== 'Tab') return;
      const controls = desktopChatDrawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      );
      if (!controls?.length) return;
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      desktopMedia.removeEventListener('change', closeAtBreakpoint);
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
      if (desktopMedia.matches) desktopChatTriggerRef.current?.focus();
    };
  }, [chatOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const desktopMedia = window.matchMedia('(min-width: 768px)');
    const closeAtBreakpoint = () => setMenuOpen(false);
    desktopMedia.addEventListener('change', closeAtBreakpoint);
    if (!desktopMedia.matches) {
      return () => desktopMedia.removeEventListener('change', closeAtBreakpoint);
    }
    desktopMenuRef.current
      ?.querySelector<HTMLElement>('a[href], button:not([disabled]), select:not([disabled])')
      ?.focus();
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', closeMenu);
    return () => {
      desktopMedia.removeEventListener('change', closeAtBreakpoint);
      document.removeEventListener('keydown', closeMenu);
      if (desktopMedia.matches) desktopMenuTriggerRef.current?.focus();
    };
  }, [menuOpen]);

  // winner-reveal choreography: parent staggers, items spring in, cards drop in
  const revealParent = {
    hidden: {},
    show: {
      transition: {
        staggerChildren: reduceMotion ? 0 : 0.09,
        delayChildren: reduceMotion ? 0 : 0.12,
      },
    },
  };
  const revealItem = reduceMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 12, scale: 0.94 },
        show: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { type: 'spring', stiffness: 380, damping: 24 } as const,
        },
      };
  const revealCard = reduceMotion
    ? revealItem
    : {
        hidden: { opacity: 0, y: -20, rotate: -8 },
        show: {
          opacity: 1,
          y: 0,
          rotate: 0,
          transition: { type: 'spring', stiffness: 300, damping: 17 } as const,
        },
      };

  useEffect(() => {
    bindGameClient();
    wsClient.joinRoom(roomId!);
    // validate membership over REST too: surfaces 401/403/404 instead of hanging
    api
      .getRoom(roomId!)
      .catch((e) => setJoinError(e instanceof Error ? e.message : 'could not load room'));
    return () => {
      voice.leave();
      wsClient.leaveRoom();
      useStore.getState().setRoom(null);
    };
  }, [roomId]);

  // if the room never arrives, say so instead of spinning forever
  useEffect(() => {
    if (room) {
      setJoinSlow(false);
      return;
    }
    const t = setTimeout(() => setJoinSlow(true), 10_000);
    return () => clearTimeout(t);
  }, [room]);

  // floating sticker reactions over the table
  useEffect(() => {
    const fresh = chat.slice(lastChatLen.current);
    lastChatLen.current = chat.length;
    for (const m of fresh) {
      if (m.kind !== 'sticker') continue;
      const id = ++floatId.current;
      setFloats((f) => [...f, { id, emoji: m.text, left: 25 + Math.random() * 50 }]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 2500);
    }
  }, [chat]);

  useEffect(() => {
    if (hand.result || hand.abort) setResultDismissed(false);
  }, [hand.result, hand.abort]);

  // confetti when you win a pot
  useEffect(() => {
    if (!hand.result || mySeat === null) return;
    const myDelta = hand.result.deltas.find((d) => d.seat === mySeat)?.delta ?? 0;
    if (myDelta > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      confetti({ particleCount: 110, spread: 75, origin: { y: 0.7 } });
      setTimeout(
        () => confetti({ particleCount: 50, angle: 60, spread: 60, origin: { x: 0, y: 0.8 } }),
        220,
      );
      setTimeout(
        () => confetti({ particleCount: 50, angle: 120, spread: 60, origin: { x: 1, y: 0.8 } }),
        380,
      );
    }
  }, [hand.result]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (errors.length === 0) return;
    const t = setTimeout(dismissError, 4000);
    return () => clearTimeout(t);
  }, [errors, dismissError]);

  const mySeat = room?.players.find((p) => p.userId === auth.userId)?.seat ?? null;
  const isHost = room?.room.hostId === auth.userId;
  const isBankerHere =
    room?.room.bankerId === auth.userId || room?.room.coBankerId === auth.userId || isHost;
  // no membership row at all means this login came through a watch link
  const amSpectator = !!room && !room.players.some((p) => p.userId === auth.userId);
  const handLive = hand.handId !== null && !hand.result && !hand.abort;
  const myRoomStack = room?.players.find((p) => p.userId === auth.userId)?.stack ?? null;
  const amBroke = mySeat !== null && myRoomStack === 0 && !handLive;
  const remaining = hand.deadline ? hand.deadline - now : null;
  const urgent = handLive && remaining !== null && remaining <= 10_000;
  const utilityGroups = tableUtilityGroups({
    amSpectator,
    isBankerHere: !!isBankerHere,
    isHost: !!isHost,
    hasSeat: mySeat !== null,
    hasMeetLink: !!room?.room.meetLink,
  });

  useEffect(() => {
    setPeekSent({});
  }, [hand.handId]);

  useEffect(() => {
    if (!watchOpen || !isBankerHere) return;
    api
      .spectateSettings(roomId!)
      .then(setWatchInfo)
      .catch(() => {});
    const loadReqs = () =>
      api
        .joinRequests(roomId!)
        .then((r) => setJoinReqs(r.requests))
        .catch(() => {});
    loadReqs();
    const iv = setInterval(loadReqs, 5000);
    return () => clearInterval(iv);
  }, [watchOpen, isBankerHere, roomId]);

  useEffect(() => {
    if (!standingsOpen) return;
    setStandings(null);
    api
      .roomLeaderboard(roomId!)
      .then((r) => setStandings(r.rows))
      .catch(() => setStandings([]));
  }, [standingsOpen, roomId]);

  // re-arm the buy-in prompt whenever the broke state resolves (approval landed / stood up)
  useEffect(() => {
    if (!amBroke) setBrokeDismissed(false);
  }, [amBroke]);

  // urgency beep, once per deadline, when it's your turn
  useEffect(() => {
    const key = `${hand.handId}:${hand.deadline}`;
    if (urgent && hand.betting?.toAct === mySeat && beepedUrgent.current !== key) {
      beepedUrgent.current = key;
      play('urgent');
    }
  }, [urgent, hand.betting?.toAct, hand.deadline, hand.handId, mySeat]);

  // small and big blind seats, derived like the engine does: heads-up the
  // button IS the small blind, otherwise SB is next after the button
  const blinds = useMemo(() => {
    if (hand.buttonSeat === null || hand.seats.length < 2) return { sb: null, bb: null };
    const order = [...hand.seats.map((x) => x.seat)].sort((a, b) => a - b);
    const after = (seat: number) => order[(order.indexOf(seat) + 1) % order.length]!;
    const sb = hand.seats.length === 2 ? hand.buttonSeat : after(hand.buttonSeat);
    return { sb, bb: after(sb) };
  }, [hand.buttonSeat, hand.seats]);

  const seatViews = useMemo((): SeatView[] => {
    if (!room) return [];
    // the chip leader: up the most against their buy-ins right now
    const seated = room.players.filter((p) => p.seat !== null && !p.privateStats);
    const netOf = (p: (typeof seated)[number]) => p.stack - p.totalBought;
    const bestNet = seated.length ? Math.max(...seated.map(netOf)) : 0;
    const leaderId =
      bestNet > 0 ? (seated.find((p) => netOf(p) === bestNet)?.userId ?? null) : null;
    return room.players
      .filter((p) => p.seat !== null)
      .sort((a, b) => a.seat! - b.seat!)
      .map((p) => {
        const engineSeat = hand.betting?.seats.find((s) => s.seat === p.seat);
        const inHand =
          hand.handId !== null && !hand.abort && hand.seats.some((s) => s.seat === p.seat);
        const reveal = hand.showdown?.reveals.find((r) => r.seat === p.seat);
        const won =
          !!hand.result && (hand.result.deltas.find((d) => d.seat === p.seat)?.delta ?? 0) > 0;
        const stackShown = engineSeat && handLive ? engineSeat.stack : p.stack;
        return {
          seat: p.seat!,
          userId: p.userId,
          username: p.username,
          displayName: p.displayName,
          avatarVersion: p.avatarVersion,
          stack: stackShown,
          pendingBuy: p.pendingBuy ?? 0,
          broke: stackShown === 0 && !(handLive && inHand),
          isButton: inHand && hand.buttonSeat === p.seat,
          isSB: inHand && blinds.sb === p.seat,
          isBB: inHand && blinds.bb === p.seat,
          isToAct: handLive && hand.betting?.toAct === p.seat,
          folded: !!engineSeat?.folded,
          allIn: !!engineSeat?.allIn,
          inHand,
          sittingOut: !!p.sittingOut,
          isLeader: p.userId === leaderId,
          connected: p.connected,
          speaking: !!voiceState.speakingByUser[p.userId],
          voiceMuted: !!voiceState.mutedByUser[p.userId],
          revealed: reveal?.cards ?? hand.shown[p.seat!],
          won,
          lastAction: hand.lastActions[p.seat!],
        };
      });
  }, [room, hand, handLive, voiceState, blinds]);

  if (!room) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-6 text-center">
        {joinError ? (
          <>
            <p className="max-w-sm text-sm text-rose-600">
              Could not join this table: {joinError}.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => location.reload()}>
                Try again
              </Button>
              <Link to="/lobby">
                <Button>Back to lobby</Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <Spinner label="Joining table…" />
            {joinSlow && (
              <>
                <p className="max-w-sm text-sm text-slate-500">
                  Still connecting. On free hosting the server sleeps when idle and can take up to a
                  minute to wake. Hang tight, or retry.
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => location.reload()}>
                    Retry
                  </Button>
                  <Link to="/lobby">
                    <Button variant="ghost">Back to lobby</Button>
                  </Link>
                </div>
              </>
            )}
          </>
        )}
      </div>
    );
  }

  const pot = hand.betting ? hand.betting.seats.reduce((s, x) => s + x.total, 0) : 0;
  const me = seatViews.find((s) => s.seat === mySeat);
  // players seated but not dealt into the live hand stay hidden until the next deal
  const opponents = seatViews.filter((s) => s.seat !== mySeat && (!handLive || s.inHand));
  const takenSeats = new Set(seatViews.map((s) => s.seat));
  const secs = remaining !== null ? Math.max(0, Math.ceil(remaining / 1000)) : null;
  const showResult = (hand.result !== null || hand.abort !== null) && !resultDismissed;
  const notInHand = handLive && mySeat !== null && !hand.seats.some((s) => s.seat === mySeat);
  const meSittingOut = !!room.players.find((p) => p.userId === auth.userId)?.sittingOut;
  const seatName = (seat: number) =>
    seatViews.find((s) => s.seat === seat)?.displayName ?? `Seat ${seat + 1}`;

  const disconnectedInHand = handLive
    ? seatViews.filter((s) => s.inHand && !s.folded && !s.connected).map((s) => s.displayName)
    : [];
  const mobileStatus = !handLive
    ? null
    : mySeat !== null && !hand.seats.some((s) => s.seat === mySeat)
      ? 'You are not in this hand. You will be dealt in at the next deal.'
      : disconnectedInHand.length > 0
        ? `${disconnectedInHand.join(', ')} lost connection. Holding the hand for them to rejoin…`
        : hand.betting
          ? hand.betting.toAct !== null && hand.betting.toAct !== mySeat
            ? `Waiting for ${seatViews.find((s) => s.seat === hand.betting!.toAct)?.displayName ?? 'player'}…`
            : null
          : 'Shuffling the encrypted deck…';

  const peekAmt = Math.max(1, parseInt(peekAmtStr, 10) || room.room.bb * 5);
  const peekEligible =
    hand.result && !hand.abort
      ? seatViews.filter(
          (v) => v.inHand && v.seat !== mySeat && !v.revealed && !hand.peekResults[v.seat],
        )
      : [];
  const peekReveals = Object.entries(hand.peekResults);
  const hasPeekContent =
    hand.peekOffers.length > 0 ||
    peekReveals.length > 0 ||
    (showResult && peekEligible.length > 0 && mySeat !== null);

  const peekBody = (dark: boolean) => (
    <div className="space-y-2.5">
      {hand.peekOffers.map((o) => (
        <div key={o.offerId} className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            <b>{o.fromName}</b> offers <b className="font-display">{fmt(o.amount)}</b> to privately
            see the cards you just had.
          </span>
          <Button
            variant="success"
            disabled={hand.myCardPoints.length === 0}
            onClick={() => answerPeek(o.offerId, true)}
          >
            Accept {fmt(o.amount)}
          </Button>
          <Button variant="secondary" onClick={() => answerPeek(o.offerId, false)}>
            Decline
          </Button>
        </div>
      ))}
      {peekReveals.map(([seat, cards]) => (
        <div key={seat} className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            <b>{seatName(+seat)}</b> had
          </span>
          {cards.map((c) => (
            <PlayingCard key={c} card={c} size="xs" />
          ))}
          <span className={dark ? 'text-white/50' : 'text-slate-400'}>only you can see this</span>
        </div>
      ))}
      {showResult && peekEligible.length > 0 && mySeat !== null && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={dark ? 'text-white/60' : 'text-slate-500'}>Pay to peek at</span>
          {peekEligible.map((v) => (
            <Button
              key={v.seat}
              variant="secondary"
              disabled={!!peekSent[v.seat] || (myRoomStack ?? 0) < peekAmt}
              onClick={() => {
                setPeekSent((m) => ({ ...m, [v.seat]: true }));
                offerPeek(v.seat, peekAmt);
              }}
            >
              {peekSent[v.seat] ? `Asked ${v.displayName}` : v.displayName}
            </Button>
          ))}
          <input
            type="number"
            min={1}
            value={peekAmtStr}
            placeholder={String(room.room.bb * 5)}
            onChange={(e) => setPeekAmtStr(e.target.value)}
            aria-label="Peek offer amount"
            className={cn(
              'w-24 rounded-lg border px-2.5 py-1.5 font-display text-sm',
              dark
                ? 'border-white/20 bg-slate-800 text-white'
                : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
            )}
          />
          <span className={dark ? 'text-white/40' : 'text-slate-400'}>
            chips, paid only if they agree to show you
          </span>
        </div>
      )}
    </div>
  );

  const peekPanel = hasPeekContent && <Panel>{peekBody(false)}</Panel>;
  const mobilePeekPanel = hasPeekContent && (
    <div className="rounded-2xl bg-white/10 p-3.5 text-sm text-white">{peekBody(true)}</div>
  );

  // the reasoning behind the result: who won, with what, over what
  const reasoning = (() => {
    if (!hand.result) return null;
    const nameOf = (seat: number) =>
      seatViews.find((s) => s.seat === seat)?.displayName ??
      hand.seats.find((s) => s.seat === seat)?.username ??
      `Seat ${seat + 1}`;
    if (!hand.showdown) {
      const winner = hand.result.deltas.find((d) => d.delta > 0);
      if (!winner) return null;
      return {
        headline: `${nameOf(winner.seat)} takes the pot. Everyone else folded, so no cards had to be shown.`,
        winningFive: null,
      };
    }
    const rt = hand.showdown.runTwice;
    if (rt) {
      const winnersOf = (aw: { seat: number; amount: number }[]) =>
        aw.filter((a) => a.amount > 0).map((a) => nameOf(a.seat)).join(' & ');
      const w1 = winnersOf(rt.awards[0]);
      const w2 = winnersOf(rt.awards[1]);
      return {
        headline:
          w1 === w2
            ? `They ran it twice - ${w1} took both boards.`
            : `They ran it twice. ${w1} takes run 1, ${w2} takes run 2.`,
        winningFive: null,
      };
    }
    const ranked = [...hand.showdown.reveals].sort((a, b) => b.score - a.score);
    const top = ranked[0];
    if (!top) return null;
    const tied = ranked.filter((r) => r.score === top.score);
    const runnerUp = ranked.find((r) => r.score < top.score);
    const headline =
      tied.length > 1
        ? `Split pot: ${tied.map((r) => nameOf(r.seat)).join(' and ')} tie with ${describeScore(top.score)}.`
        : runnerUp
          ? `${nameOf(top.seat)} wins with ${describeScore(top.score)} against ${nameOf(runnerUp.seat)}'s ${describeScore(runnerUp.score).replace(/^a /, '')}.`
          : `${nameOf(top.seat)} wins with ${describeScore(top.score)}.`;
    const winningFive = hand.board.length === 5 ? bestFive([...top.cards, ...hand.board]) : null;
    return { headline, winningFive };
  })();

  const shareData: ShareData | null =
    hand.result && !hand.abort && reasoning
      ? {
          roomName: room.room.name,
          headline: reasoning.headline,
          board: hand.board,
          rows: [...hand.result.deltas]
            .filter((d) => d.delta !== 0)
            .sort((a, b) => b.delta - a.delta)
            .map((d) => {
              const reveal = hand.showdown?.reveals.find((r) => r.seat === d.seat);
              const cards = reveal?.cards ?? hand.shown[d.seat] ?? null;
              const label = reveal
                ? describeScore(reveal.score)
                : cards && hand.board.length === 5
                  ? describeScore(evaluate7([...cards, ...hand.board]))
                  : null;
              return { name: seatName(d.seat), cards, label, delta: d.delta };
            }),
          winningFive: reasoning.winningFive,
        }
      : null;

  const resultBanner = showResult && (
    <motion.div initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
      <Panel className="relative">
        <button
          onClick={() => {
            setResultDismissed(true);
            resetHand();
          }}
          aria-label="Dismiss result"
          className="absolute right-3 top-3 rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X size={16} />
        </button>
        {hand.abort ? (
          <div className="text-sm">
            <span className="font-semibold text-rose-600">Hand aborted:</span> {hand.abort.reason}
            {hand.abort.blamedSeat !== null &&
              `. ${
                hand.seats.find((s) => s.seat === hand.abort!.blamedSeat)?.username ??
                `Seat ${hand.abort.blamedSeat + 1}`
              } did not come back in time; all bets were returned.`}
          </div>
        ) : (
          <motion.div
            key={hand.handId ?? 'result'}
            variants={revealParent}
            initial="hidden"
            animate="show"
            className="space-y-2"
          >
            {reasoning && (
              <motion.p
                variants={revealItem}
                className="font-display text-xl font-bold leading-snug sm:text-2xl"
              >
                {reasoning.headline}
              </motion.p>
            )}
            {reasoning?.winningFive && (
              <motion.div
                variants={revealItem}
                className="shine-once flex flex-col gap-1.5 rounded-lg py-1"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-500">
                  The winning five
                </span>
                <div className="flex gap-1.5">
                  {reasoning.winningFive.map((c) => (
                    <motion.span key={c} variants={revealCard}>
                      <PlayingCard card={c} size="md" />
                    </motion.span>
                  ))}
                </div>
              </motion.div>
            )}
            {hand.showdown?.runTwice && (
              <motion.div variants={revealItem}>
                <RitBoards rt={hand.showdown.runTwice} nameOf={seatName} light={false} />
              </motion.div>
            )}
            {!hand.showdown?.runTwice && hand.board.length > 0 && (
              <motion.div variants={revealItem} className="flex items-center gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  The table
                </span>
                {hand.board.map((c) => (
                  <PlayingCard key={c} card={c} size="sm" deal />
                ))}
              </motion.div>
            )}
            {hand.showdown && (
              <motion.div variants={revealItem}>
                <ShowdownCards
                  reveals={hand.showdown.reveals}
                  shown={hand.shown}
                  deltas={hand.result?.deltas ?? []}
                  nameOf={seatName}
                  light={false}
                />
              </motion.div>
            )}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <motion.span variants={revealItem} className="font-display font-semibold">
                {hand.showdown ? 'Showdown' : 'Everyone folded'}
              </motion.span>
              {!hand.showdown &&
                hand.result?.deltas
                  .filter((d) => d.delta !== 0)
                  .map((d) => (
                    <motion.span
                      key={d.seat}
                      variants={revealItem}
                      className={cn(
                        'font-display text-sm font-bold',
                        d.delta > 0 ? 'text-emerald-600' : 'text-rose-600',
                      )}
                    >
                      {seatViews.find((s) => s.seat === d.seat)?.displayName}{' '}
                      {d.delta > 0 ? '+' : ''}
                      {fmt(d.delta)}
                    </motion.span>
                  ))}
              {shareData && (
                <motion.span variants={revealItem}>
                  <Button variant="ghost" onClick={() => setShareOpen(true)}>
                    <ShareNetwork size={16} /> Share
                  </Button>
                </motion.span>
              )}
            </div>
          </motion.div>
        )}
      </Panel>
    </motion.div>
  );

  const spectatorPanel = (
    <Panel className="text-center">
      <p className="flex items-center justify-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Eye size={16} /> You are watching this table.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        You can see everything public, but not anyone's cards, the join code, or the chips.
      </p>
      <Button
        className="mt-3"
        variant="secondary"
        disabled={askedToJoin}
        onClick={() => {
          setAskedToJoin(true);
          void api.askJoin(roomId!).catch(() => {});
        }}
      >
        {askedToJoin ? 'Asked. Waiting for the host to let you in.' : 'Ask to join the game'}
      </Button>
    </Panel>
  );

  const seatPicker = (
    <Panel>
      <div className="mb-3 text-sm font-medium text-slate-600 dark:text-slate-300">Pick a seat</div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 9 }, (_, i) => (
          <Button
            key={i}
            variant="secondary"
            disabled={takenSeats.has(i) || handLive}
            onClick={() => sit(i)}
          >
            Seat {i + 1}
          </Button>
        ))}
      </div>
    </Panel>
  );

  const mobileResult = showResult && (
    <div className="relative rounded-2xl bg-white/10 p-3.5 pr-9 text-sm text-white">
      <button
        onClick={() => {
          setResultDismissed(true);
          resetHand();
        }}
        aria-label="Dismiss result"
        className="absolute right-2 top-2 rounded-md p-1 text-white/50 active:bg-white/10"
      >
        <X size={14} />
      </button>
      {hand.abort ? (
        <span>
          <span className="font-semibold text-rose-300">Hand aborted:</span> {hand.abort.reason}
          {hand.abort.blamedSeat !== null &&
            `. Seat ${hand.abort.blamedSeat + 1}; stacks rolled back.`}
        </span>
      ) : (
        <motion.div
          key={hand.handId ?? 'result'}
          variants={revealParent}
          initial="hidden"
          animate="show"
          className="space-y-2"
        >
          {reasoning && (
            <motion.p variants={revealItem} className="font-medium">
              {reasoning.headline}
            </motion.p>
          )}
          {reasoning?.winningFive && (
            <motion.div
              variants={revealItem}
              className="shine-once flex items-center gap-2 rounded-lg py-0.5"
            >
              <span className="text-[0.6rem] uppercase tracking-wide text-white/40">
                Winning five
              </span>
              <div className="flex gap-1">
                {reasoning.winningFive.map((c) => (
                  <motion.span key={c} variants={revealCard}>
                    <PlayingCard card={c} size="xs" />
                  </motion.span>
                ))}
              </div>
            </motion.div>
          )}
          {hand.showdown?.runTwice && (
            <motion.div variants={revealItem}>
              <RitBoards rt={hand.showdown.runTwice} nameOf={seatName} light />
            </motion.div>
          )}
          {!hand.showdown?.runTwice && hand.board.length > 0 && (
            <motion.div variants={revealItem} className="flex items-center gap-1">
              <span className="text-[0.6rem] uppercase tracking-wide text-white/40">Table</span>
              {hand.board.map((c) => (
                <PlayingCard key={c} card={c} size="xs" deal />
              ))}
            </motion.div>
          )}
          {hand.showdown && (
            <motion.div variants={revealItem}>
              <ShowdownCards
                reveals={hand.showdown.reveals}
                shown={hand.shown}
                deltas={hand.result?.deltas ?? []}
                nameOf={seatName}
                light
              />
            </motion.div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="font-display font-semibold">
              {hand.showdown ? 'Showdown' : 'Everyone folded'}
            </span>
            {!hand.showdown && hand.result?.deltas
              .filter((d) => d.delta !== 0)
              .map((d) => (
                <span
                  key={d.seat}
                  className={cn(
                    'font-display text-xs font-bold',
                    d.delta > 0 ? 'text-emerald-300' : 'text-rose-300',
                  )}
                >
                  {seatViews.find((x) => x.seat === d.seat)?.displayName} {d.delta > 0 ? '+' : ''}
                  {fmt(d.delta)}
                </span>
              ))}
            {shareData && (
              <button
                onClick={() => setShareOpen(true)}
                className="flex items-center gap-1 rounded-full border border-white/25 px-2.5 py-1 text-xs font-semibold text-white/80"
              >
                <ShareNetwork size={13} /> Share
              </button>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );

  const mobileSeatPicker = (
    <div className="rounded-2xl bg-white/5 p-3.5">
      <div className="mb-2.5 text-sm text-white/70">
        Pick a seat. Friends join with code{' '}
        <span className="font-display font-bold text-white">{room.room.joinCode}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }, (_, i) => (
          <button
            key={i}
            disabled={takenSeats.has(i) || handLive}
            onClick={() => sit(i)}
            className="rounded-full bg-white/10 py-2 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-30"
          >
            Seat {i + 1}
          </button>
        ))}
      </div>
    </div>
  );

  const utilityGroupLabels: Record<TableUtilityGroupId, string> = {
    people: 'People',
    records: 'Records',
    table: 'Table',
    preferences: 'Preferences',
  };
  const utilityItemClass =
    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white';

  const closeUtilityMenu = () => setMenuOpen(false);
  const utilityAction = (action: TableUtilityAction) => {
    switch (action) {
      case 'invite':
        return (
          <button
            type="button"
            role="menuitem"
            className={utilityItemClass}
            onClick={() => {
              closeUtilityMenu();
              setInviteOpen(true);
            }}
          >
            <UserPlus size={18} /> Invite friends
          </button>
        );
      case 'watch':
        return (
          <button
            type="button"
            role="menuitem"
            className={utilityItemClass}
            onClick={() => {
              closeUtilityMenu();
              setWatchOpen(true);
            }}
          >
            <Eye size={18} /> Watch-only link
          </button>
        );
      case 'video':
        return (
          <a
            href={room.room.meetLink!}
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            className={utilityItemClass}
            onClick={closeUtilityMenu}
          >
            <VideoCamera size={18} /> Open video call
          </a>
        );
      case 'standings':
        return (
          <button
            type="button"
            role="menuitem"
            className={utilityItemClass}
            onClick={() => {
              closeUtilityMenu();
              setStandingsOpen(true);
            }}
          >
            <Trophy size={18} /> Standings
          </button>
        );
      case 'ledger':
        return (
          <Link
            to={`/room/${roomId}/ledger`}
            role="menuitem"
            className={utilityItemClass}
            onClick={closeUtilityMenu}
          >
            <Receipt size={18} /> Ledger
          </Link>
        );
      case 'hands':
        return (
          <Link
            to={`/room/${roomId}/hands`}
            role="menuitem"
            className={utilityItemClass}
            onClick={closeUtilityMenu}
          >
            <CardsThree size={18} /> Hand history
          </Link>
        );
      case 'sit-out':
        return (
          <button
            type="button"
            role="menuitem"
            className={utilityItemClass}
            onClick={() => {
              setSitOut(!meSittingOut);
              closeUtilityMenu();
            }}
          >
            <PauseCircle size={18} /> {meSittingOut ? 'Deal me back in' : 'Sit out next hand'}
          </button>
        );
      case 'timer':
        return (
          <label className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            <Timer size={18} />
            <span className="flex-1">Turn timer</span>
            <select
              aria-label="Turn timer"
              value={room.room.actionSecs ?? 45}
              disabled={handLive}
              onChange={(event) => void api.roomSettings(roomId!, +event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-slate-700 dark:bg-slate-800"
              title={handLive ? 'Applies from the next hand' : undefined}
            >
              {[15, 30, 45, 60, 90, 120].map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds}s
                </option>
              ))}
              <option value={0}>No limit</option>
            </select>
          </label>
        );
      case 'theme':
        return (
          <button
            type="button"
            role="menuitem"
            className={utilityItemClass}
            onClick={() => {
              toggleTheme();
              closeUtilityMenu();
            }}
          >
            {prefs.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            {prefs.theme === 'dark' ? 'Use light appearance' : 'Use dark appearance'}
          </button>
        );
    }
  };

  return (
    <div className="table-app-bg min-h-screen">
      {/* MOBILE: full-screen Offsuit-style app view */}
      <div
        className="flex min-h-[100dvh] flex-col overflow-x-hidden bg-slate-950 text-white md:hidden"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center gap-2 px-4 pt-3">
          <Link
            to="/lobby"
            aria-label="Leave table"
            className="-ml-1.5 rounded-full p-1.5 text-white/70 active:bg-white/10"
          >
            <ArrowLeft size={20} weight="bold" />
          </Link>
          <div className="min-w-0">
            <div className="truncate font-display text-base font-bold leading-tight">
              {room.room.name}
            </div>
            <div className="font-display text-[0.65rem] tracking-widest text-white/40">
              {room.room.joinCode} · {room.room.sb}/{room.room.bb}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {handLive && secs !== null && (
              <span
                className={cn(
                  'rounded-full bg-white/10 px-2.5 py-1 font-display text-sm font-semibold',
                  urgent && 'animate-urgent bg-rose-500/20 text-rose-300',
                )}
              >
                0:{String(secs).padStart(2, '0')}
              </span>
            )}
            <button
              onClick={() => (voiceState.joined ? voice.toggleMute() : void voice.join())}
              aria-label={
                voiceState.joined ? (voiceState.muted ? 'Unmute' : 'Mute') : 'Join voice chat'
              }
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full bg-white/10 active:scale-95',
                voiceState.joined && !voiceState.muted && 'bg-emerald-500/25 text-emerald-300',
                voiceState.joined && voiceState.muted && 'bg-rose-500/25 text-rose-300',
              )}
            >
              {voiceState.joined && voiceState.muted ? (
                <MicrophoneSlash size={17} weight="bold" />
              ) : (
                <Microphone size={17} weight={voiceState.joined ? 'bold' : 'regular'} />
              )}
            </button>
            <button
              onClick={() => setChatOpen(true)}
              aria-label="Open chat"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 active:scale-95"
            >
              <ChatCircle size={17} />
            </button>
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Table menu"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 active:scale-95"
            >
              <DotsThreeVertical size={19} weight="bold" />
            </button>
          </div>
        </div>

        <MobileTable
          opponents={opponents}
          me={me}
          mySeat={mySeat}
          isHost={!!isHost}
          myCards={hand.myCards}
          board={hand.board}
          pot={pot}
          urgent={urgent}
          statusText={mobileStatus}
          dimBoard={notInHand}
        />

        {(showResult || !me || hasPeekContent) && (
          <div className="space-y-3 px-4 pb-6">
            {mobileResult}
            {mobilePeekPanel}
            {!me && (amSpectator ? spectatorPanel : mobileSeatPicker)}
          </div>
        )}

        {menuOpen && (
          <div
            className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60"
            onClick={() => setMenuOpen(false)}
          >
            <div
              className="space-y-4 rounded-t-3xl bg-slate-900 p-5 pb-8 text-white ring-1 ring-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
              <div className="flex flex-wrap gap-2">
                <BankControls roomId={roomId!} />
              </div>
              <div className="flex gap-2">
                <Link to={`/room/${roomId}/ledger`} className="flex-1">
                  <Button variant="secondary" className="w-full">
                    Ledger
                  </Button>
                </Link>
                <Link to={`/room/${roomId}/hands`} className="flex-1">
                  <Button variant="secondary" className="w-full">
                    Hands
                  </Button>
                </Link>
              </div>
              <div className="flex gap-2">
                {mySeat !== null && (
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={() => setSitOut(!meSittingOut)}
                  >
                    {meSittingOut ? 'Deal me back in' : 'Sit out next hands'}
                  </Button>
                )}
                <Button variant="secondary" className="flex-1" onClick={toggleTheme}>
                  {prefs.theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setMenuOpen(false);
                    setStandingsOpen(true);
                  }}
                >
                  <Trophy size={16} /> Standings
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setMenuOpen(false);
                    setInviteOpen(true);
                  }}
                >
                  Invite friends
                </Button>
              </div>
              {room.room.meetLink && (
                <a href={room.room.meetLink} target="_blank" rel="noreferrer" className="block">
                  <Button variant="secondary" className="w-full">
                    <VideoCamera size={16} /> Join the video call
                  </Button>
                </a>
              )}
              {isBankerHere && (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setMenuOpen(false);
                    setWatchOpen(true);
                  }}
                >
                  <Eye size={16} /> Watch-only share link
                </Button>
              )}
              {isHost && (
                <label className="flex items-center justify-between text-sm text-white/70">
                  Turn timer{handLive && ' (next hand)'}
                  <select
                    value={room.room.actionSecs ?? 45}
                    disabled={handLive}
                    onChange={(e) => void api.roomSettings(roomId!, +e.target.value)}
                    className="rounded-lg border border-white/20 bg-slate-800 px-2.5 py-1.5 text-white"
                  >
                    {[15, 30, 45, 60, 90, 120].map((t) => (
                      <option key={t} value={t}>
                        {t}s
                      </option>
                    ))}
                    <option value={0}>No limit</option>
                  </select>
                </label>
              )}
            </div>
          </div>
        )}

        {chatOpen && (
          <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 p-3">
            <div className="mb-2 flex justify-end">
              <Button variant="secondary" onClick={() => setChatOpen(false)}>
                <X size={16} /> Close
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <ChatPanel />
            </div>
          </div>
        )}
      </div>

      {/* DESKTOP */}
      <div className="mx-auto hidden min-h-screen w-full max-w-[96rem] flex-col gap-4 px-5 py-4 md:flex lg:px-7">
        <header className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/80 p-2.5 shadow-[0_12px_36px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70 dark:bg-slate-950/70 dark:ring-slate-800">
          <Link
            to="/lobby"
            className={desktopIconClass}
            aria-label="Leave table"
            title="Leave table"
          >
            <ArrowLeft size={19} weight="bold" />
          </Link>
          <div className="min-w-0 pr-2">
            <h1 className="truncate font-display text-lg font-semibold tracking-[-0.02em]">
              {room.room.name}
            </h1>
            <div className="mt-0.5 flex items-center gap-2 text-[0.68rem] text-slate-500">
              {room.room.joinCode !== '' && (
                <span className="font-display font-semibold tracking-[0.16em] text-indigo-600 dark:text-indigo-300">
                  {room.room.joinCode}
                </span>
              )}
              <span>
                blinds {room.room.sb}/{room.room.bb}
              </span>
              <span className="flex items-center gap-1" title="Seated players / in this hand">
                <UsersThree size={13} /> {seatViews.length}
                {handLive ? ` · ${hand.seats.length} in hand` : ''}
              </span>
            </div>
          </div>

          {room.room.auditMode === 'strict-audit' && <Badge tone="amber">strict audit</Badge>}
          {room.room.voided && (
            <span title="The banker voided this table: results do not count anywhere">
              <Badge tone="rose">void table</Badge>
            </span>
          )}
          {handLive && secs !== null && (
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 font-display text-sm font-semibold tabular-nums dark:bg-slate-900',
                urgent && 'animate-urgent bg-rose-50 text-rose-600 dark:bg-rose-950',
              )}
            >
              <Timer size={15} weight="bold" /> 0:{String(secs).padStart(2, '0')}
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
            <BankControls roomId={roomId!} mode="hub" />
            <DesktopIconButton
              label={
                voiceState.joined
                  ? voiceState.muted
                    ? 'Unmute voice'
                    : 'Mute voice'
                  : 'Join voice'
              }
              onClick={() => (voiceState.joined ? voice.toggleMute() : void voice.join())}
              className={cn(
                voiceState.joined &&
                  !voiceState.muted &&
                  '!bg-emerald-100 !text-emerald-700 dark:!bg-emerald-950 dark:!text-emerald-300',
                voiceState.joined &&
                  voiceState.muted &&
                  '!bg-rose-100 !text-rose-700 dark:!bg-rose-950 dark:!text-rose-300',
              )}
            >
              {voiceState.joined && voiceState.muted ? (
                <MicrophoneSlash size={19} weight="bold" />
              ) : (
                <Microphone size={19} weight={voiceState.joined ? 'bold' : 'regular'} />
              )}
            </DesktopIconButton>
            <DesktopIconButton
              label={unreadChat > 0 ? `Toggle chat, ${unreadChat} unread messages` : 'Toggle chat'}
              onClick={() => setChatOpen((open) => !open)}
              active={chatOpen}
              badge={unreadChat}
              buttonRef={desktopChatTriggerRef}
            >
              <ChatCircle size={20} weight={chatOpen ? 'fill' : 'regular'} />
            </DesktopIconButton>

            <Link
              to={`/room/${roomId}/3d`}
              className={desktopIconClass}
              aria-label="3D table"
              title="3D table"
            >
              <Cube size={19} />
            </Link>
            <DesktopIconButton
              label={isFullscreen ? 'Exit full screen' : 'Full screen'}
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void document.documentElement.requestFullscreen().catch(() => {});
              }}
              active={isFullscreen}
            >
              {isFullscreen ? <CornersIn size={19} /> : <CornersOut size={19} />}
            </DesktopIconButton>

            <div className="relative">
              <DesktopIconButton
                label="More table controls"
                onClick={() => setMenuOpen((open) => !open)}
                active={menuOpen}
                hasPopup
                expanded={menuOpen}
                buttonRef={desktopMenuTriggerRef}
              >
                <DotsThreeVertical size={20} weight="bold" />
              </DesktopIconButton>
              {menuOpen && (
                <>
                  <button
                    className="fixed inset-0 z-20 cursor-default"
                    aria-label="Close table controls"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    ref={desktopMenuRef}
                    role="menu"
                    aria-label="Table controls"
                    className="absolute right-0 top-12 z-30 w-72 rounded-2xl bg-white p-2 shadow-[0_20px_60px_rgba(15,23,42,0.18)] ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
                  >
                    {utilityGroups.map((group, index) => (
                      <div
                        key={group.id}
                        role="group"
                        aria-label={utilityGroupLabels[group.id]}
                        className={cn(
                          index > 0 && 'mt-1 border-t border-slate-100 pt-1 dark:border-slate-800',
                        )}
                      >
                        <div className="px-3 pb-1 pt-2 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                          {utilityGroupLabels[group.id]}
                        </div>
                        {group.actions.map((action) => (
                          <div key={action} role="none">
                            {utilityAction(action)}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div className="flex flex-1 items-start gap-4">
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          <section
            aria-label="Poker board"
            className={cn(
              'relative flex min-h-[clamp(32rem,64vh,54rem)] flex-col gap-3 overflow-hidden rounded-[2rem] bg-slate-200/50 px-2 pb-2 pt-4 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:ring-slate-800 sm:px-4 lg:px-6',
              notInHand && 'opacity-60 saturate-50',
            )}
          >
            {thunderKey > 0 && <div key={thunderKey} className="thunder-flash" aria-hidden="true" />}
            {floats.map((reaction) => (
              <span
                key={reaction.id}
                className="animate-float pointer-events-none absolute top-1/3 z-10 text-5xl"
                style={{ left: `${reaction.left}%` }}
              >
                {reaction.emoji}
              </span>
            ))}
            <RoundTable
              seats={seatViews}
              mySeat={mySeat}
              myUserId={auth.userId}
              myCards={hand.myCards}
              committedBySeat={Object.fromEntries(
                (hand.betting?.seats ?? []).map((s) => [s.seat, s.committed]),
              )}
              urgent={urgent}
              handLive={handLive}
              canSit={mySeat === null && !amSpectator}
              onSit={sit}
              canKick={isBankerHere}
              onKick={(userId) =>
                void api
                  .standUp(roomId!, userId)
                  .catch((err) =>
                    useStore
                      .getState()
                      .pushError(err instanceof Error ? err.message : 'could not stand them up'),
                  )
              }
              bankerId={room.room.bankerId}
              coBankerId={room.room.coBankerId}
              bb={room.room.bb}
              onMyCardsClick={() => {
                localStorage.setItem('4am-big-cards', 'on');
                setBigCards(true);
              }}
              readyCheck={!handLive ? hand.readyCheck : null}
            >
            <div className="relative">
              <motion.div
                key={pot}
                initial={pot > 0 ? { scale: 1.14 } : false}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                className="absolute inset-0 rounded-xl bg-indigo-600 shadow-[0_12px_30px_rgba(79,70,229,0.22)]"
                aria-hidden="true"
              />
              <div className="relative px-5 py-2.5 font-display text-lg font-semibold text-white">
                POT <NumberFlow value={pot} />
              </div>
            </div>
            {pot > 0 && (
              <ChipStack amount={pot} bb={room.room.bb} size="lg" className="justify-center" />
            )}
            {showResult ? (
              <div className="max-h-[44vh] w-full overflow-y-auto">{resultBanner}</div>
            ) : (
              <>
            {hand.ritOffer && (
              <div className="z-20 flex flex-col items-center gap-2 rounded-2xl bg-fuchsia-600/95 px-5 py-3 text-white shadow-[0_18px_50px_rgba(192,38,211,0.35)]">
                <span className="font-display text-lg font-bold">
                  🔁 Run it twice? ·{' '}
                  {Math.max(0, Math.ceil((hand.ritOffer.deadlineTs - now) / 1000))}s
                </span>
                {mySeat !== null && hand.ritOffer.voters.includes(mySeat) && !hand.ritOffer.voted ? (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="border-0 bg-white! text-fuchsia-700! hover:bg-fuchsia-50!"
                      onClick={() => ritVote(true)}
                    >
                      Twice 🔁
                    </Button>
                    <Button
                      variant="secondary"
                      className="border-0 bg-white/20! text-white! hover:bg-white/30!"
                      onClick={() => ritVote(false)}
                    >
                      Once
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-fuchsia-100">
                    Everyone is all-in - the rest of the board deals twice if all agree.
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center justify-center gap-2.5 lg:gap-3">
                {hand.board2.length > 0 && (
                  <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-fuchsia-500">
                    Run 1
                  </span>
                )}
                {[0, 1, 2, 3, 4].map((index) =>
                  hand.board[index] !== undefined ? (
                    <PlayingCard
                      key={`${index}-${hand.board[index]}`}
                      card={hand.board[index]}
                      size="table"
                      deal
                      // the three flop cards land together, so cascade them; the
                      // turn and river arrive alone and flip immediately
                      dealDelay={hand.board.length === 3 ? index * 0.16 : 0}
                    />
                  ) : (
                    <div
                      key={index}
                      className="h-36 w-24 rounded-2xl border-2 border-dashed border-slate-300/80 dark:border-slate-700"
                      aria-label={`Empty community card ${index + 1}`}
                    />
                  ),
                )}
              </div>
              {/* the second runout grows underneath as its twin cards land */}
              {hand.board2.length > 0 && (
                <div className="flex items-center justify-center gap-2">
                  <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-fuchsia-500">
                    Run 2
                  </span>
                  {[0, 1, 2, 3, 4].map((index) =>
                    hand.board2[index] !== undefined ? (
                      <PlayingCard
                        key={`r2-${index}-${hand.board2[index]}`}
                        card={hand.board2[index]}
                        size="lg"
                        deal
                      />
                    ) : (
                      <div
                        key={`r2-${index}`}
                        className="h-20 w-14 rounded-lg border-2 border-dashed border-fuchsia-400/30 md:h-32 md:w-[5.6rem] md:rounded-2xl"
                        aria-label={`Empty run 2 card ${index + 1}`}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
            {!handLive && !showResult && (
              <div className="text-center">
                <p className="text-sm text-slate-500">
                  {mySeat === null
                    ? 'Pick a seat.'
                    : opponents.length === 0
                      ? 'Invite a friend to deal.'
                      : 'Ready.'}
                </p>
                {mySeat !== null && isHost && opponents.length > 0 && (
                  <Button className="mt-5 h-11 rounded-xl px-5" onClick={startHand}>
                    <Play size={17} weight="fill" /> Deal hand
                  </Button>
                )}
              </div>
            )}
            {notInHand && (
              <p className="rounded-xl bg-white/90 px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm dark:bg-slate-800/90 dark:text-slate-300">
                You're in the next hand.
              </p>
            )}
            {!handLive && opponents.length === 0 && !amSpectator && (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="flex items-center gap-2 rounded-full bg-white/80 px-4 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/70 hover:text-slate-900 dark:bg-slate-900/80 dark:text-slate-300 dark:ring-slate-700/70 dark:hover:text-slate-100"
              >
                <UserPlus size={15} /> Invite friends · code{' '}
                <span className="font-display text-indigo-600 dark:text-indigo-300">
                  {room.room.joinCode}
                </span>
              </button>
            )}
              </>
            )}
            </RoundTable>
          </section>

          {/* the control strip sits under the table so the oval keeps its space */}
          {amSpectator && spectatorPanel}
          <ActionBar mySeat={mySeat} isHost={!!isHost} urgent={urgent} hideIdleStart />

          {peekPanel}

          {bigCards && handLive && hand.myCards.length > 0 && !notInHand && (
            <FloatingCards
              cards={hand.myCards}
              onClose={() => {
                localStorage.setItem('4am-big-cards', 'off');
                setBigCards(false);
              }}
            />
          )}
        </main>

        {/* chat rides beside the table as a real column, never an overlay */}
        {chatOpen && (
          <aside
            aria-label="Table chat"
            className="sticky top-4 hidden max-h-[calc(100dvh-2rem)] min-h-[30rem] w-80 shrink-0 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 md:flex dark:bg-slate-900 dark:ring-slate-700/70"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
              <h2 className="font-display text-sm font-semibold">Table chat</h2>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label="Close chat"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 p-2.5">
              <ChatPanel chrome={false} />
            </div>
          </aside>
        )}
        </div>
      </div>


      <BrokeBuyInDialog
        roomId={roomId!}
        open={amBroke && !brokeDismissed}
        onClose={() => setBrokeDismissed(true)}
      />
      <ShareHandDialog open={shareOpen} onClose={() => setShareOpen(false)} data={shareData} />
      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite friends to this table"
      >
        <InviteFriendsDialogBody roomId={roomId!} memberIds={room.players.map((p) => p.userId)} />
      </Dialog>
      <Dialog open={watchOpen} onClose={() => setWatchOpen(false)} title="Watch-only share link">
        <div className="space-y-4">
          <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={watchInfo?.allow ?? false}
              onChange={(e) =>
                void api
                  .spectateSettings(roomId!, e.target.checked)
                  .then(setWatchInfo)
                  .catch(() => {})
              }
              className="mt-0.5"
            />
            <span>
              Let anyone with the link watch this table. Viewers see the public game only: no hole
              cards, no join code, no chips of their own.
            </span>
          </label>
          {watchInfo && (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800">
                {`${location.origin}/watch/${watchInfo.token}`}
              </code>
              <Button
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard.writeText(`${location.origin}/watch/${watchInfo.token}`)
                }
              >
                Copy
              </Button>
            </div>
          )}
          {joinReqs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Watchers asking to play
              </p>
              {joinReqs.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {r.displayName}
                  </span>
                  <Button
                    variant="success"
                    onClick={() =>
                      void api
                        .admit(roomId!, r.userId, true)
                        .then(() => setJoinReqs((q) => q.filter((x) => x.id !== r.id)))
                    }
                  >
                    Let them in
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void api
                        .admit(roomId!, r.userId, false)
                        .then(() => setJoinReqs((q) => q.filter((x) => x.id !== r.id)))
                    }
                  >
                    No
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Dialog>
      <Dialog open={standingsOpen} onClose={() => setStandingsOpen(false)} title="Room standings">
        {standings === null ? (
          <Spinner label="Counting the chips…" />
        ) : standings.length === 0 ? (
          <p className="text-sm text-slate-500">No completed hands yet. Deal one and check back.</p>
        ) : (
          <LeaderboardTable rows={standings} minHands={room.room.minSettleHands} />
        )}
      </Dialog>

      {/* connection state */}
      {room && !wsConnected && (
        <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg">
          Connection lost. Reconnecting…
        </div>
      )}

      {/* error toasts */}
      {errors.length > 0 && (
        <div className="fixed bottom-4 left-4 z-50 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
          {errors[0]}
        </div>
      )}
    </div>
  );
}
