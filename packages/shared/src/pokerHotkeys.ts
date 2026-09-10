export const POKER_HOTKEY_ACTIONS = [
  'fold',
  'check',
  'call',
  'raise',
  'halfPot',
  'pot',
  'allIn',
] as const;
export type PokerHotkeyAction = (typeof POKER_HOTKEY_ACTIONS)[number];
export interface PokerHotkeys {
  enabled: boolean;
  bindings: Record<PokerHotkeyAction, string | null>;
}

export const DEFAULT_POKER_HOTKEYS: PokerHotkeys = {
  enabled: true,
  bindings: { fold: 'F', check: 'X', call: 'C', raise: 'R', halfPot: '2', pot: '3', allIn: 'I' },
};

/** Leave native navigation, browser commands and 3D movement keys alone. */
export function validPokerBinding(key: unknown): key is string {
  return (
    typeof key === 'string' && /^(Shift\+)?[A-Z0-9]$/.test(key) && !/^(Shift\+)?[WASD]$/.test(key)
  );
}

export function pokerHotkeysError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'Invalid shortcut settings.';
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== 2 ||
    typeof v.enabled !== 'boolean' ||
    !v.bindings ||
    typeof v.bindings !== 'object' ||
    Array.isArray(v.bindings)
  )
    return 'Invalid shortcut settings.';
  const bindings = v.bindings as Record<string, unknown>;
  if (Object.keys(bindings).length !== POKER_HOTKEY_ACTIONS.length)
    return 'Include every action, or clear its shortcut.';
  const used = new Set<string>();
  for (const action of POKER_HOTKEY_ACTIONS) {
    const key = bindings[action];
    if (key === null) continue;
    if (!validPokerBinding(key))
      return 'Use a letter or number, optionally with Shift. WASD is reserved for 3D movement.';
    if (used.has(key)) return `${key} is assigned to more than one action.`;
    used.add(key);
  }
  return null;
}

export function parsePokerHotkeys(value: unknown): PokerHotkeys | null {
  if (pokerHotkeysError(value)) return null;
  const v = value as PokerHotkeys;
  return { enabled: v.enabled, bindings: { ...v.bindings } };
}

export function pokerBindingFromEvent(event: {
  key: string;
  code?: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
}): string | null {
  if (
    event.repeat ||
    event.isComposing ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return null;
  const letter = /^Digit[0-9]$/.test(event.code ?? '') ? event.code!.slice(-1) : event.key;
  if (!/^[a-z0-9]$/i.test(letter)) return null;
  const key = `${event.shiftKey ? 'Shift+' : ''}${letter.toUpperCase()}`;
  return validPokerBinding(key) ? key : null;
}
