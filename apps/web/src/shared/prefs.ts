import { api } from './api.ts';
import { useStore } from './store.ts';

export function applyAppearance(): void {
  document.documentElement.classList.remove('dark', 'cyber');
  document.documentElement.classList.add('zeus');
}

/** Pull profile prefs from the server into the store (and apply the Zeus appearance). */
export async function loadPrefs(): Promise<void> {
  try {
    const p = await api.profile();
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
