import type { PlayerAction } from '@4am/shared';
import type { CardId } from '@4am/shared';
import { Badge } from '../../shared/ui/index.tsx';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';

export interface SeatView {
  seat: number;
  username: string;
  stack: number;
  isButton: boolean;
  isToAct: boolean;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  connected: boolean;
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

export function PlayerRow({ p }: { p: SeatView }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl bg-white p-3 pr-4 ring-1 ring-slate-200/70 transition-all',
        p.isToAct && 'ring-2 ring-indigo-500 shadow-md',
        (p.folded || !p.connected) && 'opacity-50',
      )}
    >
      <div className="relative">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-100 font-display text-lg font-bold text-indigo-700">
          {p.username[0]?.toUpperCase()}
        </div>
        {p.isButton && (
          <span
            title="Dealer button"
            className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[0.6rem] font-bold text-white ring-2 ring-white"
          >
            D
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{p.username}</div>
        <div className="font-display text-xs text-slate-500">{fmt(p.stack)}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {p.lastAction ? actionChip(p.lastAction) : p.allIn ? <Badge tone="indigo">ALL-IN</Badge> : null}
      </div>
      {p.inHand && !p.folded && (
        <div className="flex gap-1">
          <PlayingCard faceDown size="xs" />
          <PlayingCard faceDown size="xs" />
        </div>
      )}
    </div>
  );
}

export function YouRow({
  p,
  cards,
}: {
  p: SeatView;
  cards: CardId[];
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200/70',
        p.isToAct && 'ring-2 ring-indigo-500 shadow-lg',
        p.folded && 'opacity-60',
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 font-display text-lg font-bold text-white">
        {p.username[0]?.toUpperCase()}
      </div>
      <div>
        <div className="text-sm font-semibold">
          You{p.isButton && <span className="ml-2 text-xs text-slate-400">(dealer)</span>}
        </div>
        <div className="font-display text-sm text-slate-500">{fmt(p.stack)}</div>
      </div>
      <div className="ml-2">{p.lastAction && actionChip(p.lastAction)}</div>
      <div className="ml-auto flex gap-2">
        {p.inHand && !p.folded ? (
          cards.length ? (
            cards.map((c) => <PlayingCard key={c} card={c} size="md" />)
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
