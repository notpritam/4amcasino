import { useEffect, useRef } from 'react';
import { useStore } from '../../shared/store.ts';
import { cn } from '../../shared/lib/cn.ts';

/**
 * Draining time bar for the seat currently facing action.
 * rAF-driven and self-contained so the 60fps updates never re-render the table.
 */
export function TurnProgress({ className }: { className?: string }) {
  const barRef = useRef<HTMLDivElement>(null);
  const deadline = useStore((s) => s.hand.deadline);
  const totalMs = useStore((s) => s.room?.room.actionTimeoutMs ?? 45_000);

  useEffect(() => {
    if (!deadline || !barRef.current) return;
    let raf = 0;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      const frac = Math.min(1, remaining / totalMs);
      const bar = barRef.current;
      if (bar) {
        bar.style.width = `${frac * 100}%`;
        bar.classList.toggle('bg-rose-500', remaining <= 10_000);
        bar.classList.toggle('bg-indigo-500', remaining > 10_000);
      }
      if (remaining > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deadline, totalMs]);

  if (!deadline) return null;
  return (
    <div
      className={cn(
        'absolute inset-x-3 bottom-1 h-1 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/80',
        className,
      )}
      role="progressbar"
      aria-label="time remaining to act"
    >
      <div ref={barRef} className="h-full rounded-full bg-indigo-500 transition-colors" />
    </div>
  );
}
