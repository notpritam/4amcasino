# Sidebar redesign (reference-driven) — Plan 7 of 7

> Design-heavy UI. Verify with `cd apps/web && npx tsc --noEmit` + `npm run build`, and read the component. Use the frontend-design skill.

**Goal:** Redesign the signed-in left sidebar (`AppShell`) to match the supplied reference's structure and interaction pattern, adapted to 4amcasino's nav and theming — WITHOUT losing any existing shell behavior.

**Reference image (READ IT before starting):** `/Users/notpritamm/.bb-machines/omni.getbb.app/thread-storage/thr_dfuhimk396/Attachments/image-1788073507705-mzgak8.png`
Four variants: expanded-light, collapsed icon-rail, expanded-light with active pill, full-dark.

**Target file:** `apps/web/src/widgets/nav/AppShell.tsx` (existing 524-line collapsible icon-led shell).

## Global Constraints
- Follow `DESIGN.md`: indigo accent, Bricolage display / Onest body, emerald/rose semantics, `.cyber` theme (remapped slate/indigo vars — never hardcode theme colors, no dark-mode ternaries; use `dark:` token variants that are already themed). Corners/spacing per the existing app.
- Reuse `shared/ui` primitives and `entities/user/Avatar`. Memoized subcomponents get `memo()` + `.displayName`.
- **PRESERVE every existing behavior:** collapse toggle + persistence (`SIDEBAR_KEY` localStorage), the icon-only collapsed rail, the mobile slide-over drawer, the rooms thread-list, the `newTab` behavior at a live table, and the pending-task badges (`PendingTasks`). Do not regress these.
- `cd apps/web && npx tsc --noEmit` clean and `npm run build` succeeds before each commit. No hardcoded colors. Never `git commit --no-verify`.

## Reference → 4amcasino mapping (adapt, don't copy the brand/items)
- **Header:** 4AM brand mark + "4AM Casino" name + a short subtitle + the existing collapse toggle (top-right).
- **Grouped nav with small uppercase section labels** (hidden in collapsed rail, replaced by icon grouping). Suggested groups:
  - *Play* — Lobby, Leaderboard
  - *Money* — Settle up, Bank/Ledger
  - *Account* — Profile, Settings, How it's fair
  - *Admin* (only when `me.isPlatform`) — Admin console
  Keep the existing routes (`/lobby`, `/leaderboard`, `/settle`, `/ledger` or bank, `/settings`, `/fair`, `/admin`). Confirm actual routes from `App.tsx` before wiring.
- **Nav rows:** left icon + label + optional right-aligned count badge (red) driven by `PendingTasks` (e.g. Settle up → settlements awaiting; and any invites/friend-request counts on the relevant row).
- **One expandable row with nested sub-items + active pill:** apply this to the **Rooms** thread-list (expandable "Your tables" with the room list nested; the active room shown as a filled pill — dark pill/white text in light theme, lighter pill in dark theme). This reuses the existing rooms data.
- **Collapsed icon-rail:** icons only, section grouping preserved via spacing, utilities + avatar pinned at the bottom (matches reference variant 2).
- **Contextual card** near the bottom: adapt the reference's meeting card to a 4amcasino-relevant nudge — e.g. a "You're up next / pending tasks" card, or the current live-room quick-return card — dismissible, with a primary link. Keep it optional/among existing nudges; do not invent backend.
- **User footer:** `Avatar` with an online dot + display name + a secondary line (username/@handle) + an overflow menu (the existing sign-out / theme toggle actions move here).
- **Full dark + cyber parity:** every element must read correctly in light, dark, and cyber themes (the reference's dark variant is the dark-mode target; cyber inherits via the remapped vars).

---

### Task 1: Structure — sections, badges, nested rooms pill, header, footer
- Rebuild the expanded sidebar body: grouped sections with uppercase labels, nav rows with right-aligned red count badges from `PendingTasks`, the Rooms group as an expandable list with the active room as a filled pill, the new header (brand+subtitle+collapse), and the user footer (avatar+dot+name+secondary+overflow with sign-out/theme).
- Keep all routes and data sources the shell already uses; add the Admin row gated on `me.isPlatform` (fetch `me()` if the shell doesn't already have it).
- [ ] Implement, read the reference image, `tsc`+`build` clean → `git commit -m "feat(web): sidebar sections, badges, nested rooms, header, footer"`

### Task 2: Collapsed rail, contextual card, theme parity, preserve behaviors
- Collapsed icon-rail matching reference variant 2 (icons + grouped spacing, utilities+avatar pinned bottom), driven by the existing collapse state/persistence.
- The contextual nudge card (adapted, dismissible) above the footer.
- Verify light/dark/cyber parity and that the mobile drawer, `newTab` table behavior, and collapse persistence all still work (read the code paths; note them in the report).
- [ ] Implement, `tsc`+`build` clean → `git commit -m "feat(web): collapsed rail, contextual card, theme parity"`

## Self-Review
- Reference structure (header, grouped sections, badges, nested active pill, collapsed rail, contextual card, user footer, light/dark) all mapped to 4amcasino nav/theming. Existing behaviors preserved (collapse/drawer/newTab/rooms/badges). ✅

## Notes
- This is the last plan; after it, the branch gets a final whole-branch review and is pushed.
