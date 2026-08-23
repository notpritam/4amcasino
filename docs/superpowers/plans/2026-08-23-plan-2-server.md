# Plan 2: Server (auth, bank/ledger, betting engine, game orchestration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Node server that hosts rooms, authenticates players, manages the banker-approved hash-chained ledger, enforces no-limit Texas Hold'em betting, and orchestrates mental-poker hands over WebSocket — proven by a headless integration test where simulated clients (running the real crypto) play complete hands.

**Architecture:** Fastify (REST: auth/rooms/ledger) + `ws` (gameplay) + better-sqlite3 (one file). The betting engine is a pure reducer in `@4am/shared` (isomorphic so browsers can verify the server). The orchestrator holds per-room in-memory hand state; chip movements hit the DB only at hand settlement, so an abort is a no-op rollback.

**Tech Stack:** Node 22+, TypeScript 5, Fastify 5, ws 8, better-sqlite3 11, zod 3, vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-4amcasino-design.md`

## Global Constraints

- All money values are integer points. No floats anywhere in chip math.
- The server NEVER learns card plaintexts other than fully-public board/showdown cards; it never holds masking keys.
- Client identity: ed25519 secret derived client-side as `scrypt(password, '4am/id/' + username)`; the server receives only `authKey = hex(scrypt(password, '4am/auth/' + username))` and hashes that again with a per-user salt. Domain separation means the server can never derive the signing key.
- Deterministic deal mapping for a hand with n seats (dealing order starts left of button): seat k's hole cards are deck indices `k` and `n+k`; flop = `2n, 2n+1, 2n+2`; turn = `2n+3`; river = `2n+4`.
- Timeouts: crypto steps (shuffle/shares/reveal) 30 s → hand abort blaming the stalled seat; betting action 45 s → server auto-folds that seat (no crypto needed to fold).
- Every commit message: conventional-commit style + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

### Task 1: Betting engine in `@4am/shared` — types, startHand, blinds

**Files:**
- Create: `packages/shared/src/betting.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './betting.js';`)
- Test: `packages/shared/test/betting.test.ts`

**Interfaces (produced, used by all later tasks):**
```ts
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export interface SeatInHand {
  seat: number;          // absolute table seat number
  stack: number;         // chips behind
  committed: number;     // this street
  total: number;         // this hand (side-pot basis)
  folded: boolean;
  allIn: boolean;
  lastActedAt: number | null; // currentBet level when seat last acted this street
}
export interface BettingState {
  street: Street;
  seats: SeatInHand[];   // dealing order: index 0 is small blind (or button in heads-up)
  buttonSeat: number;
  sb: number; bb: number;
  currentBet: number;
  lastRaiseSize: number;
  lastFullRaiseAt: number;
  toAct: number | null;  // absolute seat number
  needToAct: number[];   // absolute seat numbers
  winnerByFold: number | null;
}
export interface PlayerAction { type: 'fold' | 'check' | 'call' | 'bet' | 'raise'; amount?: number } // amount = raise-to / bet-to total for this street
export function startHand(seats: { seat: number; stack: number }[], buttonSeat: number, sb: number, bb: number): BettingState;
export function legalActions(st: BettingState): { seat: number; canCheck: boolean; canRaise: boolean; callAmount: number; minRaiseTo: number; maxRaiseTo: number } | null;
export function applyAction(st: BettingState, seat: number, action: PlayerAction): BettingState; // pure; throws Error on illegal
export function streetClosed(st: BettingState): boolean;
export function nextStreet(st: BettingState): BettingState; // throws if !streetClosed or river
export function activeNonAllIn(st: BettingState): number;   // count needing future action
export function computePots(seats: SeatInHand[]): { amount: number; eligible: number[] }[];
export function awardPots(pots: { amount: number; eligible: number[] }[], scores: Map<number, number>, seatOrder: number[]): Map<number, number>;
```
Semantics locked here:
- `startHand` receives seats already rotated into dealing order (SB first; heads-up: button first). It posts blinds (short stacks post all-in), sets `currentBet = bb`, `lastRaiseSize = bb`, `lastFullRaiseAt = bb`, `toAct` = seat after BB (heads-up: the button/SB), `needToAct` = all non-all-in unfolded seats in order starting from `toAct` (BB included — the option).
- `bet`/`raise` `amount` is the seat's TOTAL committed for the street after the action ("raise to"). Legal raise: `amount >= currentBet + lastRaiseSize`, or all-in for less (an incomplete raise updates `currentBet` and re-adds unmatched seats to `needToAct` but does NOT update `lastRaiseSize`/`lastFullRaiseAt`, so raise rights don't reopen).
- `canRaise` for a seat = `lastActedAt === null || lastActedAt < lastFullRaiseAt`.
- Fold leaving one unfolded seat sets `winnerByFold` and empties `needToAct`.
- `nextStreet` zeroes street state, sets `lastRaiseSize = bb`, `lastFullRaiseAt = 0`, `toAct` = first unfolded non-all-in seat AFTER `buttonSeat` in `seats` order (ring: the SB side; heads-up: the BB — button acts last postflop), `needToAct` in order from there; if fewer than 2 unfolded non-all-in seats, `toAct = null`, `needToAct = []` (streets just run out).
- `computePots`: slice by sorted distinct positive `total` levels over ALL seats (folded chips stay in pots, folded seats never eligible); merge adjacent slices with identical eligible sets.
- `awardPots`: per pot, winners = eligible ∩ max score; integer split; odd chips go to the earliest winner in `seatOrder` (pass dealing order — first after button gets odd chip).

- [ ] **Step 1: Write failing tests for startHand/blinds**

```ts
import { describe, expect, it } from 'vitest';
import { startHand } from '../src/betting.js';

const seats3 = [ { seat: 2, stack: 1000 }, { seat: 5, stack: 800 }, { seat: 7, stack: 50 } ]; // dealing order: SB=2, BB=5, button=7

describe('startHand', () => {
  it('posts blinds and sets first to act (3-handed)', () => {
    const st = startHand(seats3, 7, 10, 20);
    expect(st.seats[0]).toMatchObject({ seat: 2, committed: 10, stack: 990 });
    expect(st.seats[1]).toMatchObject({ seat: 5, committed: 20, stack: 780 });
    expect(st.currentBet).toBe(20);
    expect(st.toAct).toBe(7); // UTG = button in 3-handed
    expect(st.needToAct).toEqual([7, 2, 5]); // BB has the option
  });
  it('heads-up: button posts SB and acts first', () => {
    const st = startHand([{ seat: 1, stack: 500 }, { seat: 3, stack: 500 }], 1, 5, 10);
    expect(st.seats[0]).toMatchObject({ seat: 1, committed: 5 });
    expect(st.seats[1]).toMatchObject({ seat: 3, committed: 10 });
    expect(st.toAct).toBe(1);
  });
  it('short stack posts all-in blind', () => {
    const st = startHand([{ seat: 0, stack: 8 }, { seat: 1, stack: 100 }, { seat: 2, stack: 100 }], 2, 10, 20);
    expect(st.seats[0]).toMatchObject({ seat: 0, committed: 8, stack: 0, allIn: true });
  });
});
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run packages/shared`

- [ ] **Step 3: Implement `startHand` (+ state helpers used later)**

```ts
import type {} from './cards.js';

// ...(types from the Interfaces block above, verbatim)...

function clone(st: BettingState): BettingState {
  return { ...st, seats: st.seats.map((s) => ({ ...s })), needToAct: [...st.needToAct] };
}

function commit(s: SeatInHand, amount: number): void {
  const put = Math.min(amount, s.stack);
  s.stack -= put; s.committed += put; s.total += put;
  if (s.stack === 0) s.allIn = true;
}

function seatAfter(st: BettingState, seat: number, pred: (s: SeatInHand) => boolean): number | null {
  const i = st.seats.findIndex((s) => s.seat === seat);
  for (let d = 1; d <= st.seats.length; d++) {
    const s = st.seats[(i + d) % st.seats.length]!;
    if (pred(s)) return s.seat;
  }
  return null;
}

export function startHand(seats: { seat: number; stack: number }[], buttonSeat: number, sb: number, bb: number): BettingState {
  if (seats.length < 2) throw new Error('need at least 2 players');
  const st: BettingState = {
    street: 'preflop',
    seats: seats.map((s) => ({ seat: s.seat, stack: s.stack, committed: 0, total: 0, folded: false, allIn: false, lastActedAt: null })),
    buttonSeat, sb, bb, currentBet: bb, lastRaiseSize: bb, lastFullRaiseAt: bb,
    toAct: null, needToAct: [], winnerByFold: null,
  };
  commit(st.seats[0]!, sb);           // SB is index 0 by construction (button itself heads-up)
  commit(st.seats[1]!, bb);           // BB is index 1
  const bbSeat = st.seats[1]!.seat;
  st.toAct = seatAfter(st, bbSeat, (s) => !s.folded && !s.allIn);
  // needToAct: all live seats in order starting from toAct
  if (st.toAct !== null) {
    const start = st.seats.findIndex((s) => s.seat === st.toAct);
    for (let d = 0; d < st.seats.length; d++) {
      const s = st.seats[(start + d) % st.seats.length]!;
      if (!s.folded && !s.allIn) st.needToAct.push(s.seat);
    }
  }
  return st;
}
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat(shared): betting engine part 1 - hand start and blinds`

---

### Task 2: Betting engine — actions, legality, street closure

**Files:** same module; extend test file.

- [ ] **Step 1: Write failing tests**

```ts
import { applyAction, legalActions, nextStreet, startHand, streetClosed } from '../src/betting.js';

const mk = () => startHand([{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }, { seat: 2, stack: 1000 }], 2, 10, 20);

describe('preflop action', () => {
  it('call, call, check closes the street (BB option)', () => {
    let st = mk();
    st = applyAction(st, 2, { type: 'call' });
    st = applyAction(st, 0, { type: 'call' });
    expect(streetClosed(st)).toBe(false); // BB still has the option
    st = applyAction(st, 1, { type: 'check' });
    expect(streetClosed(st)).toBe(true);
  });
  it('raise reopens action', () => {
    let st = mk();
    st = applyAction(st, 2, { type: 'call' });
    st = applyAction(st, 0, { type: 'raise', amount: 60 });
    expect(st.currentBet).toBe(60);
    expect(st.needToAct).toEqual([1, 2]);
    const la = legalActions(st)!;
    expect(la).toMatchObject({ seat: 1, callAmount: 40, minRaiseTo: 100, canRaise: true });
  });
  it('rejects illegal moves', () => {
    let st = mk();
    expect(() => applyAction(st, 0, { type: 'call' })).toThrow(); // not their turn
    expect(() => applyAction(st, 2, { type: 'check' })).toThrow(); // facing a bet
    expect(() => applyAction(st, 2, { type: 'raise', amount: 30 })).toThrow(); // below min raise-to 40
  });
  it('fold to one player ends the hand', () => {
    let st = mk();
    st = applyAction(st, 2, { type: 'fold' });
    st = applyAction(st, 0, { type: 'fold' });
    expect(st.winnerByFold).toBe(1);
    expect(streetClosed(st)).toBe(true);
  });
});

describe('postflop', () => {
  const flop = () => {
    let st = mk();
    st = applyAction(st, 2, { type: 'call' });
    st = applyAction(st, 0, { type: 'call' });
    st = applyAction(st, 1, { type: 'check' });
    return nextStreet(st);
  };
  it('first to act is SB; checks around close the street', () => {
    let st = flop();
    expect(st.street).toBe('flop');
    expect(st.toAct).toBe(0);
    st = applyAction(st, 0, { type: 'check' });
    st = applyAction(st, 1, { type: 'check' });
    st = applyAction(st, 2, { type: 'check' });
    expect(streetClosed(st)).toBe(true);
  });
  it('bet must be at least the big blind', () => {
    const st = flop();
    expect(() => applyAction(st, 0, { type: 'bet', amount: 5 })).toThrow();
    expect(applyAction(st, 0, { type: 'bet', amount: 20 }).currentBet).toBe(20);
  });
});

describe('incomplete all-in raise', () => {
  it('does not reopen raise rights', () => {
    // seat 1 has only 70: raise-to 70 over a 60 bet is incomplete (min would be 100)
    let st = startHand([{ seat: 0, stack: 1000 }, { seat: 1, stack: 70 }, { seat: 2, stack: 1000 }], 2, 10, 20);
    st = applyAction(st, 2, { type: 'raise', amount: 60 });
    st = applyAction(st, 0, { type: 'call' });
    st = applyAction(st, 1, { type: 'raise', amount: 70 }); // all-in incomplete raise
    expect(st.currentBet).toBe(70);
    // seats 2 and 0 must respond but cannot re-raise
    const la2 = legalActions(st)!;
    expect(la2.seat).toBe(2);
    expect(la2.canRaise).toBe(false);
    st = applyAction(st, 2, { type: 'call' });
    const la0 = legalActions(st)!;
    expect(la0).toMatchObject({ seat: 0, canRaise: false, callAmount: 10 });
  });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `legalActions`, `applyAction`, `streetClosed`, `nextStreet`, `activeNonAllIn`**

```ts
export function activeNonAllIn(st: BettingState): number {
  return st.seats.filter((s) => !s.folded && !s.allIn).length;
}

export function streetClosed(st: BettingState): boolean {
  return st.needToAct.length === 0;
}

export function legalActions(st: BettingState) {
  if (st.toAct === null) return null;
  const s = st.seats.find((x) => x.seat === st.toAct)!;
  const callAmount = Math.min(st.currentBet - s.committed, s.stack);
  const canCheck = st.currentBet === s.committed;
  const canRaiseByRights = s.lastActedAt === null || s.lastActedAt < st.lastFullRaiseAt;
  const minRaiseTo = st.currentBet + st.lastRaiseSize;
  const maxRaiseTo = s.committed + s.stack;
  const canRaise = canRaiseByRights && maxRaiseTo > st.currentBet;
  return { seat: s.seat, canCheck, canRaise, callAmount, minRaiseTo: Math.min(minRaiseTo, maxRaiseTo), maxRaiseTo };
}

export function applyAction(prev: BettingState, seat: number, action: PlayerAction): BettingState {
  const st = clone(prev);
  if (st.toAct !== seat) throw new Error('not your turn');
  const s = st.seats.find((x) => x.seat === seat)!;
  const la = legalActions(st)!;
  const dropFromNeed = () => { st.needToAct = st.needToAct.filter((x) => x !== seat); };

  switch (action.type) {
    case 'fold': {
      s.folded = true;
      dropFromNeed();
      const unfolded = st.seats.filter((x) => !x.folded);
      if (unfolded.length === 1) { st.winnerByFold = unfolded[0]!.seat; st.needToAct = []; }
      break;
    }
    case 'check': {
      if (!la.canCheck) throw new Error('cannot check facing a bet');
      s.lastActedAt = st.currentBet;
      dropFromNeed();
      break;
    }
    case 'call': {
      if (la.callAmount <= 0) throw new Error('nothing to call - check instead');
      commit(s, st.currentBet - s.committed);
      s.lastActedAt = st.currentBet;
      dropFromNeed();
      break;
    }
    case 'bet':
    case 'raise': {
      const to = action.amount;
      if (to === undefined) throw new Error('amount required');
      if (action.type === 'bet' && st.currentBet !== 0) throw new Error('use raise when facing a bet');
      if (action.type === 'raise' && st.currentBet === 0) throw new Error('use bet when unopened');
      if (!la.canRaise) throw new Error('raise rights closed');
      if (to > la.maxRaiseTo) throw new Error('cannot bet more than stack');
      const allInShort = to === la.maxRaiseTo && to < st.currentBet + st.lastRaiseSize;
      const minTo = st.currentBet === 0 ? st.bb : st.currentBet + st.lastRaiseSize;
      if (!allInShort && to < minTo) throw new Error(`minimum is ${minTo}`);
      if (to <= st.currentBet) throw new Error('raise must exceed current bet');
      const raiseSize = to - st.currentBet;
      commit(s, to - s.committed);
      s.lastActedAt = to;
      st.currentBet = to;
      if (!allInShort) { st.lastRaiseSize = raiseSize; st.lastFullRaiseAt = to; }
      // everyone else live and unmatched must act (in order after actor)
      st.needToAct = [];
      let cursor = seat;
      for (let d = 0; d < st.seats.length - 1; d++) {
        cursor = seatAfter(st, cursor, () => true)!;
        const c = st.seats.find((x) => x.seat === cursor)!;
        if (!c.folded && !c.allIn && c.seat !== seat) st.needToAct.push(c.seat);
      }
      break;
    }
  }
  st.toAct = st.needToAct[0] ?? null;
  return st;
}

export function nextStreet(prev: BettingState): BettingState {
  if (!streetClosed(prev)) throw new Error('street not closed');
  const order: Street[] = ['preflop', 'flop', 'turn', 'river'];
  const idx = order.indexOf(prev.street);
  if (idx === order.length - 1) throw new Error('no street after river');
  const st = clone(prev);
  st.street = order[idx + 1]!;
  st.currentBet = 0; st.lastRaiseSize = st.bb; st.lastFullRaiseAt = 0;
  for (const s of st.seats) { s.committed = 0; s.lastActedAt = null; }
  st.needToAct = [];
  if (st.winnerByFold === null && activeNonAllIn(st) >= 2) {
    for (const s of st.seats) if (!s.folded && !s.allIn) st.needToAct.push(s.seat);
  }
  st.toAct = st.needToAct[0] ?? null;
  return st;
}
```
NOTE — the `needToAct` rebuild in bet/raise walks seats in order after the actor, so action continues clockwise. `nextStreet` starts from the first live seat after `buttonSeat` (ring: SB; heads-up: BB, since the button acts last postflop).

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat(shared): betting engine part 2 - actions, legality, streets`

---

### Task 3: Betting engine — side pots & awards

**Files:** same module; extend test file.

- [ ] **Step 1: Write failing tests**

```ts
import { awardPots, computePots } from '../src/betting.js';

const seat = (seat: number, total: number, folded = false) => ({ seat, stack: 0, committed: 0, total, folded, allIn: false, lastActedAt: null });

describe('computePots', () => {
  it('single pot when everyone matched', () => {
    expect(computePots([seat(0, 100), seat(1, 100), seat(2, 100)])).toEqual([{ amount: 300, eligible: [0, 1, 2] }]);
  });
  it('two side pots for two different all-ins', () => {
    expect(computePots([seat(0, 50), seat(1, 200), seat(2, 500), seat(3, 500)])).toEqual([
      { amount: 200, eligible: [0, 1, 2, 3] },
      { amount: 450, eligible: [1, 2, 3] },
      { amount: 600, eligible: [2, 3] },
    ]);
  });
  it('folded chips stay in the pot but folded seats are ineligible', () => {
    expect(computePots([seat(0, 100), seat(1, 100, true), seat(2, 100)])).toEqual([{ amount: 300, eligible: [0, 2] }]);
  });
});

describe('awardPots', () => {
  it('splits ties and gives odd chip to earliest in order', () => {
    const pots = [{ amount: 101, eligible: [0, 1] }];
    const scores = new Map([[0, 5000], [1, 5000]]);
    expect(awardPots(pots, scores, [1, 0])).toEqual(new Map([[1, 51], [0, 50]]));
  });
  it('side pot goes to best eligible even if overall best is ineligible', () => {
    const pots = [
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 200, eligible: [1, 2] },
    ];
    const scores = new Map([[0, 9000], [1, 4000], [2, 3000]]);
    expect(awardPots(pots, scores, [0, 1, 2])).toEqual(new Map([[0, 150], [1, 200]]));
  });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**

```ts
export function computePots(seats: SeatInHand[]): { amount: number; eligible: number[] }[] {
  const levels = [...new Set(seats.map((s) => s.total).filter((t) => t > 0))].sort((a, b) => a - b);
  const pots: { amount: number; eligible: number[] }[] = [];
  let prev = 0;
  for (const level of levels) {
    const amount = seats.reduce((sum, s) => sum + Math.max(0, Math.min(s.total, level) - prev), 0);
    const eligible = seats.filter((s) => !s.folded && s.total >= level).map((s) => s.seat);
    const last = pots[pots.length - 1];
    if (last && last.eligible.length === eligible.length && last.eligible.every((e, i) => e === eligible[i])) {
      last.amount += amount;
    } else {
      pots.push({ amount, eligible });
    }
    prev = level;
  }
  return pots;
}

export function awardPots(
  pots: { amount: number; eligible: number[] }[],
  scores: Map<number, number>,
  seatOrder: number[],
): Map<number, number> {
  const out = new Map<number, number>();
  for (const pot of pots) {
    const scored = pot.eligible.filter((s) => scores.has(s));
    if (scored.length === 0) continue; // no eligible shown-down hand (cannot happen in a legal hand)
    const best = Math.max(...scored.map((s) => scores.get(s)!));
    const winners = seatOrder.filter((s) => scored.includes(s) && scores.get(s) === best);
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    for (const w of winners) {
      out.set(w, (out.get(w) ?? 0) + share + (odd > 0 ? 1 : 0));
      if (odd > 0) odd--;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run — PASS. Then run the whole suite:** `npm test` → all green.
- [ ] **Step 5: Commit** — `feat(shared): betting engine part 3 - side pots and pot awards`

---

### Task 4: Server scaffold, DB, auth

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/db.ts`, `apps/server/src/auth.ts`, `apps/server/src/app.ts`, `apps/server/src/index.ts`
- Test: `apps/server/test/auth.test.ts`

**Interfaces:**
- Produces: `createApp(dbPath: string): { app: FastifyInstance; db: Database }`; REST: `POST /api/register {username, authKey, publicKey}` → `{token, userId}`; `POST /api/login {username, authKey}` → `{token, userId, publicKey}`; `GET /api/me` (Bearer token) → `{userId, username, publicKey}`. `requireUser(db)` Fastify preHandler decorating `req.userId`.
- DB tables (in `db.ts` `migrate()`): `users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, auth_hash TEXT NOT NULL, auth_salt TEXT NOT NULL, pubkey TEXT NOT NULL, created_at INTEGER)`, `sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER)`, plus rooms/ledger tables defined in Task 5.

- [ ] **Step 1: Package boilerplate**

`apps/server/package.json`:
```json
{
  "name": "@4am/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "tsx watch src/index.ts", "start": "tsx src/index.ts", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@4am/shared": "*",
    "@4am/mental-poker": "*",
    "fastify": "^5.0.0",
    "@fastify/cors": "^10.0.0",
    "ws": "^8.18.0",
    "better-sqlite3": "^11.3.0",
    "zod": "^3.23.0"
  },
  "devDependencies": { "tsx": "^4.19.0", "@types/ws": "^8.5.0", "@types/better-sqlite3": "^7.6.0" }
}
```
`tsconfig.json` like the packages'. Run `npm install`.

- [ ] **Step 2: Write failing auth test**

`apps/server/test/auth.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let ctx: ReturnType<typeof createApp>;
beforeEach(() => { ctx = createApp(':memory:'); });
afterEach(async () => { await ctx.app.close(); });

const reg = (u = 'alice') =>
  ctx.app.inject({ method: 'POST', url: '/api/register', payload: { username: u, authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) } });

describe('auth', () => {
  it('registers and returns a token', async () => {
    const res = await reg();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: expect.any(Number), token: expect.any(String) });
  });
  it('rejects duplicate usernames', async () => {
    await reg();
    expect((await reg()).statusCode).toBe(409);
  });
  it('logs in with the same authKey and rejects a wrong one', async () => {
    await reg();
    const good = await ctx.app.inject({ method: 'POST', url: '/api/login', payload: { username: 'alice', authKey: 'a'.repeat(64) } });
    expect(good.statusCode).toBe(200);
    expect(good.json().publicKey).toBe('b'.repeat(64));
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/login', payload: { username: 'alice', authKey: 'c'.repeat(64) } });
    expect(bad.statusCode).toBe(401);
  });
  it('me requires a valid token', async () => {
    const token = (await reg()).json().token as string;
    const me = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.json()).toMatchObject({ username: 'alice' });
    const nope = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer junk' } });
    expect(nope.statusCode).toBe(401);
  });
});
```

- [ ] **Step 3: Run — FAIL.**
- [ ] **Step 4: Implement `db.ts`, `auth.ts`, `app.ts`, `index.ts`**

`db.ts`: open better-sqlite3, `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`, run `CREATE TABLE IF NOT EXISTS` for all tables (users, sessions, rooms, room_players, ledger, buy_requests, transcripts — full SQL in Task 5's interface block).
`auth.ts`: `hashAuthKey(authKey, salt)` = `crypto.scryptSync(authKey, salt, 32)` hex; register inserts user (409 on UNIQUE violation), creates session token = `crypto.randomBytes(32)` hex; login re-derives and `timingSafeEqual`s; `requireUser` preHandler reads `Authorization: Bearer`, looks up session, 401 otherwise.
`app.ts`: builds Fastify with CORS, registers zod-validated routes, returns `{ app, db }`.
`index.ts`: `createApp('./4amcasino.db')`, listen on `PORT ?? 8787`, plus WS attach (Task 6).

- [ ] **Step 5: Run — PASS. Commit** — `feat(server): fastify scaffold, sqlite, scrypt auth with sessions`

---

### Task 5: Rooms, bank ledger, buy/approve flow

**Files:**
- Create: `apps/server/src/rooms.ts`, `apps/server/src/ledger.ts`
- Modify: `apps/server/src/app.ts` (register routes), `apps/server/src/db.ts` (tables below)
- Test: `apps/server/test/rooms.test.ts`, `apps/server/test/ledger.test.ts`

**Interfaces:**
- Tables:
```sql
CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, join_code TEXT NOT NULL UNIQUE,
  host_id INTEGER NOT NULL, banker_id INTEGER NOT NULL, sb INTEGER NOT NULL, bb INTEGER NOT NULL,
  audit_mode TEXT NOT NULL DEFAULT 'private', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS room_players (room_id TEXT NOT NULL, user_id INTEGER NOT NULL,
  seat INTEGER, stack INTEGER NOT NULL DEFAULT 0, sitting_out INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, user_id));
CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL,
  user_id INTEGER NOT NULL, delta INTEGER NOT NULL, kind TEXT NOT NULL, approved_by INTEGER,
  note TEXT, ref TEXT, ts INTEGER NOT NULL, prev_hash TEXT NOT NULL, entry_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS buy_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL,
  user_id INTEGER NOT NULL, amount INTEGER NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'pending', ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS transcripts (hand_id TEXT PRIMARY KEY, room_id TEXT NOT NULL,
  head TEXT NOT NULL, entries TEXT NOT NULL, ts INTEGER NOT NULL);
```
- `ledger.ts` produces: `appendLedger(db, {roomId, userId, delta, kind, approvedBy?, note?, ref?}): LedgerRow` — computes `prev_hash` (last entry's `entry_hash` for the room, else `'genesis'`) and `entry_hash = sha256hex(prev_hash + canonicalize(fields))` using `canonicalize` from `@4am/mental-poker`; `verifyLedger(db, roomId): { ok: boolean; badId?: number }`; `stackOf(db, roomId, userId): number`.
- REST (all Bearer-authed): `POST /api/rooms {name, sb, bb, auditMode?}` → room (+joinCode, creator becomes host+banker and joins); `POST /api/rooms/join {joinCode}` → room; `GET /api/rooms/:id` → room + players (id, username, seat, stack) — members only; `POST /api/rooms/:id/buy {amount, note?}` → buy request (member only, amount > 0 integer); `GET /api/rooms/:id/requests` → pending (banker only); `POST /api/rooms/:id/approve {requestId, approve}` → banker only; on approve: mark request, `appendLedger(kind='purchase', approvedBy)`, `UPDATE room_players SET stack = stack + amount` in ONE sqlite transaction. `GET /api/rooms/:id/ledger` → `{ entries, verified }`.

- [ ] **Step 1: Write failing tests** — rooms: create/join/wrong-code/membership-required; ledger: buy→approve credits stack and writes chain; reject non-banker approvals; `verifyLedger` flags a tampered row (`UPDATE ledger SET delta = 9999 WHERE id = 1` directly, then expect `{ok: false, badId: 1}`); chain survives multiple entries.

```ts
// apps/server/test/ledger.test.ts (core cases)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { verifyLedger } from '../src/ledger.js';

let ctx: ReturnType<typeof createApp>;
beforeEach(() => { ctx = createApp(':memory:'); });
afterEach(async () => { await ctx.app.close(); });

async function user(name: string) {
  const r = await ctx.app.inject({ method: 'POST', url: '/api/register', payload: { username: name, authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) } });
  return { token: r.json().token as string, userId: r.json().userId as number };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('bank flow', () => {
  it('buy -> banker approve credits stack and appends verifiable ledger', async () => {
    const host = await user('host');
    const room = (await ctx.app.inject({ method: 'POST', url: '/api/rooms', headers: auth(host.token), payload: { name: 'Friday', sb: 10, bb: 20 } })).json();
    const alice = await user('alice');
    await ctx.app.inject({ method: 'POST', url: '/api/rooms/join', headers: auth(alice.token), payload: { joinCode: room.joinCode } });
    const req = (await ctx.app.inject({ method: 'POST', url: `/api/rooms/${room.id}/buy`, headers: auth(alice.token), payload: { amount: 500 } })).json();
    // non-banker cannot approve
    const forbidden = await ctx.app.inject({ method: 'POST', url: `/api/rooms/${room.id}/approve`, headers: auth(alice.token), payload: { requestId: req.id, approve: true } });
    expect(forbidden.statusCode).toBe(403);
    const ok = await ctx.app.inject({ method: 'POST', url: `/api/rooms/${room.id}/approve`, headers: auth(host.token), payload: { requestId: req.id, approve: true } });
    expect(ok.statusCode).toBe(200);
    const state = (await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}`, headers: auth(alice.token) })).json();
    expect(state.players.find((p: any) => p.username === 'alice').stack).toBe(500);
    const ledger = (await ctx.app.inject({ method: 'GET', url: `/api/rooms/${room.id}/ledger`, headers: auth(alice.token) })).json();
    expect(ledger.verified.ok).toBe(true);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({ delta: 500, kind: 'purchase' });
  });
  it('detects a tampered ledger row', async () => {
    const host = await user('host');
    const room = (await ctx.app.inject({ method: 'POST', url: '/api/rooms', headers: auth(host.token), payload: { name: 'x', sb: 1, bb: 2 } })).json();
    const req = (await ctx.app.inject({ method: 'POST', url: `/api/rooms/${room.id}/buy`, headers: auth(host.token), payload: { amount: 100 } })).json();
    await ctx.app.inject({ method: 'POST', url: `/api/rooms/${room.id}/approve`, headers: auth(host.token), payload: { requestId: req.id, approve: true } });
    ctx.db.prepare('UPDATE ledger SET delta = 9999 WHERE id = 1').run();
    expect(verifyLedger(ctx.db, room.id).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** rooms.ts (nanoid-style ids via `crypto.randomBytes(6).toString('hex')`, join codes 6 uppercase chars) and ledger.ts per the interface block; register routes in app.ts.
- [ ] **Step 4: Run — PASS. Commit** — `feat(server): rooms, hash-chained bank ledger, banker approval flow`

---

### Task 6: WS hub + game orchestrator + headless integration test

**Files:**
- Create: `apps/server/src/hub.ts` (WS wiring + room channels), `apps/server/src/game.ts` (per-room orchestrator), `apps/server/src/wsProtocol.ts` (zod schemas for every message, in `packages/shared/src/wsProtocol.ts` instead — isomorphic, imported by web later; add `zod` to shared deps)
- Modify: `apps/server/src/index.ts` (attach WS), `apps/server/src/app.ts` (expose hub)
- Test: `apps/server/test/integration.test.ts`

**Interfaces (packages/shared/src/wsProtocol.ts):**
```ts
// Client -> server message types (zod-validated): 
//  {t:'join_room', roomId}
//  {t:'sit', seat}            // takes a free seat 0..8; stack comes from room_players
//  {t:'start_hand'}           // host only; needs >=2 seated with stack>0
//  {t:'shuffle_deck', handId, deck: string[52]}                  // signed
//  {t:'unmask_share', handId, deckIndex, share}                  // signed
//  {t:'action', handId, action: {type, amount?}}                 // signed
//  {t:'reveal', handId, deckIndex, share}                        // signed (showdown, own cards)
//  {t:'chat', text}
// signed = payload carries {sig, seq}: sig over signableBytes(seq, prevHead, t, pubkey, body) from @4am/mental-poker.
// Server -> client:
//  {t:'room_state', ...}      // full snapshot: players, seats, stacks, phase
//  {t:'hand_start', handId, seats:[{seat,userId,pubkey,stack}], buttonSeat, sb, bb}
//  {t:'shuffle_turn', handId, seat}          // whose turn to shuffle
//  {t:'deck_state', handId, bySeat, deck}    // broadcast after each shuffle step
//  {t:'need_shares', handId, deckIndex, forSeat|null}  // null = public card
//  {t:'share', handId, deckIndex, seat, share}         // broadcast of a received share
//  {t:'street', handId, street, boardIndexes}
//  {t:'action_applied', handId, seat, action, bettingPublic}    // bettingPublic = BettingState minus nothing (all public)
//  {t:'showdown', handId, reveals:[{seat, cards, score}], awards:[{seat, amount}]}
//  {t:'hand_end', handId, transcriptHead, stacks:[{seat, stack}]}
//  {t:'hand_abort', handId, reason, blamedSeat|null}
//  {t:'chat', from, text}
//  {t:'error', message}
```
**Orchestrator (game.ts) rules:**
- One `GameRoom` instance per active room, held in a `Map<roomId, GameRoom>` in hub.ts. Holds: sockets by userId, seated players, current `Hand | null`.
- `Hand` state machine phases: `shuffling` (seat cursor) → `dealing` (collect shares per hole index) → `betting` (drives `@4am/shared` engine; streets via `need_shares` for board indices between betting rounds) → `showdown` (collect reveals, evaluate with `evaluate7`, `computePots`+`awardPots`) → settle: per-seat net deltas = winnings − total committed; write ONE sqlite transaction: update `room_players.stack` for every dealt seat + `appendLedger(kind='hand-settlement', ref=transcriptHead, delta)` per nonzero delta + insert `transcripts` row; broadcast `hand_end`.
- Every inbound signed message is appended to the hand's `Transcript` (server also appends its own entries — server has an identity keypair generated at boot, pubkey in `room_state`). Wrong-turn / invalid messages → `error` to sender, not appended.
- Fold-out ends hand without showdown: winner = `winnerByFold`, gets whole pot; hole cards never revealed.
- Betting-action timeout (45 s): server appends a server-signed `timeout_fold` entry and applies fold. Crypto timeout (30 s): `hand_abort` — in-memory stacks discarded (DB untouched since deal start), blamed seat marked sitting-out.
- All-in run-out: when betting closes and `activeNonAllIn(st) < 2` and no `winnerByFold`, remaining players still in reveal hole cards (protocol `reveal`) THEN remaining board streets are opened one by one — matches poker (cards face up before run-out).
- For the integration test, timeouts configurable via `GameRoom.opts.timeoutMs` (default 30000/45000; tests use 500).

**Integration test (the acceptance gate for this plan):**
```ts
// apps/server/test/integration.test.ts — outline with real crypto clients
// helper class TestClient wraps: REST register/login, ws connect (via 'ws' package client),
// identity keys, per-hand scalar, message handlers implementing the honest protocol:
//  - on shuffle_turn for me: maskAndShuffle(currentDeck, myKey, randomPerm(52)) -> send shuffle_deck
//  - on need_shares(idx, forSeat!=mine): send unmask_share for idx
//  - on need_shares(idx, null): send unmask_share (public card)
//  - on my turn (action_applied/hand_start with toAct==my seat): play scripted action from a queue
//  - on showdown request (betting closed on river or all-in run-out): send reveal for my hole indices
// Test 1: 3 players, scripted: preflop calls + check; flop/turn/river checks; showdown completes;
//         stacks sum preserved; winner stack increased by pot minus their commitment; ledger has
//         hand-settlement entries; transcripts row exists; verifyTranscript(entries) ok.
// Test 2: fold-out — 2 players, one raises, other folds; pot awarded without any reveal.
// Test 3: abort — one client stops responding to need_shares; expect hand_abort within timeout,
//         DB stacks unchanged from before the hand.
```

- [ ] **Step 0: DLEQ unmask proofs in `@4am/mental-poker`** (spec amendment 2026-08-23: forged showdown reveals were possible without this). New `src/dleq.ts`:
  `handKeyCommit(k: bigint): Point` (= k·G); `proveUnmask(k: bigint, pIn: Point): { out: Point; proof: DleqProof }` where `out = k⁻¹·pIn` and the Chaum–Pedersen proof shows `log_G(K) == log_out(pIn) == k` (Fiat–Shamir over sha512, domain-separated); `verifyUnmask(commit: Point, pIn: Point, out: Point, proof: DleqProof): boolean`. Also `signContent`/`verifyContent` (ed25519 over `canonicalize({handId, type, body})`) for order-independent message signatures — the server assigns transcript order. TDD: honest proof verifies; proof with wrong key, swapped out-point, or tampered proof fails; content sig round-trip.
- [ ] **Step 1: Write wsProtocol.ts schemas in packages/shared (+ zod dep), typecheck.**
- [ ] **Step 2: Write the integration test first (it will fail: modules missing).**
- [ ] **Step 3: Implement hub.ts (connect/auth/join/chat/room_state, socket lifecycle).**
- [ ] **Step 4: Implement game.ts per the rules above.**
- [ ] **Step 5: Run integration test until green.** `npx vitest run apps/server`
- [ ] **Step 6: Full suite + typecheck.** `npm test && npm run typecheck`
- [ ] **Step 7: Commit** — `feat(server): ws hub and mental-poker hand orchestrator with e2e test`
