# 4AM Casino — Design Spec

Date: 2026-08-23
Status: Approved approach (mental poker, TypeScript monorepo). This document is the source of truth for the MVP.

## 1. What we're building

An open-source, self-hostable web app for playing **no-limit Texas Hold'em** with friends, where **no party — not even the server operator — can ever see a card they shouldn't**. Card secrecy comes from a mental-poker protocol executed in the players' browsers; the server is a coordinator/relay that never holds card plaintexts or the deck order.

Points (chips) are **play money tracked as an IOU ledger**: players buy points from a bank, a designated **banker approves** each purchase, and every movement is written to an **append-only, hash-chained ledger** so the group can settle up outside the app. No real payments, ever.

### Goals
- 2–9 players per table, no-limit Texas Hold'em with host-configurable blinds.
- Card privacy from everyone including the host (mental poker, detect-and-attribute threat model).
- Auditable: every hand produces a signed transcript; the ledger is tamper-evident.
- Join by link from phone or laptop; clean, minimal shadcn-style UI.
- Simple to self-host: one Node process + SQLite file.

### Non-goals (MVP)
- Real-money payments, tournaments/sit-n-gos, other poker variants, mobile apps, ZK shuffle proofs (see §4 threat model). (Simple in-table text chat IS in scope — see §7.)

## 2. Architecture

Single repo, npm workspaces, TypeScript everywhere:

```
4amcasino/
  packages/shared/         # domain types, WS message schemas, card codec, hand evaluator
  packages/mental-poker/   # the crypto protocol: masking, shuffling, unmasking, transcripts
  apps/server/             # Fastify + ws: auth, rooms, bank/ledger, betting engine, relay
  apps/web/                # Vite + React, Feature-Sliced Design, Tailwind + shadcn/ui
  docs/superpowers/specs/
```

- `packages/mental-poker` is pure TS, isomorphic (browser + Node), depends only on `@noble/curves` + `@noble/hashes`. It is the security-critical unit and gets the heaviest testing.
- `packages/shared` has zero runtime deps; both apps import it.
- The server never imports card-decryption capabilities; it only validates message shapes, order, and signatures.

## 3. Mental poker protocol

Group: **ristretto255** (prime-order, via `@noble/curves`). All keys are **per-hand ephemeral scalars**; each player also holds a long-lived **ed25519 identity key** (generated at account creation, private key stays in the browser) used to sign every protocol message.

**Card encoding.** The 52 cards map to fixed public curve points via hash-to-group of their canonical names (`"As"`, `"Td"`, …). The mapping is deterministic and part of `packages/shared`.

**Shuffle-mask phase (start of each hand).** The deck starts as the canonical 52 points. In seat order, each player multiplies every point by their secret hand-scalar `k_i` and applies a private random permutation, then broadcasts the resulting deck (via the server relay). After all players have gone, the deck is masked by the product of all keys and permuted by the composition of all permutations — its order is unknown to every party.

**Dealing a hole card.** For the card at a given deck index, every player *except the recipient* publishes their partial unmask (multiplication by `k_i⁻¹`) of that point, in any order. The recipient applies their own `k_i⁻¹` **locally, last** — so only they learn the card. Observers see a point still masked by the recipient's key; under DDH this reveals nothing.

**Community cards.** All players publish their partial unmasks; the resulting plaintext point is looked up in the canonical mapping. Anyone can verify.

**Showdown.** Players still in the hand reveal their hole cards by publishing their own final unmask for those two indices. Every client and the server independently evaluate the 7-card hands and must agree on the winner before the pot moves.

**Transcript.** Every protocol message (deck states, unmask shares, betting actions) is signed by its sender and folded into a running hash. At hand end, all parties sign the final transcript hash. Transcripts are persisted server-side and downloadable.

**Post-hand audit.** Two table modes, set at room creation:
- `private` (default): hand keys are revealed only on dispute or abort. Mucked/folded cards stay secret forever.
- `strict-audit`: every player reveals their hand-scalar `k_i` after each hand; anyone can then re-derive the entire shuffle and verify every step. (Folded hole cards become public after the hand — the table opts into this trade.)

**Abort & rollback.** Dealing requires cooperation from all seated players. If a player fails to produce a required protocol message within the timeout (disconnect or stall), the hand **aborts**: all stacks roll back to their start-of-hand values, the offender is force-revealed in the transcript as the cause, and the next hand deals without them (they sit out until they return). Aborts are recorded in the room log.

## 4. Threat model (explicit)

- **Server operator**: cannot see any card, ever — cards exist only masked under keys the server never has. Server *can* deny service or misorder messages; signatures + transcript hashes make tampering evident to clients.
- **Malicious player**: cannot learn others' cards (DDH). Can mis-shuffle (e.g., duplicate an unknown card); this is **detected** when an unmask yields a point outside the canonical 52, a duplicate appears among revealed cards, or in `strict-audit` mode at the end of every hand — and **attributed** via the signed transcript. This is detect-and-attribute, not ZK-prevented; accepted trade for a friends game (documented in README).
- **Collusion out-of-band** (friends sharing screens): out of scope — no protocol prevents it.

## 5. Bank & ledger

- **Roles**: room creator is the **host/banker** by default and may transfer the role.
- **Buying points**: any player submits a buy request (amount + optional note). The banker approves or rejects. On approval, points are credited **directly to the player's table stack** (between hands only — never mid-hand; requests during a hand queue until it ends).
- **Ledger**: append-only SQLite table. Each entry: `id, timestamp, room, player, delta, kind (purchase | hand-settlement | correction), approved_by, note, prev_hash, entry_hash` where `entry_hash = H(prev_hash ‖ entry-fields)`. Hand settlements (pot movements) are written automatically per hand, referencing the hand transcript hash. Anyone in the room can view the full ledger and per-player net totals ("who owes whom") at any time; the chain makes retroactive edits evident.

## 6. Server

- **Stack**: Node 22+, Fastify (HTTP: auth, room CRUD, ledger reads) + `ws` (gameplay), `better-sqlite3` (single file DB), all TypeScript.
- **Auth**: username + password (Node built-in `scrypt`), opaque session tokens stored server-side. On first login the client generates its ed25519 identity keypair; the public key is registered with the account.
- **Rooms**: created with settings `{ small blind, big blind, min/max buy-in (optional), audit mode }`. Join by invite link (room id + join code). Seats 2–9.
- **Betting engine**: authoritative server-side state machine for everything *public*: turn order, blinds, check/bet/call/raise/fold legality, min-raise rules, all-ins and side pots, pot distribution at showdown. Pure, synchronous, exhaustively unit-tested module. Clients also run it locally to render instantly and to verify the server.
- **Relay**: WS hub per room; validates sender, seat, sequence number, and message schema, persists to transcript, broadcasts. Never interprets card contents.

## 7. Web app (Feature-Sliced Design)

- **Stack**: Vite, React 18, TypeScript, Tailwind, shadcn/ui, zustand for state.
- **Design language**: minimal, flat, light theme per the reference at `docs/design/reference-table.png` — light blue-gray background, white surfaces, a single indigo accent. No felt ellipse or skeuomorphism. Table layout follows the reference: opponents as a vertical list of rows on the left (avatar, name, stack, last action, two face-down cards); large white community cards centered with a pot pill above; your own row (stack + face-up hole cards) below the board; a full-width indigo action bar at the bottom (current bet, chip denominations, bet slider from 0 to all-in, Fold/Call/Raise buttons, your balance); timer pill and room info in the header; collapsible chat sidebar on the right (plain text chat over the room WS, stored in transcript as unsigned chatter — not part of game state).

```
apps/web/src/
  app/        # router, providers, global styles, WS bootstrap
  pages/      # login, lobby, table, ledger
  widgets/    # poker-table (felt, seats ring, board, pot), action-bar, bank-panel, ledger-table, hand-history
  features/   # auth, create-room, join-room, betting-actions, buy-points, approve-purchase, reveal-showdown
  entities/   # player, card, hand, room, ledger-entry (model + UI atoms like <PlayingCard/>)
  shared/     # ui (shadcn), api client, ws client, mental-poker glue, lib, config
```

Key screens: **Lobby** (create/join room, room list), **Table** (seats ring with stacks/dealer button/turn timer, your hole cards, board, pot, action bar with bet slider, buy-points button, banker's approval inbox), **Ledger** (chain view + per-player net totals + hand history with transcript download).

## 8. Error handling

- WS disconnect: 30 s grace to reconnect and resume (session token + room state resync). Past grace during a hand → protocol timeout → hand abort + rollback (§3).
- Any transcript signature/sequence mismatch → client surfaces a tamper warning and freezes the table until resolved.
- Ledger writes are transactional with the hand settlement; a crashed server resumes from the last completed hand (in-progress hand aborts on restart).
- Evaluator disagreement between server and any client at showdown → hand freezes, transcript exported, table alerted (this should be impossible; treat as a bug alarm).

## 9. Testing

- `mental-poker`: vitest — full-hand round-trips for 2–9 players, commutativity properties, tamper cases (duplicated card, wrong unmask share, forged signature) must be detected and attributed, deterministic vectors for cross-checking.
- `shared` hand evaluator: exhaustive category tests + known tricky boards (wheel straights, split pots, board-plays, kickers), fuzz vs. a naive reference implementation.
- Betting engine: unit tests for every rule (min-raise, incomplete raise, side pots, heads-up blind order) + scripted full-hand scenarios.
- Integration: headless test driving the real server with N simulated WS clients (each running real crypto) through complete hands, aborts, and reconnects.
- Web: smoke/render tests for widgets; the game logic itself lives in tested packages.

## 10. Milestones (each = at least one commit)

1. Monorepo scaffold: workspaces, TS config, eslint/prettier, vitest, CI-ready scripts.
2. `packages/shared`: card codec, domain types, WS message schemas, hand evaluator (+tests).
3. `packages/mental-poker`: group ops, shuffle/mask/unmask, signatures, transcript (+tests).
4. `apps/server`: auth, rooms, bank + hash-chained ledger (+tests).
5. Betting engine (+tests).
6. Protocol orchestration end-to-end: headless integration test playing full hands over WS.
7. `apps/web` scaffold: FSD skeleton, Tailwind + shadcn, auth + lobby.
8. Table UI: felt, seats, cards, action bar — playable game.
9. Bank & ledger UI: buy flow, banker approvals, ledger + hand history views.
10. Audit tooling (transcript verify page), README, LICENSE (MIT), self-host docs.
