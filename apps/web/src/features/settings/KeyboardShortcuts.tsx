import { useEffect, useState, type FormEvent } from 'react';
import { RiKeyboardLine } from '@remixicon/react';
import {
  DEFAULT_POKER_HOTKEYS,
  POKER_HOTKEY_ACTIONS,
  parsePokerHotkeys,
  pokerBindingFromEvent,
  pokerHotkeysError,
  validPokerBinding,
  type PokerHotkeys,
  type PokerHotkeyAction,
} from '@4am/shared';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { savePokerHotkeysLocally } from '../../shared/prefs.ts';
import { Button, Spinner } from '../../shared/ui/index.tsx';

export const SHORTCUT_LABELS: Record<PokerHotkeyAction, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  raise: 'Bet / raise',
  halfPot: 'Half pot',
  pot: 'Pot',
  allIn: 'All-in',
};
const descriptions: Record<PokerHotkeyAction, string> = {
  fold: 'Fold immediately on your turn.',
  check: 'Check only when nothing is owed.',
  call: 'Call the amount shown on your turn.',
  raise: 'Edit the amount, then Enter to confirm.',
  halfPot: 'Select half pot, then Enter to confirm.',
  pot: 'Select pot size, then Enter to confirm.',
  allIn: 'Select your full stack, then Enter to confirm.',
};
const keys = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].filter(validPokerBinding);
const choices = [...keys, ...keys.map((key) => `Shift+${key}`)];

/** Shared by the settings page and the table's shortcut dialog. */
export function KeyboardShortcuts() {
  const userId = useStore((s) => s.auth.userId);
  const token = useStore((s) => s.auth.token);
  const [draft, setDraft] = useState<PokerHotkeys | null>(null);
  const [savedValue, setSavedValue] = useState('');
  const [recording, setRecording] = useState<PokerHotkeyAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setDraft(null);
    setError('');
    setRecording(null);
    void api
      .profile()
      .then((profile) => {
        if (!active || useStore.getState().auth.token !== token) return;
        const settings = parsePokerHotkeys(profile.pokerHotkeys);
        if (!settings || profile.userId !== userId)
          throw new Error('Could not load your keyboard shortcuts.');
        setDraft(settings);
        setSavedValue(JSON.stringify(settings));
        useStore.getState().setPokerHotkeys(settings, profile.userId);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not load shortcuts.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, userId, attempt]);

  function bind(action: PokerHotkeyAction, key: string | null) {
    setDraft(
      (current) => current && { ...current, bindings: { ...current.bindings, [action]: key } },
    );
    setError('');
    setMessage('');
    setRecording(null);
  }
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        setRecording(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || e.isComposing || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      if (e.key === 'Escape') {
        setRecording(null);
        setMessage('Recording cancelled.');
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        bind(recording, null);
        return;
      }
      // Read the physical number for Shift+digit, which produces punctuation.
      const key = pokerBindingFromEvent({
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        repeat: e.repeat,
        isComposing: e.isComposing,
        defaultPrevented: false,
      });
      if (!key) {
        setError(
          'Choose a letter or number, optionally with Shift. WASD and browser shortcuts are reserved.',
        );
        return;
      }
      bind(recording, key);
      setMessage(`${SHORTCUT_LABELS[recording]} set to ${key}. Save to apply.`);
    };
    const cancel = () => setRecording(null);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', cancel);
    };
  }, [recording]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || !userId || saving || recording || pokerHotkeysError(draft)) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.updateProfile({ pokerHotkeys: draft });
      if (useStore.getState().auth.token !== token) return;
      savePokerHotkeysLocally(draft, userId);
      setSavedValue(JSON.stringify(draft));
      setMessage('Keyboard shortcuts saved to your account.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save shortcuts. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Loading keyboard shortcuts…" />;
  if (!draft)
    return (
      <div>
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Retry shortcuts
        </Button>
      </div>
    );
  const validation = pokerHotkeysError(draft);
  return (
    <form onSubmit={(e) => void save(e)} className="space-y-5">
      <label className="flex items-center gap-3 text-sm font-medium">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={saving}
          onChange={(e) => {
            setDraft({ ...draft, enabled: e.target.checked });
            setMessage('');
          }}
          className="size-4 accent-indigo-600"
        />
        Enable keyboard shortcuts
      </label>
      <p className="text-sm leading-relaxed text-slate-500">
        Shortcuts work in 2D and 3D on your turn. They pause while you type, open a menu or dialog,
        or wait for the server. WASD stays available for lounge movement.
      </p>
      <div className="divide-y divide-border-button-default">
        {POKER_HOTKEY_ACTIONS.map((action) => (
          <div key={action} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1 basis-44">
              <label htmlFor={`shortcut-${action}`} className="text-sm font-medium">
                {SHORTCUT_LABELS[action]}
              </label>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{descriptions[action]}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                id={`shortcut-${action}`}
                aria-label={`Shortcut for ${SHORTCUT_LABELS[action]}`}
                value={draft.bindings[action] ?? ''}
                disabled={saving || !!recording}
                onChange={(e) => bind(action, e.target.value || null)}
                className="min-h-10 w-32 rounded-lg border border-border-button-default bg-background-primary-default px-3 text-sm text-text-primary"
              >
                <option value="">None</option>
                {choices.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                aria-label={`Record ${SHORTCUT_LABELS[action]} shortcut`}
                aria-pressed={recording === action}
                onClick={() => {
                  setRecording(recording === action ? null : action);
                  setError('');
                  setMessage('');
                }}
              >
                <RiKeyboardLine size={18} aria-hidden />
                {recording === action ? 'Listening…' : 'Record'}
              </Button>
            </div>
          </div>
        ))}
      </div>
      {recording && (
        <p role="status" className="text-sm text-indigo-700 dark:text-indigo-300">
          Press a key for {SHORTCUT_LABELS[recording]}. Escape cancels; Backspace clears.
        </p>
      )}
      {(error || validation) && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error || validation}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={saving || !!recording || !!validation || JSON.stringify(draft) === savedValue}
        >
          {saving ? 'Saving…' : 'Save shortcuts'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={saving || !!recording}
          onClick={() => {
            setDraft(parsePokerHotkeys(DEFAULT_POKER_HOTKEYS)!);
            setError('');
            setMessage('Defaults restored. Save to apply.');
          }}
        >
          Restore defaults
        </Button>
      </div>
    </form>
  );
}
