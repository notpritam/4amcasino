# Tournament operations

This runbook describes the current checkout. Implementation and integration QA are separate from deployment; nothing in this document confirms a live launch, a funded external prize, or a completed payment. The participant and agent contracts are in [Agent Arena](AGENT-ARENA.md).

## Runtime administration

The platform account manages tournaments in `/admin/tournaments`, or `/tournaments` on `admin.4amcasino.com` when that admin host is deployed. The section contains tournament review and controls, published terms, earnings and manual settlement records, sponsor campaigns and receipts, and broadcast links. These are persisted runtime settings; changing them does not require editing source code or rebuilding the site.

Members can create and revise their own proposals. Only the platform approves/rejects proposals, manages sponsor campaigns, changes broadcast links after terms lock, or records settlement receipts. A platform account cannot enter the competition; use a player account for human or agent play. Scoped agent grants cannot administer tournaments, accept terms, or record payments.

## Approval, revisions, and starts

1. A member creation produces `status: pending`, `approvalStatus: pending`, and `revision: 1`. Only the owner and platform can read the proposal. A platform creation publishes immediately as approved registration.
2. The platform reviews the exact current revision. Approval opens registration; rejection closes enrollment and leaves the proposal available to its owner for revision. A stale or already reviewed request returns 409.
3. Before any enrollment, the owner/platform can update terms with the current `revision`. The revision increments; a member edit requires approval again, while a platform edit publishes directly. A rejected proposal is resubmitted through this same terms update.
4. Every new entrant sends `acceptedRevision` equal to the published `revision`. The first successful enrollment permanently locks the game settings, schedule, fees, rewards, guarantee, payouts, and watching policy. Withdrawal does not unlock them. Start also locks terms. Create a new tournament to offer different locked rules.
5. The owner/platform may start an approved registration with at least two entrants. A non-null `startsAt` is UTC Unix milliseconds. Once due, the server also starts it automatically when at least two entrants exist; with fewer, it remains in registration and reports a `scheduleNote`. This is a start trigger, not an automatic enrollment-close deadline.

The server checks due schedules and decisions every second. Stored schedules, rounds, and deadlines recover from SQLite after restart. Manual start is available before a scheduled time, so communicate any organizer change of start clearly. A scheduled-start error records its reason instead of silently claiming the event started.

An expired decision checks when free and otherwise folds. At a due decision, 90 seconds without presence from any remaining competitor pauses the event. Participant state reads, actions, and event subscriptions maintain presence; anonymous watching does not. The owner/platform can pause/resume and must pause a running tournament before cancellation.

Platform broadcast-link updates are an explicit exception to the terms lock: they keep the accepted revision and append an administrative review record. They cannot change the game or economic policy. Approval, terms updates, and broadcast-link changes have immutable review rows.

## Published policy

| Field                                         | New-event default and constraints                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `format`                                      | `fixed-hand-league`, `knockout` or `freezeout`; default fixed-hand                                                   |
| Seats / hand limit                            | 2–9 seats; 10–10,000 hands                                                                                           |
| Stack / blinds                                | Stack 100–1,000,000; small blind 1–10,000; big blind 2–20,000, at least the small blind; stack covers two big blinds |
| `actionSeconds`                               | 10–300; default 60                                                                                                   |
| `startsAt`                                    | `null` for manual start, or UTC Unix milliseconds                                                                    |
| `entryFee`, `joiningReward`, `guaranteedPool` | Whole chips, 0–1,000,000,000 each; default 0. A freezeout `entryFee` is the stack, so it must be 2×bb–1,000,000      |
| `sitOutBudget`, `maxSitOutPerRequest`         | Hands one entrant may sit out in total and in one request; defaults 10 and 5; 0–200, per-request at most the budget  |
| Guarantee coverage                            | `guaranteedPool >= capacity × joiningReward`, even before all seats fill                                             |
| `houseBps`, `prizeBps`                        | Default 50 each: 0.5% per recipient. Each rate permits 0–1,000 basis points (0–10%)                                  |
| `payoutBps`                                   | Default `[5000, 3000, 2000]` (50/30/20); 1–9 positive integer shares totalling 10,000                                |
| `blindEveryHands`                             | Default 20; 1–10,000; applies to knockout and freezeout                                                              |
| `publicWatch`                                 | Default `true`; controls hand-state/results/replay/audit access                                                      |
| `revealAllAfterHand`                          | Required `true` for new terms; includes folded hole cards                                                            |
| `streamUrl`, `meetUrl`                        | Empty or supported HTTPS external links                                                                              |

Existing revision-0 leagues retain approved status, fixed-hand stack resets, free entry, zero pot deductions, and their original showdown disclosure. They are not silently converted to the new defaults. An explicit permitted pre-entry terms update creates a new revision and requires the new reveal policy; existing entries keep terms locked.

## Formats and rankings

Fixed-hand leagues reset every entrant to the starting stack for every hand and rotate the button. Rank uses accumulated hand net after pot deductions. Equal net scores share rank. The displayed BB/100 uses the starting big blind; it is a scoring statistic, not a settlement amount.

Freezeout tournaments are the current competition format. One entry per player, with no re-entry, re-buy or add-on, and registration closes at start. The entry fee **is** the starting stack, so every chip in play originated from an entry fee and the chips form a closed, zero-sum loop among entrants. A zero stack eliminates that entrant permanently. Play runs until one entrant holds every chip; that survivor keeps the whole stack. Second and third place are the last two eliminated and receive only their share of the commission bonus pool. If the hand cap is reached first, play stops, survivors rank by stack, every survivor keeps the stack they hold, and the top three by stack take the bonus. Otherwise freezeouts follow the knockout rules below for stack carry, button advance and blind levels.

Sitting out is bounded so nobody can fold-and-wait for the field to collapse. An entrant declares a sit-out of at most `maxSitOutPerRequest` hands, limited by what remains of `sitOutBudget`, and returns automatically when it expires. A sitting-out entrant is still dealt in, still posts blinds and auto-folds, so coasting costs chips at the current blind level. Once the budget is spent, further sit-out requests are refused with 409 and ordinary action timeouts auto-fold in place. No entrant is ever eliminated for sitting out, so a disconnect costs chips rather than the tournament. Sitting out is a play decision: a scoped seat grant may request it, exactly like acting.

Knockout tournaments carry each ending stack into the next hand, remove zero-stack entrants, and advance the button to the next surviving entrant in original enrollment order. Blinds double every `blindEveryHands`: level multiplier is `2 ** min(16, floor((handNumber - 1) / blindEveryHands))`, and each blind is capped at 9,000,000 chips. Play ends when at most one entrant has chips or the hand cap is reached. Remaining entrants rank by stack; equal stacks tie. Eliminated entrants rank by elimination hand, later first; elimination in the same hand ties.

For both formats, tied ranks combine their occupied payout-place weights and split that allocation equally. Integer prizes use largest-remainder allocation: payout groups break equal remainders by better rank, and members of a tied group by lower user ID. Unoccupied payout places are omitted and occupied weights are normalized, so a two-player field with the default 60/30/10 policy divides the pool in a 60:30 ratio. A tied group can include an otherwise unpaid place. The full recorded pool is allocated once.

## Competition-chip accounting

Every amount is **whole competition chips**. The tournament journal is separate from ordinary room balances, room rake, room settlements, and cash. There is no payment-provider collection, withdrawal, card charge, bank transfer, or hosted payout. A guarantee is a recorded organizer commitment; a sponsor receipt or settlement is a platform attestation of a manual chip movement. Do not label these records as verified cash.

| Event                          | Journal behavior                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| First enrollment               | Records the guarantee once; debits the entrant's entry obligation and credits the pool                           |
| First enrollment (freezeout)   | Records the guarantee and opens the enrollment cycle, but moves no value: the fee buys chips instead of the pool |
| Withdrawal during registration | Reverses that enrollment's entry obligation; re-entry opens a new cycle                                          |
| Start                          | Ensures the guarantee exists and pays each enrolled player's joining reward from the pool once                   |
| Completed hand                 | Records each player's hand net plus house and pool deductions in one balanced transfer                           |
| Sponsor prize contribution     | Credits the chosen tournament's pool in the same transaction as its immutable sponsor receipt                    |
| Completion                     | Allocates the remaining pool by standings and published payout weights once                                      |
| Cancellation before start      | Reverses entry obligations and recorded guarantee/sponsor pool funding; no joining reward vests                  |
| Cancellation after start       | Allocates the existing pool by current completed-hand standings; rewards and completed-hand fees remain recorded |

Cancellation after start excludes the unfinished hand from scoring and fees. It does not invent a final hand result or release the seed. Funding reversals on pre-start cancellation do not erase sponsor receipts or execute a refund outside the app.

Pot deductions apply once to each **contested settled pot**, including side pots. First remove any unmatched contribution returned to a player. For each remaining pot and each recipient, use `floor(potChips × rateBps / 10000)`, then award the remaining pot. Fold-ended hands still have a contested matched portion. No fee applies to the uncalled return. At the default rates, a 1,001-chip contested pot allocates 5 chips each to house and pool; 991 go to the winner(s). These floors happen per pot and per recipient, not once on the entire session's volume.

The journal enforces balanced transfers, nonnegative pool balances, and stable transaction references. Retrying an identical operation is idempotent; using the same reference for different accounting data is rejected. Persisted receipts and journal history are not edited to make totals appear reconciled.

## Earnings and manual settlements

Participants see entry obligations, joining rewards, prizes, hand net, recorded paid, and outstanding balances in the tournament earnings views. Bankers and organizers receive no commission.

```text
settlementNet = joiningReward + prize - entryFee   # fixed-hand league and knockout
settlementNet = joiningReward + prize + playNet    # freezeout
outstanding   = settlementNet - recordedPaid
```

For fixed-hand leagues and knockouts, `playNet` is displayed separately and excluded from settlement debt, and a knockout finishing stack is not automatically cashable. A freezeout is the exception: the entry fee bought those chips, so the finishing stack is the prize and play net carries the settlement. Because the fee is already paid in chips, a freezeout entry records no pool obligation, and `entryFee` in the earnings rows is zero. House income and remaining pool are separate administrative totals.

Only the platform records settlement receipts, after status is `completed` or `cancelled`. Positive amounts attest to chips paid to the account; negative amounts attest to chips collected from it. The amount must have the outstanding balance's direction and cannot exceed its magnitude. Use a unique `requestId` and a concrete receipt note. Retry an uncertain response with the identical ID and body; changed content returns 409. Records are immutable. An award note is independent commentary and does not change earnings or prove prize delivery.

## Sponsors and advertising

The platform creates plain-text sponsor campaigns for `directory`, `tournament`, or `watch` placements. Each has a sponsor name, headline, description, safe public HTTPS destination, optional tournament target, active flag, and start/end time. Creative is visible only in the active date window; tournament targets must be approved, and watch placements also require public watching. No arbitrary HTML, injected tracking scripts, or server-side fetching of the destination is supported.

The admin view separates **booked chips**, **recorded received chips**, and the portion earmarked for tournament prizes. Bookings are editable with the campaign revision but cannot fall below existing receipts. A receipt has a positive whole-chip amount, an immutable request ID/body, optional prize contribution no larger than that receipt, and a note. Receipts cannot exceed the current booking. A campaign with receipts cannot be deleted; disable its placement instead. Campaign edits and receipt creation advance the campaign revision.

A positive prize contribution needs an approved tournament in registration, running, or paused status. The target can be explicit in the receipt or inherited from the campaign. Receipt and pool funding commit atomically, so retrying does not add the contribution twice. Contributions to completed/cancelled events are rejected. Public placement payloads contain creative only, without booking totals, receipt records, or private notes. Manually recorded sponsor income is not payment-processor confirmation.

## Watching, replay, and local recording

`/tournaments/:id/watch` is an anonymous spectator surface for approved public-watch events. It shows public table state, standings, completed-hand cards, recorded actions, and eligible sponsor placements. It never supplies live hole cards, a future deck, or an early seed. New rules reveal all hole cards after each completed hand, including folded cards. The seed and complete audit open only on tournament completion; cancelled events retain the seed.

For private watching, the approved event's summary/rules/standings remain discoverable, but hand state, results, replays, and seed audit require an entitled organizer, platform account, entrant, or matching entrant grant. The dedicated watch endpoint is always anonymous and rejects private events. Accessing it with credentials does not switch it into the participant view. Pending/rejected proposals remain owner/platform-only.

Completed-hand replay uses `GET /api/tournaments/:id/hands/:hand`, returning `{result, actions}` only after that hand is persisted. Actions contain `userId`, `actionSeq`, `action`, `timedOut`, and `ts`. `/results?after=<handNumber>` paginates 100 completed results; `/audit?after=<cursor>` paginates 500 actions after the tournament completes. See [the audit instructions](AGENT-ARENA.md#completed-hand-audit) for policy-aware reproduction.

YouTube/Twitch stream links and Google Meet links open external services. Supported stream hosts are `youtube.com`, `www.youtube.com`, `youtu.be`, `twitch.tv`, and `www.twitch.tv`; Meet uses `meet.google.com`. Links must use HTTPS without credentials or non-default ports. The app does not create a meeting, start a stream, embed a hosted player, store video, or automatically record Meet.

To create a local clip, select **Record tab** and choose the tab, window, or screen in the browser's own picker. The recorder captures only the chosen surface. Audio is off by default; opting in permits available shared **tab audio** only. It does not capture the microphone or retain screen/window audio. Missing tab audio produces a video-only clip.

Clips stop at 20 minutes or near the 200 MB limit and become downloadable WebM/MP4 files, depending on browser support. A chunk that exceeds the hard size limit discards the clip and reports the failure. Stopping capture or ending browser sharing stops the tracks. Download before leaving or starting another recording: the file is held locally in memory, previous download URLs are revoked, and leaving cleans up tracks/timers without uploading or saving a hosted copy. Unsupported recording, denied permission, empty capture, and recorder failures have explicit UI states. Browser capture permissions and support remain browser-dependent.

## Administration HTTP contract

Use the normal account's bearer token; every `/api/admin/...` route below requires the platform account. Bodies contain whole-chip integers and UTC-millisecond timestamps. Errors are `{ "error": "..." }`; 409 indicates a stale revision, conflicting retry, or invalid lifecycle transition.

| Route                                                 | Request / response                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/admin/tournaments`                          | Latest 200 tournament summaries, all earnings rows, and house/pool/prize/recorded-paid totals                                  |
| `POST /api/admin/tournaments/:id/review`              | `{revision, approve, note}`                                                                                                    |
| `GET /api/admin/tournaments/:id/audit`                | `{reviews, settlements}`; administrative history, not the seed audit                                                           |
| `POST /api/admin/tournaments/:id/settlements`         | `{userId, amount, requestId, note}`                                                                                            |
| `GET /api/me/tournament-earnings`                     | Own `{earnings}`; available to normal accounts                                                                                 |
| `PUT /api/tournaments/:id/terms`                      | Owner/platform; `{revision, ...changedSettings, policy: {...changedPolicy}}` before terms lock                                 |
| `PUT /api/tournaments/:id/media`                      | Platform; `{streamUrl, meetUrl}`; audited update, including after terms lock                                                   |
| `POST /api/tournaments/:id/control`                   | Owner/platform; `{action: "start" \| "pause" \| "resume" \| "cancel"}`                                                         |
| `POST /api/tournaments/:id/sit-out`                   | Entrant or scoped seat grant; `{hands}`; running events only; 400 over the per-request cap, 409 once the budget is spent       |
| `GET /api/admin/sponsors`                             | `{campaigns, totals: {booked, received, prizeContributions}}`                                                                  |
| `POST /api/admin/sponsors`                            | Complete campaign body below; returns campaign and revision                                                                    |
| `PUT /api/admin/sponsors/:id`                         | Complete campaign body plus current `revision`                                                                                 |
| `DELETE /api/admin/sponsors/:id`                      | `{revision}`; only if no receipts exist                                                                                        |
| `POST /api/admin/sponsors/:id/receipts`               | Receipt body below; identical retry returns the original receipt                                                               |
| `GET /api/sponsors?placement=watch&tournamentId=<id>` | Public creative projection; `placement` is `directory`, `tournament`, or `watch`; non-directory placement requires an event ID |

Campaign body:

```json
{
  "tournamentId": null,
  "name": "Confirmed sponsor name",
  "headline": "Approved placement headline",
  "description": "Approved plain-text description",
  "destinationUrl": "https://example.com/",
  "placement": "directory",
  "startsAt": 0,
  "endsAt": 1,
  "active": false,
  "bookedAmount": 0,
  "note": "Replace the inactive example window and confirmed booking before use."
}
```

Receipt body (replace the identifiers and amounts with the actual manual record):

```json
{
  "requestId": "unique-sponsor-receipt-reference",
  "amount": 1000,
  "prizeContribution": 500,
  "tournamentId": "approved-tournament-id",
  "note": "Manual competition-chip receipt reference and source."
}
```

Record only amounts supported by the organizer's actual manual records. API acceptance confirms a database entry, not external collection or prize fulfillment. Event topics, scoped MCP limits, and signed relay delivery are documented in [Agent Arena](AGENT-ARENA.md#events-and-subscriptions). No dedicated sponsorship, settlement, or broadcast-link event topics currently exist; administrative views refresh their APIs.
