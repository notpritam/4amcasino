import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { Crown, Coins, MicrophoneSlash, X } from '@phosphor-icons/react';
import type { CardId, PlayerAction } from '@4am/shared';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Avatar } from '../../entities/user/Avatar.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import type { SeatView } from './players.tsx';
import { ChipStack } from './ChipStack.tsx';

/** A real round table: nine seat pods around an oval, your seat pinned at the
 *  bottom, everyone repositioning live as they sit, act, and fold. The banker
 *  sees every seat and can stand a player up (both requested by notpritam,
 *  docs/FEATURES.md). Empty seats are sittable in place. */

const SEATS = 9;

function actionLabel(a: PlayerAction & { auto?: boolean }): string {
  if (a.type === 'fold') return a.auto ? 'timed out' : 'fold';
  if (a.type === 'check') return 'check';
  if (a.type === 'call') return 'call';
  if (a.type === 'bet') return `bet ${fmt(a.amount ?? 0)}`;
  return `raise ${fmt(a.amount ?? 0)}`;
}

export function RoundTable({
  seats,
  mySeat,
  myUserId,
  myCards,
  committedBySeat,
  urgent,
  handLive,
  canSit,
  onSit,
  canKick,
  onKick,
  bankerId,
  coBankerId,
  bb,
  onMyCardsClick,
  children,
}: {
  seats: SeatView[];
  mySeat: number | null;
  myUserId: number | null;
  myCards: CardId[];
  committedBySeat: Record<number, number>;
  urgent: boolean;
  handLive: boolean;
  canSit: boolean;
  onSit: (seat: number) => void;
  canKick: boolean;
  onKick: (userId: number) => void;
  bankerId: number;
  coBankerId: number | null;
  bb: number;
  onMyCardsClick?: () => void;
  children: React.ReactNode;
}) {
  // two-tap kick: first tap arms, second confirms, so a stray click never stands anyone up
  const [kickArmed, setKickArmed] = useState<number | null>(null);
  const reduce = useReducedMotion();
  // only occupied seats show, auto-spread evenly around the oval; when seated,
  // the order rotates so YOUR seat sits bottom-center
  const occupied = [...seats].sort((a, b) => a.seat - b.seat);
  let order = occupied;
  if (mySeat !== null) {
    const i = occupied.findIndex((x) => x.seat === mySeat);
    if (i > 0) order = [...occupied.slice(i), ...occupied.slice(0, i)];
  }
  const n = Math.max(order.length, 1);
  const angleOf = (idx: number) => (Math.PI / 180) * (90 + (idx / n) * 360);
  const RX = 45;
  // bottom seats sit a touch lower so your pod never crowds the board
  const ry = (a: number) => (Math.sin(a) > 0 ? 38 : 33);
  // an unseated member sees where they can join: one + per cyclic gap that
  // still has a free seat number in it, placed between the neighbors
  const sitSpots: { seat: number; x: number; y: number }[] = [];
  if (canSit && !handLive) {
    if (order.length === 0) {
      sitSpots.push({ seat: 0, x: 50, y: 88 });
    } else {
      for (let i = 0; i < order.length; i++) {
        const from = order[i]!.seat;
        const to = order[(i + 1) % order.length]!.seat;
        let free: number | null = null;
        for (let c = (from + 1) % SEATS; c !== to; c = (c + 1) % SEATS) {
          if (!seats.some((x) => x.seat === c)) {
            free = c;
            break;
          }
        }
        if (free !== null) {
          const a = (Math.PI / 180) * (90 + ((i + 0.5) / n) * 360);
          sitSpots.push({ seat: free, x: 50 + RX * Math.cos(a), y: 50 + ry(a) * Math.sin(a) });
        }
      }
    }
  }

  return (
    <div className="relative min-h-[30rem] w-full flex-1">
      {/* isometric table, bottom-up: ground shadow, the table's dark side,
          a bright rim band, the felt inset on top, and a racetrack line */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[calc(50%+36px)] h-[60%] w-[88%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-slate-600/30 blur-xl dark:bg-black/70"
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[calc(50%+26px)] h-[60%] w-[87%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-slate-500/60 dark:bg-slate-700/80"
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-[60%] w-[87%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-slate-300/90 dark:bg-slate-400/50"
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[calc(50%+1px)] h-[56%] w-[83%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-gradient-to-b from-slate-200/95 to-slate-300/90 shadow-[inset_0_4px_14px_rgba(15,23,42,0.18)] dark:from-slate-900 dark:to-slate-950 dark:shadow-[inset_0_4px_18px_rgba(0,0,0,0.55)]"
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-[45%] w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-slate-400/50 dark:border-slate-500/40"
      />

      {/* pot, board, and status live at the center */}
      <div className="absolute left-1/2 top-1/2 z-10 flex w-[66%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-5">
        {children}
      </div>

      {sitSpots.map((spot) => (
        <div
          key={`sit-${spot.seat}`}
          className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
        >
          <button
            onClick={() => onSit(spot.seat)}
            className="flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 border-dashed border-indigo-400/50 text-xs font-semibold text-indigo-500 transition-colors hover:border-indigo-400 hover:bg-indigo-500/10 dark:text-indigo-300"
          >
            Sit
          </button>
        </div>
      ))}

      {order.map((p, i) => {
        const seat = p.seat;
        const a = angleOf(i);
        const x = 50 + RX * Math.cos(a);
        const y = 50 + ry(a) * Math.sin(a);
        const committed = committedBySeat[seat] ?? 0;
        const bet = { x: 50 + 27 * Math.cos(a), y: 50 + 19 * Math.sin(a) };
        const isMe = p.userId === myUserId;

        const isBanker = p.userId === bankerId;
        const isCoBanker = coBankerId !== null && p.userId === coBankerId;
        return (
          <div key={seat}>
            {/* chips this player has pushed toward the pot this street: they
                slide in from the seat on every bet, and sweep into the pot
                when the street closes */}
            <AnimatePresence>
              {committed > 0 && (
                <motion.div
                  exit={
                    reduce
                      ? { opacity: 0 }
                      : { left: '50%', top: '44%', opacity: 0, scale: 0.5 }
                  }
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1"
                  style={{ left: `${bet.x}%`, top: `${bet.y}%` }}
                >
                  <motion.div
                    key={committed}
                    initial={
                      reduce
                        ? false
                        : {
                            x: (x - bet.x) * 3.2,
                            y: (y - bet.y) * 3.2,
                            opacity: 0.4,
                          }
                    }
                    animate={{ x: 0, y: 0, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                    className="flex items-center gap-1"
                  >
                    <ChipStack amount={committed} bb={bb} />
                    <span className="rounded-full bg-indigo-600/90 px-1.5 py-0.5 font-display text-[0.68rem] font-bold text-white shadow-sm">
                      {fmt(committed)}
                    </span>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
            <div
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div
              className={cn(
                'flex w-32 flex-col items-center gap-1 rounded-2xl bg-white/90 p-2 text-center ring-1 ring-slate-200/80 transition-all dark:bg-slate-900/90 dark:ring-slate-700/70',
                isMe && 'w-36 bg-white ring-indigo-300/70 shadow-md dark:bg-slate-900 dark:ring-indigo-500/40',
                p.isToAct && 'turn-glow scale-[1.06] ring-2 ring-indigo-500',
                p.isToAct && urgent && 'turn-glow-rose ring-rose-500',
                p.isLeader && !p.isToAct && 'ring-2 ring-amber-400/70',
                p.won && 'animate-winner',
                (p.folded || !p.connected) && 'opacity-55',
                p.sittingOut && 'opacity-60 saturate-50',
              )}
            >
              {p.isToAct && (
                <span
                  className={cn(
                    'absolute -top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-white shadow-md',
                    urgent ? 'bg-rose-600' : 'bg-indigo-600',
                  )}
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white motion-reduce:animate-none" />
                  playing
                </span>
              )}
              {/* my hole cards ride above my pod; opponents show backs or reveals */}
              {p.inHand && (isMe ? myCards.length > 0 || !p.folded : !p.folded || p.revealed) && (
                <div
                  className={cn('flex', isMe ? 'cursor-pointer gap-1' : '-space-x-2')}
                  onClick={isMe ? onMyCardsClick : undefined}
                  title={isMe ? 'Show big cards' : undefined}
                >
                  {isMe && myCards.length > 0 ? (
                    myCards.map((c) => <PlayingCard key={c} card={c} size="sm" deal />)
                  ) : p.revealed ? (
                    p.revealed.map((c) => <PlayingCard key={c} card={c} size="xs" deal />)
                  ) : (
                    <>
                      <PlayingCard faceDown size="xs" />
                      <PlayingCard faceDown size="xs" />
                    </>
                  )}
                </div>
              )}
              <div className="relative">
                <Link to={`/players/${p.userId}`} aria-label={`${p.displayName}'s profile`}>
                  <Avatar
                    userId={p.userId}
                    name={p.displayName}
                    version={p.avatarVersion}
                    size="sm"
                    speaking={p.speaking}
                  />
                </Link>
                {p.isLeader && (
                  <span
                    title="Chip leader"
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-white"
                  >
                    <Crown size={9} weight="fill" />
                  </span>
                )}
                {(isBanker || isCoBanker) && (
                  <span
                    title={isBanker ? 'Banker' : 'Backup banker'}
                    className={cn(
                      'absolute -bottom-1 -left-1.5 flex h-4 w-4 items-center justify-center rounded-full text-white',
                      isBanker ? 'bg-indigo-600' : 'bg-slate-500',
                    )}
                  >
                    <Coins size={9} weight="fill" />
                  </span>
                )}
                {p.isButton && (
                  <span
                    title="Dealer button"
                    className="absolute -bottom-1 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-[0.55rem] font-bold text-white dark:bg-slate-200 dark:text-slate-900"
                  >
                    D
                  </span>
                )}
                {p.voiceMuted && (
                  <span
                    title="muted"
                    className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-white"
                  >
                    <MicrophoneSlash size={9} weight="fill" />
                  </span>
                )}
              </div>
              <div className="w-full truncate px-1 text-xs font-semibold leading-tight" title={p.displayName}>
                {isMe ? 'You' : p.displayName}
              </div>
              <div
                className={cn(
                  'font-display text-[0.7rem] leading-none',
                  p.broke ? 'font-bold text-rose-500' : 'text-slate-500 dark:text-slate-400',
                )}
              >
                <NumberFlow value={p.stack} />
              </div>
              {p.pendingBuy > 0 && (
                <div
                  title="Buy waiting for banker approval"
                  className="rounded-full bg-amber-400/15 px-1.5 py-px font-display text-[0.62rem] font-bold text-amber-500"
                >
                  +{fmt(p.pendingBuy)} soon
                </div>
              )}
              {p.broke || !p.connected || p.sittingOut ? (
                <div
                  className={cn(
                    'text-[0.6rem] font-semibold uppercase tracking-wide',
                    p.broke ? 'text-rose-500' : !p.connected ? 'text-amber-500' : 'text-slate-400',
                  )}
                >
                  {p.broke ? 'out of chips' : !p.connected ? 'offline' : 'sitting out'}
                </div>
              ) : p.lastAction || p.allIn ? (
                (() => {
                  const a = p.lastAction;
                  const aggressive = a && (a.type === 'raise' || a.type === 'bet');
                  const folded = a?.type === 'fold';
                  return (
                    <motion.div
                      key={a ? `${a.type}-${a.amount ?? 0}` : 'all-in'}
                      initial={reduce ? false : { scale: 1.45, y: -3 }}
                      animate={{ scale: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 17 }}
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide',
                        !a || aggressive
                          ? 'bg-amber-400 text-amber-950 shadow-[0_0_14px_rgba(251,191,36,0.55)]'
                          : folded
                            ? 'bg-rose-500/15 text-rose-500'
                            : 'bg-slate-200/80 text-slate-600 dark:bg-slate-700/80 dark:text-slate-200',
                      )}
                    >
                      {a ? actionLabel(a) : 'all-in'}
                    </motion.div>
                  );
                })()
              ) : null}
            </div>
            {canKick && !isMe && (
              <button
                onClick={() => {
                  if (kickArmed === p.userId) {
                    setKickArmed(null);
                    onKick(p.userId);
                  } else {
                    setKickArmed(p.userId);
                    setTimeout(() => setKickArmed((v) => (v === p.userId ? null : v)), 3500);
                  }
                }}
                title={kickArmed === p.userId ? 'Tap again to stand them up' : 'Stand this player up'}
                className={cn(
                  'absolute -right-2 -top-2 z-30 flex items-center justify-center rounded-full text-white shadow-sm transition-all',
                  kickArmed === p.userId
                    ? 'h-auto w-auto bg-rose-600 px-2 py-0.5 text-[0.62rem] font-bold'
                    : 'h-5 w-5 bg-slate-400 hover:bg-rose-500 dark:bg-slate-600',
                )}
              >
                {kickArmed === p.userId ? 'stand up?' : <X size={11} weight="bold" />}
              </button>
            )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
