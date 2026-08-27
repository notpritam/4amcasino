import type { ReactNode } from 'react';
import { cn } from '../../shared/lib/cn.ts';

/** One titled block on the settings page. The id doubles as the scroll anchor
 *  the section rail jumps to (requested by notpritam, docs/FEATURES.md). */
export function SettingsCard({
  id,
  title,
  desc,
  icon,
  children,
  className,
}: {
  id: string;
  title: string;
  desc?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      // scroll-mt keeps the heading clear of the sticky page header on jump
      className={cn(
        'scroll-mt-24 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 dark:bg-slate-900 dark:ring-slate-700/70',
        className,
      )}
    >
      <header className="flex items-start gap-3 border-b border-slate-200/70 px-6 py-4 dark:border-slate-700/70">
        {icon && (
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-base dark:bg-slate-800">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h2>
          {desc && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{desc}</p>}
        </div>
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}
