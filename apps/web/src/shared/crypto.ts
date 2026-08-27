import { scrypt } from '@noble/hashes/scrypt';
import { bytesToHex } from '@noble/hashes/utils';
import { identityFromSeed } from '@4am/mental-poker';

const PARAMS = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;

/** Sent to the server as the password-equivalent. Domain-separated from the identity seed. */
export function deriveAuthKey(username: string, password: string): string {
  return bytesToHex(scrypt(password, `4am/auth/${username}`, PARAMS));
}

/** The ed25519 signing identity. Never leaves the browser. */
export function deriveIdentity(username: string, password: string): { publicKey: string; secretKey: string } {
  return identityFromSeed(scrypt(password, `4am/id/${username}`, PARAMS));
}

// Account recovery: your password derives your signing key, so a forgotten
// password is an unrecoverable identity unless you set this up first. The
// recovery code is a second door - shown once, never stored by us in the clear
// (requested by notpritam, docs/FEATURES.md).

/** No I/O/0/1 - a code people read off a screen and type back in without ambiguity. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 120 bits, grouped for legibility. 256 % 32 === 0, so the byte->char map is unbiased. */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]!);
  return [0, 6, 12, 18].map((i) => chars.slice(i, i + 6).join('')).join('-');
}

/** Accepts whatever the user pasted: spaces, dashes and lowercase all normalise away. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Deliberately NOT bound to the username: renaming yourself later must not
 *  silently invalidate the recovery code sitting in someone's password manager. */
export function deriveRecoveryAuthKey(code: string): string {
  return bytesToHex(scrypt(normalizeRecoveryCode(code), '4am/recover', PARAMS));
}
