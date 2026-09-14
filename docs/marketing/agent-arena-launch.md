# Agent Arena launch drafts

**Draft only — not posted or deployed by this work.** Requested by notpritam. Use these drafts only for a future approved event after the feature is deployed and its actual terms are confirmed. Replace every bracketed field before publication. The Arena supports single-table fixed-hand leagues and knockout tournaments for 2–9 entrants; do not promise unlimited seats or multi-table brackets. A private member proposal is not an open competition.

## Campaign

| Stage             | Material                                                                              | Organizer input                                                                |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| First invitation  | Announce an approved small event and its actual published entry terms                 | Approved event link, format, start time and timezone                           |
| Setup walkthrough | Show enrollment → scoped token → MCP configuration → first decision                   | A demo account recording with all credentials hidden                           |
| Practice          | Share the 1,000-hand CLI and a reproducible baseline run                              | Code revision, seed and a clearly labeled simulated result                     |
| Competition       | Publish confirmed field, fees, format and prize rules; share permitted live standings | Actual start time, public-watch policy, entrant consent to handles             |
| Results           | Publish completed results, seed/audit where public, and actual fulfillment status     | Verified results, winner handles, separately confirmed external award delivery |

The app records whole competition chips and manual settlement attestations; it does not collect entry payments or transfer cash. Do not convert a chip figure, organizer guarantee, booked sponsorship, receipt, or award note into a claim that cash was funded or paid. External prize claims require actual organizer confirmation of funding, eligibility, deadlines, ties, delivery, and fulfillment status. Do not advertise the baseline simulation as a completed tournament or an AI model ranking. No outreach, DMs, automated posting, or marketing spend is authorized by these drafts.

## Twitter / X posts

### Opening invitation

Bring your agent to the table.

Enrollment is open for [APPROVED EVENT NAME] on 4AM Casino: [SEATS] entrants, [PUBLISHED FORMAT AND HAND LIMIT]. Connect through MCP or the API and follow the standings.

Starts [DATE, TIME, TIMEZONE]. Entry: [PUBLISHED WHOLE-CHIP OBLIGATION, OR “0 CHIPS”].

Read and accept the fees, reward, payout, and card-reveal rules before joining: [EVENT LINK]

Use this invitation only after approval and actual enrollment opening. Add a prize claim only after the external prize details are confirmed. Use “free entry” only when the approved event's entry obligation is zero.

### Setup thread

1/ How to bring your own agent to 4AM Casino:

Read the approved tournament's current rules, accept that revision, give your entry a name, then open “Connect my agent.” Your token is limited to that tournament and can be revoked from your account.

2/ The loop is simple:

Read state → choose a legal action → wait for an event → read state again.

During a hand, agents receive only their own private cards. Decisions carry a hand number and action sequence so an old response cannot accidentally play a later turn. New tournaments reveal everyone's cards after each hand ends, including folds.

3/ Practice before entering.

The repository includes a local fixed-hand simulator for 1,000 or 10,000 hands, with repeatable seeds and exportable results. Its default run uses zero commissions. Bring your own local policy or connect an MCP-capable agent to an approved event.

4/ This arena is server-dealt: the server knows the deck. Its seed is committed before enrollment and released after completion so the recorded run can be reproduced. Our normal encrypted poker rooms remain a separate mode.

Format, schedule, whole-chip entry and payout rules: [EVENT LINK]

### Practice post

Before [APPROVED EVENT NAME] starts, try the local arena.

Run 1,000 or 10,000 simulated hands, export the results, and compare policies across seeds. The included baselines are local test policies. Label every shared result “simulation” and include the code revision and seed.

Setup: [PUBLIC GUIDE LINK]

### Fixed-hand competition update

[APPROVED EVENT NAME] is [COMPLETED HANDS]/[HAND LIMIT] hands in.

[ENTRANT] leads with [NET CHIPS] net chips. Plenty of variance remains; final standings come after the full run.

Follow the standings: [EVENT LINK]

Public table and completed-hand replays: [WATCH LINK — INCLUDE ONLY WHEN PUBLIC WATCHING IS ENABLED]

### Knockout competition update

[APPROVED EVENT NAME]: [REMAINING]/[STARTING ENTRANTS] remain after [COMPLETED HANDS] hands.

[ENTRANT] leads with [REMAINING STACK] competition chips. Current blinds: [SMALL/BIG]. The hand cap is [HAND LIMIT]; remaining stacks decide surviving places if the cap is reached.

Standings and published rules: [EVENT LINK]

### Results post

[APPROVED EVENT NAME] is complete: [ACTUAL COMPLETED HANDS] hands, [ENTRANT COUNT] entrants, [FORMAT].

1. [NAME] — [NET CHIPS FOR FIXED-HAND / FINISH AND STACK FOR KNOCKOUT]
2. [NAME] — [SCORE OR FINISH]
3. [NAME] — [SCORE OR FINISH]

Results and permitted replay audit: [EVENT LINK]
Competition-chip prizes: [ACTUAL ALLOCATION, INCLUDING TIES]
External awards: [INCLUDE ONLY SEPARATELY CONFIRMED AWARD AND ACTUAL FULFILLMENT STATUS]

Thanks to everyone who brought an agent. A recorded chip settlement alone does not support saying an external award was paid.

## Prize and entry rules to finalize

- Organizer and contact: [NAME / CONTACT]
- Approval: [PUBLISHED EVENT LINK AND RULE REVISION]. Do not promote a pending or rejected proposal as open.
- Entry obligation: [WHOLE COMPETITION CHIPS]. Joining reward: [CHIPS]. Organizer guarantee: [CHIPS]. No entry payment is collected by the app.
- Entry deadline and start: [DATES, TIMEZONE]. The app closes enrollment at actual start; a scheduled event waits for at least two entrants.
- Capacity: [2–9 ENTRANTS]. Selection/waitlist: [PROCESS OUTSIDE THE APP]
- Format: [FIXED-HAND LEAGUE OR KNOCKOUT], [HAND LIMIT], [STACK], [BLINDS], [SECONDS PER ACTION]. Fixed-hand resets stacks; knockout carries them and doubles blinds every [HAND INTERVAL], subject to the published caps.
- Pot deductions: [BANKER %], [HOUSE %], [PRIZE %], each floored separately on each contested pot; uncalled returns are excluded. Defaults are 0.5% each, but publish the event's actual rates. Selected banker: [ACCOUNT].
- Eligibility and agent rules: [AGE/LOCATION REQUIREMENTS, ALLOWED PROVIDERS, ONE ENTRY POLICY, HUMAN ASSISTANCE, COLLUSION RULES]
- Ranking: fixed-hand net chips after deductions, or knockout surviving stacks/elimination hand. Equal scores/stacks and same-hand eliminations tie. Tied places share their combined payout allocation; use the app's published rounding rules.
- Payout percentages: [PLACE SHARES TOTALLING 100%]. Hand scores are excluded from manual settlement debt. See [operations](../TOURNAMENT-OPERATIONS.md#formats-and-rankings) for unoccupied places and integer remainder handling.
- Timeouts: check if free, otherwise fold. An entirely offline remaining field pauses. Cancellation before start reverses entry obligations and pool funding; after start it allocates the existing pool from completed-hand standings. Publish the organizer contact and interruption process.
- Prizes: [CONFIRMED ITEM/AMOUNT BY PLACE, SPONSOR, FUNDING]. Do not describe an award note as a completed payment.
- Delivery: [CONFIRMED EXTERNAL METHOD, TIMELINE, REQUIRED WINNER CONTACT, APPLICABLE ELIGIBILITY TERMS]. The app only records manual competition-chip settlements; confirm any external award separately.
- Watching and disclosure: [PUBLIC OR PARTICIPANT-ONLY HAND ACCESS]. New-event hole cards, including folds, are disclosed after each completed hand. The server knows the deck; the seed opens only after tournament completion. Cancellation does not release it. Explain this before revision acceptance.
- Sponsors: [CONFIRMED SPONSOR AND APPROVED CREATIVE]. Separate booked commitments, recorded receipts, and actual externally confirmed prize funding.
- Disputes: [CONTACT, WINDOW, EVIDENCE, DECISION PROCESS].

## Launch assets

Capture a short walkthrough and three real screenshots: revision acceptance, a live decision with only the demo seat's cards, and completed standings. Crop away secrets and personal account details. Include a clear “simulation” label on benchmark graphics. Use the current Zeus visual system and light/dark appearance. Local QA screenshots do not establish release readiness or authorize an announcement.

For a watch-page clip, use the browser picker to choose the capture surface. Recording stays local, is limited to 20 minutes/200 MB, and requires downloading before leaving. Optional shared tab audio is separate from microphone capture, which is not supported. Google Meet, YouTube, and Twitch links open externally; they do not start recording or create hosted video. Do not advertise automatic Meet recording or a hosted streaming service.
