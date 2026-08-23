import { describe, expect, it } from 'vitest';
import { genIdentity, signBytes, verifyBytes } from '../src/identity.js';
import { Transcript, canonicalize, signableBytes, verifyTranscript } from '../src/transcript.js';

function signedEntry(
  t: Transcript,
  id: { publicKey: string; secretKey: string },
  type: string,
  payload: unknown,
) {
  const seq = t.entries.length;
  const sig = signBytes(id.secretKey, signableBytes(seq, t.head, type, id.publicKey, payload));
  return t.append({ type, from: id.publicKey, payload, sig });
}

describe('identityFromSeed', () => {
  it('is deterministic and signs correctly', async () => {
    const { identityFromSeed } = await import('../src/identity.js');
    const seed = new Uint8Array(32).fill(7);
    const a = identityFromSeed(seed);
    const b = identityFromSeed(seed);
    expect(a).toEqual(b);
    const msg = new TextEncoder().encode('x');
    expect(verifyBytes(a.publicKey, msg, signBytes(a.secretKey, msg))).toBe(true);
    expect(() => identityFromSeed(new Uint8Array(16))).toThrow();
  });
});

describe('identity', () => {
  it('signs and verifies', () => {
    const id = genIdentity();
    const msg = new TextEncoder().encode('hello');
    const sig = signBytes(id.secretKey, msg);
    expect(verifyBytes(id.publicKey, msg, sig)).toBe(true);
    expect(verifyBytes(id.publicKey, new TextEncoder().encode('hellp'), sig)).toBe(false);
  });
});

describe('canonicalize', () => {
  it('is key-order independent', () => {
    expect(canonicalize({ b: 1, a: [{ y: 2, x: 3 }] })).toBe(
      canonicalize({ a: [{ x: 3, y: 2 }], b: 1 }),
    );
  });
});

describe('transcript', () => {
  it('verifies an honest chain', () => {
    const alice = genIdentity(),
      bob = genIdentity();
    const t = new Transcript();
    signedEntry(t, alice, 'bet', { amount: 50 });
    signedEntry(t, bob, 'call', { amount: 50 });
    const pubkeys = new Map([
      [alice.publicKey, alice.publicKey],
      [bob.publicKey, bob.publicKey],
    ]);
    const res = verifyTranscript(t.entries, pubkeys);
    expect(res).toEqual({ ok: true, head: t.head });
  });
  it('catches payload tampering', () => {
    const alice = genIdentity();
    const t = new Transcript();
    signedEntry(t, alice, 'bet', { amount: 50 });
    const forged = [{ ...t.entries[0]!, payload: { amount: 5000 } }];
    const res = verifyTranscript(forged, new Map([[alice.publicKey, alice.publicKey]]));
    expect(res.ok).toBe(false);
    expect(res.badSeq).toBe(0);
  });
  it('catches reordering', () => {
    const alice = genIdentity();
    const t = new Transcript();
    signedEntry(t, alice, 'a', 1);
    signedEntry(t, alice, 'b', 2);
    const res = verifyTranscript(
      [t.entries[1]!, t.entries[0]!],
      new Map([[alice.publicKey, alice.publicKey]]),
    );
    expect(res.ok).toBe(false);
  });
});
