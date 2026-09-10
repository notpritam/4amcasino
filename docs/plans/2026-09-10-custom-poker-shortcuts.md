# Custom Poker Shortcuts Implementation Plan

**Goal:** Provide editable account shortcuts for fast poker actions in both table modes.

**Architecture:** A shared validated preference object persists on the user's profile.
A shared hook serves desktop ActionBar, 3D overlays, and the separate phone
controls. It handles keys through their live legal-action and pending-action gates. Reuse the existing Zeus SettingsCard/Dialog.

**Tech Stack:** React, Zustand, Fastify, SQLite, Vitest, Playwright.

## Binding model and account settings

- Shared actions: fold (F), check (X), call (C), bet/raise (R), half pot (2), pot (3), all-in (I).
- Enable/disable all shortcuts, rebind each using a key recorder, clear individual keys,
  and restore defaults. Letters/numbers, optionally Shift; reserve WASD and browser/navigation keys.
- Reject duplicates and malformed preferences on both client and server.
- Add nullable profile storage. Existing accounts use defaults. Load only the current
  user's preferences; account switching must not apply the previous account's bindings.
- Tests: defaults, normalization, reserved keys, conflicts, malformed input, account isolation,
  persistence, profile edits preserving unrelated fields, API authorization.

## Action handling and editing

- Edit through Settings → Keyboard shortcuts and a keyboard button in the shared ActionBar.
- Show bindings on applicable live-action controls; never change action availability.
- Fold/check/call fire their specific legal action. No queued keyboard pre-actions.
- Bet/raise and sizing keys focus an inline numeric amount. Enter submits the displayed
  amount only while that input owns focus; Escape cancels focus. Mouse actions stay available.
- Suppress when typing/chatting, composing, selecting UI controls, another dialog/menu/panel
  is open, disconnected, waiting for the server, settling, not the viewer's turn, or tab hidden.
- Ignore repeated/modified browser keys and deduplicate sends for a hand/action sequence.
- Tests: legal checks, no call from a check binding, stale/repeated keys, typing/modal suppression,
  pending transitions, same behavior in the standard/overlay presentations and WASD separation.

## Verification and delivery

Run focused tests, workspace typechecks, production build, and real browser UAT with
synthetic accounts. Capture settings at desktop/mobile in both themes, verify persisted
editing and runtime actions. Keep the completed work on this local feature branch.
**Do not deploy or push to main: wait for the user's explicit deployment instruction.**
