# Tournament operations, earnings and broadcast

Goal: extend the existing Agent Arena into an approved, scheduled tournament product with transparent chip accounting, sponsor placements, public watching and completed-hand replays. Preserve ordinary room accounting and the Zeus interface. No deployment or external publishing is included.

## Product contract

- Platform-created tournaments publish directly. Member-created tournaments enter a private approval queue; only the platform approves/rejects. Rejected proposals can be revised and resubmitted. Existing published tournaments are grandfathered.
- Two formats: equal-stack fixed-hand leagues and single-table knockout tournaments (2–9 players). Knockout stacks persist, blinds increase at a published hand interval, and a hand cap closes by remaining stacks. Ties share the affected payout places.
- Scheduled approved tournaments start automatically with at least two entrants. Otherwise the organizer sees why start is waiting. Timers survive restart; online/offline timeout safeguards remain.
- Publish the rule revision, schedule, format, entry fee, joining reward, payout percentages and banker/house/prize rates before enrollment. New entrants explicitly accept that revision. Terms become permanently locked on first enrollment. Only pre-entry changes are allowed and member changes require approval again.
- Accounting is whole competition chips, separately from room balances, cash and payment processing. Default new-event cuts are 50 basis points each (0.5% banker, house, prize). Each contested settled pot is charged once; uncalled returns are exempt. All transfers balance and are idempotent.
- An organizer guarantee funds joining rewards and optional starting prizes. Entry fees and prize contributions grow the pool. Joining rewards vest on start, once per entrant; cancellation before start reverses entry obligations. Cancellation after play pays the existing earned pool by current standings. Per-player entry, joining reward, prize, net result and recorded settlement are visible. Payment records are platform attestations, not processor confirmations.
- Platform administration owns approval, terms, sponsors, placements and settlement recording. Sponsors/ads have plain-text creative, safe HTTPS destination, placement, date window, booked amount, recorded receipts and prize contribution. Public creative never exposes private finance/contact notes. No arbitrary HTML or tracking scripts.
- Anonymous public watch pages contain only public state, completed-hand reveals (including folded cards when disclosed in new rules), action replay and standings. No live private cards, future deck or early seed. Stream/Google Meet links open externally; local browser capture requires the browser's picker and produces a downloadable recording.

## Implementation

1. Shared engine and tests: optional persistent stacks, blind/button continuity, per-pot commission allocations and after-hand reveal flag. Old defaults reproduce existing benchmarks.
2. Additive SQLite migration; approval/policy/revision/audit, entry accounting columns, balanced tournament journal, sponsorships and settlement receipts. Keep legacy rows unchanged.
3. Server workflow: approval/terms APIs, accepted revision enrollment, scheduled starts, knockout progression, accounting and payout settlement, personal earnings, public watch/replays and scoped MCP metadata.
4. Sponsorship APIs and admin UI: platform-only CRUD, runtime placements, booked versus received income, earmarked prize contributions with immutable records.
5. Zeus tournament pages: discover upcoming/live/completed/proposals, configure/publish or submit, readable entry rules, consent, winnings, public watch link; dedicated tournament operations/earnings section in admin.
6. Broadcast UI: anonymous watch route, hands/actions selector, completed cards, ad placement, stream/Meet links, browser recording with cleanup and clear states. Update MCP guide and enrollment tool.
7. Verification: meaningful failing tests first; conservation/rounding/side pots/idempotency, authorization/revisions/schedule/cancellation/migration/restarts/privacy; focused browser enrollment-to-completion and admin/sponsor/recording-control flows, desktop/mobile/dark. Full typecheck/tests/build, independent security and design reviews, documentation.

Architecture: existing TypeScript monorepo, shared pure betting engine, Fastify + synchronous SQLite transactions, React/Zeus. New economy module owns journal calculations. Published policy is immutable after enrollment. Public views are explicit projections. Payment provider, multi-table balancing and hosted video storage are separate integrations; never present recorded chips as collected currency.

Execution uses the subagent-driven-development skill for bounded independent engine, sponsor and UI tasks with explicit file ownership; the root owns integration and verification. Review each result before integrating.
