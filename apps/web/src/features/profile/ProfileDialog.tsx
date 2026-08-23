import { useRef, useState } from 'react';
import { api } from '../../shared/api.ts';
import { applyTheme, setSoundsEnabled, soundsEnabled } from '../../shared/prefs.ts';
import { useStore, type Prefs } from '../../shared/store.ts';
import { cn } from '../../shared/lib/cn.ts';
import { Button, Dialog, Input } from '../../shared/ui/index.tsx';
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

export function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const auth = useStore((s) => s.auth);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const [displayName, setDisplayName] = useState(prefs.displayName || (auth.username ?? ''));
  const [bio, setBio] = useState(prefs.bio);
  const [phrasesText, setPhrasesText] = useState(prefs.quickPhrases.join('\n'));
  const [sounds, setSounds] = useState(soundsEnabled());
  const [saving, setSaving] = useState(false);
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
        theme: prefs.theme,
        quickPhrases,
      });
      setPrefs({ displayName: displayName.trim() || (auth.username ?? ''), bio, quickPhrases });
      setSoundsEnabled(sounds);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Your profile">
      <div className="space-y-4">
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
            <input type="checkbox" checked={sounds} onChange={(e) => setSounds(e.target.checked)} />
            Turn sounds
          </label>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        <Button className="w-full" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </Dialog>
  );
}
