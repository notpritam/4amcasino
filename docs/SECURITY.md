# Security

An audit of 2026-08-27 read the codebase line by line across four areas: auth and
accounts, the chip economy, the game protocol, and the web client. This file
records what was fixed and — more importantly — what is still open, so nobody has
to rediscover it.

## Fixed

**Money**

- Buy-ins and transfers had no upper bound. Around ten buys of `1e18` pushed
  `room_players.stack` past 2^63, SQLite silently retyped the column value to
  REAL, and from then on every debit rounded away to nothing while every credit
  landed — an unlimited chip faucet reachable by anyone at a table with
  auto-approve on. Both are now capped at `LIMITS.maxChipAmount`.
- Voiding a hand reversed the settlements but not the 1% commission, so each void
  minted the rake out of nothing. The reversal now covers `commission` too.
- `revert` and `void-hand` ran during a live hand. Chips at risk are held in
  memory, not deducted from the stack, so both passed their own solvency checks
  and then settled players into negative balances. Both now refuse while a hand
  is running, the way transfers already did.
- Settle-up netting ignored direction: an amount properly settled one way
  cancelled the next debt the other way, so A could be paid 500, lose it back,
  and have the platform report a clean slate. `settledSum` is now signed against
  the debtor.
- A backup banker could flip `autoApproveBuys` on, buy itself a fortune, and flip
  it back. That setting and `visibility` are now host/main-banker only.

**The game protocol**

The client holds secrets the server is never supposed to learn, and the server is
the one narrating what happened. Three handlers took that narration at face
value:

- `need_share` unmasked any point the server sent. Feeding a player their own
  encrypted hole card returned the plaintext. It now refuses any index it was
  dealt, and any `hole` request addressed to its own seat.
- `action_applied` escrowed the hand key whenever the server claimed the player
  folded. It now requires that this browser actually sent the fold.
- `need_keys` returned the hand key on request. That key opens the whole deck, so
  it now goes out only after the hand has ended locally.

Also: `proof.z`, `reveal_key.key` and `fold_key.key` were unbounded hex feeding
`BigInt('0x'+…)` — one frame could freeze every table on the instance. All are
pinned to 64 characters. Emote kinds are a closed enum and the lookup table is
null-prototyped, because `__proto__` resolved to a truthy object with no `apply`
and the throw landed inside the render loop, permanently freezing the 3D table
for everyone in the room.

**Transport and accounts**

- WebSocket frames defaulted to ws's 100MB; now `LIMITS.wsFrameBytes`. Added a
  per-connection token bucket, an origin check, a per-user socket cap, closing of
  the displaced socket on reconnect, and reclamation of idle rooms.
- The session token travelled in the WebSocket URL, which proxies and platform
  access logs record verbatim. It now rides `Sec-WebSocket-Protocol`.
- Sessions never expired and nothing swept them. They now carry a 30-day expiry
  (existing rows grandfathered, not logged out), and `POST /api/logout` ends one
  server-side — clearing localStorage never did.
- CORS reflected every origin; now an allowlist. Added CSP, `nosniff`,
  `Referrer-Policy` and HSTS.
- `GET /api/users/:id/profile` ignored private mode and returned anyone's
  lifetime P&L, opponent graph, and last 100 ledger rows including the notes
  people write about how they settled up. Private mode is honoured and the money
  rail is owner-only.
- Rate limits on login, register and every credential endpoint, per IP and per
  targeted username; a global body limit; one-hop proxy trust so `req.ip` is the
  client rather than a forgeable header.
- The schema had no indexes at all. Added eleven.

## The abort problem, and how to actually fix it

The single worst issue on the list below is that aborting a hand is free and any
player can force one. It deserves more than a line, because the fix is not
obvious and half of it is impossible.

### Why you cannot just prevent it

Mental poker needs every player to cooperate to decrypt a card. Nobody holds the
whole key, which is the entire point — so any player can stall the hand by
refusing to answer, and no amount of cryptography changes that. This is not a
bug in our design; it is **Cleve's theorem** (1986): with a dishonest majority,
a protocol that guarantees output delivery to everyone is impossible. Someone
who is willing to walk away can always walk away.

So the goal is not "make aborting impossible". It is:

1. make aborting **cost more than losing**, so nobody wants to; and
2. make an abort **not stall the table**, so one dropout does not cost everyone
   else their hand.

Those are two different mechanisms and we need both.

### What everyone else does

Commercial online poker sidesteps this entirely — there is a trusted server with
an RNG, so no player holds a key and no player can stall anything. That is the
model we deliberately rejected.

Every decentralised poker project that keeps the mental-poker property lands on
the same two answers: **collateral with slashing** (you post a bond; provable
misbehaviour forfeits it) and **threshold recovery** (your key is secret-shared
so the table can finish without you). The academic framing is "MPC with
penalties" — Bentov and Kumaresan, *How to Use Bitcoin to Design Fair Protocols*
(CRYPTO 2014) — which exists precisely because Cleve says fairness alone is
unachievable. Penalties are not a fallback for a weak protocol; they are the
known-correct answer.

### Fix 1 — stop broadcasting the outcome before it is final (cheap, do first)

Right now `share_applied` is broadcast the moment each showdown share arrives,
and the payload includes the plaintext card point. So a player watches the
reveals land, works out that they have lost, and *only then* sends a bad proof.
The free-roll is profitable because the information arrives before the decision
has to be made.

Collect all showdown shares server-side and reveal them in one atomic step. That
alone removes the asymmetry — abort before the reveal and you are folding blind,
which is just a fold.

### Fix 2 — make a provable fault forfeit the pot (kills the exploit)

Distinguish the two failure modes, because they are not the same:

- **Provable misbehaviour.** A DLEQ proof that fails verification, carrying the
  player's own signature. There is no innocent explanation — they signed it.
- **Silence.** A timeout. Could be malice, could be a train tunnel.

For provable misbehaviour, do not refund. Settle the hand as though that seat
folded: their committed chips are forfeit and go to the players still live, and
it is written to the ledger like any other settlement. Aborting then costs
exactly what losing would have, so there is nothing to gain.

For silence, do not punish immediately — that is how a flaky connection turns
into a fine. Retry, then fall back to Fix 3.

### Fix 3 — the table finishes without you (the real answer to "someone left")

This is what actually stops a hand dying when a player closes their laptop.

At deal time, each player verifiably secret-shares their per-hand key among the
other seats — Feldman VSS over the same Ristretto group we already use, so every
share comes with a proof it is a real share of the committed key. If a seat goes
silent past its deadline, a threshold of the others publish their shares, the
missing unmasking capability is reconstructed, and the hand plays out.

The privacy cost is real and has to be bounded, or we have quietly rebuilt the
trusted server out of a quorum of players:

- reconstruction is only reachable **after** a seat has missed its deadline;
- it recovers **only the specific deck indices** still owed, never the raw key;
- every reconstruction is written to the transcript, so a table that colludes to
  recover a live player's cards leaves permanent, signed evidence.

The existing fold-key escrow is the degenerate case of this — a 1-of-1 sharing
with the server as trustee. Fix 3 generalises it to something that does not
require trusting us.

### Order of work

Fix 1, then Fix 2 — together they close the exploit, and both are contained
changes. Fix 3 is a larger project and is what upgrades "the hand aborts and
everyone is refunded" into "the hand finishes without the player who left".

## Still open

Listed in the order I would fix them.

1. **Aborting a hand is free, and any player can force one.** Chips committed
   during betting live only in the in-memory betting state; `abort()` writes
   nothing, so every chip is refunded. A player who has seen the showdown shares
   come in can send one malformed unmask proof and void a hand they were losing,
   at no cost, every time. Fixing it properly means either committing betting
   state at each street close, or forfeiting the blamed seat's commitment to the
   remaining players. **This is the most exploitable thing left in the app.**
2. **There is no verifiable shuffle proof.** A shuffler may substitute arbitrary
   points; the only check is "52 distinct parseable points". A malicious shuffler
   can poison the slot destined for a chosen victim, who is then dealt an
   undecodable card and silently crippled for the hand. Needs a real verifiable
   shuffle (Bayer-Groth or Neff) — this is the deepest remaining gap in the
   fairness story.
3. **Transcript signatures bind neither order nor seat.** `signContent` covers
   `{handId, type, body}` only, and the `seat` on an action is server-added and
   unsigned, so a stored transcript can be reordered or re-seated and still
   verify. The chained `verifyTranscript` in `transcript.ts` is dead code. Until
   this is fixed, "verified in your browser" is weaker than it reads.
4. **Out-of-turn actions are transcribed before they are validated.**
   `appendPlayer` runs before `applyEngineAction`, so rejected actions still land
   in the permanent record and are broadcast.
5. **Session tokens are stored in plaintext** and the whole SQLite file is
   uploaded to MongoDB every 15 seconds. Hash them at rest (`sha256`) and compare
   hashes; the raw token stays with the client.
6. **The card-signing key is persisted to localStorage.** The CSP raises the bar
   for exfiltration but does not remove the key from reach. Not persisting it
   means re-deriving from the password on cold load, which is a real UX call.
7. `scryptSync` blocks the single event loop that also runs every live hand's
   action clock. Move to the async variant.
8. A banker can void a whole room to erase debts; the 7-2 bounty amount is read
   at payout time rather than deal time; peek offers are unbounded; revoking
   spectating does not evict existing spectators; `/hands`, `/ledger` and
   `/style` have no pagination and parse every transcript per request.
