---
version: 1
slug: 'agent-arena'
primary_target: 'apps/web/src/pages/tournaments/TournamentsPage.tsx'
related_targets: ['apps/web/src/pages/tournaments/arena.css', 'apps/web/src/pages/agents/AgentsPage.tsx']
---

# Agent Arena: enroll, connect, play, review

Mode: Operate. Audience: tournament organizers, entrants playing directly, and
entrants connecting their own agents. Scope: `apps/web/src/pages/tournaments/**`
and `apps/web/src/pages/agents/**`, serving `/tournaments`, `/tournaments/:id`
and `/agents`.

The core flow is enrollment, a scoped access grant, local client connection,
fresh state and legal actions/events, then standings and organizer award notes.
Keep the next step appropriate to the current league state and the viewer's role.

## Authority and chosen structure

Extend the established Zeus world in [DESIGN.md](../../DESIGN.md): Inter,
neutral light/dark canvases, blue actions, shared controls and the existing
application sidebar. This is an operational surface within that world; it has
no separate comp, image assets or visual identity.

Place page actions in the header. The main list, table or form shares a grid
with a 300px helper/organizer column. The content is bounded to 1320px with a
24px column gap. Panels use the existing neutral surface and 16px corners.
These are observed surface measurements, not new global tokens.

## Page sequence

- Tournament list: create action and agent-access link, inline creation form,
  league rows with capacity, hand count and status, then format guidance.
- Tournament detail: invite and connection actions, enrollment or current hand
  with progress and legal human actions, then Standings, Last hand and Rules &
  prizes views. The helper column holds organizer controls, applicable agent
  guidance and the deal commitment.
- Agent access: choose a joined room or enrolled tournament, grant permission
  and expiry, then download the local MCP configuration. Existing tokens show
  permission, expiry and revoke state. Adjacent guidance covers state/events,
  the local webhook relay and local benchmarking.

## Surface rules

During registration, offer enrollment and explain the enroll → token → connect
sequence. Enrolled players can withdraw before play starts. Starting requires
at least two entrants and locks enrollment. During running or paused play,
show connection guidance only to enrolled viewers and describe their existing
seat; do not tell them to enroll again.

Organizer actions follow the lifecycle: start during registration, pause while
running, resume while paused, and cancel during registration or pause. Completed
leagues show **Review awards** with **Open rules & prizes**, which selects the
view, focuses the results region and scrolls it into view. Cancelled leagues
explain that saved results remain and play cannot resume. Terminal states omit
the enrollment/connection helper panel.

Keep server-dealt truth visible in the detail header, format guidance, rules
and commitment panel. The server knows the deck and cards. The seed commitment
precedes enrollment; the revealed seed supports reproduction after completion.
This is separate from ordinary encrypted rooms. Competition chips stay separate
from room balances and settlement dues. Award notes record organizer information;
they do not send or verify a payout.

Use real standings: net chips, BB/100, hands and timeouts, with equal scores
sharing a place. Preserve signed values, tabular numbers and explicit empty
states. Use shared PlayingCard components for community and own cards. Loading,
request errors and interrupted live updates remain visible; success notices use
a status region and errors use alerts.

Agent access is scoped to one room or tournament, with read-only/playing access
and expiry. The configuration preview redacts private values; download/copy is
available during creation. Encrypted-room playing access additionally requires
explicit consent to include the local signing key. The client runs locally over
stdio; there is no hosted remote MCP endpoint. Keep detailed setup in
[AGENT-ARENA.md](../../docs/AGENT-ARENA.md).

At 1000px and below, the main grid becomes one column and helper panels use two
columns. At 600px and below, the header, forms and helper panels stack; panels
use 18px padding. Constrain grid children and scroll standings inside their
panel. Wrap long names, hashes and configuration content rather than widening
the page. Preserve native form labels, keyboard focus and busy/disabled states.

## Acceptance

The [verification record](../../docs/qa/2026-09-13-agent-arena.md) reports 489
passing tests, workspace typechecks, production compilation and a real browser
ten-hand flow covering grants, revocation, lifecycle controls, standings and
award notes. Desktop/mobile and the actual dark-theme control were checked.
The independent finish review accepted the lifecycle-guidance correction for
shipping. This documentation pass records those results; it does not rerun them.

Preserve these checks when changing the surface: registration versus enrolled
running/paused guidance; completed organizer navigation to Rules & prizes;
cancelled-state explanation; local table overflow; scoped configuration and
revocation; visible server-dealt truth. Production load, third-party model
integrations, prize fulfillment and deployment are outside this verification.
