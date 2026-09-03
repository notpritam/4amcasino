// Mirrors apps/web/src/shared/crypto.ts. The golden-vector test in
// apps/server/test/platform.test.ts guards against the two copies drifting.
import { scrypt } from '@noble/hashes/scrypt';
import { bytesToHex } from '@noble/hashes/utils';
import { identityFromSeed } from '@4am/mental-poker';

// MUST stay byte-for-byte identical to apps/web/src/shared/crypto.ts, or the
// seeded account cannot be logged into from the browser.
const PARAMS = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;

export function derivePlatformCredentials(
  username: string,
  password: string,
): { authKey: string; publicKey: string } {
  const authKey = bytesToHex(scrypt(password, `4am/auth/${username}`, PARAMS));
  const { publicKey } = identityFromSeed(scrypt(password, `4am/id/${username}`, PARAMS));
  return { authKey, publicKey };
}
