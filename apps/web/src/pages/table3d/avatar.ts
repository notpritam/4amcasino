/** Saved profile format stays compatible with every existing character. */
export interface Avatar3D {
  c: string;
  t: string;
  head: 'round' | 'cube' | 'cone';
  hat: 'none' | 'cap' | 'halo' | 'crown';
  fx: 'boom' | 'rocket' | 'sparks';
}
export const DEFAULT_AVATAR: Avatar3D = {
  c: '#a78bfa',
  t: '#e879f9',
  head: 'round',
  hat: 'none',
  fx: 'boom',
};
export const HEADS: Avatar3D['head'][] = ['round', 'cube', 'cone'];
export const HATS: Avatar3D['hat'][] = ['none', 'cap', 'halo', 'crown'];
export const FX: Avatar3D['fx'][] = ['boom', 'rocket', 'sparks'];
export const COLORS = [
  { value: '#a78bfa', name: 'Lavender' },
  { value: '#e879f9', name: 'Orchid' },
  { value: '#60a5fa', name: 'Cobalt' },
  { value: '#34d399', name: 'Mint' },
  { value: '#fbbf24', name: 'Gold' },
  { value: '#fb7185', name: 'Coral' },
  { value: '#f8fafc', name: 'Pearl' },
  { value: '#64748b', name: 'Graphite' },
];
export const PRESETS: { name: string; cfg: Avatar3D }[] = [
  { name: 'Orbit', cfg: { ...DEFAULT_AVATAR, hat: 'halo', t: '#60a5fa', fx: 'sparks' } },
  {
    name: 'High roller',
    cfg: { c: '#f8fafc', t: '#fbbf24', head: 'round', hat: 'crown', fx: 'boom' },
  },
  { name: 'Wildcard', cfg: { c: '#34d399', t: '#fbbf24', head: 'cube', hat: 'cap', fx: 'rocket' } },
  {
    name: 'After hours',
    cfg: { c: '#64748b', t: '#e879f9', head: 'cone', hat: 'none', fx: 'sparks' },
  },
];
export function parseAvatar(raw: string | null | undefined): Avatar3D {
  try {
    const v = JSON.parse(raw ?? '');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...DEFAULT_AVATAR };
    const hex = (x: unknown, fallback: string) =>
      typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : fallback;
    return {
      c: hex(v.c, DEFAULT_AVATAR.c),
      t: hex(v.t, DEFAULT_AVATAR.t),
      head: HEADS.includes(v.head) ? v.head : 'round',
      hat: HATS.includes(v.hat) ? v.hat : 'none',
      fx: FX.includes(v.fx) ? v.fx : 'boom',
    };
  } catch {
    return { ...DEFAULT_AVATAR };
  }
}
