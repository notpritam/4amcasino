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
