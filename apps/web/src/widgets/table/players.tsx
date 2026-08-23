import { Link } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import type { CardId, PlayerAction } from '@4am/shared';
import { Badge } from '../../shared/ui/index.tsx';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { Avatar } from '../../entities/user/Avatar.tsx';

export interface SeatView {
  seat: number;
  userId: number;
  username: string;
  displayName: string;
  avatarVersion: number;
  stack: number;
  isButton: boolean;
  isToAct: boolean;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  connected: boolean;
  speaking: boolean;
  voiceMuted: boolean;
  revealed?: CardId[];
  won: boolean;
  lastAction?: PlayerAction & { auto?: boolean };
}

function actionChip(a: PlayerAction & { auto?: boolean }) {
  const label =
    a.type === 'fold'
      ? a.auto
        ? 'TIMED OUT'
        : 'FOLD'
      : a.type === 'check'
        ? 'CHECK'
        : a.type === 'call'
          ? 'CALL'
          : a.type === 'bet'
            ? `BET ${fmt(a.amount ?? 0)}`
            : `RAISE ${fmt(a.amount ?? 0)}`;
  const tone = a.type === 'fold' ? 'rose' : a.type === 'raise' || a.type === 'bet' ? 'amber' : 'slate';
  return <Badge tone={tone}>{label}</Badge>;
}

function VoiceDot({ muted }: { muted: boolean }) {
  if (!muted) return null;
  return (
    <span
      title="muted"
      className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-[0.6rem] text-white ring-2 ring-white dark:ring-slate-900"
    >
      🔇
    </span>
  );
}

export function PlayerRow({ p, urgent }: { p: SeatView; urgent: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl bg-white p-3 pr-4 ring-1 ring-slate-200/70 transition-all dark:bg-slate-900 dark:ring-slate-700/70',
        p.isToAct && 'ring-2 ring-indigo-500 shadow-md',
        p.isToAct && urgent && 'ring-rose-500 animate-urgent',
        p.won && 'animate-winner',
        (p.folded || !p.connected) && 'opacity-50',
      )}
    >
      <div className="relative">
        <Link to={`/players/${p.userId}`} aria-label={`${p.displayName}'s profile`}>
          <Avatar userId={p.userId} name={p.displayName} version={p.avatarVersion} speaking={p.speaking} />
        </Link>
        <VoiceDot muted={p.voiceMuted} />
        {p.isButton && (
          <span
            title="Dealer button"
            className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[0.6rem] font-bold text-white ring-2 ring-white dark:ring-slate-900"
          >
            D
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <Link to={`/players/${p.userId}`} className="block truncate text-sm font-semibold hover:underline">
          {p.displayName}
        </Link>
        <div className="font-display text-xs text-slate-500 dark:text-slate-400">
          <NumberFlow value={p.stack} />
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {p.lastAction ? actionChip(p.lastAction) : p.allIn ? <Badge tone="indigo">ALL-IN</Badge> : null}
      </div>
      {p.inHand && !p.folded && (
        <div className="flex gap-1">
          {p.revealed ? (
            p.revealed.map((c) => <PlayingCard key={c} card={c} size="xs" deal />)
          ) : (
            <>
              <PlayingCard faceDown size="xs" />
              <PlayingCard faceDown size="xs" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function YouRow({ p, cards, urgent }: { p: SeatView; cards: CardId[]; urgent: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200/70 dark:bg-slate-900 dark:ring-slate-700/70',
        p.isToAct && 'ring-2 ring-indigo-500 shadow-lg',
        p.isToAct && urgent && 'ring-rose-500 animate-urgent',
        p.won && 'animate-winner',
        p.folded && 'opacity-60',
      )}
    >
      <div className="relative">
        <Avatar userId={p.userId} name={p.displayName} version={p.avatarVersion} size="lg" speaking={p.speaking} className="bg-indigo-600 text-white" />
        <VoiceDot muted={p.voiceMuted} />
      </div>
      <div>
        <div className="text-sm font-semibold">
          You{p.isButton && <span className="ml-2 text-xs text-slate-400">(dealer)</span>}
        </div>
        <div className="font-display text-sm text-slate-500 dark:text-slate-400">
          <NumberFlow value={p.stack} />
        </div>
      </div>
      <div className="ml-2">{p.lastAction && actionChip(p.lastAction)}</div>
      <div className="ml-auto flex gap-2">
        {p.inHand && !p.folded ? (
          cards.length ? (
            cards.map((c) => <PlayingCard key={c} card={c} size="md" deal />)
          ) : (
            <>
              <PlayingCard faceDown size="md" />
              <PlayingCard faceDown size="md" />
            </>
          )
        ) : null}
      </div>
    </div>
  );
}
