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
    });
    applyTheme(p.theme);
  } catch {
    /* not logged in yet */
  }
}

export function soundsEnabled(): boolean {
  return localStorage.getItem('4am-sounds') !== 'off';
}
export function setSoundsEnabled(on: boolean): void {
  localStorage.setItem('4am-sounds', on ? 'on' : 'off');
}

let audioCtx: AudioContext | null = null;

/** Tiny attention beep (your turn / clock running out). */
export function beep(freq = 880, duration = 0.09, volume = 0.04): void {
  if (!soundsEnabled()) return;
  try {
    audioCtx ??= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch {
    /* audio blocked until user interacts - fine */
  }
}
