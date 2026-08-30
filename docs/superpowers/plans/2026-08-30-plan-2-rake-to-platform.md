# Rake to Platform + History Rewrite — Implementation Plan (Plan 2 of 6)

> **For agentic workers:** implement task-by-task with TDD. Steps use `- [ ]`.

**Goal:** Route each hand's 1% commission chips to the Platform account instead of the room banker (forward), exclude the Platform account from peer settle-up, add a ledger re-chain helper, and provide a one-time migration that re-attributes historical commission (chips + ledger) to Platform and re-chains each affected room.

**Architecture:** Extract the rake-crediting into a testable `settleRake` helper that `game.ts` calls with `recipientId = platformUserId(db) ?? room.banker_id`. Add `rechainRoom` to `ledger.ts` (recompute the per-room hash chain from genesis after any row mutation) — reused by the migration and by Plan 4 (merge). The migration and its CLI are split so the core is unit-testable.

**Tech Stack:** TypeScript ESM (`.js` suffixes), better-sqlite3, vitest, `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-30-platform-account-design.md` (§5)

## Global Constraints
- ESM `.js` import suffixes; better-sqlite3 prepared statements only.
- Every ledger mutation keeps the per-room chain valid: after any change, `verifyLedger(db, roomId)` MUST return `{ ok: true }`.
- Per-room invariant preserved by the rewrite: `sum(room_players.stack) == sum(ledger.delta)` for that room.
- Platform is `platformUserId(db)` (Plan 1). If it is null (unseeded), forward rake falls back to the banker — no behavior change.
- **DESTRUCTIVE-OP GUARD (mandatory):** No script may delete or overwrite any `*.db` file. The migration MUST copy the DB to a timestamped backup before mutating, and refuse to run if the backup step fails. Never `rm` a database.
- Never `git commit --no-verify`. Run tests: `npx vitest run apps/server/test/<file>`.

---

### Task 1: `settleRake` helper + wire into game.ts

**Files:** Create `apps/server/src/rake.ts`; Modify `apps/server/src/game.ts` (the rake branch in `finalizeSettlement`, ~lines 1873-1885); Test `apps/server/test/rake.test.ts`.

**Design:**
```ts
// apps/server/src/rake.ts
import type { DB } from './db.js';
import { appendLedger } from './ledger.js';

/** Credits raked chips to `recipientId` on the room ledger (same hand ref), ensuring
 *  the recipient is a room member first so the stack has somewhere to land. */
export function settleRake(
  db: DB,
  args: { roomId: string; recipientId: number; rake: number; ref: string },
): void {
  if (args.rake <= 0) return;
  db.prepare('INSERT OR IGNORE INTO room_players (room_id, user_id) VALUES (?, ?)').run(args.roomId, args.recipientId);
  db.prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?').run(args.rake, args.roomId, args.recipientId);
  appendLedger(db, { roomId: args.roomId, userId: args.recipientId, delta: args.rake, kind: 'commission', ref: args.ref, note: '1% table commission - keeps the lights on' });
}
```
In `game.ts finalizeSettlement`, replace the inline rake block (the `if (rake > 0 && room) { ... }` that credits `room.banker_id`) with:
```ts
if (rake > 0 && room) {
  const recipientId = platformUserId(this.db) ?? room.banker_id;
  settleRake(this.db, { roomId: this.roomId, recipientId, rake, ref: head });
}
```
Add imports at the top of game.ts: `import { settleRake } from './rake.js';` and `import { platformUserId } from './platform.js';`.

**Tests (TDD, rake.test.ts):**
- With platform seeded: `settleRake(db,{roomId,recipientId:platformId,rake:50,ref:'h1'})` → platform `room_players` row created, platform stack === 50, one `commission` ledger row `user_id=platformId delta=50 ref='h1'`, `verifyLedger` ok.
- `rake:0` → no-op (no row, no ledger entry).
- Recipient already a member → stack increments, no duplicate membership error.
Seed a room + users the same way Plan 1's leaderboard test did (direct `INSERT INTO rooms (...)`, register users via `/api/register` or `createUser`).

- [ ] Write failing tests → run (fail) → implement rake.ts + wire game.ts → run (pass) → `git commit -m "feat(server): route rake to platform account"`

---

### Task 2: Exclude Platform from peer settle-up

**Files:** Modify `apps/server/src/social.ts` (`roomDebts`, ~line 502-505); Test `apps/server/test/rake.test.ts` (add cases) or a new `settle-platform.test.ts`.

**Change:** In `roomDebts`, drop the platform user from the nets so it is never a debtor or creditor in peer pairings:
```ts
const platformId = platformUserId(db);
const nets = roomPlayers(db, roomId)
  .map((p) => ({ userId: p.userId, net: p.stack - p.totalBought }))
  .filter((n) => n.net !== 0 && n.userId !== platformId);
```
Add `import { platformUserId } from './platform.js';` to social.ts. This one point feeds both `/api/me/debts` (social.ts) and `/api/me/settle` (settle.ts, via the injected `roomDebts`).

**Tests:** In a room where the platform holds rake (positive net) and two players have a real debt between them, assert `GET /api/me/settle` (as a player) lists the other player but NOT the platform account, and the player-to-player amount is unchanged by the platform's presence.

- [ ] Write failing test → run (fail) → implement filter → run (pass) → `git commit -m "feat(server): exclude platform from peer settle-up"`

---

### Task 3: `rechainRoom` ledger helper

**Files:** Modify `apps/server/src/ledger.ts` (add `rechainRoom`); Test `apps/server/test/ledger.test.ts` (add cases).

**Design:** Recompute `prev_hash`/`entry_hash` for every row of a room in `id` order from `'genesis'`, using the existing `hashFields`. Export it.
```ts
export function rechainRoom(db: DB, roomId: string): void {
  const rows = db.prepare('SELECT * FROM ledger WHERE room_id = ? ORDER BY id ASC').all(roomId) as LedgerRow[];
  let prev = 'genesis';
  const upd = db.prepare('UPDATE ledger SET prev_hash = ?, entry_hash = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const row of rows) {
      const { id, prev_hash, entry_hash, ...fields } = row;
      const eh = hashFields(prev, fields);
      upd.run(prev, eh, id);
      prev = eh;
    }
  });
  tx();
}
```
(Reuses `hashFields`, already defined in ledger.ts.)

**Tests:** Append a few valid ledger rows (chain valid, `verifyLedger` ok). Then `UPDATE ledger SET user_id = ... WHERE id = ...` to break the chain (`verifyLedger` false). `rechainRoom(db, roomId)` → `verifyLedger` ok again, and the mutated field value is preserved.

- [ ] Write failing test → run (fail) → implement `rechainRoom` → run (pass) → `git commit -m "feat(server): add rechainRoom ledger helper"`

---

### Task 4: History-rewrite migration (core + CLI)

**Files:** Modify `apps/server/src/rake.ts` (add `rewriteRakeToPlatform` core); Create `apps/server/scripts/rewrite-rake-to-platform.ts` (CLI: backup + call core); Test `apps/server/test/rake.test.ts` (add cases).

**Core design:**
```ts
export interface RewriteReport {
  roomsRewritten: string[];
  roomsSkippedBankerSpent: { roomId: string; bankerId: number; reclaim: number; bankerStack: number }[];
}
export function rewriteRakeToPlatform(db: DB, platformId: number): RewriteReport { ... }
```
Logic, in ONE `db.transaction`:
1. Find rooms that have `commission` ledger rows whose `user_id != platformId`.
2. For each such room, per old recipient (banker): `reclaim = SUM(delta of that recipient's commission rows)`. If the recipient's current `room_players.stack < reclaim` → record in `roomsSkippedBankerSpent`, DO NOT mutate that room, continue.
3. Otherwise: `UPDATE ledger SET user_id = platformId WHERE room_id=? AND kind='commission' AND user_id!=platformId`; move chips (recipient `stack -= reclaim`; ensure platform `room_players` row; platform `stack += reclaim`); `rechainRoom(db, roomId)`; assert `verifyLedger` ok (throw to roll back the whole migration if not).
4. Return the report.

**CLI** `scripts/rewrite-rake-to-platform.ts`: read db path (argv/env), **copy the db file to `<path>.bak-<epoch>` first** (fs.copyFileSync; if it throws, print error and exit non-zero WITHOUT calling the core), resolve `platformUserId(db)` (exit if unset), call core, print the report (rooms rewritten + any banker-spent rooms to review). MUST NOT delete/overwrite the original db.

**Tests (rake.test.ts):**
- Legacy room: seed a room where a `commission` row is keyed to the banker and the banker's stack includes that rake. Run `rewriteRakeToPlatform(db, platformId)` → commission row now `user_id=platformId`; platform stack has the rake; banker stack reduced by it; `verifyLedger` ok; room in `roomsRewritten`.
- Banker-spent room: banker's stack < reclaim → room reported in `roomsSkippedBankerSpent`, ledger/stacks unchanged, `verifyLedger` still ok.
- Idempotent: a second run rewrites nothing (all commission already platform-keyed).

- [ ] Write failing tests → run (fail) → implement core + CLI → run (pass) → `git commit -m "feat(server): rake history rewrite migration"`

## Self-Review
- §5.1 forward routing → Task 1. §5.3 peer exclusion → Task 2. re-chain machinery → Task 3. §5.4 rewrite + banker-spent report + backup → Task 4. §5.2 (house-dues attribution unaffected) — no code change needed; commission grouping by ref/winners is recipient-agnostic. ✅
- Types consistent: `settleRake`, `rechainRoom`, `rewriteRakeToPlatform`, `RewriteReport` used identically across tasks.
- No placeholders.

## Notes for later plans
- Plan 4 (merge) reuses `rechainRoom` after re-attributing a merged user's ledger rows.
- The prod runbook (spec §11) runs `scripts/rewrite-rake-to-platform.ts` against prod with a backup, and must confirm the seed **adopted** (not created) the account first.
