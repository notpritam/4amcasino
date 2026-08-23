import { useRef, useState } from 'react';
import { api } from '../../shared/api.ts';
import { applyTheme } from '../../shared/prefs.ts';
import { play, setSoundVolume, setSoundsEnabled, soundVolume, soundsEnabled } from '../../shared/sounds.ts';
import { useStore, type Prefs } from '../../shared/store.ts';
import { cn } from '../../shared/lib/cn.ts';
import { Button, Input } from '../../shared/ui/index.tsx';
import { Avatar } from '../../entities/user/Avatar.tsx';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { cardFromName } from '@4am/shared';

const BACKS: Prefs['cardBack'][] = ['indigo', 'crimson', 'emerald', 'slate'];

/** Downscale + center-crop the chosen file to a 256px JPEG data URL. */
async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d')!;
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** The profile form. Lives on /settings; the dialog wrapper below is legacy. */
export function ProfileEditor({ onSaved, wide = false }: { onSaved?: () => void; wide?: boolean }) {
  const auth = useStore((s) => s.auth);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const [displayName, setDisplayName] = useState(prefs.displayName || (auth.username ?? ''));
  const [bio, setBio] = useState(prefs.bio);
  const [phrasesText, setPhrasesText] = useState(prefs.quickPhrases.join('\n'));
  const [sounds, setSounds] = useState(soundsEnabled());
  const [volume, setVolume] = useState(soundVolume());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await toAvatarDataUrl(file);
      const res = await api.uploadAvatar(dataUrl);
      setPrefs({ hasAvatar: true, avatarVersion: res.avatarVersion });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed');
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const quickPhrases = phrasesText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((s) => s.slice(0, 60));
    try {
      await api.updateProfile({
        displayName: displayName.trim() || auth.username,
        bio,
        cardBack: prefs.cardBack,
        fourColor: prefs.fourColor,
        privateMode: prefs.privateMode,
        autoJoinInvites: prefs.autoJoinInvites,
        theme: prefs.theme,
        quickPhrases,
      });
      setPrefs({ displayName: displayName.trim() || (auth.username ?? ''), bio, quickPhrases });
      setSoundsEnabled(sounds);
      if (onSaved) {
        onSaved();
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save');
    } finally {
      setSaving(false);
    }
  }

  const identity = (
    <>
      <div className="flex items-center gap-4">
        <Avatar userId={auth.userId ?? 0} name={displayName || '?'} version={prefs.avatarVersion} size="xl" />
        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void pickAvatar(e.target.files?.[0])}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            Change photo
          </Button>
          {prefs.hasAvatar && (
            <Button
              variant="ghost"
              onClick={() =>
                api.deleteAvatar().then(() =>
                  setPrefs({ hasAvatar: false, avatarVersion: prefs.avatarVersion + 1 }),
                )
              }
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-slate-500">Display name</span>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={24} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-500">Bio</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={280}
          rows={2}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          placeholder="Tight is right."
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-slate-500">Your quick chat phrases (one per line, max 8)</span>
        <textarea
          value={phrasesText}
          onChange={(e) => setPhrasesText(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          placeholder={'nice hand 👏\nbluff! 🤨\nrun it again 🔁'}
        />
      </label>
    </>
  );

  const tableStyle = (
    <>
      <div className="text-sm">
        <span className="mb-2 block text-slate-500">Deck style</span>
        <div className="flex items-center gap-3">
          {BACKS.map((b) => (
            <button
              key={b}
              onClick={() => setPrefs({ cardBack: b })}
              aria-label={`${b} card back`}
              className={cn('rounded-lg p-0.5 ring-2 ring-transparent', prefs.cardBack === b && 'ring-indigo-500')}
            >
              <div className={cn('card-back h-14 w-10 rounded-lg', `card-back-${b}`)} />
            </button>
          ))}
          <label className="ml-2 flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={prefs.fourColor}
              onChange={(e) => setPrefs({ fourColor: e.target.checked })}
            />
            4-color deck
          </label>
          <PlayingCard card={cardFromName('Td')} size="sm" />
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={prefs.autoJoinInvites}
          onChange={(e) => setPrefs({ autoJoinInvites: e.target.checked })}
          className="mt-0.5"
        />
        <span>
          Auto-join: when a friend invites me to a table, add me right away instead of asking.
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={prefs.privateMode}
          onChange={(e) => setPrefs({ privateMode: e.target.checked })}
          className="mt-0.5"
        />
        <span>
          Private mode: hide my winnings from other players. Leaderboards, the session report, and
          the chip-leader crown skip you; bankers still see everything so the group can settle up.
        </span>
      </label>

      <div className="flex items-center gap-6 text-sm">
        <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={prefs.theme === 'dark'}
            onChange={(e) => {
              const theme = e.target.checked ? 'dark' : 'light';
              setPrefs({ theme });
              applyTheme(theme);
            }}
          />
          Dark theme
        </label>
        <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={sounds}
            onChange={(e) => {
              setSounds(e.target.checked);
              setSoundsEnabled(e.target.checked);
              if (e.target.checked) play('chip');
            }}
          />
          Game sounds
        </label>
      </div>

      {sounds && (
        <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-slate-500">Volume</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => {
              const v = +e.target.value;
              setVolume(v);
              setSoundVolume(v);
            }}
            onPointerUp={() => play('chip')}
            className="flex-1 accent-indigo-600"
            aria-label="Sound volume"
          />
          <Button variant="ghost" onClick={() => play('win')}>
            Test
          </Button>
        </div>
      )}
    </>
  );

  return (
    <div className={wide ? 'grid gap-x-10 gap-y-4 md:grid-cols-2' : 'space-y-4'}>
      <div className="space-y-4">{identity}</div>
      <div className="space-y-4">{tableStyle}</div>
      <div className={cn('space-y-3', wide && 'md:col-span-2')}>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {saved && <p className="text-sm text-emerald-600">Saved.</p>}
        <Button className={wide ? 'w-full sm:w-auto' : 'w-full'} onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </div>
  );
}
