# Tournament Rules — Design Spec

Date: 2026-09-14
Requested by: **notpritam**
Status: Rules approved (§2) and implemented (§3). Surface unification (§4) remains a separate design pass.

This document defines the competition rules for 4AM Casino tournaments. It supersedes the rule
statements in [Tournament operations](../../TOURNAMENT-OPERATIONS.md) where the two disagree;
that runbook has been updated to describe these rules as implemented.

## 1. Why this exists

Tournaments today run on a separate surface from ordinary play. The table room, table UI and 3D
lounge are driven by `apps/server/src/rooms.ts` and `apps/server/src/game.ts`; tournaments run on
a server-dealt arena in `apps/server/src/tournaments.ts` over `packages/shared/src/arena.ts`, with
their own pages under `apps/web/src/pages/tournaments/`. The two engines have drifted, and the
tournament rules that exist are stricter and shaped differently than intended.

This spec fixes the rules first. Unifying the play surface is scoped separately in §4.

## 2. The rules

Format: **freezeout, entry-fee-as-stack, winner-takes-chips, commission side-pool.**

### 2.1 Entry and registration

- One entry per player, ever. No re-entry, no re-buy, no add-on.
- Registration closes at start. The `registration` → `running` transition is a hard door.
- Withdrawal is permitted before start only, and reverses the entry obligation.

### 2.2 Your entry fee is your stack

Paying entry fee _N_ seats a player with exactly _N_ tournament chips. There is no separate
starting-stack setting; the fee **is** the stack.

Every chip on the table therefore originated from an entry fee, and chips in play form a closed,
zero-sum loop among entrants.

Bounds are inherited from the arena engine (`packages/shared/src/arena.ts:53-59`): a stack must be
at least `2 × bigBlind` and at most 1,000,000 chips. Entry fees currently admit up to
1,000,000,000, so **the published entry-fee range must be clamped to the stack range** — otherwise
a legal fee produces a round the engine rejects.

### 2.3 Elimination

- A stack reaching zero eliminates that player permanently. There is no return path.
- Elimination order is recorded; busting later ranks higher.
- Players busting in the same hand tie, broken by their stack at the start of that hand.

### 2.4 Sit-out, and required participation

A player may not sit out the tournament and wait for the field to collapse. Participation is
compulsory, enforced by a budget rather than by ejection.

- A tournament publishes `sitOutBudget` — total hands a player may sit out, default **10** — and
  `maxSitOutPerRequest`, default **5**.
- A player declares a sit-out of _N_ hands, where _N_ is at most `maxSitOutPerRequest` and at most
  their remaining budget. They return automatically when it expires.
- **A sitting-out player is still dealt in, still posts blinds, and auto-folds.** This is what makes
  the rule bite: a coasting player bleeds down at the current blind level.
- Once the budget is exhausted, further sit-out requests are refused with 409. The player remains in
  the tournament and ordinary action timeouts auto-fold in place.
- **No player is ever eliminated for sitting out.** A disconnect costs chips, never the tournament.

### 2.5 Ending and payout

- Play runs until **one player holds every chip**. That survivor keeps the whole stack — the sum of
  all entry fees, less commission taken along the way.
- 2nd and 3rd place are the last two players eliminated.
- Commission skimmed from each pot at `prizeBps` accumulates into a side pool, paid **50 / 30 / 20**
  to the top three: `payoutBps = [5000, 3000, 2000]`.
- 2nd and 3rd receive the bonus only, and no chips. The flat split is deliberate — it is the entire
  reward for finishing near the top, since the winner takes every chip in play.
- The separate `houseBps` skim is house income and never enters the bonus pool.

### 2.6 Backstops

Two cases the rules above do not reach on their own:

- **Hand cap.** A tournament carries a `handLimit` of 10–10,000 hands. If the cap is reached while
  several players still hold chips, play stops, survivors rank by stack, every survivor keeps the
  stack they hold, and the top three by stack take the bonus. Without this an unresolved tournament
  could never settle.
- **Fields under three.** A two-entrant field has no third place. The existing engine normalizes the
  unoccupied payout weight, so 50/30/20 becomes a 62.5 / 37.5 split of the bonus. This behaviour is
  retained unchanged.

### 2.7 Consequence to be explicit about

Because the winner takes every chip, a tournament is a pure redistribution among entrants — a field
of nine funds one. Platform revenue comes entirely from the `houseBps` skim, never from entry fees.
This is a deliberate and coherent model, but it is a different business shape than "the house keeps
the entry fees," and it should not be discovered by surprise later.

## 3. Implementation

### 3.1 Policy surface

`packages/shared/src/tournamentPolicy.ts` changes:

| Field                 | Today                           | Under these rules                                             |
| --------------------- | ------------------------------- | ------------------------------------------------------------- |
| `payoutBps`           | `[6000, 3000, 1000]`            | `[5000, 3000, 2000]`                                          |
| `format`              | `fixed-hand-league \| knockout` | adds a third value, `freezeout`; the other two are unaffected |
| `sitOutBudget`        | absent                          | new, default 10, range 0–200                                  |
| `maxSitOutPerRequest` | absent                          | new, default 5, at most `sitOutBudget`                        |
| entry fee range       | 0–1,000,000,000                 | clamped to the arena stack range (§2.2)                       |

`startingStack` stops being independently settable for freezeout tournaments; it is derived from
`entryFee`. It remains as-is for fixed-hand leagues, which reset stacks every hand.

**Implementation note — why `freezeout` is a new format value rather than a redefinition of
`knockout`.** The original §3 proposed treating freezeout as the knockout path. That would have
changed the published meaning of terms that are already locked: a tournament whose entrants accepted
knockout terms would silently start behaving differently, which the terms lock exists to prevent.
Freezeout is therefore a third `format` value. Knockout keeps the behaviour it published, and
`carriesStacks()` in `packages/shared/src/tournamentPolicy.ts` is the single predicate both formats
share for stack carry, button advance, blind escalation and stack-based ranking.

### 3.2 Server

- `apps/server/src/tournaments.ts` — derive the round stack from the entry fee in `freshRound`;
  add the sit-out request route, counter, and auto-return; change the end condition to a single
  survivor with the hand-cap backstop.
- `apps/server/src/tournamentEconomy.ts` — the entry fee no longer credits the prize pool. The pool
  is funded by `prizeBps` skim, sponsor contributions, and any guarantee. `completePrizes` keeps its
  largest-remainder allocation and tie handling.
- Schema: `tournament_entries` gains `sat_out_hands` and `sit_out_until_hand`, added idempotently in
  `initializeTournamentOperations`.
- `POST /api/tournaments/:id/sit-out` accepts `{hands}` from an entrant or a scoped seat grant — the
  same authentication `/actions` uses, because sitting out is a play decision, not administration.
  When the turn is already on the requester, the deadline moves to now so the existing timer folds
  them on the next tick instead of stalling the table.
- `apps/web` — `TournamentTerms` publishes and edits the sit-out fields and the freezeout format,
  `TournamentsPage` gives an enrolled player a sit-out control showing their remaining budget, and
  both standings views rank a freezeout by stack. `apps/mcp` gains `tournament_sit_out`.

### 3.3 Migration

Existing revision-0 leagues keep approved status, free entry, zero pot deductions and their original
disclosure, exactly as they do now. They are not converted. New rules apply to new terms only, and a
terms update to an existing proposal creates a new revision that must adopt them.

## 4. Open scope question — the play surface

The rules above are surface-independent. Moving tournaments onto the shared table room, table UI and
3D view is a second, larger piece of work: it means running a tournament through the room engine
(`rooms.ts` / `game.ts`) rather than the arena, while preserving the arena's server-dealt seed audit,
scoped agent access, event subscriptions and spectator surface.

That work is **not specified here** and needs its own design pass. This spec should be treated as the
rules definition it is, and the surface unification brainstormed separately once these rules are
settled.

## 5. Review checklist

- [x] No placeholders or TBDs
- [x] Rules internally consistent: freezeout entry, zero-stack elimination, single survivor, and the
      commission side-pool agree with each other and with §2.7
- [x] Ambiguities resolved explicitly: join-once (not late registration), play-to-one (not last
      three), bonus split totalling 100
- [x] Scope bounded: rules only; play-surface unification deferred to §4
