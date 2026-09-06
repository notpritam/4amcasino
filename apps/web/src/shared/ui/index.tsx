import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.ts';
import { Button as ZeusButton, InputBase } from '@zeus/ui/base';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <ZeusButton
      variant={variant === 'success' ? 'primary' : variant}
      type={props.type ?? 'submit'}
      className={cn(
        'zeus-button min-h-10 h-auto shrink-0 whitespace-normal',
        variant === 'success' && 'bg-emerald-600 hover:bg-emerald-700',
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, size: _size, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <InputBase
      fieldClassName={cn('zeus-field min-h-10 min-w-0', className)}
      className="text-sm"
      {...props}
    />
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'zeus-panel rounded-2xl bg-background-secondary-default p-5 text-text-primary',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  tone = 'slate',
  className,
  children,
}: {
  tone?: 'slate' | 'indigo' | 'rose' | 'emerald' | 'amber';
  className?: string;
  children: ReactNode;
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** `lg` for dialogs that hold a grid or a table rather than a short form. */
  size?: 'md' | 'lg';
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0 && !el.matches(':disabled'));
    (focusable()[0] ?? dialogRef.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      // A nested dialog owns the keyboard until it closes.
      const dialogs = document.querySelectorAll('[data-ui-dialog]');
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      data-ui-dialog
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn(
          'max-h-[86vh] w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900',
          size === 'lg' ? 'max-w-3xl' : 'max-w-md',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      {label}
    </span>
  );
}
