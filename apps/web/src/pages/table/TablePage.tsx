import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, ChatCircle, DotsThreeVertical, Microphone, MicrophoneSlash, Timer, X } from '@phosphor-icons/react';
import NumberFlow from '@number-flow/react';
import confetti from 'canvas-confetti';
import { HAND_CATEGORY_NAMES, handCategory } from '@4am/shared';
import { bindGameClient, sit } from '../../shared/gameClient.ts';
import { wsClient } from '../../shared/ws.ts';
import { useStore } from '../../shared/store.ts';
import { api } from '../../shared/api.ts';
import { voice } from '../../shared/voice.ts';
import { play } from '../../shared/sounds.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Badge, Button, Panel, Spinner } from '../../shared/ui/index.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { PlayerRow, YouRow, type SeatView } from '../../widgets/table/players.tsx';
import { ActionBar } from '../../widgets/table/ActionBar.tsx';
import { ChatPanel } from '../../widgets/table/ChatPanel.tsx';
import { MobileTable } from '../../widgets/table/MobileTable.tsx';
import { BankControls } from '../../widgets/table/BankControls.tsx';
import { BrokeBuyInDialog } from '../../features/bank/BrokeBuyInDialog.tsx';

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
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [floats, setFloats] = useState<FloatingReaction[]>([]);
  const floatId = useRef(0);
  const lastChatLen = useRef(0);
  const beepedUrgent = useRef<string | null>(null);
  const now = useNow();

  useEffect(() => {
    bindGameClient();
    wsClient.joinRoom(roomId!);
    // validate membership over REST too: surfaces 401/403/404 instead of hanging
    api.getRoom(roomId!).catch((e) => setJoinError(e instanceof Error ? e.message : 'could not load room'));
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
      setTimeout(() => confetti({ particleCount: 50, angle: 60, spread: 60, origin: { x: 0, y: 0.8 } }), 220);
      setTimeout(() => confetti({ particleCount: 50, angle: 120, spread: 60, origin: { x: 1, y: 0.8 } }), 380);
    }
  }, [hand.result]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (errors.length === 0) return;
    const t = setTimeout(dismissError, 4000);
    return () => clearTimeout(t);
  }, [errors, dismissError]);

  const mySeat = room?.players.find((p) => p.userId === auth.userId)?.seat ?? null;
  const isHost = room?.room.hostId === auth.userId;
  const handLive = hand.handId !== null && !hand.result && !hand.abort;
  const myRoomStack = room?.players.find((p) => p.userId === auth.userId)?.stack ?? null;
  const amBroke = mySeat !== null && myRoomStack === 0 && !handLive;
  const remaining = hand.deadline ? hand.deadline - now : null;
  const urgent = handLive && remaining !== null && remaining <= 10_000;

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

  const seatViews = useMemo((): SeatView[] => {
    if (!room) return [];
    return room.players
      .filter((p) => p.seat !== null)
      .sort((a, b) => a.seat! - b.seat!)
      .map((p) => {
        const engineSeat = hand.betting?.seats.find((s) => s.seat === p.seat);
        const inHand = hand.handId !== null && !hand.abort && hand.seats.some((s) => s.seat === p.seat);
        const reveal = hand.showdown?.reveals.find((r) => r.seat === p.seat);
        const won = !!hand.result && (hand.result.deltas.find((d) => d.seat === p.seat)?.delta ?? 0) > 0;
        const stackShown = engineSeat && handLive ? engineSeat.stack : p.stack;
        return {
          seat: p.seat!,
          userId: p.userId,
          username: p.username,
          displayName: p.displayName,
          avatarVersion: p.avatarVersion,
          stack: stackShown,
          broke: stackShown === 0 && !(handLive && inHand),
          isButton: inHand && hand.buttonSeat === p.seat,
          isToAct: handLive && hand.betting?.toAct === p.seat,
          folded: !!engineSeat?.folded,
          allIn: !!engineSeat?.allIn,
          inHand,
          connected: p.connected,
          speaking: !!voiceState.speakingByUser[p.userId],
          voiceMuted: !!voiceState.mutedByUser[p.userId],
          revealed: reveal?.cards ?? hand.shown[p.seat!],
          won,
          lastAction: hand.lastActions[p.seat!],
        };
      });
  }, [room, hand, handLive, voiceState]);

  if (!room) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-6 text-center">
        {joinError ? (
          <>
            <p className="max-w-sm text-sm text-rose-600">Could not join this table: {joinError}.</p>
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

  const disconnectedInHand = handLive
    ? seatViews.filter((s) => s.inHand && !s.folded && !s.connected).map((s) => s.displayName)
    : [];
  const mobileStatus = !handLive
    ? null
    : disconnectedInHand.length > 0
      ? `${disconnectedInHand.join(', ')} lost connection. Holding the hand for them to rejoin…`
      : hand.betting
        ? hand.betting.toAct !== null && hand.betting.toAct !== mySeat
          ? `Waiting for ${seatViews.find((s) => s.seat === hand.betting!.toAct)?.displayName ?? 'player'}…`
          : null
        : 'Shuffling the encrypted deck…';

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
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="font-display font-semibold">
              {hand.showdown ? 'Showdown' : 'Everyone folded'}
            </span>
            {hand.showdown?.reveals.map((r) => (
              <span key={r.seat} className="flex items-center gap-1.5 text-sm">
                <span className="text-slate-500">
                  {seatViews.find((s) => s.seat === r.seat)?.displayName}
                </span>
                <Badge tone="slate">{HAND_CATEGORY_NAMES[handCategory(r.score)]}</Badge>
              </span>
            ))}
            {hand.result?.deltas
              .filter((d) => d.delta !== 0)
              .map((d) => (
                <span
                  key={d.seat}
                  className={cn(
                    'font-display text-sm font-bold',
                    d.delta > 0 ? 'text-emerald-600' : 'text-rose-600',
                  )}
                >
                  {seatViews.find((s) => s.seat === d.seat)?.displayName} {d.delta > 0 ? '+' : ''}
                  {fmt(d.delta)}
                </span>
              ))}
          </div>
        )}
      </Panel>
    </motion.div>
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
          {hand.abort.blamedSeat !== null && `. Seat ${hand.abort.blamedSeat + 1}; stacks rolled back.`}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="font-display font-semibold">
            {hand.showdown ? 'Showdown' : 'Everyone folded'}
          </span>
          {hand.showdown?.reveals.map((r) => (
            <span key={r.seat} className="rounded-full bg-white/15 px-2 py-0.5 text-xs">
              {seatViews.find((x) => x.seat === r.seat)?.displayName}:{' '}
              {HAND_CATEGORY_NAMES[handCategory(r.score)]}
            </span>
          ))}
          {hand.result?.deltas
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
        </div>
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

  return (
    <div className="min-h-screen">
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
            <div className="truncate font-display text-base font-bold leading-tight">{room.room.name}</div>
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
              aria-label={voiceState.joined ? (voiceState.muted ? 'Unmute' : 'Mute') : 'Join voice chat'}
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
        />

        {(showResult || !me) && (
          <div className="space-y-3 px-4 pb-6">
            {mobileResult}
            {!me && mobileSeatPicker}
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
      <div className="mx-auto hidden min-h-screen max-w-7xl flex-col gap-4 p-4 md:flex">
      <header className="flex flex-wrap items-center gap-3">
        <Link to="/lobby" className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
          ← Leave table
        </Link>
        <h1 className="font-display text-lg font-bold">{room.room.name}</h1>
        <Badge tone="indigo" className="font-display tracking-widest">
          {room.room.joinCode}
        </Badge>
        <Badge tone="slate">
          blinds {room.room.sb}/{room.room.bb}
        </Badge>
        {room.room.auditMode === 'strict-audit' && <Badge tone="amber">strict audit</Badge>}
        {handLive && secs !== null && (
          <span
            className={cn(
              'rounded-full bg-white px-3 py-1 font-display text-sm font-semibold ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700',
              urgent && 'animate-urgent bg-rose-50 text-rose-600 ring-rose-300 dark:bg-rose-950',
            )}
          >
            <Timer size={15} weight="bold" className="-mt-0.5 mr-1 inline" />
            0:{String(secs).padStart(2, '0')}
          </span>
        )}
        {isHost && (
          <label className="hidden items-center gap-1.5 text-xs text-slate-500 md:flex">
            turn time
            <select
              value={room.room.actionSecs ?? 45}
              disabled={handLive}
              onChange={(e) => void api.roomSettings(roomId!, +e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-1.5 py-1 dark:border-slate-700 dark:bg-slate-800"
              title={handLive ? 'applies from the next hand' : undefined}
            >
              {[15, 30, 45, 60, 90, 120].map((s) => (
                <option key={s} value={s}>
                  {s}s
                </option>
              ))}
              <option value={0}>No limit</option>
            </select>
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={voiceState.joined ? (voiceState.muted ? 'danger' : 'success') : 'secondary'}
            onClick={() => (voiceState.joined ? voice.toggleMute() : void voice.join())}
            title={voiceState.joined ? (voiceState.muted ? 'Unmute' : 'Mute') : 'Join voice chat'}
          >
            {voiceState.joined ? (
              voiceState.muted ? (
                <>
                  <MicrophoneSlash size={16} weight="bold" /> Muted
                </>
              ) : (
                <>
                  <Microphone size={16} weight="bold" /> Live
                </>
              )
            ) : (
              <>
                <Microphone size={16} /> Join voice
              </>
            )}
          </Button>
          <BankControls roomId={roomId!} />
          <Link to={`/room/${roomId}/ledger`}>
            <Button variant="ghost">Ledger</Button>
          </Link>
          <Link to={`/room/${roomId}/hands`}>
            <Button variant="ghost">Hands</Button>
          </Link>
        </div>
      </header>

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
            {/* opponents */}
            <div className="space-y-2.5">
              {opponents.length === 0 && (
                <Panel className="text-sm text-slate-500">
                  Share code <span className="font-display font-bold">{room.room.joinCode}</span> with
                  your friends.
                </Panel>
              )}
              {opponents.map((p) => (
                <PlayerRow key={p.seat} p={p} urgent={urgent} />
              ))}
            </div>

            {/* board */}
            <div className="relative flex min-h-[320px] flex-col items-center justify-center gap-6 rounded-3xl bg-slate-200/50 p-4 ring-1 ring-slate-200 md:min-h-[440px] md:p-6 dark:bg-slate-900/60 dark:ring-slate-800">
              {/* floating sticker reactions */}
              {floats.map((f) => (
                <span
                  key={f.id}
                  className="animate-float pointer-events-none absolute top-1/3 z-10 text-5xl"
                  style={{ left: `${f.left}%` }}
                >
                  {f.emoji}
                </span>
              ))}
              <div className="rounded-xl bg-indigo-600 px-6 py-2 font-display text-xl font-bold text-white shadow">
                POT <NumberFlow value={pot} />
              </div>
              <div className="flex gap-1.5 md:gap-2">
                {[0, 1, 2, 3, 4].map((i) =>
                  hand.board[i] !== undefined ? (
                    <PlayingCard key={`${i}-${hand.board[i]}`} card={hand.board[i]} size="lg" deal />
                  ) : (
                    <div
                      key={i}
                      className="h-20 w-14 rounded-lg border-2 border-dashed border-slate-300 md:h-32 md:w-[5.6rem] md:rounded-2xl dark:border-slate-700"
                    />
                  ),
                )}
              </div>
              {!handLive && !showResult && (
                <p className="text-sm text-slate-500">
                  {mySeat === null ? 'Pick a seat to play.' : 'No hand in progress.'}
                </p>
              )}
            </div>
          </div>

          {/* non-blocking hand result */}
          {resultBanner}

          {/* you + actions */}
          {me ? <YouRow p={me} cards={hand.myCards} urgent={urgent} /> : seatPicker}
          <ActionBar mySeat={mySeat} isHost={!!isHost} urgent={urgent} />
        </div>

        <div className="min-h-80">
          <ChatPanel />
        </div>
      </div>

      </div>

      <BrokeBuyInDialog
        roomId={roomId!}
        open={amBroke && !brokeDismissed}
        onClose={() => setBrokeDismissed(true)}
      />

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
