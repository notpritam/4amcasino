import { api } from './api.ts';
import { useStore } from './store.ts';

export type Theme = 'light' | 'dark' | 'cyber';

export function applyTheme(theme: Theme): void {
  // cyber layers on dark so every dark: variant participates in the reskin
  document.documentElement.classList.toggle('dark', theme !== 'light');
  document.documentElement.classList.toggle('cyber', theme === 'cyber');
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
      autoJoinInvites: !!p.autoJoinInvites,
      autoReady: !!p.autoReady,
    });
    applyTheme(p.theme);
  } catch {
    /* not logged in yet */
  }
}

export { soundsEnabled, setSoundsEnabled, soundVolume, setSoundVolume } from './sounds.ts';
