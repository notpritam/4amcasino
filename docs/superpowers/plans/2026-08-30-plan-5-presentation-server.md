# Presentation server layer — Plan 5 of 7

> TDD, task-by-task. Steps use `- [ ]`.

**Goal:** Server support for the web presentation work: expose each user's global leaderboard rank (for top-3 badges), and stop the Platform "house" account from showing up in room rosters (it holds rake chips as a non-seated member since Plan 2).

**Spec:** `docs/superpowers/specs/2026-08-30-platform-account-design.md` (§9.1). Carries the Plan 2 deferred item (platform visible in `roomPlayers`).

## Global Constraints
- ESM `.js`; better-sqlite3 prepared statements. `cd apps/server && npx tsc --noEmit` clean before each commit.
- The Platform account is `platformUserId(db)`. It is already excluded from the leaderboard (Plan 1) and peer settle-up (Plan 2); this plan also removes it from the room roster JSON.
- Rank basis = the existing global `LEADERBOARD_SQL` order (net DESC, handsPlayed DESC). A user in private mode, disabled, the platform account, or with no ranked hands has rank `null` (not badged — consistent with the crown rule).
- Never `git commit --no-verify`; never touch a `.db` file (tests use `:memory:`).

---

### Task 1: `leaderboardRankOf` helper + expose on `/api/me` and `/api/users/:id/profile`
**Files:** Modify `apps/server/src/profile.ts` (add helper + add `leaderboardRank` to the `/api/users/:id/profile` response ~line 206), `apps/server/src/app.ts` (add `leaderboardRank` to `/api/me` ~line 147). Test: `apps/server/test/presentation.test.ts`.
- Helper (profile.ts, exported): runs the existing `LEADERBOARD_SQL` (global variant, `%ROOM%`→''), finds the 1-based index of `userId`; returns `number | null`.
  ```ts
  export function leaderboardRankOf(db: DB, userId: number): number | null {
    const rows = db.prepare(LEADERBOARD_SQL.replace('%ROOM%', '')).all() as { userId: number }[];
    const i = rows.findIndex((r) => r.userId === userId);
    return i < 0 ? null : i + 1;
  }
  ```
- `/api/users/:id/profile`: add `leaderboardRank: leaderboardRankOf(db, id)` to the returned object.
- `/api/me` (app.ts): add `leaderboardRank: leaderboardRankOf(db, row.id)` (import from `./profile.js`).
**Tests:** three users with different nets → ranks 1/2/3; a private-mode user → null; the platform account → null; `/api/me` and `/api/users/:id/profile` both include the field.
- [ ] TDD → `git commit -m "feat(server): expose leaderboardRank for badges"`

---

### Task 2: Hide the Platform account from room rosters
**Files:** Modify `apps/server/src/rooms.ts` (`roomJson`, ~line 121-149, the `players` mapping). Test: `apps/server/test/presentation.test.ts`.
- Filter the platform user out of the `players` array returned in room JSON, so the house never appears as a seat/player in the UI roster. Keep it in `room_players` (it must still hold rake chips for accounting) — only the presented list drops it:
  ```ts
  const platformId = platformUserId(db);
  players: roomPlayers(db, room.id).filter((p) => p.userId !== platformId).map(...)
  ```
  (Import `platformUserId` from `./platform.js`.)
**Tests:** a room where the platform holds rake → `GET /api/rooms/:id` `players` array excludes the platform account but still includes the real players; `room_players` row for the platform still exists (accounting intact).
- [ ] TDD → `git commit -m "feat(server): hide platform account from room rosters"`

## Self-Review
- §9.1 rank exposure → Task 1; platform-in-rosters (Plan 2 carry-forward) → Task 2. ✅

## Notes for later plans
- Plan 6 web consumes `leaderboardRank` (top-3 badges) and `isPlatform` (house profile). Plan 6/7 web should also skip the platform in any other roster/standings UI it renders.
