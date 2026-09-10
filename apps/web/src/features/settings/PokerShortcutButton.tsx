import { useState } from 'react';
import { createPortal } from 'react-dom';
import { RiKeyboardLine } from '@remixicon/react';
import { Button, Dialog } from '../../shared/ui/index.tsx';
import { useStore } from '../../shared/store.ts';
import { cn } from '../../shared/lib/cn.ts';
import { KeyboardShortcuts } from './KeyboardShortcuts.tsx';

export function PokerShortcutButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const enabled = useStore(
    (s) =>
      s.prefs.pokerHotkeys.enabled && s.auth.userId !== null && s.pokerHotkeysFor === s.auth.userId,
  );
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className={cn(
          'min-h-8! gap-1.5 bg-transparent! px-2! text-xs! text-inherit! hover:bg-slate-500/15!',
          className,
        )}
        onClick={() => setOpen(true)}
        aria-label="Edit keyboard shortcuts"
      >
        <RiKeyboardLine size={16} aria-hidden />
        Shortcuts{!enabled && ' off'}
      </Button>
      {createPortal(
        <Dialog open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" size="lg">
          <KeyboardShortcuts />
        </Dialog>,
        document.body,
      )}
    </>
  );
}
