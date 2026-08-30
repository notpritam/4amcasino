# Account Merge (Platform-approved) — Plan 4 of 6

> Implement task-by-task with TDD. Steps use `- [ ]`.

**Goal:** Any user can request merging any two accounts; the Platform admin approves; on approval the surviving account absorbs everything (rooms, stacks, ledger, debts, friends, house dues) and the merged-away account is disabled.

**Architecture:** `users` gains `disabled` + `merged_into`; `account_merge_requests` table. A transactional `mergeAccounts(db, fromUser, intoUser)` in a new `merge.ts` repoints every user-referencing table and re-chains affected ledgers (reusing Plan 2's `rechainRoom`). Request + admin-approval endpoints extend `admin.ts` (Plan 3). No proof of control is required — the Platform admin's manual check is the only guard, so the admin listing surfaces both sides' balances.

**Tech Stack:** TS ESM (`.js`), Fastify, better-sqlite3, vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-platform-account-design.md` (§3, §7, §8 merge part)

## Global Constraints
- ESM `.js`; better-sqlite3 prepared statements.
- `mergeAccounts` runs in ONE `db.transaction` — all-or-nothing.
- After re-attributing any ledger rows, `rechainRoom` each affected room and assert `verifyLedger` ok (throw → rollback).
- No automated guard on WHO may merge (user's explicit choice); safety is the admin's manual review. The admin listing MUST show both accounts' net/rooms.
- Disabled accounts cannot authenticate.
- Never `git commit --no-verify`.

## User-referencing tables the merge must handle (complete list)
sessions.user_id · rooms.host_id/banker_id/co_banker_id · room_players(room_id,user_id PK) · ledger.user_id (+approved_by) · buy_requests.user_id · settlements(low_user,high_user) · settlement_marks(settlement_id,user_id PK) · friends(requester_id,target_id PK) · spectators(room_id,user_id PK) · join_requests.user_id · invites(from_id,to_id) · house_payments.user_id. (transcripts carry inline pubkeys — leave historical.)

---

### Task 1: Schema + disabled-user rejection
**Files:** Modify `apps/server/src/db.ts` (columns + table), `apps/server/src/auth.ts` (`requireUser` rejects disabled). Test: `apps/server/test/merge.test.ts`.
- `ensureColumn(db,'users','disabled','INTEGER NOT NULL DEFAULT 0')`; `ensureColumn(db,'users','merged_into','INTEGER')`.
- ```sql
  CREATE TABLE IF NOT EXISTS account_merge_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user INTEGER NOT NULL, into_user INTEGER NOT NULL, requested_by INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', note TEXT,
    created_at INTEGER NOT NULL, decided_at INTEGER, decided_by INTEGER );
  ```
- In `requireUser` (auth.ts), after resolving `userId`, if `SELECT disabled FROM users WHERE id=?` is 1 → `reply.code(401).send({ error: 'account merged' })` and return reply.
**Tests:** disabled user's token → 401 on any authed route; schema round-trips.
- [ ] TDD → `git commit -m "feat(server): merge schema + disabled-account rejection"`

---

### Task 2: `mergeAccounts` core (transactional)
**Files:** Create `apps/server/src/merge.ts`; Test `apps/server/test/merge.test.ts`.
```ts
export function mergeAccounts(db: DB, fromUser: number, intoUser: number): void
```
Guards (throw with a clear message): `fromUser===intoUser`; either not found; either already `disabled`; either currently seated (`SELECT 1 FROM room_players WHERE user_id IN (from,into) AND seat IS NOT NULL` AND that room is in `activeHands`). Import `activeHands` from `./liveHands.js`.
In one `db.transaction`:
1. **room_players:** for each `(room_id, stack)` where `user_id=from`: if a row `(room_id, into)` exists → `UPDATE room_players SET stack = stack + ? WHERE room_id=? AND user_id=into` then `DELETE` the from row; else `UPDATE room_players SET user_id=into WHERE room_id=? AND user_id=from`. Track the set of affected `room_id`s.
2. **ledger:** `UPDATE ledger SET user_id=into WHERE user_id=from`; `UPDATE ledger SET approved_by=into WHERE approved_by=from`. Collect every distinct `room_id` from's ledger rows touched, and `rechainRoom(db, roomId)` for each; assert `verifyLedger` ok for each (throw otherwise).
3. **rooms:** `UPDATE rooms SET host_id=into WHERE host_id=from`; same for `banker_id`, `co_banker_id`.
4. **buy_requests / join_requests / house_payments:** `UPDATE ... SET user_id=into WHERE user_id=from`.
5. **spectators / settlement_marks:** these have PKs including user_id — `INSERT OR IGNORE`-style move: `UPDATE OR IGNORE ... SET user_id=into WHERE user_id=from` then `DELETE ... WHERE user_id=from` (the IGNORE keeps the existing into row on collision).
6. **friends:** repoint `requester_id`/`target_id` from→into with `UPDATE OR IGNORE`, then `DELETE FROM friends WHERE requester_id=from OR target_id=from`; finally `DELETE FROM friends WHERE requester_id=target_id` (drop any self-friend created by the merge).
7. **invites:** `UPDATE OR IGNORE invites SET from_id=into WHERE from_id=from`; same for `to_id`; delete leftovers referencing from; delete self-invites (`from_id=to_id`).
8. **settlements:** for each row where `low_user=from` or `high_user=from`: compute the new pair from `(replace from with into)`; if the new pair is `into,into` (a settlement between the two merged accounts) → DELETE it (cannot owe yourself); else re-normalize `low_user<high_user` (swap + flip the stored `debtor` sense if the schema stores direction — preserve `settledSum` semantics) and `UPDATE OR IGNORE`; delete leftovers. Keep it correct: a settlement's meaning must not invert. If re-normalization is ambiguous for a row, prefer leaving the pair un-normalized only if `settledSum`/`pairOf` still reads it correctly; document the choice in a comment.
9. **sessions:** `DELETE FROM sessions WHERE user_id=from` (force re-login; the identity is retired).
10. **users:** `UPDATE users SET disabled=1, merged_into=into WHERE id=from`.
**Tests (merge.test.ts):** build two accounts sharing a room (both seated=null) with stacks + ledger + a debt + a friend; run `mergeAccounts`; assert: into's room stack = sum; from's room_players row gone; ledger rows all `user_id=into` and `verifyLedger` ok; a settlement between from and into is removed; from `disabled=1, merged_into=into`; from's sessions gone. Seated-in-live-hand → throws, nothing changed.
- [ ] TDD → `git commit -m "feat(server): mergeAccounts core"`

---

### Task 3: Merge request + admin approval endpoints
**Files:** Modify `apps/server/src/admin.ts` (add merge routes) and add a user route (in `account.ts` or `admin.ts`) `POST /api/me/merge-request`. Test: `apps/server/test/merge.test.ts`.
- `POST /api/me/merge-request { fromUsername, intoUsername, note? }` (authed, any user): resolve both usernames to ids (404 if missing), reject if same, INSERT a pending `account_merge_requests`. Return `{ requestId }`.
- `GET /api/admin/merges` (requirePlatform): pending requests joined to both usernames AND a net-balance summary per side (`SELECT COALESCE(SUM(delta),0) FROM ledger WHERE user_id=? AND kind='hand-settlement'`) + room count — the manual-check surface (§7).
- `POST /api/admin/merges/:id { approve }` (requirePlatform): set status/decided_*; on approve call `mergeAccounts(db, from_user, into_user)` (its transaction; if it throws, return 409 with the message and leave status pending or mark 'failed'). Reject → no merge.
**Tests:** non-platform → 403 on admin routes; a full flow: user files a merge request, platform lists it (sees both balances), approves it, and the accounts are merged (assert via Task 2's observable effects); approving a request whose account is seated returns 409 and does not disable anyone.
- [ ] TDD → `git commit -m "feat(server): merge request + platform approval"`

---

### Task 4: Admin user management — disable + password reset
**Files:** Modify `apps/server/src/account.ts` (export `rekey`), `apps/server/src/admin.ts` (add two routes). Test: `apps/server/test/merge.test.ts` (or `admin.test.ts`).
- Export the existing `rekey(db, userId, newAuthKey, newPublicKey, keepToken, extra?)` from account.ts (currently module-private) so admin can reuse it.
- `POST /api/admin/users/:id/disable` (requirePlatform): `UPDATE users SET disabled=1 WHERE id=?`; `DELETE FROM sessions WHERE user_id=?`. Refuse to disable the platform account itself (`isPlatform` guard → 400). Return `{ ok: true }`.
- `POST /api/admin/users/:id/password { newAuthKey, newPublicKey }` (requirePlatform): validate both are 64-hex; refuse if the target is seated in a live hand (same check as account.ts uses); call `rekey(db, targetId, newAuthKey, newPublicKey, null)` (null keepToken → drops ALL target sessions). Return `{ ok: true }`. The admin's browser derives `newAuthKey`/`newPublicKey` for the target's username + chosen new password (web, Plan 5); this endpoint just applies them.
**Tests:** non-platform → 403 on both; platform disables a user → that user's token now 401s (ties to Task 1's disabled rejection) and `disabled=1`; platform resets a user's password → old sessions gone and login works with the new authKey (derive via the same KDF, or assert the stored pubkey changed).
- [ ] TDD → `git commit -m "feat(server): admin disable + password reset"`

## Self-Review
- §3 schema + disabled → Task 1. §7 consolidate-everything → Task 2 (all 13 tables). §7 loose request + manual admin check with balances → Task 3. §8 admin merge routes → Task 3; §8 user disable + password reset → Task 4. ✅
- `mergeAccounts`, `rechainRoom` (from Plan 2) signatures consistent. `requirePlatform` from Plan 3.
- Risk: settlement pair re-normalization (step 8) is the subtle part — the test must include a settlement involving `from` to prove direction is preserved.

## Notes for later plans
- Plan 6 web adds the "request account merge" form and the admin merges list with both-sides balances.
