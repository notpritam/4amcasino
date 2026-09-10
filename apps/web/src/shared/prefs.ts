import { parsePokerHotkeys, type PokerHotkeys } from '@4am/shared';
import { api } from './api.ts';
import { useStore } from './store.ts';

export function applyAppearance(): void {
  // Appearance is a device preference; a profile refresh must not reset it.
  document.documentElement.classList.remove('cyber');
  document.documentElement.classList.add('zeus');
}

/** Pull profile prefs from the server into the store (and apply the Zeus appearance). */
let prefsRevision = 0;
export function savePokerHotkeysLocally(pokerHotkeys: PokerHotkeys, userId: number): void {
  prefsRevision++;
  useStore.getState().setPokerHotkeys(pokerHotkeys, userId);
  localStorage.setItem('4am-hotkeys-changed', JSON.stringify({ userId, at: Date.now() }));
}

export async function loadPrefs({
  onlyHotkeys = false,
}: { onlyHotkeys?: boolean } = {}): Promise<void> {
  const auth = useStore.getState().auth;
  const revision = ++prefsRevision;
  if (!auth.token) return;
  try {
    const p = await api.profile();
    if (useStore.getState().auth.token !== auth.token || p.userId !== auth.userId) return;
    if (revision === prefsRevision) {
      const hotkeys = parsePokerHotkeys(p.pokerHotkeys);
      if (hotkeys) useStore.getState().setPokerHotkeys(hotkeys, p.userId);
    }
    if (onlyHotkeys) return;
    useStore.getState().setPrefs({
      displayName: p.displayName,
      bio: p.bio,
      hasAvatar: p.hasAvatar,
      avatarVersion: p.avatarVersion,
      cardBack: p.cardBack,
      fourColor: p.fourColor,
      quickPhrases: p.quickPhrases ?? [],
      privateMode: !!p.privateMode,
      autoJoinInvites: !!p.autoJoinInvites,
      autoReady: !!p.autoReady,
    });
    applyAppearance();
  } catch {
    /* not logged in yet */
  }
}

export { soundsEnabled, setSoundsEnabled, soundVolume, setSoundVolume } from './sounds.ts';
