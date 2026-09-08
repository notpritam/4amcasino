import { useLayoutEffect, useRef, useState } from 'react';
import { motion, useDragControls, useMotionValue } from 'motion/react';
import { DotsSixVertical, Minus, Plus, X } from '@phosphor-icons/react';
import type { CardId } from '@4am/shared';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';

/** Your hole cards as a big floating panel: drag it anywhere on the screen,
 *  size it with the +/- controls, and it remembers where you left it.
 *  Requested by notpritam - see docs/FEATURES.md. */

const POS_KEY = '4am-cards-pos';
const SCALE_KEY = '4am-cards-scale';

function savedPos(): { x: number; y: number } {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? '');
    if (typeof v.x === 'number' && typeof v.y === 'number') return v;
  } catch {
    /* first visit */
  }
  return { x: 0, y: 0 };
}

function savedScale(): number {
  const v = Number(localStorage.getItem(SCALE_KEY));
  return Number.isFinite(v) && v >= 0.7 && v <= 2.2 ? v : 1.2;
}

export function FloatingCards({
  cards,
  onClose,
  bounded = false,
}: {
  cards: CardId[];
  onClose: () => void;
  /** In 3D, keep enlarged cards above the measured poker-control dock. */
  bounded?: boolean;
}) {
  const pos = savedPos();
  const x = useMotionValue(pos.x);
  const y = useMotionValue(pos.y);
  const [scale, setScale] = useState(savedScale);
  const boundsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();

  useLayoutEffect(() => {
    const bounds = boundsRef.current;
    const panel = panelRef.current;
    if (!bounded || !bounds || !panel) return;
    const clamp = () => {
      // The panel is anchored bottom-right. Use layout sizes, not its translated
      // rect, so repeated resize callbacks cannot compound the correction.
      x.set(Math.max(Math.min(0, panel.offsetWidth - bounds.clientWidth), Math.min(0, x.get())));
      y.set(Math.max(Math.min(0, panel.offsetHeight - bounds.clientHeight), Math.min(0, y.get())));
    };
    const observer = new ResizeObserver(clamp);
    observer.observe(bounds);
    observer.observe(panel);
    clamp();
    return () => observer.disconnect();
  }, [bounded, cards.length, x, y]);

  if (cards.length === 0) return null;

  const bumpScale = (d: number) => {
    setScale((s) => {
      const next = Math.min(2.2, Math.max(0.7, Math.round((s + d) * 100) / 100));
      localStorage.setItem(SCALE_KEY, String(next));
      return next;
    });
  };

  return (
    <div ref={boundsRef} className={bounded ? 'floating-card-bounds' : 'contents'}>
      <motion.div
        ref={panelRef}
        drag
        dragControls={dragControls}
        dragListener={!bounded}
        dragConstraints={bounded ? boundsRef : undefined}
        dragMomentum={false}
        dragElastic={0}
        style={{ x, y }}
        onDragEnd={() => localStorage.setItem(POS_KEY, JSON.stringify({ x: x.get(), y: y.get() }))}
        className={
          bounded
            ? 'floating-cards group absolute bottom-0 right-0 select-none'
            : 'group fixed bottom-36 right-8 z-40 cursor-grab touch-none select-none active:cursor-grabbing'
        }
        role="region"
        aria-label="Your cards (drag to move)"
      >
        <div className="rounded-2xl bg-white/85 p-2.5 pt-10 shadow-xl ring-1 ring-slate-200/80 backdrop-blur dark:bg-slate-900/85 dark:ring-slate-700/70">
          {/* Keep resize and close visible for touch and keyboard users. */}
          <div
            onPointerDown={bounded ? (event) => dragControls.start(event) : undefined}
            title={bounded ? 'Drag here to move your cards' : undefined}
            className="absolute inset-x-0 top-0 flex touch-none cursor-grab items-center justify-between px-1.5 pt-1 opacity-100 active:cursor-grabbing"
          >
            {bounded ? (
              <DotsSixVertical size={12} aria-hidden="true" />
            ) : (
              <span aria-hidden="true" />
            )}
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => bumpScale(-0.15)}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Smaller cards"
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <Minus size={13} weight="bold" />
              </button>
              <button
                onClick={() => bumpScale(0.15)}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Bigger cards"
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <Plus size={13} weight="bold" />
              </button>
              <button
                onClick={onClose}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Hide big cards (tap your seat's cards to bring them back)"
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X size={13} weight="bold" />
              </button>
            </div>
          </div>
          <div className="flex gap-1.5">
            {cards.map((c) => (
              <span key={c} style={{ width: `${4.2 * scale}rem`, height: `${6 * scale}rem` }}>
                <span className="block origin-top-left" style={{ transform: `scale(${scale})` }}>
                  <PlayingCard card={c} size="md" />
                </span>
              </span>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
