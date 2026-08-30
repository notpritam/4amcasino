# Platform account, rake routing, admin controls — design

Date: 2026-08-30
Author: notpritam + Claude
Status: awaiting review

## 1. Goal

Introduce a single **Platform account** (`4amcasino`) that is the master admin of
the app. It:

- receives every table's 1% commission (rake) instead of the room banker,
- is the sole approver for account merges and for archiving/deleting rooms,
- can delete any user account, and change any user account's password.

It also gets a **distinct identity in the UI** (a "house" profile, not a normal
player), and the **top-3 leaderboard players** get a differentiated profile view
with rank badges.

Historical rake is re-attributed to the Platform account by rewriting the ledger
(user's explicit choice), and archived rooms stop counting toward money owed.

Scope: **local dev DB and production**. On the local repo DB (`4amcasino.db`) the
Platform account is seeded. On **production (poker.notpritam.in) the account
already exists** — its username/id is `4amcasino` — so there we *adopt* the
existing user, we do not create one. The history rewrite and every destructive
admin action run behind a mandatory DB backup on both, and a prod runbook (§11).

## 2. Load-bearing constraints (read before implementing)

1. **The per-room ledger is hash-chained** (`ledger.prev_hash`/`entry_hash`,
   `verifyLedger` in `apps/server/src/ledger.ts`). Any retroactive change to an
   entry invalidates that room's chain from the changed row forward. The history
   rewrite therefore **re-chains each affected room from genesis** and re-verifies.
   Consequence the user has accepted: entry hashes change, so any externally-saved
   old hashes no longer match. Internal verification stays green.

2. **Passwords never reach the server in the clear.** The client derives, via
   scrypt (`apps/web/src/shared/crypto.ts`, `PARAMS = {N:2^15, r:8, p:1, dkLen:32}`):
   - `authKey = scrypt(password, "4am/auth/<username>")` (sent to server),
   - identity `= identityFromSeed(scrypt(password, "4am/id/<username>"))` → `{publicKey, secretKey}`.
   The server stores `auth_hash = scryptSync(authKey, salt, 32)` + `pubkey`
   (`apps/server/src/auth.ts`). Seeding the Platform account and admin
   "change a user's password" must both reproduce this derivation — they cannot be
   raw column writes.

3. **Reversing a deliberate decision.** `POST /api/rooms/:id/archive`
   (`apps/server/src/social.ts`) documents that archived-room debts survive **on
   purpose** — otherwise the player who is down the most could one-click archive to
   erase what they owe (the same hole `/void` was hardened against). We are now
   excluding archived rooms from money owed. This is only safe because **archiving
   now requires Platform approval** — an individual player can no longer archive to
   dodge a debt. This coupling (money-exclusion ⇔ admin-gated archive) is mandatory,
   not incidental.

## 3. Data model changes (`apps/server/src/db.ts`)

- `meta` row `platform_user_id` → the Platform account's user id. Single source of
  truth for the admin gate; no schema change to `users` required for the role
  itself. Helper `isPlatform(db, userId)` compares against this value.
- `users`: add `disabled INTEGER NOT NULL DEFAULT 0` (merged-away / deleted
  accounts are disabled, never hard-deleted, so ledgers and transcripts that
  reference them stay readable). `requireUser` rejects disabled users.
- `users`: add `merged_into INTEGER` (nullable) — set on the retired side of a
  merge, points at the surviving user id.
- New table `account_merge_requests`:
  `id, from_user, into_user, requested_by, status('pending'|'approved'|'rejected'),
  created_at, decided_at, decided_by, note`.
- New table `room_lifecycle_requests`:
  `id, room_id, action('archive'|'unarchive'|'delete'), requested_by,
  status('pending'|'approved'|'rejected'), created_at, decided_at, decided_by, note`.
- `rooms`: add `deleted INTEGER NOT NULL DEFAULT 0` + `deleted_at INTEGER`
  (soft delete; audit trail survives, like `voided`/`archived`).

All added via the existing `ensureColumn` / `CREATE TABLE IF NOT EXISTS` pattern so
the running DB migrates in place.

## 4. Subsystem B — Platform account + admin role

- **Adopt-or-create script** `apps/server/scripts/seed-platform.mjs` — idempotent,
  runs the same on local and prod:
  1. If `meta.platform_user_id` is already set → no-op.
  2. Else, look up the user `4amcasino`. **If it exists (the prod case), adopt it**:
     just write `meta.platform_user_id = <its id>`. Do not touch its credentials.
  3. **Only if no such user exists (the local case), create it**: reproduce the
     client derivation for `username="4amcasino"`, `password` from `PLATFORM_PASSWORD`
     (defaulting to `Fun99312@` on local) — `authKey` and `{publicKey}` via
     `@noble/hashes/scrypt` + `@4am/mental-poker`'s `identityFromSeed` (the exact
     functions the web uses) — then `createUser(db, "4amcasino", authKey, publicKey)`
     and set `meta.platform_user_id`.
  Result: on prod, the existing `4amcasino` account is promoted to Platform with no
  password change; on local, a loginable account is created.
- **Admin gate**: `requirePlatform(db)` preHandler = `requireUser` then
  `isPlatform`. Reused by every admin endpoint below.
- **Credential note**: the password is only ever used on the create path (local),
  and comes from `PLATFORM_PASSWORD` env with a dev default — it is never written to
  or read from prod, where the account already exists.

## 5. Subsystem C — rake to Platform (forward + history rewrite)

### 5.1 Forward
`Hand.finalizeSettlement()` (`apps/server/src/game.ts:1841`) currently credits
`room.banker_id`. Change the rake branch (`game.ts:1873-1884`) to credit the
Platform user:
- ensure a `room_players` row exists for the Platform user in this room (lazily
  insert seat=NULL if absent — Platform holds chips but never sits),
- `UPDATE room_players.stack += rake` for `platform_user_id`,
- `appendLedger({ userId: platform_user_id, kind:'commission', ... })`.

### 5.2 House-dues attribution is unaffected
`houseDues` (`settle.ts:103`) attributes each player's real-money share from
`kind='commission'` grouped by hand ref and the hand's winners. It does not depend
on who holds the chips, so moving the recipient changes nothing there. The
real-money house path (`house_payments`, `/api/house/pay`) stays as-is.

### 5.3 Platform is excluded from peer settle-up
The Platform account is the house, not a peer. Exclude `platform_user_id` from
peer debt netting so players never see "you owe 4amcasino N chips" in person-to-
person settle-up: filter it out of `roomDebts` / `openDebts` inputs
(`settle.ts:67`). House obligations remain represented only by the existing
house-dues mechanism.

### 5.4 History rewrite migration `apps/server/scripts/rewrite-rake-to-platform.mjs`
Per-room invariant to preserve: `sum(stacks) == sum(ledger deltas)`.
For each room with any `kind='commission'` entry not already keyed to Platform:
1. Reattribute every such entry's `user_id` → `platform_user_id`.
2. Move the chips: for each old banker recipient, `stack -= their reclaimed rake`;
   Platform `stack += room's total rake` (insert Platform `room_players` row if
   needed).
3. **Re-chain** the room: recompute `prev_hash`/`entry_hash` for every row in `id`
   order from `'genesis'` using `ledger.ts`'s `hashFields`, write them back.
4. `verifyLedger(room)` must return `{ok:true}`; abort the whole migration
   (transaction rollback) if any room fails.
- **Edge case — banker already spent the rake**: if reclaiming rake would drive a
  banker's *current* stack negative, do **not** silently create a negative. Collect
  those rooms and **report them for a manual decision**; leave them untouched in
  this pass. (Flag in output; do not guess.)
- **Backup first**: copy `4amcasino.db` (+ `-wal`/`-shm` after a checkpoint) to a
  timestamped file before the script mutates anything. The script refuses to run
  without a completed backup.

## 6. Subsystem E — archived rooms stop counting + archive/delete via Platform

### 6.1 Money exclusion
Add `AND r.archived = 0 AND r.deleted = 0` to:
- `openDebts` room selection (`settle.ts:70`),
- `houseDues` commission query (`settle.ts:106`).
(Profile stats already exclude archived; `voided` already excluded everywhere.)

### 6.2 Archive/delete become approval requests
- `POST /api/rooms/:id/archive` (`social.ts:405`) no longer mutates directly. Host/
  banker calling it **creates a `room_lifecycle_requests` row** (action `archive` or
  `unarchive`) and returns `{ pending: true }`. Same mid-hand refusal as today.
- New `POST /api/rooms/:id/delete` → creates a `delete` request (net-new; today no
  delete exists).
- Only the Platform account approves, via the admin surface (§8). Approval applies
  the actual `UPDATE rooms SET archived/deleted...`, emits `roomEvents`, and (for
  delete) soft-deletes so the ledger/transcripts survive.

## 7. Subsystem D — account merge (consolidate everything)

- `POST /api/me/merge-request { fromUsername, intoUsername }` → creates
  `account_merge_requests`. **Any signed-in user may raise a request naming any two
  accounts; no proof of control over either side is required.** Lands in the
  Platform admin queue.
- Platform approval runs `mergeAccounts(db, fromUser, intoUser)` in one transaction,
  after a DB backup:
  - **room_players**: move `from`'s rows to `into`; if both are in the same room,
    sum stacks into `into` and drop `from`'s row. Refuse if either account is
    seated in a live hand (`seat` not null and room in `activeHands`).
  - **ledger**: reattribute `from`'s rows to `into`, then **re-chain each affected
    room** and `verifyLedger` (same machinery as §5.4).
  - **debts/settlements/house_payments/friends/invites**: repoint `from`→`into`,
    de-duplicating self-pairs and unique constraints.
  - mark `from` `disabled=1`, `merged_into=into`, kill its sessions.
- **Trust model (user's explicit choice):** because a request needs no proof of
  control, the *only* safeguard against someone requesting a merge that vacuums
  another person's chips/debts into themselves is the **Platform admin's manual,
  out-of-band verification** — the admin talks to the user and merges directly. The
  request carries a free-text note for that conversation. There is no automated
  guard; the human gate is load-bearing. The admin console must therefore show both
  sides' balances/rooms so the admin can sanity-check before approving.

## 8. Subsystem F — admin surface (Platform-only)

All under `requirePlatform`. New file `apps/server/src/admin.ts`:

- `GET /api/admin/requests` — pending merge + lifecycle requests.
- `POST /api/admin/merge/:id { approve }` — approve/reject a merge (§7).
- `POST /api/admin/lifecycle/:id { approve }` — approve/reject archive/unarchive/
  delete (§6).
- `POST /api/admin/users/:id/disable` — delete (disable) a user account.
- `POST /api/admin/users/:id/password { newAuthKey, newPublicKey }` — set a user's
  password. The admin's browser derives `authKey`/`publicKey` for the chosen new
  password (same `deriveAuthKey`/`deriveIdentity`), server `rekey`s the target and
  drops the target's sessions. **Crypto implication documented for the admin UI:**
  this re-keys the target's card-signing identity; old hands stay verifiable
  (pubkey is inline per transcript entry) but the target must log in with the new
  password. Refuse if the target is seated in a live hand.

## 9. Presentation — admin surface, Platform identity, top-3 badges

### 9.1 Server: leaderboard + identity signals
- **Exclude the Platform account from the global leaderboard** (`profile.ts:33`,
  `/api/leaderboard` at `:276`): add `AND u.id != <platform_user_id>`. Otherwise it
  sits at #1 forever (it holds all rake). Also exclude it from top-3 badge
  computation and from peer settle-up (§5.3).
- `/api/leaderboard` returns a stable `rank` per row so the client can mark the top
  three without re-deriving order.
- `/api/me` and the profile payload expose `isPlatform` and, for players,
  `leaderboardRank` (null if outside the ranked set / private mode) so the client
  can render badges without a second call. Private mode still hides winnings; a
  private top-3 player is not badged (consistent with the crown rule).

### 9.2 Web (`apps/web`)
- **Admin console** (Platform-only, gated on `isPlatform`): pending merge +
  lifecycle requests with both sides' balances/rooms shown (the manual-verification
  surface §7 requires), approve/reject, user disable, user password reset.
- **Platform profile** is visibly different from a player's: a "house" identity —
  house badge, no win/loss/net stats, no rivals, copy that reads as the table's bank
  rather than a competitor. Applied in `ProfileDialog.tsx` (profile is a dialog, not
  a route) and anywhere the Platform user is listed.
- **Top-3 profile treatment**: players ranked 1/2/3 on the global leaderboard get a
  distinguished profile header + a gold/silver/bronze rank badge (reuse the existing
  `Badge` component in `shared/ui/index.tsx`, extend tones as needed), shown on the
  profile dialog and on their leaderboard row. Badge basis = current global
  leaderboard order (net DESC), matching the existing ranking.
- Room controls: archive/delete now read "request archive/delete" with pending
  state. Account settings gains a "request account merge" flow.
- Follow `DESIGN.md` and the i18n/tracking conventions (all strings via `t()`,
  PostHog `location` on new actions); money on the display face; no hardcoded colors.

## 10. Testing

- **B**: seed script creates a loginable account; `checkLogin("4amcasino","<authKey
  for Fun99312@>")` succeeds; second run is a no-op.
- **C forward**: play a hand in a test DB; assert rake lands on `platform_user_id`
  stack + a `commission` ledger row keyed to Platform; banker stack unchanged;
  `verifyLedger` ok; Platform absent from `/api/me/settle` peer lines.
- **C rewrite**: fixture DB with legacy banker-rake; run migration; assert
  reattribution, stack conservation per room, `verifyLedger` ok on every room, and
  that a banker-spent-rake room is reported not mutated.
- **E**: archived room's debts/house dues drop out of `/api/me/settle` and
  `/api/me/house`; archive/delete create requests, not mutations; approval applies.
- **D**: merge consolidates rooms/stacks/ledger/debts/friends; re-chain verifies;
  `from` disabled; same-room stacks summed; live-hand merge refused.
- **F**: non-platform users get 403 on every admin route; password reset re-keys and
  drops target sessions.
- **Presentation (§9)**: Platform account is absent from `/api/leaderboard`;
  `rank`/`leaderboardRank` are correct and stable; a private top-3 player is not
  badged; `isPlatform` is surfaced by `/api/me`. (UI badge/profile rendering verified
  manually against `DESIGN.md`.)
- Extend existing suites (`apps/server/test/ledger.test.ts`, `settle`-adjacent,
  `auth.test.ts`) rather than adding a parallel harness.

## 11. Sequencing

Build + verify entirely on the **local DB** first, in this order:
Phase 1 (B, create) → 2 (C forward) → 3 (C rewrite migration) → 4 (E) → 5 (D) →
6 (F admin API) → 7 (§9 presentation: leaderboard exclusion, Platform profile,
top-3 badges). Each phase is independently testable. Back up `4amcasino.db` before
phases 3 and 5.

**Prod runbook** (after local sign-off, run per prod deploy):
1. Full backup of the prod DB (checkpoint WAL, copy file, verify).
2. Run adopt-or-create (§4) — it **adopts** the existing `4amcasino` account, no
   password change.
3. Run the rake history rewrite (§5.4) against prod; it re-chains + `verifyLedger`s
   every room and aborts on any failure; review the banker-already-spent-rake
   report before accepting.
4. Deploy the server/web changes.

## 12. Risks / open items

- **Merge has no automated guard (user's choice):** any user can request merging any
  two accounts; the Platform admin's manual verification is the only safeguard (§7).
  The admin console must show both sides so mistakes are catchable.
- **Prod rewrite is on the real audited ledger** — highest-stakes step. Mitigated by
  the backup + re-chain + `verifyLedger` gate and the abort-on-failure transaction.
- Banker-already-spent-rake rooms in the rewrite (handled by report-not-mutate on
  both local and prod).
- Platform account must stay excluded from the leaderboard/top-3/peer settle-up, or
  it distorts all three (§9.1, §5.3).
- Password/`PLATFORM_PASSWORD` is only used on the local create path; prod adopts an
  existing account and never sees it.
