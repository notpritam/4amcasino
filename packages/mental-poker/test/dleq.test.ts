import { describe, expect, it } from 'vitest';
import { cardPoint, mulPoint, pointHex, randScalar } from '../src/group.js';
import { handKeyCommit, proveUnmask, verifyUnmask } from '../src/dleq.js';
import { genIdentity } from '../src/identity.js';
import { signContent, verifyContent } from '../src/dleq.js';

describe('DLEQ unmask proofs', () => {
  it('honest unmask verifies and inverts the mask', () => {
    const k = randScalar();
    const commit = handKeyCommit(k);
    const plain = cardPoint(7);
    const masked = mulPoint(plain, k);
    const { out, proof } = proveUnmask(k, masked);
    expect(pointHex(out)).toBe(pointHex(plain));
    expect(verifyUnmask(commit, masked, out, proof)).toBe(true);
  });
  it('rejects a share produced with a different key than committed', () => {
    const k = randScalar();
    const other = randScalar();
    const masked = mulPoint(cardPoint(7), k);
    const { out, proof } = proveUnmask(other, masked); // cheater unmasks with wrong key
    expect(verifyUnmask(handKeyCommit(k), masked, out, proof)).toBe(false);
  });
  it('rejects a swapped output point (claiming a different card)', () => {
    const k = randScalar();
    const commit = handKeyCommit(k);
    const masked = mulPoint(cardPoint(7), k);
    const { proof } = proveUnmask(k, masked);
    const lie = cardPoint(51); // "I actually had the ace of spades"
    expect(verifyUnmask(commit, masked, lie, proof)).toBe(false);
  });
  it('rejects a tampered proof', () => {
    const k = randScalar();
    const commit = handKeyCommit(k);
    const masked = mulPoint(cardPoint(7), k);
    const { out, proof } = proveUnmask(k, masked);
    const bad = { ...proof, z: proof.z.slice(0, -2) + (proof.z.endsWith('00') ? '01' : '00') };
    expect(verifyUnmask(commit, masked, out, bad)).toBe(false);
  });
});

describe('content signatures', () => {
  it('binds handId, type, and body', () => {
    const id = genIdentity();
    const sig = signContent(id.secretKey, 'hand1', 'action', { type: 'raise', amount: 100 });
    expect(verifyContent(id.publicKey, 'hand1', 'action', { type: 'raise', amount: 100 }, sig)).toBe(true);
    expect(verifyContent(id.publicKey, 'hand1', 'action', { type: 'raise', amount: 999 }, sig)).toBe(false);
    expect(verifyContent(id.publicKey, 'hand2', 'action', { type: 'raise', amount: 100 }, sig)).toBe(false);
    expect(verifyContent(id.publicKey, 'hand1', 'fold', { type: 'raise', amount: 100 }, sig)).toBe(false);
  });
});
