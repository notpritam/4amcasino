# Centered Table UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the poker board the dominant centered desktop surface and reduce command-bar clutter without hiding important or consequential actions.

**Architecture:** Preserve the mobile table and game state flow. Restructure only the desktop composition in `TablePage`, add an accessible chat drawer, and extend existing reusable controls with icon-aware variants instead of introducing a new component library.

**Tech Stack:** React, TypeScript, Tailwind CSS 4, Phosphor Icons, Motion, Vitest.

---

### Task 1: Build the desktop command hierarchy

**Files:**
- Modify: `apps/web/src/pages/table/TablePage.tsx`
- Modify: `apps/web/src/widgets/table/BankControls.tsx`

1. Import the selected Phosphor icons.
2. Replace low-frequency text actions with accessible icon controls.
3. Keep voice and money actions labeled.
4. Group identity, utility, and consequential controls separately.
5. Run the web typecheck.

### Task 2: Center and enlarge the game board

**Files:**
- Modify: `apps/web/src/pages/table/TablePage.tsx`
- Modify: `apps/web/src/widgets/table/players.tsx`

1. Move opponents from the left column into a responsive rail above the board.
2. Increase the desktop canvas and board width/height.
3. Add a compact opponent-card presentation suitable for the horizontal rail.
4. Keep local player and action controls aligned to the board width.
5. Verify empty, active, result, spectator, and seat-picker branches still render.

### Task 3: Replace permanent chat with a drawer

**Files:**
- Modify: `apps/web/src/pages/table/TablePage.tsx`
- Modify: `apps/web/src/widgets/table/ChatPanel.tsx`

1. Reuse the existing chat-open state for desktop.
2. Add overlay, drawer, close control, Escape handling, and message count badge.
3. Give `ChatPanel` a borderless drawer presentation without changing chat behavior.
4. Preserve the existing full-screen mobile chat.

### Task 4: Verify and repair

**Files:**
- Modify: files implicated by failures only.

1. Format changed files.
2. Run repository-wide TypeScript checks and tests.
3. Run the production web build.
4. Run Impeccable layout and general detection.
5. Inspect desktop and mobile screenshots in one bounded browser pass when the browser bridge is available.
