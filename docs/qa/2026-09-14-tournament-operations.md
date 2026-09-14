# Tournament operations verification — 2026-09-14

Branch: `feat/agent-tournaments`, extending local commit `fa67c01`. This is local implementation and verification, not a production deployment, payment collection, prize fulfillment, or advertising launch.

## Verified

| Check                     | Evidence                                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full suite                | `npx vitest run --maxWorkers=2 --minWorkers=1`: **590 tests, 52 files passed**, 73.72 seconds                                                                                                       |
| Types                     | `npm run typecheck`: all five workspaces passed                                                                                                                                                     |
| Production compilation    | `npm run build --workspace @4am/web`: web and server passed; existing main/3D large-chunk warnings remain                                                                                           |
| Browser lifecycle         | Real Chromium: anonymous directory, private member proposal, platform approval, explicit rule consent, two enrollments, terms lock, start/pause/resume, ten hands via UI, completion and prizes     |
| Delegation                | Downloaded scoped MCP configuration, no signing key for the tournament, token revocation confirmed with HTTP 401                                                                                    |
| Accounting retries        | Simulated a successful server write followed by a lost response for both sponsor receipt and player settlement; identical retries produced one record                                               |
| Spectators                | Public creative omitted internal sponsor notes; anonymous view omitted live private cards; completed hand selector and decision replay exposed both players' hole-card sets from the completed hand |
| Earnings                  | Player identity and per-tournament fees/rewards/prizes/banker commission visible in admin; recorded settlement reduced outstanding to zero; personal Settle page linked the tournament              |
| Responsive and appearance | Desktop 1440×1000 and mobile 390×844; no page-level horizontal overflow; tables scroll internally; actual Zeus dark control exercised                                                               |
| Runtime errors            | Zero browser `pageerror` events during the complete flow                                                                                                                                            |
| Admin entry               | Actual password login returned to `/admin/tournaments` and displayed a pending member proposal                                                                                                      |
| Recording                 | Real Chromium MediaRecorder with a generated canvas capture stream: cancellation recovery, WebM download, removal of non-tab audio, track cleanup, unmount while the picker is pending              |

[Browser result](tournament-operations/browser-result.json) · [Recording result](tournament-operations/recording-result.json) · [Independent UI review](tournament-operations/finish-review.md)

The recording picker was stubbed; no real screen or microphone was captured. The saved clip decoded as VP9, 640×360, 14 frames. This verifies recording and cleanup logic, not permissions or capture support in every browser.

## Accounting example exercised

Two entrants, 100-chip entry each, 10-chip joining reward each, 1,000-chip guarantee, and a 500-chip sponsor receipt with 250 assigned to prizes. Ten fold-ended hands at 100/200 blinds accrued 10 chips each for banker, house, and prize pool. The resulting 1,440-chip prize pool was fully allocated, 720 per tied entrant. Alice's designated banker commission made her settlement net 640; Bob's net was 630. Recording 630 paid to Bob left his outstanding at zero. Hand-score net remained separate from settlement.

## Regression and integrity coverage

- Pending member proposals are private; platform-created events publish directly. Approval and economic edits check exact revisions. The first enrollment permanently locks terms.
- Cancelled proposals cannot be reapproved. Pre-start cancellation reverses entry obligations and original guarantee/sponsor funding; after-start cancellation allocates the earned pool from completed hands.
- Due schedules start eligible events, persist underfilled/error notes, and recover on restart. Underfilled queues do not starve eligible events. Eliminated spectators do not keep absent knockout players active.
- Knockout stacks persist, short all-in blinds resolve, surviving seats rotate, and ties/side pots/odd chips conserve chip allocation. Uncalled excess is exempt from fees. Legacy leagues preserve their original no-fee behavior and result serialization.
- Balanced immutable accounting, payout allocation, banker attribution (including nonentrants), account-merge protection, signed settlement bounds, and exact retry semantics have regression tests.
- Sponsor booking/receipt bounds, private/public projections, active date windows, target visibility, unsafe URLs, duplicate conflicts, and atomic receipt-to-pool funding are covered.
- Public watching never gains private cards by receiving credentials. Completed replay rejects unfinished hands; private watching requires entitlement outside the anonymous watch endpoint.
- An independent backend reviewer identified cancelled approval, scheduler starvation, legacy sponsor visibility, cleared banker attribution, and eliminated-player presence defects. Each received a regression fix; the reviewer independently reran the 12 operations tests and confirmed the last two fixes.

## Visual evidence

Full-page captures were taken from the document top after fonts loaded. The root inspected desktop/mobile together, corrected completed-stack display and terminal directory copy in one batch, and confirmed the captures. The design detector ran once across the changed UI files with no findings. A fresh independent reviewer received all nine captures and returned `disposition: ship` with no material fixes in the reviewed operational scope. A general agent substituted for the unavailable named Impeccable reviewer profile. Its visual/source review did not independently rerun the browser tests.

[Approvals](tournament-operations/approval-desktop.png) · [Sponsors](tournament-operations/sponsors-desktop.png) · [Directory](tournament-operations/directory-desktop.png) · [Winnings](tournament-operations/winnings-desktop.png) · [Watch](tournament-operations/watch-desktop.png) · [Mobile watch](tournament-operations/watch-mobile.png) · [Dark watch](tournament-operations/watch-mobile-dark.png) · [Earnings](tournament-operations/earnings-desktop.png) · [Mobile earnings](tournament-operations/earnings-mobile.png)

## Reproduce and preview

Build first, then start `npx tsx apps/web/test/browser/arena-server.mts`. It serves the built app and an in-memory synthetic fixture on port 58599. Run `ARENA_WEB_URL=http://127.0.0.1:58599 node apps/web/test/browser/arena.mjs` against a fresh fixture. The compatible arena entry point runs `tournament-operations.mjs`. Run `tournament-recording.mjs` after creating a public event. Set `PLAYWRIGHT_MODULE` if Playwright is installed outside the script's default QA location.

The BB preview has a completed UAT event, an upcoming knockout demonstration, and a member proposal awaiting review. It uses synthetic accounts and no production data. Fixture credentials are defined in the test fixture source; generated tokens remain in a local mode-0600 file and are not part of this report. The in-memory data disappears on process restart.

## Boundaries

- One table, 2–9 entrants: fixed-hand leagues and knockout tournaments. Multi-table tournament orchestration is not implemented.
- All amounts are whole competition chips and manual records. No real-money checkout, wallet, verified receipt, or automated payout is connected.
- External YouTube/Twitch and Google Meet links plus local browser recording are supported. The app does not create meetings, host streams, or store video.
- Local stdio MCP and scoped events remain available; there are no dedicated MCP admin/earnings/replay tools or sponsor/settlement webhook topics.
- The previous engine's 1,000/10,000-hand benchmark evidence remains in the prior QA report. This turn did not run a 10,000-hand production tournament or paid third-party agents.
- Sponsor copy and social materials are drafts or synthetic fixtures. No posts, messages, ad purchases, push, merge, or deployment were performed.

See [Tournament operations](../TOURNAMENT-OPERATIONS.md) for the runtime admin and API contracts.
