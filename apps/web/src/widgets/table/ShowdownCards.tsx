import { cn, fmt } from '../../shared/lib/cn.ts';
import { HAND_CATEGORY_NAMES, handCategory } from '@4am/shared';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';

/** The hand's ending, per player: THEIR two cards, what they made, their net.
 *  Everyone sees exactly what they won or lost to, not just the winning five
 *  (requested by notpritam, docs/FEATURES.md). */
export function ShowdownCards({
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
            {/* shrink-0: as flex children these were compressed narrower than a
                card whenever the row was tight, which read as overlapping */}
            <div className="flex shrink-0 gap-1">
              {r.cards.map((c) => (
                <PlayingCard key={c} card={c} size="sm" deal className="shrink-0" />
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
export function RitBoards({
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

