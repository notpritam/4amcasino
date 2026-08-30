# Platform Account Foundations — Implementation Plan (Plan 1 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the single Platform account (`4amcasino`) as first-class server state — a helper module, an idempotent adopt-or-create seed, `isPlatform` on `/api/me`, and exclusion of the Platform account from the leaderboard.

**Architecture:** Store the Platform user id in the existing `meta` table under key `platform_user_id`. A new `apps/server/src/platform.ts` owns all reads/writes of that state plus the adopt-or-create logic. A `tsx`-run seed script derives credentials (only when creating on local) using the exact web KDF. `/api/me` and the leaderboard query read the Platform id.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import suffixes), Fastify, better-sqlite3, vitest, `@noble/hashes` (scrypt), `@4am/mental-poker` (`identityFromSeed`).

**Spec:** `docs/superpowers/specs/2026-08-30-platform-account-design.md` (§3, §4, §9.1)

## Global Constraints

- ESM with explicit `.js` suffixes on relative imports (matches every file in `apps/server/src`).
- All DB access via better-sqlite3 prepared statements (no ORM).
- KDF must match the web verbatim (`apps/web/src/shared/crypto.ts`): scrypt `PARAMS = { N: 2**15, r: 8, p: 1, dkLen: 32 }`; `authKey = bytesToHex(scrypt(password, "4am/auth/<username>", PARAMS))`; identity `= identityFromSeed(scrypt(password, "4am/id/<username>", PARAMS))`.
- On production the `4amcasino` account already exists → **adopt** it (set meta only); never write its password. `PLATFORM_PASSWORD` is used only on the local create path (dev default `Fun99312@`).
- The Platform account must be excluded from the leaderboard (this plan), and later from top-3 badges and peer settle-up (Plans 6 and 2).
- Never use `git commit --no-verify`.
- Run tests with `npx vitest run <file>` from repo root; full suite is `npm test`.

---

### Task 1: Platform state helper module

**Files:**
- Create: `apps/server/src/platform.ts`
- Test: `apps/server/test/platform.test.ts`

**Interfaces:**
- Consumes: `openDb`, `DB` from `./db.js`; `createUser` from `./auth.js`.
- Produces:
  - `platformUserId(db: DB): number | null`
  - `setPlatformUserId(db: DB, id: number): void`
  - `isPlatform(db: DB, userId: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/platform.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { platformUserId, setPlatformUserId, isPlatform } from '../src/platform.js';

describe('platform state', () => {
  it('is unset until written, then round-trips', () => {
    const db = openDb(':memory:');
    expect(platformUserId(db)).toBeNull();
    expect(isPlatform(db, 5)).toBe(false);
    setPlatformUserId(db, 5);
    expect(platformUserId(db)).toBe(5);
    expect(isPlatform(db, 5)).toBe(true);
    expect(isPlatform(db, 6)).toBe(false);
  });

  it('setPlatformUserId is idempotent (upsert)', () => {
    const db = openDb(':memory:');
    setPlatformUserId(db, 5);
    setPlatformUserId(db, 7);
    expect(platformUserId(db)).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/server/test/platform.test.ts`
Expected: FAIL — cannot resolve `../src/platform.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/server/src/platform.ts`:

```ts
import type { DB } from './db.js';

const KEY = 'platform_user_id';

/** The Platform (house/admin) account id, or null if not configured yet. */
export function platformUserId(db: DB): number | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(KEY) as
    | { value: string }
    | undefined;
  if (!row) return null;
  const n = Number(row.value);
  return Number.isInteger(n) ? n : null;
}

/** Upsert the Platform account id into the meta table. */
export function setPlatformUserId(db: DB, id: number): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(KEY, String(id));
}

/** True iff userId is the configured Platform account. */
export function isPlatform(db: DB, userId: number): boolean {
  return platformUserId(db) === userId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/server/test/platform.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/platform.ts apps/server/test/platform.test.ts
git commit -m "feat(server): platform account state helpers"
```

---

### Task 2: Surface `isPlatform` on `/api/me`

**Files:**
- Modify: `apps/server/src/app.ts:138-153` (the `/api/me` handler)
- Test: `apps/server/test/platform.test.ts` (add a case)

**Interfaces:**
- Consumes: `isPlatform`, `setPlatformUserId` from `./platform.js`; `createApp` returns `{ app, db }`.
- Produces: `/api/me` response gains `isPlatform: boolean`.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/platform.test.ts`:

```ts
import { createApp } from '../src/app.js';

async function register(app: ReturnType<typeof createApp>['app'], username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username, authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) },
  });
  return res.json() as { userId: number; token: string };
}

describe('/api/me isPlatform', () => {
  it('is true only for the platform account', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const bob = await register(ctx.app, 'bob');
    setPlatformUserId(ctx.db, alice.userId);

    const meAlice = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${alice.token}` },
    });
    const meBob = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(meAlice.json().isPlatform).toBe(true);
    expect(meBob.json().isPlatform).toBe(false);
    await ctx.app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/server/test/platform.test.ts -t "isPlatform"`
Expected: FAIL — `meAlice.json().isPlatform` is `undefined`, not `true`.

- [ ] **Step 3: Write minimal implementation**

In `apps/server/src/app.ts`, add the import near the other route imports:

```ts
import { isPlatform } from './platform.js';
```

Change the `/api/me` return (currently `app.ts:147-152`) to include the flag:

```ts
    return {
      userId: row.id,
      username: row.username,
      publicKey: row.pubkey,
      joinNumber: row.joinNumber,
      isPlatform: isPlatform(db, row.id),
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/server/test/platform.test.ts`
Expected: PASS (all cases). Also run `npx vitest run apps/server/test/auth.test.ts` to confirm the existing `/api/me` shape assertion (`toMatchObject({ username: 'alice' })`) still passes.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/test/platform.test.ts
git commit -m "feat(server): expose isPlatform on /api/me"
```

---

### Task 3: Exclude the Platform account from the leaderboard

**Files:**
- Modify: `apps/server/src/profile.ts:31-38` (the `LEADERBOARD_SQL` constant)
- Test: `apps/server/test/platform.test.ts` (add a case)

**Interfaces:**
- Consumes: `appendLedger` from `../src/ledger.js`; `setPlatformUserId` from `./platform.js`.
- Produces: `/api/leaderboard` no longer returns the Platform account.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/platform.test.ts`:

```ts
import { appendLedger } from '../src/ledger.js';

function seedRoomWithSettlements(
  db: ReturnType<typeof openDb>,
  roomId: string,
  hostId: number,
  players: { userId: number; delta: number }[],
) {
  db.prepare(
    `INSERT INTO rooms (id, name, join_code, host_id, banker_id, sb, bb, audit_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'private', ?)`,
  ).run(roomId, 'T', roomId.toUpperCase().slice(0, 6), hostId, hostId, 1, 2, Date.now());
  for (const p of players) {
    appendLedger(db, { roomId, userId: p.userId, delta: p.delta, kind: 'hand-settlement', ref: 'h1' });
  }
}

describe('leaderboard excludes platform', () => {
  it('omits the platform account from /api/leaderboard', async () => {
    const ctx = createApp(':memory:');
    const alice = await register(ctx.app, 'alice');
    const house = await register(ctx.app, 'house');
    seedRoomWithSettlements(ctx.db, 'room01', alice.userId, [
      { userId: alice.userId, delta: 100 },
      { userId: house.userId, delta: 500 },
    ]);
    setPlatformUserId(ctx.db, house.userId);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/leaderboard',
      headers: { authorization: `Bearer ${alice.token}` },
    });
    const ids = (res.json().rows as { userId: number }[]).map((r) => r.userId);
    expect(ids).toContain(alice.userId);
    expect(ids).not.toContain(house.userId);
    await ctx.app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/server/test/platform.test.ts -t "leaderboard excludes"`
Expected: FAIL — `house.userId` is present (it currently ranks #1 with net 500).

- [ ] **Step 3: Write minimal implementation**

In `apps/server/src/profile.ts`, edit `LEADERBOARD_SQL` (lines 31-38). Add one WHERE clause. `NOT IN (empty subquery)` is TRUE, so this is safe when no platform is configured:

```ts
const LEADERBOARD_SQL = `
  SELECT u.id as userId, u.username, u.display_name as displayName, u.avatar_version as avatarVersion,
         SUM(l.delta) as net, COUNT(*) as handsPlayed, MAX(l.delta) as biggestWin
  FROM ledger l JOIN users u ON u.id = l.user_id JOIN rooms r ON r.id = l.room_id
  WHERE l.kind = 'hand-settlement' AND u.private_mode = 0 AND r.voided = 0 AND r.archived = 0
    AND u.id NOT IN (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'platform_user_id')
    AND NOT EXISTS (SELECT 1 FROM ledger v WHERE v.room_id = l.room_id AND v.kind = 'void-hand' AND v.ref = l.ref) %ROOM%
  GROUP BY u.id ORDER BY net DESC, handsPlayed DESC
`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/server/test/platform.test.ts`
Expected: PASS. Also run the existing profile suite if present: `npx vitest run apps/server/test/profile.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/profile.ts apps/server/test/platform.test.ts
git commit -m "feat(server): exclude platform account from leaderboard"
```

---

### Task 4: Adopt-or-create seed (script + tested core)

**Files:**
- Modify: `apps/server/src/platform.ts` (add `ensurePlatformAccount`)
- Create: `apps/server/scripts/platform-crypto.ts` (KDF, script-only)
- Create: `apps/server/scripts/seed-platform.ts` (CLI wrapper)
- Modify: `apps/server/package.json` (add `@noble/hashes` dep only if it does not already resolve)
- Test: `apps/server/test/platform.test.ts` (add cases)

**Interfaces:**
- Consumes: `platformUserId`, `setPlatformUserId` (Task 1); `createUser` from `./auth.js`; `identityFromSeed` from `@4am/mental-poker`; `scrypt`/`bytesToHex` from `@noble/hashes`.
- Produces:
  - `ensurePlatformAccount(db: DB, opts: { username: string; createCreds: () => { authKey: string; publicKey: string } }): { userId: number; created: boolean; adopted: boolean }`
  - `derivePlatformCredentials(username: string, password: string): { authKey: string; publicKey: string }`

- [ ] **Step 1: Write the failing test (adopt-or-create core)**

Append to `apps/server/test/platform.test.ts`:

```ts
import { ensurePlatformAccount } from '../src/platform.js';
import { createUser } from '../src/auth.js';

describe('ensurePlatformAccount', () => {
  it('creates the account when neither meta nor user exists', () => {
    const db = openDb(':memory:');
    const res = ensurePlatformAccount(db, {
      username: '4amcasino',
      createCreds: () => ({ authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) }),
    });
    expect(res).toMatchObject({ created: true, adopted: false });
    expect(platformUserId(db)).toBe(res.userId);
    const again = ensurePlatformAccount(db, {
      username: '4amcasino',
      createCreds: () => { throw new Error('must not create twice'); },
    });
    expect(again).toMatchObject({ created: false, adopted: false, userId: res.userId });
  });

  it('adopts an existing account without calling createCreds', () => {
    const db = openDb(':memory:');
    const { userId } = createUser(db, '4amcasino', 'a'.repeat(64), 'b'.repeat(64));
    const res = ensurePlatformAccount(db, {
      username: '4amcasino',
      createCreds: () => { throw new Error('must not derive on adopt'); },
    });
    expect(res).toEqual({ userId, created: false, adopted: true });
    expect(platformUserId(db)).toBe(userId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/server/test/platform.test.ts -t "ensurePlatformAccount"`
Expected: FAIL — `ensurePlatformAccount` is not exported.

- [ ] **Step 3: Implement `ensurePlatformAccount`**

Add to `apps/server/src/platform.ts`:

```ts
import { createUser } from './auth.js';

/** Idempotent: use the configured platform id if set; else adopt an existing
 *  same-named user (the prod case); else create one (the local case). */
export function ensurePlatformAccount(
  db: DB,
  opts: { username: string; createCreds: () => { authKey: string; publicKey: string } },
): { userId: number; created: boolean; adopted: boolean } {
  const existing = platformUserId(db);
  if (existing !== null) return { userId: existing, created: false, adopted: false };

  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(opts.username) as
    | { id: number }
    | undefined;
  if (row) {
    setPlatformUserId(db, row.id);
    return { userId: row.id, created: false, adopted: true };
  }

  const { authKey, publicKey } = opts.createCreds();
  const { userId } = createUser(db, opts.username, authKey, publicKey);
  setPlatformUserId(db, userId);
  return { userId, created: true, adopted: false };
}
```

- [ ] **Step 4: Run core test to verify it passes**

Run: `npx vitest run apps/server/test/platform.test.ts -t "ensurePlatformAccount"`
Expected: PASS.

- [ ] **Step 5: Write the failing test (derivation is loginable end-to-end)**

First confirm `@noble/hashes` resolves for the server workspace:

Run: `node -e "require.resolve('@noble/hashes/scrypt')" && echo OK || echo MISSING`
If it prints `MISSING`, run `npm install -w apps/server @noble/hashes@^1.4.0` (it is already in the lockfile via the web app; this only records it as a direct server dep).

Append to `apps/server/test/platform.test.ts`:

```ts
import { derivePlatformCredentials } from '../scripts/platform-crypto.js';

describe('platform credentials are loginable', () => {
  it('a created platform account logs in with the derived authKey', async () => {
    const ctx = createApp(':memory:');
    const creds = derivePlatformCredentials('4amcasino', 'Fun99312@'); // scrypt: ~1-2s
    ensurePlatformAccount(ctx.db, { username: '4amcasino', createCreds: () => creds });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: '4amcasino', authKey: creds.authKey },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().publicKey).toBe(creds.publicKey);
    await ctx.app.close();
  }, 15_000);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run apps/server/test/platform.test.ts -t "loginable"`
Expected: FAIL — cannot resolve `../scripts/platform-crypto.js`.

- [ ] **Step 7: Implement the KDF and the CLI script**

Create `apps/server/scripts/platform-crypto.ts`:

```ts
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
```

Create `apps/server/scripts/seed-platform.ts`:

```ts
import { openDb } from '../src/db.js';
import { ensurePlatformAccount } from '../src/platform.js';
import { derivePlatformCredentials } from './platform-crypto.js';

// Usage: npx tsx apps/server/scripts/seed-platform.ts [dbPath]
// Env: PLATFORM_USERNAME (default 4amcasino), PLATFORM_PASSWORD (default Fun99312@, LOCAL create only)
const dbPath = process.argv[2] ?? process.env.DB_PATH ?? '4amcasino.db';
const username = process.env.PLATFORM_USERNAME ?? '4amcasino';
const password = process.env.PLATFORM_PASSWORD ?? 'Fun99312@';

const db = openDb(dbPath);
const res = ensurePlatformAccount(db, {
  username,
  createCreds: () => derivePlatformCredentials(username, password),
});
console.log(
  res.adopted
    ? `adopted existing '${username}' as platform (id ${res.userId})`
    : res.created
      ? `created platform account '${username}' (id ${res.userId})`
      : `platform already configured (id ${res.userId})`,
);
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run apps/server/test/platform.test.ts`
Expected: PASS (all cases, including the loginable one).

- [ ] **Step 9: Seed the local dev DB and verify login manually**

Run: `PLATFORM_PASSWORD='Fun99312@' npx tsx apps/server/scripts/seed-platform.ts 4amcasino.db`
Expected: prints `created platform account '4amcasino' (id N)` (or `adopted...`/`already configured` on reruns — it is idempotent).

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/platform.ts apps/server/scripts/platform-crypto.ts \
  apps/server/scripts/seed-platform.ts apps/server/package.json apps/server/test/platform.test.ts
git commit -m "feat(server): adopt-or-create platform account seed"
```

---

## Self-Review

**Spec coverage (§3, §4, §9.1):**
- `meta.platform_user_id` + `isPlatform` gate → Task 1. ✅
- Adopt-or-create seed, idempotent, prod-adopt / local-create, KDF parity → Task 4. ✅
- `/api/me` surfaces `isPlatform` → Task 2. ✅
- Platform excluded from leaderboard → Task 3. ✅
- (Deferred, correctly: `disabled`/`merged_into` columns and `requirePlatform` land in Plans 4/5 where first used; `leaderboardRank` on the profile payload lands in Plan 6 with the badges that consume it; peer settle-up exclusion lands in Plan 2.)

**Placeholder scan:** none — every step has runnable code or an exact command.

**Type consistency:** `platformUserId`/`setPlatformUserId`/`isPlatform`/`ensurePlatformAccount`/`derivePlatformCredentials` signatures are identical across the Interfaces blocks, the implementations, and the tests. `createApp` used as `{ app, db }` (matches `app.ts:172`). `createUser` returns `{ userId }` (matches `auth.ts:14`).

## Notes for later plans
- Plan 2 (rake) reuses `platformUserId(db)` to pick the rake recipient and to exclude Platform from peer settle-up; it also owns the ledger re-chain helper used by the history rewrite and by Plan 4 (merge).
- `requirePlatform(db)` preHandler is introduced in Plan 5 (first admin route); keep it in `platform.ts`.
