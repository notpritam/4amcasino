import { cn } from '../../shared/lib/cn.ts';

/** Chips drawn like chips: amounts break into denominations scaled off the
 *  big blind, each tier its own color, stacked as little isometric cylinders
 *  that grow as the money does. Requested by notpritam - docs/FEATURES.md. */

const TIER_STYLES = [
  // 100bb - the heavy chip
  'bg-slate-800 shadow-[inset_0_2px_0_rgba(255,255,255,0.25)] dark:bg-slate-200 dark:shadow-[inset_0_2px_0_rgba(0,0,0,0.3)]',
  // 25bb
  'bg-emerald-500 shadow-[inset_0_2px_0_rgba(255,255,255,0.4)]',
  // 5bb
  'bg-rose-500 shadow-[inset_0_2px_0_rgba(255,255,255,0.4)]',
  // 1bb - the light chip
  'bg-amber-300 shadow-[inset_0_2px_0_rgba(255,255,255,0.55)]',
];

/** Greedy split into up to four denominations, capped so piles stay readable. */
function split(amount: number, bb: number): number[] {
  const unit = Math.max(1, bb);
  const denoms = [unit * 100, unit * 25, unit * 5, unit];
  const counts = [0, 0, 0, 0];
  let rest = amount;
  denoms.forEach((d, i) => {
    counts[i] = Math.min(Math.floor(rest / d), 5);
    rest -= counts[i]! * d;
  });
  if (!counts.some((c) => c > 0)) counts[3] = 1; // any money shows at least one chip
  return counts;
}

export function ChipStack({
  amount,
  bb,
  size = 'sm',
  className,
}: {
  amount: number;
  bb: number;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  if (amount <= 0) return null;
  const counts = split(amount, bb);
  const chipW = size === 'lg' ? 'w-7' : 'w-5';
  const chipH = size === 'lg' ? 'h-[9px]' : 'h-[7px]';
  const overlap = size === 'lg' ? '-mt-[5px]' : '-mt-[4px]';

  return (
    <div className={cn('flex items-end gap-1', className)} aria-hidden="true">
      {counts.map((count, tier) =>
        count === 0 ? null : (
          <div key={tier} className="flex flex-col items-center">
            {Array.from({ length: count }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'rounded-[50%] ring-1 ring-black/25',
                  chipW,
                  chipH,
                  i > 0 && overlap,
                  TIER_STYLES[tier],
                )}
              />
            ))}
          </div>
        ),
      )}
    </div>
  );
}
