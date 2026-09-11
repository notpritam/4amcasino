# Auto-deal with an online fallback

**Goal:** Give the host an explicit room auto-deal switch and continue with an eligible online fallback when the host is unavailable.

**Architecture:** Keep scheduling and ready checks on the server. Persist `rooms.auto_deal` (on by default, preserving existing automatic continuation). Prefer the seated, funded, connected, non-sitting-out host; otherwise choose the first eligible player by seat. This is an auto-deal coordinator, independent of the rotating poker button and banking/host permissions.

**Tech stack:** Fastify, SQLite, shared WebSocket types, React/Zustand, Vitest, Playwright.

## Implementation

1. Add API and timer regression tests in `apps/server/test/autoDeal.test.ts`: host-only validated setting, persistence, offline/sitting-out/busted fallback, two-player minimum, cancel/re-enable, reconnect state, readiness filtering and no overlapping deals.
2. Add the migration in `apps/server/src/db.ts`, room setting/read payload in `rooms.ts`, and optional additive live fields in `packages/shared/src/wsProtocol.ts`.
3. Update `GameRoom` scheduling: preserve countdown on ordinary broadcasts, re-evaluate eligibility at every transition, cancel when disabled/archived/short of players, retain ready consent, snapshot countdown/readiness for reconnects, and avoid automatic retries after a failed ready check until eligibility changes or the host restarts it.
4. Add a shared `AutoDealControl` to the 2D desktop/phone and 3D Table menus, with a host switch, dealer identity, waiting/ready/countdown status, disabled disconnected state and visible save failure. Extend `api.ts` and apply live snapshots in `gameClient.ts`.
5. Run targeted regressions, the full test suite with two workers, workspace typechecks and production build. Check host/member menus and server-driven fallback/cancellation in browser UAT. Record results and commit locally.

This request authorizes implementation. Keep this follow-up local; the earlier deployment covered the keyboard shortcut release.
