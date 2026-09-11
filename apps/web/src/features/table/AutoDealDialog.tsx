import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog } from '../../shared/ui/index.tsx';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';

export function AutoDealDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const room = useStore((s) => s.room);
  const userId = useStore((s) => s.auth.userId);
  const connected = useStore((s) => s.wsConnected);
  const ready = useStore((s) => s.hand.readyCheck);
  const nextAt = useStore((s) => s.hand.autoDealAt);
  const handActive = useStore((s) => !!s.hand.handId && !s.hand.result && !s.hand.abort);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    setError(null);
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  if (!room) return null;
  const isHost = userId === room.room.hostId;
  const enabled = room.room.autoDeal ?? true;
  const dealer = room.players.find((p) => p.userId === room.room.autoDealerId);
  const activeCount = room.players.filter(
    (p) => p.connected && p.seat !== null && !p.sittingOut && p.stack > 0,
  ).length;
  let status = 'Waiting for two seated, online players with chips.';
  if (!connected) status = 'Reconnecting to the table…';
  else if (!enabled) status = 'Off. The host starts each hand manually.';
  else if (room.handActive || handActive) status = 'The next ready check starts after this hand.';
  else if (ready) status = `${ready.ready.length} of ${ready.eligible.length} players ready.`;
  else if (room.autoDealPaused) status = 'Paused because fewer than two players were ready.';
  else if (nextAt) status = `Ready check in ${Math.max(0, Math.ceil((nextAt - now) / 1000))}s.`;
  else if (activeCount >= 2) status = 'Waiting for the next ready check.';
  async function save(value: boolean) {
    if (!room || !connected || saving || !isHost) return;
    setSaving(true);
    setError(null);
    try {
      await api.setAutoDeal(room.room.id, value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save auto-deal. Try again.');
    } finally {
      setSaving(false);
    }
  }
  return createPortal(
    <Dialog open={open} onClose={onClose} title="Auto-deal">
      <div className="space-y-5 text-sm text-slate-700 dark:text-slate-200">
        <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <span>
            <span className="block font-semibold text-slate-950 dark:text-white">
              Enable auto-deal
            </span>
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Keep the table moving between hands.
            </span>
          </span>
          <span className="relative inline-flex shrink-0">
            <input
              type="checkbox"
              role="switch"
              aria-label="Enable auto-deal"
              checked={enabled}
              disabled={!isHost || !connected || saving}
              onChange={(e) => void save(e.target.checked)}
              className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
            <span
              aria-hidden
              className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-indigo-600 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-indigo-500 peer-disabled:opacity-50 dark:bg-slate-600"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5 peer-disabled:opacity-70"
            />
          </span>
        </label>
        <div className="space-y-2" aria-live="polite">
          <p className="font-medium">{saving ? 'Saving…' : status}</p>
          {enabled && dealer && connected && (
            <p>
              Automatic dealer: <strong>{dealer.displayName}</strong>
              {dealer.userId !== room.room.hostId && (
                <span className="ml-2 text-xs text-indigo-600 dark:text-indigo-300">Fallback</span>
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>
        <p>
          The seated, online host is preferred. If they leave, sit out or run out of chips, another
          seated, online player takes over automatically.
        </p>
        <p className="text-slate-500 dark:text-slate-400">
          After a 15-second break, everyone gets up to 20 seconds to choose “I’m ready”. Your “Auto
          ready” preference still applies. At least two ready players are needed.
        </p>
        {!isHost && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Only the host can change this room setting.
          </p>
        )}
        {isHost && enabled && room.autoDealPaused && (
          <Button type="button" disabled={saving || !connected} onClick={() => void save(true)}>
            Try ready check again
          </Button>
        )}
      </div>
    </Dialog>,
    document.body,
  );
}
