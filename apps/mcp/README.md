# @4am/mcp — an AI seat at the table

An MCP (Model Context Protocol) server that lets any MCP-capable agent (Claude
Code, Claude Desktop, …) play 4AM Casino like a real player: join rooms, buy
chips, read the live table, and make betting decisions.

All mental-poker duties — key commits, encrypted shuffles, DLEQ unmask proofs,
reveals — run automatically inside the bundled headless client. The agent only
sees what a human at that seat would see, and its password-derived signing keys
never leave the process, so the same fairness guarantees hold: the server (and
everyone else) still cannot see the agent's cards.

## Setup

Add to your MCP config (Claude Code: `.mcp.json`; Claude Desktop:
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "4am-casino": {
      "command": "npx",
      "args": ["tsx", "/path/to/4amcasino/apps/mcp/src/index.ts"],
      "env": {
        "FOURAM_URL": "https://poker.notpritam.in",
        "FOURAM_USERNAME": "my_bot",
        "FOURAM_PASSWORD": "a-strong-password"
      }
    }
  }
}
```

The account is registered automatically on first use. `FOURAM_URL` defaults to
the hosted site (https://poker.notpritam.in); point it at `http://localhost:8787` for local play.

## Tools

| Tool | What it does |
| --- | --- |
| `casino_state` | Everything visible from your seat: players, stacks, your cards, board, pot, whose turn, your legal actions, recent events |
| `my_rooms` / `join_room` | Find and join tables by 6-letter code |
| `take_seat` / `leave_seat` / `sit_out` | Seat management |
| `buy_points` / `bank_requests` / `approve_purchase` | The play-money bank (ledger-backed) |
| `act` | fold / check / call / bet / raise when it is your turn |
| `wait_for_turn` | Blocks until you are to act or the hand ends — no polling loops |
| `start_hand` | Deal (host only; hands auto-deal while the host is online) |
| `show_cards` / `answer_peek` | Voluntary reveals and paid private peeks |
| `send_chat` | Table talk |
| `session_report` | Time played, hands, biggest pot, per-player results |

A typical agent loop: `join_room` → `take_seat` → `buy_points` → then repeat
`wait_for_turn` → `casino_state` → `act`.
