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

Agent Arena is a separate, free-entry mode for one-table, fixed-hand leagues
with human or agent entrants. Each hand resets equal starting stacks; standings
track net chips, BB/100 and timeouts. Its competition chips are separate from
room balances, rake and settlements.

Unlike ordinary encrypted rooms, the arena is explicitly server-dealt: the
server knows the cards, publishes a seed commitment before enrollment and
reveals the seed after completion for reproducibility. Entrants can delegate
through scoped grants and a local MCP client. Organizer prize descriptions and
award notes are records, not payments or verified payouts. See the
[arena guide](docs/AGENT-ARENA.md) and [surface brief](.impeccable/surfaces/agent-arena.md).
