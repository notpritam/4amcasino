# Web — admin console, lifecycle/merge wiring, house profile, top-3 badges — Plan 6 of 7

> Implement task-by-task. Build/typecheck-verified (this is UI: verify with `cd apps/web && npx tsc --noEmit` and `npm run build`, plus reading the components — visual QA is limited).

**Goal:** Expose the platform features in the web app: a platform-only admin console (approve/reject lifecycle + merge requests, disable users, reset passwords), turn archive/delete into "request" actions, add a "request account merge" form, give the Platform account a distinct "house" profile, and badge the top-3 leaderboard players.

**Spec:** `docs/superpowers/specs/2026-08-30-platform-account-design.md` (§8, §9.2)

## Global Constraints
- Stack: React + TypeScript + Tailwind. Follow `DESIGN.md` (indigo accent, Bricolage display face for numbers, Onest body, emerald/rose semantics, `.cyber` theme via remapped slate/indigo vars — never hardcode theme colors). Use the existing `shared/ui` primitives (`Panel`, `Button`, `Badge`, `Input`, `Dialog`, `Spinner`, `Avatar`).
- All user-facing strings via i18n if the app uses it; if the app has no i18n wiring, match the existing (mostly literal-string) convention in these files — do NOT introduce a new i18n system.
- Every new button/action gets PostHog tracking with a `location` id IF the app already wires PostHog; otherwise match existing (likely none) — do not add a tracking system that isn't there. (Check `apps/web/src` for an existing analytics util before adding calls.)
- `cd apps/web && npx tsc --noEmit` MUST be clean and `npm run build` (from repo root or apps/web) MUST succeed before each commit.
- No hardcoded colors / no dark-mode ternaries — use Tailwind tokens (`text-slate-*`, `dark:` variants already themed). Memoized components get `memo()` + `.displayName`.
- Never `git commit --no-verify`; never touch a `.db`.

---

### Task 1: API client + types (+ tiny server glue)
**Files:** Modify `apps/server/src/profile.ts` (add `isPlatform` to `/api/users/:id/profile`), `apps/web/src/shared/api.ts`, `apps/web/src/shared/store.ts` (me/auth type). Test: extend `apps/server/test/presentation.test.ts` for the server bit.
- Server: `/api/users/:id/profile` response gains `isPlatform: isPlatform(db, id)` (import from `./platform.js`) so the web can render the house profile.
- api.ts — add methods (all via the existing `req` helper):
  `deleteRoom(roomId) → POST /api/rooms/:id/delete`; `mergeRequest(fromUsername, intoUsername, note?) → POST /api/me/merge-request`;
  `adminLifecycle() → GET /api/admin/lifecycle`; `adminDecideLifecycle(id, approve) → POST /api/admin/lifecycle/:id`;
  `adminMerges() → GET /api/admin/merges`; `adminDecideMerge(id, approve) → POST /api/admin/merges/:id`;
  `adminDisableUser(id) → POST /api/admin/users/:id/disable`; `adminSetUserPassword(id, newAuthKey, newPublicKey) → POST /api/admin/users/:id/password`.
  Also ensure `archiveRoom` still exists (now returns `{pending, requestId}`).
- store/me type: add `isPlatform?: boolean` and `leaderboardRank?: number | null` to whatever type models `/api/me` / auth.
- [ ] Implement, `tsc`+`build` clean, server test for the isPlatform field → `git commit -m "feat(web): api client + types for platform admin"`

---

### Task 2: Admin console page (platform-only)
**Files:** Create `apps/web/src/pages/admin/AdminPage.tsx`; Modify `apps/web/src/app/App.tsx` (lazy route `/admin`), `apps/web/src/widgets/nav/AppShell.tsx` (nav link shown only when `me.isPlatform`).
- `/admin` route; on mount fetch `me()`; if not `isPlatform`, redirect to `/lobby`. (Belt-and-suspenders — the server 403s anyway.)
- Three sections using `Panel`:
  1. **Room requests** — `adminLifecycle()` list (room name, action, requester, note); Approve / Reject buttons calling `adminDecideLifecycle`.
  2. **Merge requests** — `adminMerges()` list showing BOTH accounts' name + net balance + room count (the manual-check surface §7); Approve / Reject via `adminDecideMerge`. Show a confirm dialog before approve (irreversible).
  3. **User admin** — a username/id lookup, then Disable (confirm) and Reset password. Password reset derives the new `authKey`/`publicKey` in the browser using the same `deriveAuthKey`/`deriveIdentity` from `shared/crypto.ts` for the TARGET's username + a chosen new password, then calls `adminSetUserPassword`.
- Add `railItem('/admin', 'Admin', <ShieldCheck size={17} />, loc.pathname === '/admin')` in AppShell, rendered only when the loaded `me.isPlatform` is true (AppShell already fetches pending/me-ish data; fetch `me()` if not already available).
- [ ] Implement, `tsc`+`build` clean → `git commit -m "feat(web): platform admin console"`

---

### Task 3: Request-based archive/delete + merge request form
**Files:** Modify the room controls component that calls `api.archiveRoom` (find via grep for `archiveRoom` in `apps/web/src`), add a delete button; Modify `apps/web/src/pages/settings/SettingsPage.tsx` (or an account feature) to add a merge-request form.
- Archive/delete buttons now read "Request archive" / "Request delete", call `archiveRoom`/`deleteRoom`, and on success show a "pending platform approval" state (toast or inline). Keep them host/banker-gated in the UI as before.
- Settings gains a "Merge accounts" form: two username fields (from, into) + optional note + submit → `mergeRequest`; on success show "request sent to the platform for approval." Copy: plain, active voice, buttons say what happens (DESIGN.md).
- [ ] Implement, `tsc`+`build` clean → `git commit -m "feat(web): request archive/delete + merge request form"`

---

### Task 4: House profile + top-3 badges
**Files:** Modify `apps/web/src/pages/leaderboard/LeaderboardPage.tsx` (LeaderboardTable), `apps/web/src/pages/player/PlayerPage.tsx`. Possibly extend `shared/ui` `Badge` tones.
- **Top-3 badges:** in `LeaderboardTable` the rows map with index `i` — for `i < 3` render a rank medal badge (1=gold, 2=silver, 3=bronze). Use `Badge` with a medal glyph/number; add `amber`(gold)/`slate`(silver)/a bronze class as needed without hardcoding raw hex outside the token system (bronze can be an amber-variant utility). In `PlayerPage`, if `profile.leaderboardRank` is 1/2/3, show the same medal near the name; any rank can show "#N on the leaderboard" subtly.
- **House profile:** in `PlayerPage`, if `profile.isPlatform`, render a distinct "house" treatment: a house badge by the name, hide win/loss/net/rivals/debts sections, and show copy framing it as the table's bank (not a competitor). Keep it on-theme.
- [ ] Implement, `tsc`+`build` clean → `git commit -m "feat(web): house profile + top-3 leaderboard badges"`

## Self-Review
- §8 admin console (lifecycle+merge approve/reject, disable, password) → Tasks 1-2. §9.2 request buttons + merge form → Task 3; house profile + top-3 badges → Task 4. ✅
- Reuse existing `shared/ui` + `shared/crypto` (password reset derivation) — no new systems.

## Notes
- Plan 7 redesigns the whole sidebar (AppShell); keep Task 2's admin nav item simple — Plan 7 will restyle it into the new grouped sidebar.
