import { describe, expect, it } from 'vitest';
import { parseAvatar, DEFAULT_AVATAR } from '../src/pages/table3d/avatar.ts';

describe('3D avatar profile compatibility', () => {
  it('keeps existing saved wardrobes intact', () => {
    const existing = { c: '#60a5fa', t: '#34d399', head: 'cube', hat: 'crown', fx: 'rocket' };
    expect(parseAvatar(JSON.stringify(existing))).toEqual(existing);
  });
  it('recovers malformed and non-object saved profiles', () => {
    for (const raw of [undefined, null, '', '{', 'null', '[]', '42', '"text"']) {
      expect(parseAvatar(raw)).toEqual(DEFAULT_AVATAR);
    }
  });
  it('validates each field independently without losing valid choices', () => {
    expect(
      parseAvatar(JSON.stringify({ c: 'red', t: '#34d399', head: 'bad', hat: 'halo', fx: 'bad' })),
    ).toEqual({ ...DEFAULT_AVATAR, t: '#34d399', hat: 'halo' });
  });
});
