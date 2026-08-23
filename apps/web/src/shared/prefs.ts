import { api } from './api.ts';
import { useStore } from './store.ts';

export function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/** Pull profile prefs from the server into the store (and apply the theme). */
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
      theme: p.theme,
      quickPhrases: p.quickPhrases ?? [],
      privateMode: !!p.privateMode,
    });
    applyTheme(p.theme);
  } catch {
    /* not logged in yet */
  }
}

export { soundsEnabled, setSoundsEnabled, soundVolume, setSoundVolume } from './sounds.ts';
