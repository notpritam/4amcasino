# Hands that survive a player dropping

## Why hands abort today

The deck is masked by every player's per-hand key. Opening a board card needs
every masker's inverse share. So if one player stops answering, nobody can open
anything, and the hand has nowhere to go but an abort.

The one escape hatch that exists is **fold-key escrow**: when you fold, your
client hands its per-hand key to the server, and the server can then compute your
shares itself (`applyRecoveredShare`, with a DLEQ proof so the recovery is as
verifiable as a share you sent yourself).

That covers exactly one case. It does nothing for the case that actually happens:

> **A player who is still live in the hand loses their connection.**
> Nobody holds their key. The hand is unrecoverable. It aborts. Always.

No amount of timeout tuning changes that — longer deadlines only delay the same
abort. This is structural, and it is the reason so many hands die.

## The insight that makes it fixable

When someone drops, poker already knows what to do with them: **they fold.**

And a folded player's hole cards are never shown. So the only shares anyone ever
needs from a dropped player are:

- the **board** indices, and
- **other players'** hole indices at showdown.

Never their own hole cards. That is a hard boundary, and it means recovery can be
built without ever exposing the hand of the person who dropped.

It also collapses a whole class of the problem for free: if auto-folding the
dropped player leaves only **one** live player, the hand ends by fold
(`winnerByFold`) and no unmasking is needed at all. Heads-up drops need no
cryptography — just the fold.

Recovery is therefore only required when **two or more players are still live and
the board is incomplete.**

## The fix: deal-time escrow, sharded to the other players

Not to the server. To the other players, so no single party — including us — can
read anything.

**At deal time**, right after key commitment and before any chips are committed,
each player P:

1. Shamir-splits their per-hand key `k_P` into shares for the other seats, with
   threshold `t`.
2. Encrypts share *i* to player *i* (X25519 derived from their identity key).
3. Publishes **Feldman commitments** to the polynomial, so each recipient can
   verify their share really is a share of the `k_P` that P already committed to.
4. Sends the ciphertexts and commitments to the server, which relays them and
   records them in the transcript.

Step 3 is not optional. Without it, a malicious player distributes junk shares and
you only discover it at recovery time — which converts a rare abort into a
reliable one. Verify at deal time and refuse to start the hand if escrow is
missing or invalid: fail before anyone has money in.

**On a drop**, after the deadline and retries:

1. The server marks the player folded.
2. If one live player remains → `winnerByFold`, settle, done. No recovery.
3. Otherwise the server asks the remaining players for their shares of `k_dropped`.
4. `t` shares arrive → reconstruct → compute the outstanding unmask shares with
   DLEQ proofs, exactly as `applyRecoveredShare` already does.
5. The hand plays out.
6. The reconstruction is written to the transcript, naming who contributed.

## Choosing the threshold

This is a real dial, and it should be a deliberate choice rather than a default.

| `t` | Survives | Cost |
| --- | --- | --- |
| `n-1` (everyone else) | one drop | a second simultaneous drop still aborts |
| majority of the others | several drops | a colluding majority could reconstruct a dropped player's key and read the hand they folded |

For a friends-and-family table, majority-of-others is the right trade: multiple
drops are common, coordinated collusion is not, and every reconstruction leaves
permanent signed evidence in the transcript. For a table of strangers, `n-1`.

Note the leak is bounded either way: a coalition can only reach the cards of a
player who **already dropped and was folded**, never a live opponent's.

## Order of work

1. **Auto-fold on drop, and settle by fold when one player remains.** No crypto.
   Removes every heads-up drop and every drop that leaves a single contestant —
   a large share of what is aborting now.
2. **Deal-time escrow + threshold recovery.** Closes the rest.
3. Keep the existing fold-key escrow as the fast path: when the dropped player had
   already folded, the server can still recover alone without troubling anyone.

Step 1 is small and worth doing immediately. Step 2 is the sure-shot guarantee:
with it, a hand can only die if more than `n - t` players vanish at once.
