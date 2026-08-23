import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { attachHub } from '../src/hub.js';
import {
  cardLookup,
  genIdentity,
  handKeyCommit,
  invScalar,
  maskAndShuffle,
  mulPoint,
  pointFromHex,
  pointHex,
  proveUnmask,
  randScalar,
  randomPerm,
  recoverCard,
  signContent,
} from '@4am/mental-poker';
import type { CardId, PlayerAction, ServerMsg } from '@4am/shared';

type Strategy = 'passive' | 'fold-first';

class TestClient {
  username: string;
  token = '';
  userId = 0;
  identity = genIdentity();
  ws!: WebSocket;
  baseUrl: string;
  strategy: Strategy;
  respondShares = true;

  seat: number | null = null;
  handId: string | null = null;
  handKey: bigint | null = null;
  myCards: CardId[] = [];
  myCardPoints: { deckIndex: number; point: string }[] = [];
  board: CardId[] = [];
  cardsShown: { seat: number; cards: CardId[] }[] = [];
  peekOffers: { offerId: string; fromUserId: number; amount: number }[] = [];
  peekResults: { targetSeat: number; status: string; cards?: CardId[] }[] = [];
  sawShowdown = false;
  handEnd: Extract<ServerMsg, { t: 'hand_end' }> | null = null;
  handAbort: Extract<ServerMsg, { t: 'hand_abort' }> | null = null;
  lastRespondedActionSeq = -1;
  lookup = cardLookup();

  constructor(baseUrl: string, username: string, strategy: Strategy = 'passive') {
    this.baseUrl = baseUrl;
    this.username = username;
    this.strategy = strategy;
  }

  async register(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        authKey: 'a'.repeat(64),
        publicKey: this.identity.publicKey,
      }),
    });
    const json = (await res.json()) as { token: string; userId: number };
    this.token = json.token;
    this.userId = json.userId;
  }

  async api(path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json();
  }

  connect(roomId: string): Promise<void> {
    const wsUrl = this.baseUrl.replace('http', 'ws') + `/ws?token=${this.token}`;
    this.ws = new WebSocket(wsUrl);
    return new Promise((resolve) => {
      this.ws.on('open', () => {
        this.send({ t: 'join_room', roomId });
        resolve();
      });
      this.ws.on('message', (raw) => this.handle(JSON.parse(String(raw)) as ServerMsg));
    });
  }

  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }

  signed(t: string, body: unknown): string {
    return signContent(this.identity.secretKey, this.handId!, t, body);
  }

  private act(action: PlayerAction): void {
    this.send({ t: 'action', handId: this.handId, action, sig: this.signed('action', { action }) });
  }

  showCards(): void {
    const shares = this.myCardPoints.map(({ deckIndex, point }) => {
      const { out, proof } = proveUnmask(this.handKey!, pointFromHex(point));
      return { deckIndex, out: pointHex(out), proof };
    });
    this.send({ t: 'show_cards', handId: this.handId, shares, sig: this.signed('show_cards', { shares }) });
  }

  acceptPeek(offerId: string): void {
    const shares = this.myCardPoints.map(({ deckIndex, point }) => {
      const { out, proof } = proveUnmask(this.handKey!, pointFromHex(point));
      return { deckIndex, out: pointHex(out), proof };
    });
    this.send({
      t: 'peek_accept',
      handId: this.handId,
      offerId,
      shares,
      sig: this.signed('peek_accept', { offerId, shares }),
    });
  }

  handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'hand_start': {
        const mine = msg.seats.find((s) => s.userId === this.userId);
        if (!mine) break;
        // like the real client: a re-delivered hand_start (reconnect) keeps state and key
        if (this.handId !== msg.handId) {
          this.seat = mine.seat;
          this.handId = msg.handId;
          this.handKey = randScalar();
          this.myCards = [];
          this.myCardPoints = [];
          this.board = [];
          this.cardsShown = [];
          this.sawShowdown = false;
          this.handEnd = null;
          this.handAbort = null;
          this.lastRespondedActionSeq = -1;
        }
        const commit = pointHex(handKeyCommit(this.handKey!));
        this.send({ t: 'key_commit', handId: this.handId, commit, sig: this.signed('key_commit', { commit }) });
        break;
      }
      case 'shuffle_turn': {
        if (msg.seat !== this.seat) break;
        const deck = msg.deck.map(pointFromHex);
        const out = maskAndShuffle(deck, this.handKey!, randomPerm(52)).map(pointHex);
        this.send({ t: 'shuffle_deck', handId: this.handId, deck: out, sig: this.signed('shuffle_deck', { deck: out }) });
        break;
      }
      case 'need_share': {
        if (!this.respondShares) break;
        const { out, proof } = proveUnmask(this.handKey!, pointFromHex(msg.point));
        const body = { deckIndex: msg.deckIndex, out: pointHex(out), proof };
        this.send({ t: 'unmask_share', handId: this.handId, ...body, sig: this.signed('unmask_share', body) });
        break;
      }
      case 'your_card': {
        if (this.myCardPoints.some((c) => c.deckIndex === msg.deckIndex)) break;
        const plain = mulPoint(pointFromHex(msg.point), invScalar(this.handKey!));
        const card = recoverCard(plain, this.lookup);
        if (card !== null) {
          this.myCards.push(card);
          this.myCardPoints.push({ deckIndex: msg.deckIndex, point: msg.point });
        }
        break;
      }
      case 'board_open': {
        if (!this.board.includes(msg.card)) this.board.push(msg.card);
        break;
      }
      case 'cards_shown': {
        this.cardsShown.push({ seat: msg.seat, cards: msg.cards });
        break;
      }
      case 'peek_offer': {
        this.peekOffers.push({ offerId: msg.offerId, fromUserId: msg.fromUserId, amount: msg.amount });
        break;
      }
      case 'peek_result': {
        this.peekResults.push({ targetSeat: msg.targetSeat, status: msg.status, cards: msg.cards });
        break;
      }
      case 'betting_state': {
        const st = msg.state;
        if (st.toAct !== this.seat || msg.actionSeq === this.lastRespondedActionSeq) break;
        this.lastRespondedActionSeq = msg.actionSeq;
        const me = st.seats.find((s) => s.seat === this.seat)!;
        if (this.strategy === 'fold-first') this.act({ type: 'fold' });
        else if (st.currentBet === me.committed) this.act({ type: 'check' });
        else this.act({ type: 'call' });
        break;
      }
      case 'showdown': {
        this.sawShowdown = true;
        break;
      }
      case 'hand_end': {
        this.handEnd = msg;
        break;
      }
      case 'hand_abort': {
        this.handAbort = msg;
        break;
      }
      case 'need_keys': {
        const key = this.handKey!.toString(16);
        this.send({ t: 'reveal_key', handId: this.handId, key, sig: this.signed('reveal_key', { key }) });
        break;
      }
      default:
        break;
    }
  }

  async waitFor(pred: () => boolean, ms = 15000): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > ms) throw new Error(`timeout waiting (${this.username})`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  close(): void {
    this.ws?.close();
  }
}

let ctx: ReturnType<typeof createApp>;
let baseUrl: string;
let clients: TestClient[] = [];

beforeEach(async () => {
  ctx = createApp(':memory:');
  attachHub(ctx.app, ctx.db, { cryptoTimeoutMs: 1500, actionTimeoutMs: 1500 });
  await ctx.app.listen({ port: 0 });
  const addr = ctx.app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  clients = [];
});

afterEach(async () => {
  for (const c of clients) c.close();
  await ctx.app.close();
});

async function setupRoom(names: string[], strategies: Strategy[] = []) {
  const players = names.map((n, i) => new TestClient(baseUrl, n, strategies[i] ?? 'passive'));
  clients.push(...players);
  for (const p of players) await p.register();
  const host = players[0]!;
  const room = await host.api('/api/rooms', { name: 'Test', sb: 10, bb: 20 });
  for (const p of players.slice(1)) await p.api('/api/rooms/join', { joinCode: room.joinCode });
  for (const p of players) {
    const req = await p.api(`/api/rooms/${room.id}/buy`, { amount: 1000 });
    await host.api(`/api/rooms/${room.id}/approve`, { requestId: req.id, approve: true });
  }
  for (const [i, p] of players.entries()) {
    await p.connect(room.id);
    p.send({ t: 'sit', seat: i });
  }
  await new Promise((r) => setTimeout(r, 100)); // let sits settle
  return { players, room, host };
}

describe('full hand integration', () => {
  it('three players play a complete hand to showdown', async () => {
    const { players, room, host } = await setupRoom(['host', 'bob', 'carol']);
    host.send({ t: 'start_hand' });
    await Promise.all(players.map((p) => p.waitFor(() => p.handEnd !== null)));

    for (const p of players) {
      expect(p.handAbort).toBeNull();
      expect(p.myCards).toHaveLength(2);
      expect(new Set(p.myCards).size).toBe(2);
      expect(p.board).toHaveLength(5);
      expect(p.sawShowdown).toBe(true);
    }
    // all clients agree on the board
    expect(players[1]!.board).toEqual(players[0]!.board);
    expect(players[2]!.board).toEqual(players[0]!.board);
    // no card appears twice across boards + all hole cards
    const all = [...players[0]!.board, ...players.flatMap((p) => p.myCards)];
    expect(new Set(all).size).toBe(all.length);

    // chips conserved: everyone matched the BB (passive play), pot 60
    const stacks = players[0]!.handEnd!.stacks;
    expect(stacks.reduce((s, x) => s + x.stack, 0)).toBe(3000);
    const deltas = players[0]!.handEnd!.deltas;
    expect(deltas.reduce((s, x) => s + x.delta, 0)).toBe(0);

    // DB: stacks persisted, ledger has verifiable settlement entries, transcript stored
    const state = await host.api(`/api/rooms/${room.id}`);
    expect(
      state.players.reduce((s: number, p: { stack: number }) => s + p.stack, 0),
    ).toBe(3000);
    const ledger = await host.api(`/api/rooms/${room.id}/ledger`);
    expect(ledger.verified.ok).toBe(true);
    const settlements = ledger.entries.filter((e: { kind: string }) => e.kind === 'hand-settlement');
    expect(settlements.length).toBeGreaterThan(0);
    expect(settlements[0].ref).toBe(players[0]!.handEnd!.head);
    const row = ctx.db
      .prepare('SELECT head FROM transcripts WHERE hand_id = ?')
      .get(players[0]!.handEnd!.handId) as { head: string };
    expect(row.head).toBe(players[0]!.handEnd!.head);
  });

  it('fold-out ends the hand without any reveal', async () => {
    const { players, host } = await setupRoom(['host', 'bob'], ['fold-first', 'fold-first']);
    // heads-up: button/SB acts first and folds; BB wins blinds without showdown
    host.send({ t: 'start_hand' });
    await Promise.all(players.map((p) => p.waitFor(() => p.handEnd !== null)));
    for (const p of players) {
      expect(p.sawShowdown).toBe(false);
      expect(p.handAbort).toBeNull();
    }
    const deltas = players[0]!.handEnd!.deltas;
    expect(deltas.reduce((s, x) => s + x.delta, 0)).toBe(0);
    expect(Math.max(...deltas.map((d) => d.delta))).toBe(10); // BB wins the small blind
  });

  it('a stalling player causes an abort that blames them and leaves stacks untouched', async () => {
    const { players, room, host } = await setupRoom(['host', 'bob', 'mallory']);
    players[2]!.respondShares = false; // mallory never answers unmask requests
    host.send({ t: 'start_hand' });
    await Promise.all(players.slice(0, 2).map((p) => p.waitFor(() => p.handAbort !== null, 20000)));
    expect(players[0]!.handAbort!.blamedSeat).toBe(2);
    const state = await host.api(`/api/rooms/${room.id}`);
    for (const p of state.players) expect(p.stack).toBe(1000);
  }, 20000);

  it('a disconnected player can rejoin during the grace window and the hand completes', async () => {
    const { players, room, host } = await setupRoom(['host', 'bob', 'flaky']);
    const flaky = players[2]!;
    flaky.respondShares = false; // simulates a device that missed the requests
    host.send({ t: 'start_hand' });
    await new Promise((r) => setTimeout(r, 2000)); // the deal is now stalled on flaky
    expect(host.handAbort).toBeNull();
    flaky.ws.close();
    flaky.respondShares = true;
    await flaky.connect(room.id); // rejoin: the server re-sends what it is waiting on
    await Promise.all(players.map((p) => p.waitFor(() => p.handEnd !== null, 20000)));
    for (const p of players) expect(p.handAbort).toBeNull();
    expect(flaky.myCards).toHaveLength(2);
  }, 20000);

  it('a folded player can voluntarily show cards while the hand continues', async () => {
    const { players, host } = await setupRoom(
      ['host', 'bob', 'carol'],
      ['fold-first', 'passive', 'passive'],
    );
    host.send({ t: 'start_hand' });
    await host.waitFor(() => host.lastRespondedActionSeq >= 0); // host has sent the fold
    await new Promise((r) => setTimeout(r, 200));
    host.showCards();
    await players[2]!.waitFor(() => players[2]!.cardsShown.length > 0);
    expect(players[2]!.cardsShown[0]!.seat).toBe(host.seat);
    expect(players[2]!.cardsShown[0]!.cards.slice().sort()).toEqual(host.myCards.slice().sort());
    await Promise.all(players.map((p) => p.waitFor(() => p.handEnd !== null)));
    expect(players[0]!.handAbort).toBeNull();
  });

  it('a paid peek reveals cards only to the buyer and moves the chips', async () => {
    const { players, room, host } = await setupRoom(
      ['host', 'bob', 'carol'],
      ['fold-first', 'fold-first', 'passive'],
    );
    const [h, bob, carol] = players as [TestClient, TestClient, TestClient];
    host.send({ t: 'start_hand' });
    await Promise.all(players.map((p) => p.waitFor(() => p.handEnd !== null)));

    // carol (won by folds) pays 100 to see host's mucked cards
    carol.send({ t: 'peek_offer', handId: carol.handId, targetSeat: h.seat, amount: 100 });
    await h.waitFor(() => h.peekOffers.length > 0);
    expect(h.peekOffers[0]!.amount).toBe(100);
    h.acceptPeek(h.peekOffers[0]!.offerId);
    await carol.waitFor(() => carol.peekResults.length > 0);

    const result = carol.peekResults[0]!;
    expect(result.status).toBe('accepted');
    expect(result.cards!.slice().sort()).toEqual(h.myCards.slice().sort());
    // the reveal went only to the buyer
    expect(bob.peekResults).toHaveLength(0);
    expect(bob.cardsShown).toHaveLength(0);

    // chips moved: carol paid host 100 on top of the blind results
    const state = await host.api(`/api/rooms/${room.id}`);
    const stack = (name: string) => state.players.find((p: any) => p.username === name).stack;
    expect(stack('host')).toBe(1100); // folded for free, then sold a look for 100
    expect(stack('carol')).toBe(910); // won the 10 blind, paid 100
    const ledger = await host.api(`/api/rooms/${room.id}/ledger`);
    expect(ledger.verified.ok).toBe(true);
    expect(ledger.entries.filter((e: any) => e.kind === 'peek')).toHaveLength(2);
  });

  it('a sitting-out player is skipped when the next hand is dealt', async () => {
    const { players, host } = await setupRoom(['host', 'bob', 'carol']);
    players[2]!.send({ t: 'sit_out', sittingOut: true });
    await new Promise((r) => setTimeout(r, 100));
    host.send({ t: 'start_hand' });
    await Promise.all(players.slice(0, 2).map((p) => p.waitFor(() => p.handEnd !== null)));
    const seats = players[0]!.handEnd!.stacks.map((s) => s.seat).sort();
    expect(seats).toEqual([0, 1]);
  });

  it('the fold winner can voluntarily show cards after the hand ends', async () => {
    const { players, host } = await setupRoom(['host', 'bob'], ['fold-first', 'passive']);
    host.send({ t: 'start_hand' });
    await Promise.all(players.map((p) => p.waitFor(() => p.handEnd !== null)));
    const bob = players[1]!;
    bob.showCards();
    await host.waitFor(() => host.cardsShown.length > 0);
    expect(host.cardsShown[0]!.seat).toBe(bob.seat);
    expect(host.cardsShown[0]!.cards.slice().sort()).toEqual(bob.myCards.slice().sort());
  });
});
