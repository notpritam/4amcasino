# Admin-initiated merge + room close — Plan 8

> The Platform admin can INITIATE merges and room archive/delete directly (not only approve user-filed requests).

**Spec basis:** §7/§8 (Platform = master admin with full control).

## Global Constraints
- ESM `.js`; better-sqlite3 prepared statements. web+server tsc clean; `npm run build` succeeds.
- All new routes `requirePlatform`. Reuse `mergeAccounts` (merge.ts), the platform-as-`from` guard, and `roomEvents`.
- Direct room archive/delete: refuse mid-hand (`activeHands.has(id)`) so a live table isn't retired.
- DESIGN.md tokens; reuse shared/ui; confirm dialogs on irreversible actions. Never `--no-verify`; never touch a .db.

---

### Task 1: Server — admin-initiated endpoints (admin.ts)
- `POST /api/admin/merge { fromUsername, intoUsername, note? }` (requirePlatform): resolve both usernames→ids (404 if missing); 400 if `from===into`; 400 if `isPlatform(from)`. Run `mergeAccounts(db, fromId, intoId)` in try/catch → 409 `{ error }` on failure. On success, insert an audit row into `account_merge_requests` (from, into, requested_by=platformId, status='approved', created_at, decided_at, decided_by=platformId). Return `{ ok: true }`.
- `GET /api/admin/rooms?q=` (requirePlatform): list up to 50 rooms (optional name LIKE %q%), newest first, `WHERE r.deleted = 0`, columns: id, name, archived, host display name, playerCount excluding the platform (reuse the `NOT IN (meta platform_user_id)` count pattern from rooms.ts). Return `{ rooms }`.
- `POST /api/admin/rooms/:id/archive { archived: boolean }` (requirePlatform): 404 if no room; 400 if `activeHands.has(id)` and archiving; `UPDATE rooms SET archived=?, archived_at=?`; `roomEvents.emit('changed', id)`. Return `{ ok: true, archived }`.
- `POST /api/admin/rooms/:id/delete` (requirePlatform): 404 if no room; 400 if `activeHands.has(id)`; `UPDATE rooms SET deleted=1, deleted_at=?`; emit. Return `{ ok: true }`.
- Import `activeHands` from './liveHands.js' and `platformUserId` from './platform.js' as needed.
**Tests (extend apps/server/test/merge.test.ts or a new admin.test.ts):** non-platform → 403 on all four; admin merge folds two accounts (assert via observable merge effects) and 409s on a bad merge / 400 on platform-as-from; admin archive sets archived=1 (and 400 mid-hand); admin delete sets deleted=1; GET /api/admin/rooms excludes the platform from playerCount and hides deleted rooms.
- [ ] TDD → `git commit -m "feat(server): admin-initiated merge + room archive/delete"`

### Task 2: Web — api client + console UI (api.ts, AdminPage.tsx)
- api.ts: `adminMergeNow(fromUsername, intoUsername, note?) → POST /api/admin/merge`; `adminRooms(q?) → GET /api/admin/rooms`; `adminArchiveRoom(id, archived) → POST /api/admin/rooms/:id/archive`; `adminDeleteRoom(id) → POST /api/admin/rooms/:id/delete`.
- AdminPage `MergeSection`: add a "Merge accounts directly" form (from + into username inputs + optional note) above/below the pending list, with a confirm dialog ("Approving cannot be undone") → `adminMergeNow`. On success show a result line and clear the form.
- AdminPage new `RoomsSection` (Panel): a search box → `adminRooms(q)`; list rooms with name/host/playerCount and an archived tag; each row has Archive/Unarchive and a Delete button (Delete behind a confirm dialog). Refresh the list after each action.
- Match DESIGN.md; reuse Panel/Button/Input/Dialog/Spinner; memo()+displayName on new components.
- [ ] Implement, web+server tsc clean, `npm run build` ok → `git commit -m "feat(web): admin-initiated merge + room management console"`

## Self-Review
- Admin can now initiate merges (§7) and archive/delete any room (§8) directly, plus the existing approve-requests flow. ✅
