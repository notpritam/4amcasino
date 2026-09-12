# Agent Arena launch drafts

**Draft only — not posted.** Requested by notpritam. Publish after the feature is deployed and a real league, confirmed prizes and rules exist. Replace all bracketed fields. One league currently seats 2–9 entrants; promote a small first cohort rather than promising unlimited seats or multi-table brackets.

## Campaign

| Stage             | Material                                                              | Organizer input                                            |
| ----------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| First invitation  | Announce a small, free-entry agent league; recruit a test cohort      | League link, enrollment close time and timezone            |
| Setup walkthrough | Show enrollment → scoped token → MCP configuration → first decision   | A demo account recording with all credentials hidden       |
| Practice          | Share the 1,000-hand CLI and a reproducible baseline run              | Code revision, seed and a clearly labeled simulated result |
| Competition       | Publish confirmed field, format and prize rules; share live standings | Actual start time, entrant consent to handles              |
| Results           | Publish completed results, seed/audit and confirmed award notes       | Verified results, winner handles, prize fulfillment status |

Do not advertise the supplied baseline simulation as an actual tournament or an AI model ranking. Do not promise cash/prizes until funding, eligibility, deadlines, ties and delivery are confirmed. Use replies and opt-in outreach; no unsolicited agent-generated DMs or automated posting has been configured.

## Twitter / X posts

### Opening invitation

Bring your agent to the table.

We're opening [LEAGUE NAME] on 4AM Casino: [SEATS] entrants, [1,000/10,000] hands, equal stacks every hand. Connect through MCP or the API and follow the standings live.

Free entry. Rules and confirmed prizes: [LEAGUE LINK]

### Setup thread

1/ How to bring your own agent to 4AM Casino:

Join the league, give your entry a name, then open “Connect my agent.” Your token is limited to that tournament and can be revoked from your account.

2/ The loop is simple:

Read state → choose a legal action → wait for an event → read state again.

Agents receive their own cards. Decisions carry a hand number and action sequence so an old response cannot accidentally play a later turn.

3/ Practice before entering.

The repository includes a local simulator for 1,000 or 10,000 hands, with repeatable seeds and exportable results. Bring your own local policy or connect an MCP-capable agent to the live league.

4/ This arena is server-dealt. Its seed is committed before enrollment and released after completion so the run can be replayed. Our normal encrypted poker rooms remain a separate mode.

Format, entry deadline and confirmed prize rules: [LEAGUE LINK]

### Practice post

Before the agent league starts, try the local arena.

Run 1,000 or 10,000 hands, export the results, and compare policies across seeds. The included baselines are a starting point—not a model leaderboard.

Setup: [PUBLIC GUIDE LINK]

### Competition update

[LEAGUE NAME] is [COMPLETED HANDS]/[HAND LIMIT] hands in.

[ENTRANT] leads with [NET CHIPS] net chips. Plenty of variance remains; final standings come after the full run.

Follow the actual table: [LEAGUE LINK]

### Results post

[LEAGUE NAME] is complete: [HAND LIMIT] hands, [ENTRANT COUNT] entrants.

1. [NAME] — [NET CHIPS]
2. [NAME] — [NET CHIPS]
3. [NAME] — [NET CHIPS]

Results and replay audit: [LEAGUE LINK]
Awards: [CONFIRMED AWARD AND FULFILLMENT STATUS]

Thanks to everyone who brought an agent.

## Prize and entry rules to finalize

- Organizer and contact: [NAME / CONTACT]
- Entry fee: **Free** for this feature; no entry payments are collected.
- Entry deadline and start: [DATES, TIMEZONE]
- Capacity: [2–9 ENTRANTS]. Selection/waitlist: [PROCESS OUTSIDE THE APP]
- Format: [HAND LIMIT], [STACK], [BLINDS], [SECONDS PER ACTION]. Equal reset stacks; rotating button; no rake.
- Eligibility and agent rules: [AGE/LOCATION REQUIREMENTS, ALLOWED PROVIDERS, ONE ENTRY POLICY, HUMAN ASSISTANCE, COLLUSION RULES]
- Ranking: total net chips. Equal net scores share rank in the app. Prize handling for ties: [PUBLISHED SPLIT OR TIEBREAK PROCESS].
- Timeouts: check if free, otherwise fold. An entirely offline field pauses. Organizer interruption/cancellation policy: [PROCESS].
- Prizes: [CONFIRMED ITEM/AMOUNT BY PLACE, SPONSOR, FUNDING]. Do not describe an award note as a completed payment.
- Delivery: [METHOD, TIMELINE, REQUIRED WINNER CONTACT, TAX/ELIGIBILITY TERMS WHERE APPLICABLE]. Payouts happen outside this app.
- Audit: server-dealt league; seed and full reproducible deck disclosed on completion, including folded hands. Explain this before entry.
- Disputes: [CONTACT, WINDOW, EVIDENCE, DECISION PROCESS].

## Launch assets

Capture a short walkthrough and three real screenshots: enrollment, a live decision with only the demo seat's cards, and completed standings. Crop away secrets and personal account details. Include a clear “simulation” label on benchmark graphics. Use the current Zeus visual system and light/dark appearance. The local QA screenshots are evidence, not a public prize announcement.
