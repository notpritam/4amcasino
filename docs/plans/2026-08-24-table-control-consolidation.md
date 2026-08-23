# Table Control Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the crowded desktop table command bar with four accessible control groups while preserving every existing action.

**Architecture:** Add pure table-control helpers for role-aware menu composition, then render one Chips hub and one categorized More menu from `TablePage`. Extend `BankControls` with a compact hub presentation while reusing its existing dialogs and API behavior. Keep mobile controls and all gameplay actions unchanged.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Phosphor Icons, Vitest, Motion.

---

### Task 1: Encode the visible utility groups

**Files:**
- Modify: `apps/web/src/pages/table/tableUi.ts`
- Modify: `apps/web/test/tableUi.test.ts`

**Step 1: Write the failing tests**

Add tests showing that utility sections omit unavailable actions, expose banker and host actions only when authorized, and preserve the expected People, Records, Table, and Preferences grouping.

**Step 2: Run the focused test and verify it fails**

Run: `npm test -- apps/web/test/tableUi.test.ts`

Expected: FAIL because the utility-group helper does not exist.

**Step 3: Add the minimal pure helper**

Export typed action identifiers and a helper that returns role-aware grouped action identifiers. Keep presentation labels and callbacks in the page component.

**Step 4: Run the focused test and verify it passes**

Run: `npm test -- apps/web/test/tableUi.test.ts`

Expected: PASS.

### Task 2: Consolidate bank controls into one Chips hub

**Files:**
- Modify: `apps/web/src/widgets/table/BankControls.tsx`
- Modify: `apps/web/src/pages/table/TablePage.tsx`

**Step 1: Add a compact hub presentation**

Let `BankControls` render one labeled Chips trigger on desktop and preserve its current expanded button presentation on mobile. The compact menu exposes Buy points, Send chips, and conditional Bank inbox actions.

**Step 2: Preserve dialog and polling behavior**

Reuse the existing buy, transfer, inbox, approval, and banker settings flows. Surface pending request count on both the Chips trigger and Bank inbox item.

**Step 3: Add menu accessibility**

Expose expanded state, menu semantics, Escape handling, outside dismissal, initial focus, and trigger focus restoration.

### Task 3: Replace scattered utilities with one categorized More menu

**Files:**
- Modify: `apps/web/src/pages/table/TablePage.tsx`

**Step 1: Remove standalone utility icons**

Remove desktop Invite, Watch link, Standings, Ledger, Hands, and Theme icons from the persistent header.

**Step 2: Build categorized menu content**

Render People, Records, Table, and Preferences sections from the pure visibility helper. Keep action labels explicit and pair them with existing Phosphor icons.

**Step 3: Harden menu behavior**

Close the menu before dialogs or navigation, support Escape and focus restoration, expose menu relationships with ARIA, and avoid trapping focus behind the menu.

**Step 4: Reduce Voice and Chat visual weight**

Keep Voice and Chat as compact state-aware icon controls. Voice communicates disconnected, live, and muted states through its icon, color, accessible label, and tooltip.

### Task 4: Polish and verify

**Files:**
- Modify if needed: `apps/web/src/pages/table/TablePage.tsx`
- Modify if needed: `apps/web/src/widgets/table/BankControls.tsx`

**Step 1: Run formatting and static checks**

Run:

```bash
npx prettier --write apps/web/src/pages/table/TablePage.tsx apps/web/src/pages/table/tableUi.ts apps/web/src/widgets/table/BankControls.tsx apps/web/test/tableUi.test.ts
npm run typecheck
```

Expected: exit 0.

**Step 2: Run the complete test suite**

Run: `npm test`

Expected: all tests pass.

**Step 3: Run the production build and design detectors**

Run:

```bash
npm run build --workspace @4am/web
npx impeccable detect apps/web/src
node /Users/notpritamm/.agents/skills/impeccable/scripts/detect.mjs --json --scope layout apps/web/src/pages/table/TablePage.tsx apps/web/src/widgets/table/BankControls.tsx
git diff --check
```

Expected: build succeeds and detectors return no findings.

**Step 4: Commit only table-control files**

Exclude the existing database shared-memory and WAL files.

```bash
git add apps/web/src/pages/table/TablePage.tsx apps/web/src/pages/table/tableUi.ts apps/web/src/widgets/table/BankControls.tsx apps/web/test/tableUi.test.ts docs/plans/2026-08-24-table-control-consolidation.md
git commit -m "feat: consolidate table controls"
```
