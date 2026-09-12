# Agent Arena verification — 2026-09-13

Branch: `feat/agent-tournaments`, based on `c8ea5d7`. Local development only; no deployment, Twitter posting, paid model run, entry collection or payout performed.

## Verified

| Check                  | Evidence                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full test suite        | `npx vitest run --maxWorkers=2 --minWorkers=1`: **489/489**, 47 files                                                                                                                                                             |
| TypeScript             | `npm run typecheck`: all five workspaces pass                                                                                                                                                                                     |
| Production compilation | `npm run build --workspace @4am/web`: web and server pass; existing large-chunk warnings remain                                                                                                                                   |
| Browser UAT            | Actual login/invite return, create league, two enrollments, scoped MCP config download, revoke, start/pause/resume, ten hands through UI, isolated own cards, standings, award note, desktop/mobile and actual dark-theme control |
| Responsive UI          | 1440×1000 desktop and 390×844 mobile; no page-level horizontal overflow; standings scroll within their panel; agent setup also checked on mobile                                                                                  |
| Runtime errors         | No browser `pageerror` events in the completed flow or mobile agent setup                                                                                                                                                         |
| MCP protocol           | SDK client/server over in-memory transport: discover tools, enroll, read state, reject an illegal call with `isError`, read guide resource                                                                                        |
| Encrypted room agent   | Real headless clients played through shuffle/proofs to showdown with full-account and delegated room credentials; delegated banking denied                                                                                        |
| Revocation             | Read-only tokens denied gameplay WebSockets; revoked play socket closes with 1008; HTTP token access revoked, expiry/membership checks verified                                                                                   |
| Tournament integrity   | Capacity/ownership/lock checks, legal and stale actions, duplicate retry, timeout isolation, restart recovery, equal-stack zero-sum results, no ledger entries                                                                    |
| Reproducibility        | Completed league replayed from seed and action audit; all ten persisted hand results match                                                                                                                                        |
| Event privacy          | Private crypto/card events excluded, cursor replay and cross-scope denial verified; expired-history relay exits before delivery/checkpoint mutation                                                                               |
| Webhook transport      | Real local HTTP receiver returned 503 then 204; signature verified on exact body, stable event ID preserved, cursor written only after acknowledgement                                                                            |
| Local simulation       | 1,000 and 10,000 hands with deterministic baseline policies; every hand conserves chips                                                                                                                                           |
| UI detector            | One pass on changed new surfaces and shell; zero findings                                                                                                                                                                         |

The initial unrestricted full-suite run had three five-second crypto test timeouts under concurrent CPU load. Running with two workers resolved these without changing test deadlines. A newly added WebSocket test initially installed its hub after Fastify initialization; its fixture ordering was corrected. The final full run above includes that test. Browser test fixes included waiting for synthetic fixture readiness and for the theme transition to settle; these were harness issues, separate from the actual revoke-request and mobile-grid defects fixed in the product.

## Defects fixed during review

- User-supplied action IDs could collide with automatic timeout IDs. Separate namespaces now prevent this; one damaged league cannot block other deadlines.
- Account merges could strand an active organizer or entrant. Both sides are now guarded while any involved tournament is active.
- A webhook outage beyond retained history could silently skip events. The relay now retains its checkpoint and requires explicit resynchronization.
- Event subscribers waiting for long decisions were counted offline. Continuing subscriptions now refresh their entrant presence.
- Persisted room events could imply that an old hand was still running after restart. Current engine activity and matching hand IDs now gate exposed betting state.
- Revoking a token failed because an empty DELETE carried JSON content type. Bodyless app requests now omit it.
- A mobile standings table expanded its parent grid. The grid now constrains its content and keeps table scrolling local.

An independent backend review verified the three original findings resolved and found no further material issues in that bounded review. Its additional CLI retention-gap check observed zero receiver deliveries and an unchanged checkpoint. The presence fix and current-hand guard were verified separately by regression tests.

The UI review requested one material fix: completed leagues still offered enrollment/start guidance. Completed organizers now get **Review awards → Open rules & prizes**, which selects, focuses and scrolls to the results area. Closed enrollment no longer shows enrollment instructions; enrolled running players get connection guidance. The reviewer scored this fix **resolved**, with `disposition: ship` for that scored fix and no direct visual regressions. The updated browser UAT exercised the new award-navigation action, and web typecheck/build passed afterward. General agents supplied the independent finish review and documentation roles because named Impeccable agent profiles were unavailable in this harness.

## Baseline results

Seed: `arena-qa-2026-09-13`. Three local policies: check/call, check/fold and pressure. These are scripted-policy comparisons, not LLM performance results or prize-bearing standings.

| Hands  | Transcript SHA-256                                                 | Total net chips |
| ------ | ------------------------------------------------------------------ | --------------- |
| 1,000  | `8632ba185184cd59f4bde1f4dde39c860023de95650d3573b5814f66634a7025` | 0               |
| 10,000 | `56767c14ad7a700f1cd320ec9e3b8a835cfac9eecfb843814b90cc0189b1b9b6` | 0               |

[Machine-readable benchmark summary](agent-arena/benchmark-summary.json) · [Browser result](agent-arena/browser-result.json)

Screenshots remain local under `.impeccable/review/arena/`: `agents-desktop.png`, `agents-mobile.png`, `tournament-desktop.png`, `tournament-mobile.png`, `completed-desktop.png`, `list-desktop.png`, `list-mobile.png`, `list-mobile-dark.png`. Config previews redact tokens/keys. No fixture credentials are stored in these QA artifacts.

## Release limits

- One table and 2–9 entrants per league. No elimination bracket, multi-table orchestration or paid entry.
- Arena dealing is server-known, with seed reveal after completion; existing encrypted rooms retain their own protocol.
- Local stdio MCP plus authenticated HTTP/WebSockets; no hosted remote MCP endpoint.
- Webhook forwarding runs in the entrant's own relay process. Checkpoints and external receiver operation are their responsibility.
- Prize descriptions/award notes are metadata. Organizer must finalize real prize values, eligibility and delivery before promotion.
- Twitter materials are drafts. No posts, DMs or advertising spend.
- Production load, real third-party model integrations and actual prize fulfillment have not been tested. The 10,000-hand run exercises the local core engine, not 10,000 production HTTP hands.
- Google/Supabase project setup remains separate in `docs/SUPABASE-GOOGLE-AUTH.md`.
