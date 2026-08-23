import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export function genIdentity(): { publicKey: string; secretKey: string } {
  const secret = ed25519.utils.randomPrivateKey();
  return { publicKey: bytesToHex(ed25519.getPublicKey(secret)), secretKey: bytesToHex(secret) };
}

/** Deterministic identity from a 32-byte seed (e.g. scrypt of the user's password). */
export function identityFromSeed(seed: Uint8Array): { publicKey: string; secretKey: string } {
  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  return { publicKey: bytesToHex(ed25519.getPublicKey(seed)), secretKey: bytesToHex(seed) };
}

export function signBytes(secretKeyHex: string, bytes: Uint8Array): string {
  return bytesToHex(ed25519.sign(bytes, hexToBytes(secretKeyHex)));
}

export function verifyBytes(publicKeyHex: string, bytes: Uint8Array, sigHex: string): boolean {
  try {
    return ed25519.verify(hexToBytes(sigHex), bytes, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}
