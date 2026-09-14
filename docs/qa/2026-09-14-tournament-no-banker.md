# Tournament release correction — 2026-09-14

User correction: bankers never receive commission. Tournament cuts go only to the house and prize pool. The user authorized merging and pushing to trigger production deployment.

## Changes

- Defaults are 50 basis points (0.5%) to the house and 50 basis points to the prize pool. Bankers have no rate, payee, deduction, journal account, earnings column or settlement entitlement.
- Creation and terms updates reject obsolete nonzero banker rates and non-null banker payees. Neutral obsolete fields and saved pre-release policy fields are omitted from published rules.
- The fee engine ignores retired banker rates in serialized pre-release rounds. Contested side pots still floor each remaining rate separately; uncalled returns remain exempt. For a 1,001-chip contested pot at the defaults, the house receives 5, the prize pool receives 5, and the winner receives 991.
- Settlement net is joining reward + prize − entry fee. Hand scoring remains separate. Ordinary room banker permissions and room accounting are unchanged.
- Updated participant/admin controls, shared/API types, integration docs and launch drafts. Earlier QA records retain their historical evidence.

## Candidate verification

| Check                   | Result                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regression first        | Two new API/projection tests failed on the old banker fields before implementation                                                                                                                                                    |
| Full suite              | `npx vitest run --maxWorkers=2 --minWorkers=1`: **590 tests, 52 files passed**, 81.22 seconds                                                                                                                                         |
| TypeScript              | `npm run typecheck`: all five workspaces passed                                                                                                                                                                                       |
| Build                   | `npm run build --workspace @4am/web`: web/server passed; existing bundle-size warnings remain                                                                                                                                         |
| Independent review      | No material findings in the correction diff; independently ran 65 focused tests plus 11 forbidden-input cases and neutral/persisted-field checks                                                                                      |
| Browser                 | Real Chromium: member proposal, platform approval, enrollment consent, scoped MCP token/revocation, sponsors and lost-response retry, start/pause/resume, ten hands, completed reveals/replay, settlement retry and personal earnings |
| Corrected money example | Both entrants received a 720-chip prize and 10-chip joining reward against 100 entry, yielding **630 each**. House accrued 10; prize allocations totaled 1,440. No banker field or commission existed                                 |
| UI                      | No banker form control; desktop/mobile/dark checks passed with no page overflow or browser page errors. Root inspected approval, earnings and dark mobile captures                                                                    |

[Browser result](tournament-no-banker/browser-result.json) · [Published cuts](tournament-no-banker/approval-desktop.png) · [Earnings](tournament-no-banker/earnings-desktop.png) · [Dark watching](tournament-no-banker/watch-mobile-dark.png)

This candidate includes the earlier arena and tournament operations commits. The broader [operations QA](2026-09-14-tournament-operations.md) and [arena QA](2026-09-13-agent-arena.md) remain historical context. This record precedes the push; the exact Render deployment status and public route/asset checks are verified afterward in the release handoff.

## Release checks

Render deploys `main` with the repository blueprint and persistent disk. Verify the GitHub deployment for the pushed SHA reaches success, `/api/health` is healthy, `/api/tournaments` is available, anonymous administration is denied, and public tournament/agent assets load.

Before release, both Cloudflare and Google public DNS resolvers returned no address for `admin.4amcasino.com`. The supported same-site admin entry is `/admin/tournaments`. No DNS records or production tournament/financial records were changed by local QA. The fixture and its accounts are local only.
