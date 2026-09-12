# Agent tournaments implementation plan

**Goal:** Enroll human and agent players in fixed-hand leagues, expose scoped agent control and resumable room events, and run reproducible 1,000/10,000-hand benchmarks.

**Architecture:** Keep the encrypted room engine and its ledger intact. Add a separate, explicitly server-dealt tournament arena with equal stacks reset every hand, rotating positions, server-generated seed commitment, persisted state, legal-action validation, and chip-net/BB-per-100 standings. Existing room agents continue using local mental-poker keys. Arena agents need a revocable, tournament-scoped token, and never receive other players' hidden cards. Public room events use an authenticated cursor feed; an optional local signed webhook relay delivers those events to an agent's endpoint.

**Tech stack:** Existing React/Zeus, Fastify, SQLite, shared Hold'em rules, TypeScript MCP SDK, Node crypto and local CLI tools.

## Product defaults

- Free entry; no payment collection, house cut, or settlement ledger changes.
- One table per league, 2–9 entrants. Explicit capacity in UI. A league lasts 1,000 or 10,000 hands (shorter runs supported for testing).
- Fixed stacks each hand; total net chips and BB/100 rank entries. Tied scores share rank. No claim that one finite sample proves the strongest agent.
- Tournament lifecycle: registration → running ↔ paused → completed, plus cancellation outside an active action. Organizer controls start/pause/resume; enrollment locks at start.
- Prize descriptions and organizer award records are metadata, not payments. No invented prize pool or public promise.
- Server-dealt benchmarks are distinct from cryptographically private normal rooms. Reveal the committed seed only after completion for replay verification.
- Draft Twitter launch copy; do not publish or buy promotion. No deployment in this task.
- Google/Supabase project setup remains a separate pending task; current accounts work here.

## Build sequence

1. Add shared arena round engine and deterministic deck generator. Test blinds, legal actions, all-ins, folds, card visibility, zero-sum accounting, and repeatability.
2. Add tournament tables and routes for creation, enrollment/withdrawal, lifecycle, state/actions, standings and award notes. Test ownership, capacity, idempotency, stale actions, reload persistence, hidden-card redaction, and cash-ledger isolation.
3. Add hashed, expiring, revocable agent grants. Gate room WebSocket messages and tournament actions by scope. Existing full sessions remain compatible. Test cross-room denial, membership revocation and denied banking/account access.
4. Add durable scoped event cursors, bounded retention and long polling. Publish only whitelisted public game messages, never crypto shares/keys/private cards. Test permission, replay and private-event rejection.
5. Extend MCP with structured state, tournament listing/enrollment/actions, subscription/event tools, ready checks and scoped configuration. Organizer lifecycle controls stay in the normal account UI/API. Keep the crypto client local and validate signing-key matches. Add a signed local webhook relay with cursor checkpointing and bounded retry.
6. Add Zeus tournament list/detail/enrollment/standings/prizes and agent access screens, connected to actual endpoints. Check light/dark, desktop/mobile, errors and keyboard operation.
7. Add local benchmark CLI using the same shared rules and user-supplied local agent modules. Run 1,000 and 10,000 hands, record reproducible results and zero-sum checks. Separately test a real encrypted MCP room and a live arena tournament.
8. Write agent/API/event contract docs, prize-rule template and Twitter draft campaign. Run type checks, targeted/full tests, build and browser UAT. Summarize exactly what was verified and what still needs external setup.

## Implementation targets

- `packages/shared/src/arena.ts`, `packages/shared/test/arena.test.ts`
- `apps/server/src/tournaments.ts`, `agentAccess.ts`, `agentEvents.ts`, corresponding server tests
- Existing `db.ts`, `app.ts`, `hub.ts`, `game.ts` integration points
- `apps/mcp/src/index.ts`, `client.ts`, `benchmark.ts`, `webhook-relay.ts`, examples and README
- `apps/web/src/pages/tournaments/TournamentsPage.tsx`, `pages/agents/AgentsPage.tsx`, shared API and navigation
- `docs/AGENT-ARENA.md`, `docs/marketing/agent-arena-launch.md`, `docs/qa/2026-09-13-agent-arena.md`
