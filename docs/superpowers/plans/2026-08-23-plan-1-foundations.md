# Plan 1: Foundations (monorepo, shared, mental-poker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the TypeScript monorepo and build the two foundational packages — `@4am/shared` (cards, hand evaluator) and `@4am/mental-poker` (masking/shuffling crypto, identities, transcripts) — fully tested.

**Architecture:** npm workspaces; packages are ESM TypeScript consumed source-direct (no build step — vitest/tsx/vite all execute TS). `@4am/mental-poker` depends only on `@noble/curves` + `@noble/hashes` and `@4am/shared`.

**Tech Stack:** Node 22+, TypeScript 5, vitest, @noble/curves (ristretto255 + ed25519), @noble/hashes.

**Spec:** `docs/superpowers/specs/2026-08-23-4amcasino-design.md`

## Global Constraints

- All packages ESM (`"type": "module"`), TypeScript strict mode.
- `@4am/shared` runtime deps: none. `@4am/mental-poker` runtime deps: `@noble/curves`, `@noble/hashes`, `@4am/shared` only.
- Card ids are integers 0–51: `id = rankIndex * 4 + suitIndex`, rankIndex 0='2'…12='A', suitIndex 0='c',1='d',2='h',3='s'. Card names are like `"As"`, `"Td"`.
- Scalars are bigint mod L = 2^252 + 27742317777372353535851937790883648493 (ristretto255 group order).
- Every commit message: conventional-commit style + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `.prettierrc.json`, `LICENSE`, `README.md`

**Interfaces:**
- Produces: workspace layout `packages/*`, `apps/*`; root scripts `test`, `typecheck`, `format`.

- [ ] **Step 1: Write root config files**

`package.json`:
```json
{
  "name": "4amcasino",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "prettier": "^3.3.0",
    "@types/node": "^22.0.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
```

`.gitignore`: `node_modules/`, `dist/`, `*.db`, `.DS_Store`.
`.prettierrc.json`: `{ "singleQuote": true, "printWidth": 100 }`.
`LICENSE`: MIT, copyright "4amcasino contributors".
`README.md`: one-paragraph project description from spec §1 + "work in progress".

- [ ] **Step 2: Install and verify**

Run: `npm install && npm test`
Expected: install succeeds; vitest reports "no test files found" (exit code may be nonzero — that's fine, nothing else errors).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold npm-workspaces monorepo (TS, vitest, prettier)"
```

---

### Task 2: `@4am/shared` — card codec

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/cards.ts`
- Test: `packages/shared/test/cards.test.ts`

**Interfaces:**
- Produces:
  - `type CardId = number` (0–51)
  - `const RANKS: readonly string[]` (`'2'…'A'`), `const SUITS: readonly string[]` (`'c','d','h','s'`)
  - `rankOf(id: CardId): number` (0–12), `suitOf(id: CardId): number` (0–3)
  - `cardName(id: CardId): string` (e.g. `"As"`), `cardFromName(name: string): CardId` (throws on invalid)
  - `ALL_CARDS: readonly CardId[]` (0…51)

- [ ] **Step 1: Package boilerplate**

`packages/shared/package.json`:
```json
{
  "name": "@4am/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" }
}
```
`packages/shared/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`

- [ ] **Step 2: Write the failing test**

`packages/shared/test/cards.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ALL_CARDS, cardFromName, cardName, rankOf, suitOf } from '../src/cards.js';

describe('card codec', () => {
  it('round-trips all 52 cards through names', () => {
    const names = ALL_CARDS.map(cardName);
    expect(new Set(names).size).toBe(52);
    for (const id of ALL_CARDS) expect(cardFromName(cardName(id))).toBe(id);
  });
  it('maps known cards', () => {
    expect(cardName(0)).toBe('2c');
    expect(cardName(51)).toBe('As');
    expect(cardFromName('Td')).toBe(8 * 4 + 1);
    expect(rankOf(cardFromName('As'))).toBe(12);
    expect(suitOf(cardFromName('Ah'))).toBe(2);
  });
  it('rejects invalid names', () => {
    expect(() => cardFromName('Xz')).toThrow();
    expect(() => cardFromName('A')).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/shared`
Expected: FAIL (cannot resolve `../src/cards.js`).

- [ ] **Step 4: Implement**

`packages/shared/src/cards.ts`:
```ts
export type CardId = number; // 0..51
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['c', 'd', 'h', 's'] as const;
export const ALL_CARDS: readonly CardId[] = Array.from({ length: 52 }, (_, i) => i);

export function rankOf(id: CardId): number { return Math.floor(id / 4); }
export function suitOf(id: CardId): number { return id % 4; }

export function cardName(id: CardId): string {
  if (!Number.isInteger(id) || id < 0 || id > 51) throw new Error(`bad card id: ${id}`);
  return RANKS[rankOf(id)]! + SUITS[suitOf(id)]!;
}

export function cardFromName(name: string): CardId {
  if (name.length !== 2) throw new Error(`bad card name: ${name}`);
  const r = RANKS.indexOf(name[0] as (typeof RANKS)[number]);
  const s = SUITS.indexOf(name[1] as (typeof SUITS)[number]);
  if (r < 0 || s < 0) throw new Error(`bad card name: ${name}`);
  return r * 4 + s;
}
```
`packages/shared/src/index.ts`: `export * from './cards.js';`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/shared` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared && git commit -m "feat(shared): card codec (ids 0-51, names like As/Td)"
```

---

### Task 3: `@4am/shared` — hand evaluator

**Files:**
- Create: `packages/shared/src/evaluate.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './evaluate.js';`)
- Test: `packages/shared/test/evaluate.test.ts`

**Interfaces:**
- Produces:
  - `evaluate5(cards: CardId[]): number` — comparable score, higher wins
  - `evaluate7(cards: CardId[]): number` — best 5 of 7
  - `handCategory(score: number): number` (0–8) and `HAND_CATEGORY_NAMES: readonly string[]` (`['High Card','Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush']`)

Score packing: `category << 20 | t1 << 16 | t2 << 12 | t3 << 8 | t4 << 4 | t5` where t's are rank indices (0–12) of tiebreakers in significance order, zero-padded.

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/evaluate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { cardFromName } from '../src/cards.js';
import { evaluate5, evaluate7, handCategory, HAND_CATEGORY_NAMES } from '../src/evaluate.js';

const h = (s: string) => s.split(' ').map(cardFromName);
const cat5 = (s: string) => HAND_CATEGORY_NAMES[handCategory(evaluate5(h(s)))];

describe('evaluate5 categories', () => {
  it('detects every category', () => {
    expect(cat5('As Ks Qs Js Ts')).toBe('Straight Flush');
    expect(cat5('9c 9d 9h 9s 2c')).toBe('Four of a Kind');
    expect(cat5('9c 9d 9h 2s 2c')).toBe('Full House');
    expect(cat5('As Ks 9s 5s 3s')).toBe('Flush');
    expect(cat5('9c 8d 7h 6s 5c')).toBe('Straight');
    expect(cat5('9c 9d 9h Ks 2c')).toBe('Three of a Kind');
    expect(cat5('9c 9d Kh Ks 2c')).toBe('Two Pair');
    expect(cat5('9c 9d Kh Qs 2c')).toBe('Pair');
    expect(cat5('Ac Kd 9h 5s 3c')).toBe('High Card');
  });
  it('handles the wheel (A-5 straight) as lowest straight', () => {
    expect(cat5('Ac 2d 3h 4s 5c')).toBe('Straight');
    expect(evaluate5(h('Ac 2d 3h 4s 5c'))).toBeLessThan(evaluate5(h('2c 3d 4h 5s 6c')));
    expect(cat5('As 2s 3s 4s 5s')).toBe('Straight Flush');
  });
  it('ranks by kickers', () => {
    expect(evaluate5(h('Ac Ad Kh Qs 2c'))).toBeGreaterThan(evaluate5(h('Ac Ad Kh Js 9c')))
    expect(evaluate5(h('Kc Kd Qh Qs Ac'))).toBeGreaterThan(evaluate5(h('Kc Kd Jh Js Ac')));
  });
  it('equal hands tie exactly', () => {
    expect(evaluate5(h('Ac Kd 9h 5s 3c'))).toBe(evaluate5(h('Ad Kc 9s 5h 3d')));
  });
});

describe('evaluate7', () => {
  it('finds the best five of seven', () => {
    // board gives a flush, hole cards irrelevant
    const score = evaluate7(h('2c 2d Ah Kh Qh Jh 9h'));
    expect(HAND_CATEGORY_NAMES[handCategory(score)]).toBe('Flush');
  });
  it('board plays: both players tie when board is best', () => {
    const board = '9c 8d 7h 6s 5c';
    expect(evaluate7(h(`${board} 2c 3d`))).toBe(evaluate7(h(`${board} Kc 2h`)));
  });
  it('straight beats trips across 7 cards', () => {
    const score = evaluate7(h('9c 9d 9h 8s 7c 6d 5h'));
    expect(HAND_CATEGORY_NAMES[handCategory(score)]).toBe('Straight');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run packages/shared` → FAIL (module missing).

- [ ] **Step 3: Implement**

`packages/shared/src/evaluate.ts`:
```ts
import { type CardId, rankOf, suitOf } from './cards.js';

export const HAND_CATEGORY_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'] as const;

export function handCategory(score: number): number { return score >> 20; }

function pack(category: number, tiebreaks: number[]): number {
  let s = category << 20;
  for (let i = 0; i < 5; i++) s |= (tiebreaks[i] ?? 0) << (16 - 4 * i);
  return s;
}

/** Returns the high-card rank index of a straight in `ranks` (unique, sorted desc), or -1. */
function straightHigh(ranks: number[]): number {
  const withWheelAce = ranks.includes(12) ? [...ranks, -1] : ranks; // ace also plays low
  let run = 1;
  for (let i = 1; i < withWheelAce.length; i++) {
    if (withWheelAce[i]! === withWheelAce[i - 1]! - 1) {
      run++;
      if (run >= 5) return withWheelAce[i]! + 4;
    } else run = 1;
  }
  return -1;
}

export function evaluate5(cards: CardId[]): number {
  if (cards.length !== 5) throw new Error('evaluate5 needs exactly 5 cards');
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const isFlush = new Set(cards.map(suitOf)).size === 1;
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // group ranks by count desc, then rank desc
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const uniq = [...new Set(ranks)];
  const sHigh = uniq.length === 5 ? straightHigh(uniq) : -1;

  if (isFlush && sHigh >= 0) return pack(8, [sHigh]);
  if (groups[0]![1] === 4) return pack(7, [groups[0]![0], groups[1]![0]]);
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return pack(6, [groups[0]![0], groups[1]![0]]);
  if (isFlush) return pack(5, ranks);
  if (sHigh >= 0) return pack(4, [sHigh]);
  if (groups[0]![1] === 3) return pack(3, [groups[0]![0], groups[1]![0], groups[2]![0]]);
  if (groups[0]![1] === 2 && groups[1]![1] === 2) return pack(2, [groups[0]![0], groups[1]![0], groups[2]![0]]);
  if (groups[0]![1] === 2) return pack(1, [groups[0]![0], groups[1]![0], groups[2]![0], groups[3]![0]]);
  return pack(0, ranks);
}

export function evaluate7(cards: CardId[]): number {
  if (cards.length !== 7) throw new Error('evaluate7 needs exactly 7 cards');
  let best = 0;
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++) {
      const five = cards.filter((_, i) => i !== a && i !== b);
      const s = evaluate5(five);
      if (s > best) best = s;
    }
  return best;
}
```
Add to `packages/shared/src/index.ts`: `export * from './evaluate.js';`

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run packages/shared` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared && git commit -m "feat(shared): 7-card Texas Hold'em hand evaluator"
```

---

### Task 4: `@4am/mental-poker` — group operations & card points

**Files:**
- Create: `packages/mental-poker/package.json`, `packages/mental-poker/tsconfig.json`, `packages/mental-poker/src/index.ts`, `packages/mental-poker/src/group.ts`
- Test: `packages/mental-poker/test/group.test.ts`

**Interfaces:**
- Produces:
  - `type Point` (ristretto255 point), `GROUP_ORDER: bigint` (L)
  - `randScalar(): bigint` (uniform in [1, L-1]), `invScalar(k: bigint): bigint`
  - `mulPoint(P: Point, k: bigint): Point`
  - `cardPoint(id: CardId): Point` — deterministic hash-to-group of `"4amcasino/v1/card/" + cardName(id)`
  - `pointHex(P: Point): string`, `pointFromHex(hex: string): Point`

- [ ] **Step 1: Package boilerplate + deps**

`packages/mental-poker/package.json`:
```json
{
  "name": "@4am/mental-poker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@4am/shared": "*",
    "@noble/curves": "^1.6.0",
    "@noble/hashes": "^1.5.0"
  }
}
```
`tsconfig.json` same shape as shared's. Run `npm install` at root.

- [ ] **Step 2: Pin the noble API surface**

Run a scratch check (then delete it) to confirm exact names in the installed version:
```bash
node -e "import('@noble/curves/ed25519').then(m => console.log(Object.keys(m)))"
```
Expected: exports include `RistrettoPoint` (and `ed25519`). If `RistrettoPoint.hashToCurve` doesn't exist in this version, use the version's documented ristretto one-way map (e.g. `ristretto255_hasher` / `RistrettoPoint.fromHash`) inside `cardPoint` — the wrapper signature below MUST stay unchanged either way.

- [ ] **Step 3: Write the failing tests**

`packages/mental-poker/test/group.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '@4am/shared';
import { GROUP_ORDER, cardPoint, invScalar, mulPoint, pointFromHex, pointHex, randScalar } from '../src/group.js';

describe('group ops', () => {
  it('scalars are in range and invertible', () => {
    for (let i = 0; i < 20; i++) {
      const k = randScalar();
      expect(k > 0n && k < GROUP_ORDER).toBe(true);
      expect((k * invScalar(k)) % GROUP_ORDER).toBe(1n);
    }
  });
  it('masking commutes: k1*(k2*P) == k2*(k1*P)', () => {
    const P = cardPoint(0);
    const k1 = randScalar(), k2 = randScalar();
    expect(pointHex(mulPoint(mulPoint(P, k1), k2))).toBe(pointHex(mulPoint(mulPoint(P, k2), k1)));
  });
  it('unmasking recovers the point', () => {
    const P = cardPoint(17);
    const k = randScalar();
    expect(pointHex(mulPoint(mulPoint(P, k), invScalar(k)))).toBe(pointHex(P));
  });
  it('52 card points are distinct, deterministic, and hex round-trips', () => {
    const hexes = ALL_CARDS.map((id) => pointHex(cardPoint(id)));
    expect(new Set(hexes).size).toBe(52);
    expect(ALL_CARDS.map((id) => pointHex(cardPoint(id)))).toEqual(hexes); // deterministic
    expect(pointHex(pointFromHex(hexes[3]!))).toBe(hexes[3]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail** — `npx vitest run packages/mental-poker` → FAIL.

- [ ] **Step 5: Implement**

`packages/mental-poker/src/group.ts`:
```ts
import { RistrettoPoint } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes, randomBytes } from '@noble/hashes/utils';
import { type CardId, cardName } from '@4am/shared';

export type Point = InstanceType<typeof RistrettoPoint>;
export const GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;

function bytesToBigint(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

export function randScalar(): bigint {
  // 64 uniform bytes mod L => negligible bias
  const k = bytesToBigint(randomBytes(64)) % GROUP_ORDER;
  return k === 0n ? randScalar() : k;
}

export function invScalar(k: bigint): bigint {
  // Fermat: k^(L-2) mod L
  let base = ((k % GROUP_ORDER) + GROUP_ORDER) % GROUP_ORDER;
  let e = GROUP_ORDER - 2n;
  let r = 1n;
  while (e > 0n) {
    if (e & 1n) r = (r * base) % GROUP_ORDER;
    base = (base * base) % GROUP_ORDER;
    e >>= 1n;
  }
  return r;
}

export function mulPoint(P: Point, k: bigint): Point { return P.multiply(k); }

export function cardPoint(id: CardId): Point {
  const seed = sha512(utf8ToBytes(`4amcasino/v1/card/${cardName(id)}`));
  return RistrettoPoint.hashToCurve(seed);
}

export function pointHex(P: Point): string { return bytesToHex(P.toRawBytes()); }
export function pointFromHex(hex: string): Point { return RistrettoPoint.fromHex(hexToBytes(hex)); }
```
`packages/mental-poker/src/index.ts`: `export * from './group.js';`

(If Step 2 showed a different one-way-map name, adapt only the body of `cardPoint`.)

- [ ] **Step 6: Run tests to verify they pass** — `npx vitest run packages/mental-poker` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/mental-poker package-lock.json
git commit -m "feat(mental-poker): ristretto255 group ops and card point encoding"
```

---

### Task 5: `@4am/mental-poker` — mask/shuffle/unmask protocol core

**Files:**
- Create: `packages/mental-poker/src/protocol.ts`
- Modify: `packages/mental-poker/src/index.ts` (add export)
- Test: `packages/mental-poker/test/protocol.test.ts`

**Interfaces:**
- Produces:
  - `initialDeck(): Point[]` — 52 canonical card points in id order
  - `randomPerm(n: number): number[]` — Fisher–Yates using crypto randomness
  - `maskAndShuffle(deck: Point[], k: bigint, perm: number[]): Point[]` — `perm.map(i => deck[i] * k)`
  - `unmaskShare(P: Point, k: bigint): Point` — `P * k⁻¹`
  - `cardLookup(): Map<string, CardId>` — pointHex → id
  - `recoverCard(P: Point, lookup: Map<string, CardId>): CardId | null`

- [ ] **Step 1: Write the failing tests**

`packages/mental-poker/test/protocol.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { cardLookup, initialDeck, maskAndShuffle, randomPerm, recoverCard, unmaskShare } from '../src/protocol.js';
import { pointHex, randScalar } from '../src/group.js';
import type { Point } from '../src/group.js';

/** Simulate the full shuffle-mask phase for n players; returns masked deck + keys. */
function shuffledTable(n: number) {
  const keys = Array.from({ length: n }, randScalar);
  let deck = initialDeck();
  for (const k of keys) deck = maskAndShuffle(deck, k, randomPerm(52));
  return { deck, keys };
}

/** All players cooperatively unmask one deck position. */
function openCard(deck: Point[], keys: bigint[], idx: number): Point {
  let P = deck[idx]!;
  for (const k of keys) P = unmaskShare(P, k);
  return P;
}

describe('mental poker protocol', () => {
  for (const n of [2, 5, 9]) {
    it(`full deal with ${n} players recovers all 52 distinct cards`, () => {
      const { deck, keys } = shuffledTable(n);
      const lookup = cardLookup();
      const seen = new Set<number>();
      for (let i = 0; i < 52; i++) {
        const card = recoverCard(openCard(deck, keys, i), lookup);
        expect(card).not.toBeNull();
        seen.add(card!);
      }
      expect(seen.size).toBe(52);
    });
  }

  it('a partially unmasked card (recipient share missing) is unreadable', () => {
    const { deck, keys } = shuffledTable(3);
    const lookup = cardLookup();
    // players 1..2 publish shares; player 0 (recipient) has not applied theirs
    let P = deck[0]!;
    for (const k of keys.slice(1)) P = unmaskShare(P, k);
    expect(recoverCard(P, lookup)).toBeNull();
  });

  it('the masked deck leaks nothing positionally (no masked point matches a canonical point)', () => {
    const { deck } = shuffledTable(2);
    const lookup = cardLookup();
    for (const P of deck) expect(recoverCard(P, lookup)).toBeNull();
  });

  it('detects a duplicated card at open time', () => {
    const { deck, keys } = shuffledTable(2);
    const cheated = [...deck];
    cheated[1] = cheated[0]!; // cheater duplicates an unknown card
    const lookup = cardLookup();
    const a = recoverCard(openCard(cheated, keys, 0), lookup);
    const b = recoverCard(openCard(cheated, keys, 1), lookup);
    expect(a).toBe(b); // duplicate detected by collision when both open
  });

  it('detects a garbage substitute (recover returns null)', () => {
    const { deck, keys } = shuffledTable(2);
    const cheated = [...deck];
    cheated[5] = cheated[5]!.add(cheated[6]!); // not any masked card
    const lookup = cardLookup();
    expect(recoverCard(openCard(cheated, keys, 5), lookup)).toBeNull();
  });

  it('randomPerm is a permutation', () => {
    const p = randomPerm(52);
    expect([...p].sort((x, y) => x - y)).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run packages/mental-poker` → FAIL.

- [ ] **Step 3: Implement**

`packages/mental-poker/src/protocol.ts`:
```ts
import { ALL_CARDS, type CardId } from '@4am/shared';
import { randomBytes } from '@noble/hashes/utils';
import { type Point, cardPoint, invScalar, mulPoint, pointHex } from './group.js';

export function initialDeck(): Point[] { return ALL_CARDS.map(cardPoint); }

export function randomPerm(n: number): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    // rejection sampling for unbiased index in [0, i]
    let j: number;
    do {
      const b = randomBytes(4);
      j = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
    } while (j >= Math.floor(0xffffffff / (i + 1)) * (i + 1));
    j %= i + 1;
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return p;
}

export function maskAndShuffle(deck: Point[], k: bigint, perm: number[]): Point[] {
  if (perm.length !== deck.length) throw new Error('perm/deck length mismatch');
  return perm.map((i) => mulPoint(deck[i]!, k));
}

export function unmaskShare(P: Point, k: bigint): Point { return mulPoint(P, invScalar(k)); }

export function cardLookup(): Map<string, CardId> {
  const m = new Map<string, CardId>();
  for (const id of ALL_CARDS) m.set(pointHex(cardPoint(id)), id);
  return m;
}

export function recoverCard(P: Point, lookup: Map<string, CardId>): CardId | null {
  return lookup.get(pointHex(P)) ?? null;
}
```
Add to index: `export * from './protocol.js';`

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run packages/mental-poker` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mental-poker && git commit -m "feat(mental-poker): commutative mask/shuffle/unmask protocol core"
```

---

### Task 6: `@4am/mental-poker` — identities (ed25519) & signed transcript chain

**Files:**
- Create: `packages/mental-poker/src/identity.ts`, `packages/mental-poker/src/transcript.ts`
- Modify: `packages/mental-poker/src/index.ts` (add exports)
- Test: `packages/mental-poker/test/transcript.test.ts`

**Interfaces:**
- Produces:
  - `genIdentity(): { publicKey: string; secretKey: string }` (hex)
  - `signBytes(secretKeyHex: string, bytes: Uint8Array): string`, `verifyBytes(publicKeyHex: string, bytes: Uint8Array, sigHex: string): boolean`
  - `canonicalize(value: unknown): string` — JSON with recursively sorted object keys
  - `interface TranscriptEntry { seq: number; type: string; from: string; payload: unknown; sig: string }`
  - `class Transcript { readonly entries: TranscriptEntry[]; get head(): string; append(e: Omit<TranscriptEntry,'seq'>): TranscriptEntry }` — head is a sha256 hash chain starting from `sha256('4amcasino/v1/transcript')`
  - `signableBytes(seq: number, prevHead: string, type: string, from: string, payload: unknown): Uint8Array` — what senders sign
  - `verifyTranscript(entries: TranscriptEntry[], pubkeys: Map<string, string>): { ok: boolean; head: string; badSeq?: number }` — replays the chain, checks seq order and every signature (`from` → pubkey)

- [ ] **Step 1: Write the failing tests**

`packages/mental-poker/test/transcript.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { genIdentity, signBytes, verifyBytes } from '../src/identity.js';
import { Transcript, canonicalize, signableBytes, verifyTranscript } from '../src/transcript.js';

function signedEntry(t: Transcript, id: { publicKey: string; secretKey: string }, type: string, payload: unknown) {
  const seq = t.entries.length;
  const sig = signBytes(id.secretKey, signableBytes(seq, t.head, type, id.publicKey, payload));
  return t.append({ type, from: id.publicKey, payload, sig });
}

describe('identity', () => {
  it('signs and verifies', () => {
    const id = genIdentity();
    const msg = new TextEncoder().encode('hello');
    const sig = signBytes(id.secretKey, msg);
    expect(verifyBytes(id.publicKey, msg, sig)).toBe(true);
    expect(verifyBytes(id.publicKey, new TextEncoder().encode('hellp'), sig)).toBe(false);
  });
});

describe('canonicalize', () => {
  it('is key-order independent', () => {
    expect(canonicalize({ b: 1, a: [{ y: 2, x: 3 }] })).toBe(canonicalize({ a: [{ x: 3, y: 2 }], b: 1 }));
  });
});

describe('transcript', () => {
  it('verifies an honest chain', () => {
    const alice = genIdentity(), bob = genIdentity();
    const t = new Transcript();
    signedEntry(t, alice, 'bet', { amount: 50 });
    signedEntry(t, bob, 'call', { amount: 50 });
    const pubkeys = new Map([[alice.publicKey, alice.publicKey], [bob.publicKey, bob.publicKey]]);
    const res = verifyTranscript(t.entries, pubkeys);
    expect(res).toEqual({ ok: true, head: t.head });
  });
  it('catches payload tampering', () => {
    const alice = genIdentity();
    const t = new Transcript();
    signedEntry(t, alice, 'bet', { amount: 50 });
    const forged = [{ ...t.entries[0]!, payload: { amount: 5000 } }];
    const res = verifyTranscript(forged, new Map([[alice.publicKey, alice.publicKey]]));
    expect(res.ok).toBe(false);
    expect(res.badSeq).toBe(0);
  });
  it('catches reordering', () => {
    const alice = genIdentity();
    const t = new Transcript();
    signedEntry(t, alice, 'a', 1);
    signedEntry(t, alice, 'b', 2);
    const res = verifyTranscript([t.entries[1]!, t.entries[0]!], new Map([[alice.publicKey, alice.publicKey]]));
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run packages/mental-poker` → FAIL.

- [ ] **Step 3: Implement**

`packages/mental-poker/src/identity.ts`:
```ts
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export function genIdentity(): { publicKey: string; secretKey: string } {
  const secret = ed25519.utils.randomPrivateKey();
  return { publicKey: bytesToHex(ed25519.getPublicKey(secret)), secretKey: bytesToHex(secret) };
}
export function signBytes(secretKeyHex: string, bytes: Uint8Array): string {
  return bytesToHex(ed25519.sign(bytes, hexToBytes(secretKeyHex)));
}
export function verifyBytes(publicKeyHex: string, bytes: Uint8Array, sigHex: string): boolean {
  try {
    return ed25519.verify(hexToBytes(sigHex), bytes, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}
```

`packages/mental-poker/src/transcript.ts`:
```ts
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { verifyBytes } from './identity.js';

export interface TranscriptEntry { seq: number; type: string; from: string; payload: unknown; sig: string }

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

const GENESIS = bytesToHex(sha256(utf8ToBytes('4amcasino/v1/transcript')));

export function signableBytes(seq: number, prevHead: string, type: string, from: string, payload: unknown): Uint8Array {
  return utf8ToBytes(canonicalize({ seq, prevHead, type, from, payload }));
}

function entryHead(prevHead: string, e: TranscriptEntry): string {
  return bytesToHex(sha256(utf8ToBytes(prevHead + canonicalize(e))));
}

export class Transcript {
  readonly entries: TranscriptEntry[] = [];
  #head = GENESIS;
  get head(): string { return this.#head; }
  append(e: Omit<TranscriptEntry, 'seq'>): TranscriptEntry {
    const entry: TranscriptEntry = { seq: this.entries.length, ...e };
    this.#head = entryHead(this.#head, entry);
    this.entries.push(entry);
    return entry;
  }
}

export function verifyTranscript(entries: TranscriptEntry[], pubkeys: Map<string, string>): { ok: boolean; head: string; badSeq?: number } {
  let head = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const pub = pubkeys.get(e.from);
    if (e.seq !== i || !pub || !verifyBytes(pub, signableBytes(e.seq, head, e.type, e.from, e.payload), e.sig)) {
      return { ok: false, head, badSeq: i };
    }
    head = entryHead(head, e);
  }
  return { ok: true, head };
}
```
Add to index: `export * from './identity.js'; export * from './transcript.js';`

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run packages/mental-poker` → PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test && npm run typecheck` → all green.
```bash
git add packages/mental-poker && git commit -m "feat(mental-poker): ed25519 identities and signed hash-chain transcripts"
```
