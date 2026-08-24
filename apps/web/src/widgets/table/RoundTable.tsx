import { useState } from 'react';
import { Link } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { Crown, Coins, MicrophoneSlash, X } from '@phosphor-icons/react';
import type { CardId, PlayerAction } from '@4am/shared';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { Avatar } from '../../entities/user/Avatar.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import type { SeatView } from './players.tsx';

/** A real round table: nine seat pods around an oval, your seat pinned at the
 *  bottom, everyone repositioning live as they sit, act, and fold. The banker
 *  sees every seat and can stand a player up (both requested by notpritam,
 *  docs/FEATURES.md). Empty seats are sittable in place. */

const SEATS = 9;

/** Display slot for index i (0 = bottom center, clockwise around an oval). */
function slot(i: number): { x: number; y: number } {
  const a = (Math.PI / 180) * (90 + i * (360 / SEATS));
  return { x: 50 + 44 * Math.cos(a), y: 50 + 42 * Math.sin(a) };
}

function betSpot(i: number): { x: number; y: number } {
  const a = (Math.PI / 180) * (90 + i * (360 / SEATS));
  return { x: 50 + 26 * Math.cos(a), y: 50 + 25 * Math.sin(a) };
}

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
  children: React.ReactNode;
}) {
  // two-tap kick: first tap arms, second confirms, so a stray click never stands anyone up
  const [kickArmed, setKickArmed] = useState<number | null>(null);
  const rotation = mySeat ?? 0;
  const displayIndex = (seat: number) => (seat - rotation + SEATS) % SEATS;
  const bySeat = new Map(seats.map((s) => [s.seat, s]));

  return (
    <div className="relative min-h-[26rem] w-full flex-1">
      {/* faux-isometric table: a darker rim sits a step below the felt surface */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[calc(50%+14px)] h-[68%] w-[74%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-slate-400/40 dark:bg-black/60"
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-[68%] w-[74%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-slate-300/60 bg-gradient-to-b from-slate-100/60 to-slate-200/40 shadow-[inset_0_2px_0_rgba(255,255,255,0.08)] dark:border-slate-700/60 dark:from-slate-900/50 dark:to-slate-950/40"
      />

      {/* pot, board, and status live at the center */}
      <div className="absolute left-1/2 top-1/2 z-10 flex w-[58%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-5">
        {children}
      </div>

      {Array.from({ length: SEATS }, (_, seat) => {
        const p = bySeat.get(seat);
        const i = displayIndex(seat);
        const { x, y } = slot(i);
        const committed = committedBySeat[seat] ?? 0;
        const bet = betSpot(i);
        const isMe = p?.userId === myUserId;

        if (!p) {
          return (
            <div
              key={seat}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {canSit && !handLive ? (
                <button
                  onClick={() => onSit(seat)}
                  className="flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 border-dashed border-indigo-400/50 text-xs font-semibold text-indigo-500 transition-colors hover:border-indigo-400 hover:bg-indigo-500/10 dark:text-indigo-300"
                >
                  Sit
                </button>
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-slate-300/50 text-[0.6rem] text-slate-400/70 dark:border-slate-700/50"
                >
                  {seat + 1}
                </div>
              )}
            </div>
          );
        }

        const isBanker = p.userId === bankerId;
        const isCoBanker = coBankerId !== null && p.userId === coBankerId;
        return (
          <div key={seat}>
            {/* chips this player has pushed toward the pot this street */}
            {committed > 0 && (
              <div
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/90 px-2 py-0.5 font-display text-[0.68rem] font-bold text-white shadow-sm"
                style={{ left: `${bet.x}%`, top: `${bet.y}%` }}
              >
                {fmt(committed)}
              </div>
            )}
            <div
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div
              className={cn(
                'flex w-32 flex-col items-center gap-1 rounded-2xl bg-white/90 p-2 text-center ring-1 ring-slate-200/80 transition-all dark:bg-slate-900/90 dark:ring-slate-700/70',
                isMe && 'w-36 bg-white ring-indigo-300/70 shadow-md dark:bg-slate-900 dark:ring-indigo-500/40',
                p.isToAct && 'ring-2 ring-indigo-500 shadow-lg',
                p.isToAct && urgent && 'ring-rose-500 animate-urgent',
                p.isLeader && !p.isToAct && 'ring-2 ring-amber-400/70',
                p.won && 'animate-winner',
                (p.folded || !p.connected) && 'opacity-55',
                p.sittingOut && 'opacity-60 saturate-50',
              )}
            >
              {/* my hole cards ride above my pod; opponents show backs or reveals */}
              {p.inHand && (isMe ? myCards.length > 0 || !p.folded : !p.folded || p.revealed) && (
                <div className={cn('flex', isMe ? 'gap-1' : '-space-x-2')}>
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
              {(p.broke || p.sittingOut || !p.connected || p.allIn || p.lastAction) && (
                <div
                  className={cn(
                    'text-[0.6rem] font-semibold uppercase tracking-wide',
                    p.broke || p.lastAction?.type === 'fold'
                      ? 'text-rose-500'
                      : !p.connected
                        ? 'text-amber-500'
                        : 'text-slate-400',
                  )}
                >
                  {p.broke
                    ? 'out of chips'
                    : !p.connected
                      ? 'offline'
                      : p.sittingOut
                        ? 'sitting out'
                        : p.lastAction
                          ? actionLabel(p.lastAction)
                          : 'all-in'}
                </div>
              )}
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
