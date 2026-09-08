import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const bootstrap = readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8');

function boot(saved: string | null, storageBlocked = false) {
  const classes = new Set<string>();
  const style = { colorScheme: '' };
  const listeners = new Map<
    string,
    (event: { key?: string | null; newValue?: string | null }) => void
  >();
  let chromeColor = '';
  const root = {
    style,
    classList: {
      add: (value: string) => classes.add(value),
      contains: (value: string) => classes.has(value),
      toggle: (value: string, enabled: boolean) =>
        enabled ? classes.add(value) : classes.delete(value),
    },
  };
  runInNewContext(bootstrap, {
    document: {
      documentElement: root,
      querySelector: () => ({
        setAttribute: (_key: string, value: string) => {
          chromeColor = value;
        },
      }),
    },
    localStorage: {
      getItem: () => {
        if (storageBlocked) throw new Error('Blocked');
        return saved;
      },
    },
    CustomEvent: class {
      constructor(public type: string) {}
    },
    window: {
      addEventListener: (name: string, listener: (event: object) => void) =>
        listeners.set(name, listener),
      dispatchEvent: (event: { type: string }) => listeners.get(event.type)?.({}),
    },
  });
  return {
    classes,
    style,
    chromeColor: () => chromeColor,
    event: (name: string, event = {}) => listeners.get(name)?.(event),
  };
}

describe('appearance before React starts', () => {
  it.each([null, 'light', 'cyber', 'invalid'])('defaults safely to light for %s', (saved) => {
    const page = boot(saved);
    expect([...page.classes]).toEqual(['zeus']);
    expect(page.style.colorScheme).toBe('light');
    expect(page.chromeColor()).toBe('#ffffff');
  });
  it('restores dark before the app loads', () => {
    const page = boot('dark');
    expect(page.classes.has('dark')).toBe(true);
    expect(page.style.colorScheme).toBe('dark');
    expect(page.chromeColor()).toBe('#262626');
  });
  it('still starts with blocked storage', () => {
    expect(boot('dark', true).style.colorScheme).toBe('light');
  });
  it('tracks theme changes and clearing preferences from another tab', () => {
    const page = boot('light');
    page.event('storage', { key: 'zeus:theme', newValue: 'dark' });
    expect(page.classes.has('dark')).toBe(true);
    expect(page.chromeColor()).toBe('#262626');
    page.event('storage', { key: 'unrelated', newValue: 'light' });
    expect(page.classes.has('dark')).toBe(true);
    page.event('storage', { key: null, newValue: null });
    expect(page.classes.has('dark')).toBe(false);
    expect(page.chromeColor()).toBe('#ffffff');
  });
  it('updates browser chrome after the Zeus control changes the root class', () => {
    const page = boot('light');
    page.classes.add('dark');
    page.event('zeus:theme-change');
    expect(page.style.colorScheme).toBe('dark');
    expect(page.chromeColor()).toBe('#262626');
  });
});
