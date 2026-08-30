# Archived-room money exclusion + Platform-approved archive/delete — Plan 3 of 6

> Implement task-by-task with TDD. Steps use `- [ ]`.

**Goal:** Stop counting archived (and newly deleted) rooms in settle-up/house-dues/listings; turn archive + delete into requests only the Platform account can approve; introduce the `requirePlatform` admin gate.

**Architecture:** New `rooms.deleted` column + `room_lifecycle_requests` table. `requirePlatform` preHandler added to `platform.ts`. Archive/delete endpoints create requests; a new `admin.ts` owns the platform-only approve/apply endpoints (Plan 5 extends this file). Money/listing queries gain `archived = 0 AND deleted = 0`.

**Tech Stack:** TS ESM (`.js`), Fastify, better-sqlite3, vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-platform-account-design.md` (§3, §6, §8 lifecycle part)

## Global Constraints
- ESM `.js` suffixes; better-sqlite3 prepared statements.
- Money exclusion ⇔ admin-gated archive: archived rooms stop counting ONLY because archiving now requires Platform approval (a player can no longer self-archive to dodge a debt). Keep both halves.
- `requirePlatform` = `requireUser` then `isPlatform(db, req.userId)` → 403 otherwise.
- Soft delete only: `rooms.deleted = 1` + `deleted_at`; never DROP rows or `rm` a DB (ledger/transcripts must survive).
- Never `git commit --no-verify`.

---

### Task 1: Schema — `deleted` column + `room_lifecycle_requests`
**Files:** Modify `apps/server/src/db.ts` (near the other `ensureColumn`/`CREATE TABLE` calls); Test `apps/server/test/lifecycle.test.ts`.
- `ensureColumn(db, 'rooms', 'deleted', 'INTEGER NOT NULL DEFAULT 0')`; `ensureColumn(db, 'rooms', 'deleted_at', 'INTEGER')`.
- ```sql
  CREATE TABLE IF NOT EXISTS room_lifecycle_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    action TEXT NOT NULL,            -- 'archive' | 'unarchive' | 'delete'
    requested_by INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
    note TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    decided_by INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_lifecycle_status ON room_lifecycle_requests(status);
  ```
**Test:** `openDb(':memory:')` then `PRAGMA table_info(rooms)` includes `deleted`; inserting/selecting a `room_lifecycle_requests` row round-trips.
- [ ] TDD → `git commit -m "feat(server): rooms.deleted + room_lifecycle_requests schema"`

---

### Task 2: Exclude archived+deleted rooms from money and listings
**Files:** Modify `apps/server/src/settle.ts` (`openDebts` room query ~line 70; `houseDues` commission query ~line 106), `apps/server/src/social.ts` (`/api/me/debts` room query ~line 554), `apps/server/src/rooms.ts` (`/api/my-rooms` ~line 466 and `/api/rooms/public` ~line 205), `apps/server/src/profile.ts` (`LEADERBOARD_SQL` ~line 35 — it already has `r.archived = 0`, add `AND r.deleted = 0`). Test: `apps/server/test/lifecycle.test.ts`.
- Add `AND r.archived = 0 AND r.deleted = 0` to the settle/house/debts room filters (they currently filter only `voided = 0`).
- Add `AND r.deleted = 0` (and `archived = 0` where a listing should hide archived too — for `/api/my-rooms` keep archived visible since users browse their archived tables, but hide `deleted`; for `/api/rooms/public` hide both archived and deleted).
- LEADERBOARD_SQL: add `AND r.deleted = 0`.
**Tests:** Seed a room with settled hands producing a debt + commission; assert it appears in `/api/me/settle` and `/api/me/house`. Set `archived = 1` → it drops out of both. Reset, set `deleted = 1` → drops out of both and out of `/api/rooms/public`.
- [ ] TDD → `git commit -m "feat(server): exclude archived/deleted rooms from money and listings"`

---

### Task 3: Archive + delete become lifecycle requests
**Files:** Modify `apps/server/src/social.ts` (replace the body of `POST /api/rooms/:id/archive` at ~line 406; add `POST /api/rooms/:id/delete`). Test: `apps/server/test/lifecycle.test.ts`.
- `POST /api/rooms/:id/archive { archived: boolean }`: keep the host-or-banker check and the mid-hand refusal (`activeHands`), but instead of mutating `rooms`, INSERT a `room_lifecycle_requests` row with `action = archived ? 'archive' : 'unarchive'`, `requested_by = req.userId`, `status='pending'`. Return `{ pending: true, requestId }`. If an identical pending request already exists for that room+action, return it (idempotent).
- `POST /api/rooms/:id/delete { note?: string }`: host-or-banker, mid-hand refusal, INSERT `action='delete'` pending request. Return `{ pending: true, requestId }`.
**Tests:** calling archive no longer changes `rooms.archived` (still 0) and creates a pending `room_lifecycle_requests` row; delete creates a pending `delete` request; a non-member/non-host/non-banker gets 403.
- [ ] TDD → `git commit -m "feat(server): archive and delete become platform-approved requests"`

---

### Task 4: `requirePlatform` + admin lifecycle approval
**Files:** Modify `apps/server/src/platform.ts` (add `requirePlatform`); Create `apps/server/src/admin.ts`; Modify `apps/server/src/app.ts` (import + `registerAdminRoutes(app, db)` after the other `register*Routes`). Test: `apps/server/test/lifecycle.test.ts`.
- `requirePlatform(db)`:
  ```ts
  export function requirePlatform(db: DB) {
    const base = requireUser(db);
    return async (req, reply) => {
      const r = await base(req, reply); if (r) return r;         // 401 path
      if (!isPlatform(db, req.userId)) return reply.code(403).send({ error: 'platform only' });
    };
  }
  ```
  (Import `requireUser` from `./auth.js`.)
- `admin.ts` `registerAdminRoutes(app, db)`:
  - `GET /api/admin/lifecycle` (requirePlatform) → pending `room_lifecycle_requests` joined to room name + requester name.
  - `POST /api/admin/lifecycle/:id { approve: boolean }` (requirePlatform): in a transaction, set the request `status` + `decided_at`/`decided_by`; if approved apply the action — `archive`→`UPDATE rooms SET archived=1`, `unarchive`→`archived=0`, `delete`→`UPDATE rooms SET deleted=1, deleted_at=?`. Emit `roomEvents.emit('changed', roomId)` (import from `./rooms.js`). Reject → no room change.
**Tests:** a non-platform user gets 403 on both admin routes; the platform user lists a pending archive request, approves it, and `rooms.archived` becomes 1; approving a `delete` sets `rooms.deleted=1`; combined with Task 2, the room then drops from `/api/me/settle`.
- [ ] TDD → `git commit -m "feat(server): platform admin approves room lifecycle"`

## Self-Review
- §6 money exclusion → Task 2; archive/delete requests → Task 3; approval/apply → Task 4. §3 schema → Task 1. §8 `requirePlatform` → Task 4. ✅
- Types consistent: `room_lifecycle_requests` columns identical across tasks; `requirePlatform` signature matches `requireUser`'s preHandler shape.

## Notes for later plans
- Plan 5 extends `admin.ts` (merge approval, user disable/password) and reuses `requirePlatform`.
- Plan 6 web adds the "request archive/delete" buttons + admin console listing these requests.
