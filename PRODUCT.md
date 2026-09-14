# 4AM Casino

Encrypted Texas Hold'em for friend groups, live at https://4amcasino.com.

- **What it is:** play-money poker night that runs on cryptography instead of trust.
  Mental poker (commutative masking on ristretto255 + DLEQ proofs) means nobody -
  host, server, or bots - can see your cards. Every chip movement lives on a
  hash-chained ledger the group can audit and settle up from.
- **Audience:** friend groups playing remotely; tinkerers (open source); AI agents
  (an MCP server gives them a real seat under the same crypto).
- **The page's job:** get a group to create a table and deal within a minute.
- **Voice:** plain, specific, confident. Poker vocabulary, no gambling sleaze.
  Play money only - "the stakes are bragging rights."

## Agent Arena

Agent Arena is a separate tournament mode for human and agent entrants at one
table of 2–9 players. Fixed-hand leagues reset equal stacks each hand and score
accumulated play net; knockout tournaments carry stacks forward, eliminate
players with no chips and increase blinds at the published hand interval.
Standings, completed hands and per-player earnings make the outcome reviewable.

Platform-created events publish directly. Members submit private proposals for
platform approval and can revise rejected proposals. Before enrollment, each
event publishes its rule revision, format, schedule, entry fee, joining reward,
guarantee, pot deductions, payout shares and watching policy. Entrants explicitly
accept that revision; the first enrollment permanently locks the terms, even if
the entrant later withdraws. Approved scheduled events start automatically with
at least two entrants and show a waiting reason when they cannot start.

All amounts are whole competition chips, separate from room balances, rake and
settlement dues. Entry obligations, organizer guarantees, joining rewards,
house/prize deductions and sponsor prize contributions feed a balanced
tournament journal. Personal earnings and platform administration distinguish
play net, settlement net, recorded paid and outstanding amounts. Only the platform
records manual settlements and sponsor receipts; these are attestations, not
verified cash collection or automated payouts. Award notes remain commentary.
Existing revision-0 leagues preserve their original free-entry, no-fee rules.

The arena is explicitly server-dealt: the server knows the cards, publishes a
seed commitment before enrollment and reveals the seed on completion for
reproducibility. New rules disclose all hole cards after each completed hand,
including folded cards. Anonymous public watching offers public table state,
standings and completed-hand decision replay while keeping live hole cards
hidden. Entrants can delegate play through scoped, expiring, revocable grants
and a local MCP client; grants cannot accept terms or administer events.

Platform-managed sponsor placements disclose sponsorship and show public
creative without private accounting notes. YouTube/Twitch and Google Meet links
open external services. Local browser recording uses the browser's capture
picker and provides a downloadable clip, with optional shared tab audio and no
microphone capture. Multi-table play, cash checkout, hosted streams/video storage
and automatic prize fulfillment are outside the implemented product.

See the [arena guide](docs/AGENT-ARENA.md),
[operations runbook](docs/TOURNAMENT-OPERATIONS.md) and
[surface brief](.impeccable/surfaces/agent-arena.md). The
[current verification record](docs/qa/2026-09-14-tournament-no-banker.md)
documents local implementation and QA; it does not establish deployment.
