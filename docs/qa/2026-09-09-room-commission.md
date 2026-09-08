# New-room platform commission

New rooms charge 0.1% (10 basis points). Existing rooms retain 1% (100 basis points).
The database migration adds the column and backfills existing rooms in one transaction;
it does not change previous ledger entries, balances, or hand transcripts. Subsequent
room inserts default to 10 basis points, including after a restart.

Each hand snapshots its room's rate when dealt, records it in the transcript, floors
the commission separately for each pot, and credits the platform on the same ledger
reference as the player settlement. A 2,000-chip pot pays 2 chips; a pot below 1,000
pays zero. Run-it-twice splits the net pot after commission. Host settings cannot
override the platform rate.

REST and WebSocket room payloads expose the rate. The creation dialog discloses 0.1%,
both table layouts show their actual room rate, and settle-up describes actual ledger
deductions across new and legacy rooms. Older-server room payloads fall back to 1%.

## Verification

- 275 distinct automated tests passed across the focused server, shared, and web
  suites, including all 28 full-hand integration cases. Coverage includes new-room
  creation, migration/restart, unchanged legacy ledger hashes, pot rounding, split
  boards, platform credits, chip conservation, legacy settlement, and fold wins.
- All workspace typechecks and the production web/server build passed.
- Chromium: 48 result/control cases across 2D/3D layouts, rates of 0.1%/1%, four
  desktop/mobile viewport sizes, and showdown/fold/abort states. Exactly one visible
  rate label (where commission is positive), clickable Deal, dismissible results,
  and enlarged-card bounds were checked. This pass used `NO_WEBGL=1` and fixture
  sessions to check the DOM overlays; it did not repeat 3D rendering or production
  multiplayer testing.
- Chromium: the 0.1% creation disclosure and reachable Create button were checked
  at 1440×900 and 390×844; settle-up copy was checked. No uncaught browser errors.

The committed browser regression is `apps/web/test/browser/post-hand-deal.mjs`.
Run against Vite with `BASE_URL`, `PLAYWRIGHT_MODULE`, and `BROWSER_EXECUTABLE` as
needed; set `COMMISSION_BPS=100` for legacy rooms (default 10).
