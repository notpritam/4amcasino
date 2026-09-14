---
version: 1
slug: 'agent-arena'
primary_target: 'apps/web/src/pages/tournaments/TournamentsPage.tsx'
related_targets:
  - 'apps/web/src/pages/tournaments/arena.css'
  - 'apps/web/src/pages/tournaments/TournamentTerms.tsx'
  - 'apps/web/src/pages/tournaments/tournament-operations.css'
  - 'apps/web/src/pages/tournaments/TournamentWatchPage.tsx'
  - 'apps/web/src/pages/tournaments/broadcast.css'
  - 'apps/web/src/pages/tournaments/SponsorPlacements.tsx'
  - 'apps/web/src/pages/tournaments/TournamentEarnings.tsx'
  - 'apps/web/src/pages/agents/AgentsPage.tsx'
  - 'apps/web/src/pages/admin/TournamentAdmin.tsx'
  - 'apps/web/src/pages/admin/AdminPage.tsx'
  - 'apps/web/src/pages/settle/SettlePage.tsx'
---

# Agent Arena: propose, approve, enroll, play, review

Mode: Operate. Audience: platform administrators, member organizers, human and
agent entrants, and public spectators. Scope: `apps/web/src/pages/tournaments/**`,
agent access, the tournament administration section, and personal tournament
earnings in Settle. Routes are `/tournaments`, `/tournaments/:id`,
`/tournaments/:id/watch`, `/agents`, `/settle` and `/admin/tournaments`.

The core flow is proposal or platform publication, exact-revision approval,
explicit entry consent, optional scoped agent connection, scheduled or manual
play, then standings, prizes and manual settlement records. Public watching and
completed-hand replay run alongside play. Keep the next step appropriate to the
event state and the viewer's role.

## Authority and chosen structure

Extend the established Zeus world in [DESIGN.md](../../DESIGN.md): Inter,
neutral light/dark canvases, blue actions, shared controls and the existing
application sidebar. This is an operational surface within that world; it has
no separate comp, image assets or visual identity.

The [implementation contract](../../docs/plans/2026-09-14-tournament-economy.md)
pins this extension to the incumbent Zeus system. Place page actions in the
header. The participant list, table or form shares a grid with a 300px
helper/organizer column. Content is bounded to 1320px with a 24px gap; neutral
panels have 16px corners and 24px padding. The separate administration shell
includes Tournaments & earnings among its seven destinations and retains 14px
panel corners. These are observed surface measurements, not new global tokens.

Public watch uses its own compact navigation with a tournament-details link and
the shared appearance control. Its content is bounded to 1440px, with a 340px
supporting column and 24px gap. The main column holds the public table and
completed-hand review; the supporting column holds standings, external links,
local recording and sponsor placements.

## Page sequence

- Tournament list: Upcoming, Live, Past and signed-in My proposals filters;
  platform publication or member proposal form; rows with format, capacity,
  entry amount, schedule/status and guarantee; then format/entry guidance and
  disclosed sponsor placements.
- Tournament detail: approval/revision state, invite and watch/connection actions,
  published terms with explicit enrollment consent, or the current hand with
  progress and legal human actions. Standings, Winnings, Last hand and Rules &
  prizes views follow. Supporting panels hold lifecycle controls, funds, sponsor
  placements, broadcast links, applicable agent guidance and the deal commitment.
- Tournament administration: Approvals, Tournaments, Earnings and Sponsors tabs.
  Review the published facts beside approval controls. Earnings expose player and
  tournament identity, search, totals and inline manual settlement recording.
  Sponsors expose creative, placement/date window, booked versus received chips
  and optional prize contributions. Broadcast links remain runtime settings.
- Personal Settle: a separate tournament earnings panel links each event and
  itemizes entry, reward, prize, play net, settlement net,
  recorded paid and outstanding amounts.
- Public watch: current table state, completed-hand selector and final reveals,
  decision replay controls, standings, external stream/Meet links, local recording
  and disclosed sponsorship. Live and selected historical hand states remain
  separate and clearly labeled.
- Agent access: choose a joined room or enrolled tournament, grant permission
  and expiry, then download the local MCP configuration. Existing tokens show
  permission, expiry and revoke state. Adjacent guidance covers state/events,
  the local webhook relay and local benchmarking.

## Surface rules

Member proposals remain private to their owner and the platform until approved.
Platform-created events publish directly. Rejected proposals can be revised and
resubmitted. Terms show the revision, format, schedule, whole-chip entry/reward/
guarantee, house/prize deductions, payout shares and watching disclosure
before the consent checkbox. Enrollment sends the displayed accepted revision;
the first entrant permanently locks the terms, including after withdrawal.
Only pre-entry terms can change, and a member edit requires approval again.
Platform accounts administer events and cannot enroll as players.

During registration, explain the enroll → token → connect sequence. Enrolled
players can withdraw before play starts. Starting requires approval and at least
two entrants, then closes enrollment. Due scheduled events start automatically;
underfilled or failed starts show a waiting reason. During running or paused
play, show connection guidance only to enrolled viewers and describe their
existing seat; do not tell them to enroll again.

Both formats use a single table of 2–9 entrants. Fixed-hand leagues reset stacks
and rank by accumulated play net. Knockout events carry stacks between hands,
eliminate zero stacks and increase blinds at the published hand interval; a hand
cap ranks remaining stacks. Preserve tied ranks and their shared payout places.

Organizer actions follow the lifecycle: start approved registration, pause while
running, resume while paused, and cancel pending/rejected proposals, registration
or paused play. Completed events show **Review awards** with **Open rules &
prizes**, which selects the view, focuses the results region and scrolls it into
view. Cancelled events explain that saved results remain and play cannot resume.
Terminal states omit the enrollment/connection helper panel. Before-start
cancellation reverses entry obligations and original pool funding; after-start
cancellation allocates the earned pool by completed-hand standings. Platform
broadcast-link edits remain available after terms lock without changing the
accepted game/economic revision.

Keep server-dealt truth visible in the detail header, rules and commitment panel.
The server knows the deck and cards. The seed commitment precedes enrollment;
the revealed seed supports reproduction on completion. New rules disclose all
hole cards, including folded cards, only after a hand finishes. Public watching
never exposes live hole cards, even to a viewer with participant credentials.
Private hand/replay access requires entitlement; the anonymous watch route does
not become a private participant view. Cancelled events do not reveal the seed.
Legacy revision-0 leagues retain their original rules and disclosure behavior.

Competition-chip accounting stays separate from room balances and settlement
dues. Distinguish entry obligations, organizer guarantees, joining rewards,
prizes and house/pool deductions. Settlement net adds joining reward and prize, then subtracts the entry fee; play net is performance,
not settlement debt.
Outstanding is settlement net − recorded paid. State the direction of signed
outstanding values. Bankers receive no cut.
Only the platform records manual settlements after completion/cancellation.
Award notes do not change earnings or send/verify a payout.

Sponsor administration separates booked, recorded received and prize-contribution
chips. Public placements show sponsor disclosure and creative, without private
notes or finance records. Receipt and settlement forms preserve the exact pending
attempt after an uncertain response, offer the same-record retry and clearly
report that recording a payment does not send one. Keep receipts immutable;
disable a campaign with receipts instead of presenting deletion as available.

Use real standings: play net or knockout stack, prizes, BB/100, hands and timeouts.
Preserve signed values, tabular numbers and explicit empty states. Use shared
PlayingCard components for community, own and completed-hand cards. Loading,
request errors and interrupted live updates remain visible; success notices use
a status region and errors use alerts. Public watch distinguishes paused updates
from current live state and labels the timestamp of the last successful update.

External YouTube/Twitch and Google Meet links open separately. **Record tab** uses
the browser's capture picker; capture stays local and the user downloads the
result. Audio is off by default and optional shared tab audio excludes microphone
and screen/window audio. Show recording, stop, download, cancellation/permission,
unsupported and failure states. Clips are bounded to 20 minutes or approximately
200 MB; leaving or restarting discards the in-memory clip and cleans up capture.
The app does not create meetings, host streams or store recordings.

Agent access is scoped to one room or tournament, with read-only/playing access,
expiry and revocation. The configuration preview redacts private values;
download/copy is available during creation. A tournament grant cannot accept
terms, administer events or record payments. Encrypted-room playing access
additionally requires explicit consent to include the local signing key. The
client runs locally over stdio; there is no hosted remote MCP endpoint. Keep
detailed setup in [AGENT-ARENA.md](../../docs/AGENT-ARENA.md) and accounting,
approval and recording contracts in the
[operations runbook](../../docs/TOURNAMENT-OPERATIONS.md).

At 1000px and below, the main grid becomes one column and helper panels use two
columns. At 600px and below, the header, forms and helper panels stack; panels
use 18px padding. Term facts and admin form rows become one column at 640px.
Public watch reduces its supporting column to 300px at 1150px, stacks the main
layout at 850px, and becomes fully single-column at 580px with 18px panel padding.
Constrain grid children and scroll standings/earnings inside their panel. Wrap
long names, hashes and configuration content rather than widening the page.
Preserve native form labels, keyboard focus and busy/disabled states.

## Acceptance

The [current verification record](../../docs/qa/2026-09-14-tournament-operations.md)
reports 590 tests across 52 files, all five workspace typechecks and production
compilation. A real Chromium flow covered private proposal, platform approval,
explicit consent, two enrollments, permanent terms lock, start/pause/resume, ten
hands, completion and prizes. It also checked scoped configuration/revocation,
lost-response retries for sponsor receipts and settlement, public hand privacy
and replay, personal/admin earnings, actual admin login, desktop/mobile overflow
and the actual Zeus dark control, with zero browser page errors.

Recording checks used real Chromium MediaRecorder with a generated canvas
capture stream and a stubbed picker. They exercised cancellation recovery,
download, removal of non-tab audio, track cleanup and leaving while the picker
was pending. They did not capture a real screen or microphone or verify browser
capture permissions across platforms.

The [independent finish review](../../docs/qa/tournament-operations/finish-review.md)
returned `disposition: ship` with no material fixes in the reviewed operational
scope, based on the nine final captures and sampled source. It did not rerun the
functional checks. Durable screenshots are linked from the current verification
record. The [previous arena QA](../../docs/qa/2026-09-13-agent-arena.md) remains
historical evidence. This documentation pass records those results; it does not
rerun them or establish deployment.

Preserve revision/consent locking, role-appropriate lifecycle guidance, manual
accounting distinctions, exact retries, separate live/replay states, sponsor
disclosure, scoped access/revocation, bounded tables and desktop/mobile/theme
continuity. Multi-table orchestration, real-money collection, automatic prize
fulfillment, hosted video, production load and third-party paid-agent integration
are outside this verification.
