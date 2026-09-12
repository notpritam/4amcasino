import { writeFile } from 'node:fs/promises';
import { createApp } from '../../../server/src/app.js';
import { attachHub } from '../../../server/src/hub.js';
import { createUser, createSession } from '../../../server/src/auth.js';
import { identityFromSeed } from '@4am/mental-poker';
import { scrypt } from '@noble/hashes/scrypt';
import { bytesToHex } from '@noble/hashes/utils';
const { app, db } = createApp(':memory:');
attachHub(app, db);
const users = ['arena_host', 'arena_alice', 'arena_bob'].map((username) => {
  const password = 'local-arena-qa-only';
  const params = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 };
  const identity = identityFromSeed(scrypt(password, `4am/id/${username}`, params));
  const { userId } = createUser(
    db,
    username,
    bytesToHex(scrypt(password, `4am/auth/${username}`, params)),
    identity.publicKey,
  );
  return { username, userId, token: createSession(db, userId), identity };
});
await writeFile('/tmp/4am-arena-fixture.json', JSON.stringify({ users }), { mode: 0o600 });
await app.listen({ port: Number(process.env.PORT ?? 58599), host: '127.0.0.1' });
console.log('Local arena fixture ready; synthetic credentials are in /tmp/4am-arena-fixture.json.');
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => void app.close().then(() => process.exit(0)));
