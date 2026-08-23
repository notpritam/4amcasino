import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export function genIdentity(): { publicKey: string; secretKey: string } {
  const secret = ed25519.utils.randomPrivateKey();
  return { publicKey: bytesToHex(ed25519.getPublicKey(secret)), secretKey: bytesToHex(secret) };
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
