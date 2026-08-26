import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CaretDown, CaretUp, ClockCounterClockwise } from '@phosphor-icons/react';
import { describeScore } from '@4am/shared';
import { useStore } from '../../shared/store.ts';
import { cn, fmt } from '../../shared/lib/cn.ts';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { RitBoards, ShowdownCards } from './ShowdownCards.tsx';

/** The previous hand, one click away at the bottom of the table: who won,
 *  with what, and everyone's revealed cards - open it when you want the
 *  recap, collapse it when you don't. The choice is remembered.
 *  (requested by notpritam, docs/FEATURES.md) */
export function LastHandStrip({ roomId, light = false }: { roomId: string; light?: boolean }) {
  const last = useStore((s) => s.lastHand);
  const currentHandId = useStore((s) => s.hand.handId);
  const [open, setOpen] = useState(() => localStorage.getItem('4am-last-hand') === 'on');
  // hidden while the hand it describes is still the one on the table
  if (!last || last.handId === currentHandId) return null;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem('4am-last-hand', next ? 'on' : 'off');
  };
  const nameOf = (seat: number) => last.names[seat] ?? `Seat ${seat + 1}`;
  const winners = last.deltas.filter((d) => d.delta > 0);
  const top = [...last.reveals].sort((a, b) => b.score - a.score)[0];
  const headline =
    winners.length === 0
      ? 'chips stayed put'
      : `${winners.map((w) => `${nameOf(w.seat)} +${fmt(w.delta)}`).join(' & ')} · ${
          last.runTwice
            ? 'ran it twice'
            : top
              ? describeScore(top.score)
              : 'everyone folded'
        }`;

  return (
    <div
      className={cn(
        'rounded-2xl',
        light
          ? 'bg-white/10 text-white'
          : 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/70 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700/70',
      )}
    >
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
      >
        <ClockCounterClockwise
          size={15}
          className={light ? 'text-white/50' : 'text-slate-400'}
          aria-label="Last hand"
        />
        <span className="text-xs font-semibold uppercase tracking-[0.14em]">Last hand</span>
        <span className={cn('min-w-0 flex-1 truncate text-sm', light ? 'text-white/70' : 'text-slate-500')}>
          {headline}
        </span>
        {open ? (
          <CaretDown size={14} className={light ? 'text-white/50' : 'text-slate-400'} />
        ) : (
          <CaretUp size={14} className={light ? 'text-white/50' : 'text-slate-400'} />
        )}
      </button>
      {open && (
        <div className="space-y-2.5 px-4 pb-3.5">
          {last.runTwice ? (
            <RitBoards rt={last.runTwice} nameOf={nameOf} light={light} />
          ) : (
            last.board.length > 0 && (
              <div className="flex items-center gap-1.5">
                {last.board.map((c) => (
                  <PlayingCard key={c} card={c} size="xs" />
                ))}
              </div>
            )
          )}
          <ShowdownCards
            reveals={last.reveals}
            shown={last.shown}
            deltas={last.deltas}
            nameOf={nameOf}
            light={light}
          />
          {last.reveals.length === 0 && Object.keys(last.shown).length === 0 && (
            <p className={cn('text-xs', light ? 'text-white/50' : 'text-slate-500')}>
              No cards were shown - the pot went to the last player standing.
            </p>
          )}
          <Link
            to={`/room/${roomId}/replay/${last.handId}`}
            className={cn(
              'inline-block text-xs font-semibold',
              light ? 'text-indigo-300' : 'text-indigo-600 dark:text-indigo-400',
            )}
          >
            Full replay →
          </Link>
        </div>
      )}
    </div>
  );
}
