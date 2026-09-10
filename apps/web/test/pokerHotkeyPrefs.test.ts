import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POKER_HOTKEYS } from '@4am/shared';
const profile = vi.hoisted(() => vi.fn());
vi.mock('../src/shared/api.ts', () => ({ api: { profile } }));
vi.mock('../src/shared/sounds.ts', () => ({}));
const storage = { getItem: () => null, setItem: vi.fn(), removeItem: () => {} };
vi.stubGlobal('localStorage', storage);
vi.stubGlobal('window', { localStorage: storage });
vi.stubGlobal('document', { documentElement: { classList: { add: vi.fn(), remove: vi.fn() } } });
const { useStore } = await import('../src/shared/store.ts');
const { loadPrefs, savePokerHotkeysLocally } = await import('../src/shared/prefs.ts');
const auth = (id: number, token = String(id)) => ({
  userId: id,
  token,
  username: 'user' + id,
  identity: null,
});
const custom = {
  ...DEFAULT_POKER_HOTKEYS,
  bindings: { ...DEFAULT_POKER_HOTKEYS.bindings, fold: 'Q' },
};
beforeEach(() => {
  useStore.getState().logout();
  profile.mockReset();
});
describe('account-owned shortcut preferences', () => {
  it('finishes the initial profile load when a newer shortcut-only refresh wins', async () => {
    useStore.getState().setAuth(auth(1));
    let finish!: (value: unknown) => void;
    profile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const initial = loadPrefs();
    profile.mockResolvedValueOnce({ userId: 1, pokerHotkeys: custom });
    await loadPrefs({ onlyHotkeys: true });
    finish({ userId: 1, pokerHotkeys: DEFAULT_POKER_HOTKEYS, displayName: 'Alice' });
    await initial;
    expect(useStore.getState().prefs.displayName).toBe('Alice');
    expect(useStore.getState().prefs.pokerHotkeys).toEqual(custom);
  });
  it('refreshes shortcuts without overwriting unsaved table appearance edits', async () => {
    useStore.getState().setAuth(auth(1));
    useStore.getState().setPrefs({ cardBack: 'crimson' });
    profile.mockResolvedValueOnce({ userId: 1, pokerHotkeys: custom, cardBack: 'indigo' });
    await loadPrefs({ onlyHotkeys: true });
    expect(useStore.getState().prefs.pokerHotkeys).toEqual(custom);
    expect(useStore.getState().prefs.cardBack).toBe('crimson');
  });
  it('activates only after the signed-in account loads and resets on account/session changes', () => {
    useStore.getState().setAuth(auth(1));
    expect(useStore.getState().pokerHotkeysFor).toBeNull();
    useStore.getState().setPokerHotkeys(custom, 1);
    useStore.getState().setAuth(auth(1));
    expect(useStore.getState().pokerHotkeysFor).toBe(1);
    useStore.getState().setAuth(auth(2));
    expect(useStore.getState().pokerHotkeysFor).toBeNull();
    useStore.getState().setPokerHotkeys(custom, 1);
    expect(useStore.getState().pokerHotkeysFor).toBeNull();
    useStore.getState().setPokerHotkeys(DEFAULT_POKER_HOTKEYS, 2);
    useStore.getState().setAuth(auth(2, 'new-session'));
    expect(useStore.getState().pokerHotkeysFor).toBeNull();
  });
  it('ignores a profile response belonging to an account that signed out while loading', async () => {
    useStore.getState().setAuth(auth(1));
    let finish!: (value: unknown) => void;
    profile.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = loadPrefs();
    useStore.getState().setAuth(auth(2));
    finish({ userId: 1, pokerHotkeys: custom });
    await pending;
    expect(useStore.getState().pokerHotkeysFor).toBeNull();
  });
  it('keeps a saved edit when an older profile load arrives late', async () => {
    useStore.getState().setAuth(auth(1));
    let finish!: (value: unknown) => void;
    profile.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = loadPrefs();
    savePokerHotkeysLocally(custom, 1);
    finish({ userId: 1, pokerHotkeys: DEFAULT_POKER_HOTKEYS });
    await pending;
    expect(useStore.getState().prefs.pokerHotkeys).toEqual(custom);
    expect(useStore.getState().pokerHotkeysFor).toBe(1);
  });
  it('leaves shortcuts inactive if the profile fails or returns malformed settings', async () => {
    useStore.getState().setAuth(auth(1));
    profile.mockRejectedValueOnce(new Error('offline'));
    await loadPrefs();
    expect(useStore.getState().pokerHotkeysFor).toBeNull();
    profile.mockResolvedValueOnce({ userId: 1, pokerHotkeys: { enabled: true } });
    await loadPrefs();
    expect(useStore.getState().pokerHotkeysFor).toBeNull();
  });
});
