import { motion } from 'motion/react';
import { RANKS, SUITS, rankOf, suitOf, type CardId } from '@4am/shared';
import { cn } from '../../shared/lib/cn.ts';
import { useStore } from '../../shared/store.ts';

const SUIT_GLYPHS = ['♣', '♦', '♥', '♠'] as const;

const sizes = {
  xs: 'h-10 w-7 rounded-md text-[0.55rem]',
  sm: 'h-14 w-10 rounded-lg text-xs',
  md: 'h-24 w-[4.2rem] rounded-xl text-base',
  // responsive: phones get a board that fits five across
  lg: 'h-20 w-14 rounded-lg text-sm md:h-32 md:w-[5.6rem] md:rounded-2xl md:text-lg',
  table: 'h-36 w-24 rounded-2xl text-2xl',
  // Offsuit-style huge mobile hole cards
  xl: 'h-36 w-24 rounded-2xl text-2xl',
} as const;

const centerSizes = {
  xs: 'text-sm',
  sm: 'text-lg',
  md: 'text-3xl',
  lg: 'text-2xl md:text-5xl',
  table: 'text-5xl',
  xl: 'text-5xl',
} as const;

// standard: hearts/diamonds red; four-color deck: diamonds blue, clubs green
const twoColor = ['text-slate-800', 'text-rose-600', 'text-rose-600', 'text-slate-800'];
const fourColorClasses = ['text-emerald-700', 'text-blue-600', 'text-rose-600', 'text-slate-800'];

export function PlayingCard({
  card,
  faceDown = false,
  size = 'md',
  deal = false,
  className,
}: {
  card?: CardId;
  faceDown?: boolean;
  size?: keyof typeof sizes;
  deal?: boolean;
  className?: string;
}) {
  const { cardBack, fourColor } = useStore((s) => s.prefs);
  if (faceDown || card === undefined) {
    return (
      <div
        className={cn(
          sizes[size],
          'card-back shrink-0 shadow-sm ring-1 ring-black/10',
          `card-back-${cardBack}`,
          deal && 'animate-deal',
          !faceDown && 'opacity-0', // placeholder slot keeps layout stable
          className,
        )}
        aria-label={faceDown ? 'face-down card' : 'empty card slot'}
      />
    );
  }
  const rank = RANKS[rankOf(card)]!;
  const suitIdx = suitOf(card);
  const glyph = SUIT_GLYPHS[suitIdx]!;
  return (
    <motion.div
      initial={deal ? { rotateY: 90, scale: 0.85, opacity: 0 } : false}
      animate={{ rotateY: 0, scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 360, damping: 26 }}
      className={cn(
        sizes[size],
        'relative shrink-0 bg-white shadow-sm ring-1 ring-slate-200 select-none',
        (fourColor ? fourColorClasses : twoColor)[suitIdx],
        className,
      )}
      aria-label={`${rank}${SUITS[suitIdx]}`}
    >
      <div className="absolute left-1 top-0.5 font-display font-bold leading-tight">
        {rank}
        <div className="-mt-0.5">{glyph}</div>
      </div>
      {(size === 'md' || size === 'lg' || size === 'table') && (
        <div className={cn('absolute inset-0 flex items-center justify-center', centerSizes[size])}>
          {glyph}
        </div>
      )}
      {size !== 'xl' && (
        <div className="absolute bottom-0.5 right-1 rotate-180 font-display font-bold leading-tight">
          {rank}
          <div className="-mt-0.5">{glyph}</div>
        </div>
      )}
    </motion.div>
  );
}
