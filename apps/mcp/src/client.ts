import WebSocket from 'ws';
import { scrypt } from '@noble/hashes/scrypt';
import { bytesToHex } from '@noble/hashes/utils';
import {
  cardLookup,
  handKeyCommit,
  identityFromSeed,
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
import {
  HAND_CATEGORY_NAMES,
  cardName,
  describeScore,
  evaluate7,
  handCategory,
  legalActions,
  type BettingState,
  type CardId,
  type PlayerAction,
  type ServerMsg,
} from '@4am/shared';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;
const lookup = cardLookup();

export interface RoomView {
  id: string;
  name: string;
  joinCode: string;
  hostId: number;
  bankerId: number;
  coBankerId: number | null;
  sb: number;
  bb: number;
  minSettleHands: number;
  sevenDeuceBonus: number;
}

interface RoomPlayer {
  userId: number;
  username: string;
  displayName: string;
  seat: number | null;
  stack: number;
  sittingOut: boolean;
  connected: boolean;
  totalBought: number;
  privateStats: boolean;
}

/**
 * A full headless 4AM Casino player: it performs every mental-poker duty
 * (key commits, shuffles, DLEQ unmask shares, reveals) automatically, and
 * leaves only the poker decisions to the caller.
 */
export class HeadlessClient {
  token = '';
  userId = 0;
  private identity!: { publicKey: string; secretKey: string };
  private ws: WebSocket | null = null;
  private roomId: string | null = null;
  private closedByUs = false;

  room: { room: RoomView; players: RoomPlayer[]; handActive: boolean } | null = null;
  handId: string | null = null;
  seats: { seat: number; userId: number; username: string }[] = [];
  myCards: CardId[] = [];
  myCardPoints: { deckIndex: number; point: string }[] = [];
  board: CardId[] = [];
  betting: BettingState | null = null;
  actionSeq = -1;
  private lastActedSeq = -2;
  deadline: number | null = null;
  result: Extract<ServerMsg, { t: 'hand_end' }> | null = null;
  showdown: Extract<ServerMsg, { t: 'showdown' }> | null = null;
  abort: Extract<ServerMsg, { t: 'hand_abort' }> | null = null;
  peekOffers: { offerId: string; fromName: string; amount: number }[] = [];
  events: string[] = [];
  private handKeys = new Map<string, bigint>();
  private waiters = new Set<() => void>();

  constructor(
    private baseUrl: string,
    private username: string,
    private password: string,
  ) {}

  // ---------- auth ----------

  private derive(): { authKey: string; identity: { publicKey: string; secretKey: string } } {
    const authKey = bytesToHex(scrypt(this.password, `4am/auth/${this.username}`, SCRYPT));
    const identity = identityFromSeed(scrypt(this.password, `4am/id/${this.username}`, SCRYPT));
    return { authKey, identity };
  }

  async login(registerIfMissing = true): Promise<void> {
    const { authKey, identity } = this.derive();
    this.identity = identity;
    let res = await fetch(`${this.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.username, authKey }),
    });
    if (res.status === 401 && registerIfMissing) {
      res = await fetch(`${this.baseUrl}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: this.username, authKey, publicKey: identity.publicKey }),
      });
    }
    if (!res.ok) throw new Error(`login failed: ${((await res.json()) as { error?: string }).error ?? res.status}`);
    const json = (await res.json()) as { token: string; userId: number };
    this.token = json.token;
    this.userId = json.userId;
  }

  async api(path: string, body?: unknown, method?: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
    return json;
  }

  // ---------- room lifecycle ----------

  async joinByCode(joinCode: string): Promise<string> {
    const room = await this.api('/api/rooms/join', { joinCode });
    await this.connect(room.id as string);
    return room.id as string;
  }

  async connect(roomId: string): Promise<void> {
    this.roomId = roomId;
    this.closedByUs = false;
    await this.openSocket();
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.baseUrl.replace(/^http/, 'ws') + `/ws?token=${this.token}`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.on('open', () => {
        this.send({ t: 'join_room', roomId: this.roomId });
        resolve();
      });
      ws.on('message', (raw) => {
        try {
          this.handle(JSON.parse(String(raw)) as ServerMsg);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[${this.username}] handler error on ${String(raw).slice(0, 60)}:`, err);
        }
      });
      ws.on('error', (err) => reject(err));
      ws.on('close', () => {
        this.ws = null;
        if (!this.closedByUs && this.roomId) {
          setTimeout(() => void this.openSocket().catch(() => {}), 1500);
        }
      });
    });
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
  }

  send(obj: unknown): void {
    this.ws?.send(JSON.stringify(obj));
  }

  private signed(handId: string, t: string, body: unknown): string {
    return signContent(this.identity.secretKey, handId, t, body);
  }

  private keyFor(handId: string): bigint {
    let k = this.handKeys.get(handId);
    if (!k) {
      k = randScalar();
      this.handKeys.set(handId, k);
    }
    return k;
  }

  // ---------- game protocol (all crypto automatic) ----------

  private handle(msg: ServerMsg): void {
    if (process.env.FOURAM_DEBUG) {
      // eslint-disable-next-line no-console
      console.error(`${Date.now() % 100000} [${this.username}] <- ${msg.t}${'deckIndex' in msg ? ` idx=${(msg as { deckIndex?: number }).deckIndex}` : ''}`);
    }
    switch (msg.t) {
      case 'room_state':
        this.room = { room: msg.room as RoomView, players: msg.players, handActive: msg.handActive };
        break;
      case 'hand_start': {
        if (this.handId !== msg.handId) {
          this.handId = msg.handId;
          this.seats = msg.seats;
          this.myCards = [];
          this.myCardPoints = [];
          this.board = [];
          this.betting = null;
          this.actionSeq = -1;
          this.lastActedSeq = -2;
          this.result = null;
          this.showdown = null;
          this.abort = null;
          this.peekOffers = [];
          for (const key of this.handKeys.keys()) if (key !== msg.handId) this.handKeys.delete(key);
          this.log(`hand ${msg.handId.slice(0, 6)} dealt (blinds ${msg.sb}/${msg.bb})`);
        }
        if (!msg.seats.some((s) => s.userId === this.userId)) break;
        const commit = pointHex(handKeyCommit(this.keyFor(msg.handId)));
        this.send({ t: 'key_commit', handId: msg.handId, commit, sig: this.signed(msg.handId, 'key_commit', { commit }) });
        break;
      }
      case 'shuffle_turn': {
        if (this.mySeat() !== msg.seat) break;
        const deck = maskAndShuffle(msg.deck.map(pointFromHex), this.keyFor(msg.handId), randomPerm(52)).map(pointHex);
        this.send({ t: 'shuffle_deck', handId: msg.handId, deck, sig: this.signed(msg.handId, 'shuffle_deck', { deck }) });
        break;
      }
      case 'need_share': {
        const { out, proof } = proveUnmask(this.keyFor(msg.handId), pointFromHex(msg.point));
        const body = { deckIndex: msg.deckIndex, out: pointHex(out), proof };
        this.send({ t: 'unmask_share', handId: msg.handId, ...body, sig: this.signed(msg.handId, 'unmask_share', body) });
        break;
      }
      case 'your_card': {
        if (this.myCardPoints.some((c) => c.deckIndex === msg.deckIndex)) break;
        const plain = mulPoint(pointFromHex(msg.point), invScalar(this.keyFor(msg.handId)));
        const card = recoverCard(plain, lookup);
        if (card !== null) {
          this.myCards.push(card);
          this.myCardPoints.push({ deckIndex: msg.deckIndex, point: msg.point });
        }
        break;
      }
      case 'board_open':
        if (!this.board.includes(msg.card)) this.board.push(msg.card);
        break;
      case 'betting_state':
        this.betting = msg.state;
        this.actionSeq = msg.actionSeq;
        this.board = msg.board;
        this.deadline = msg.deadline;
        break;
      case 'action_applied':
        this.log(`${this.nameOf(msg.seat)} ${msg.action.type}${msg.action.amount ? ` ${msg.action.amount}` : ''}${msg.auto ? ' (timed out)' : ''}`);
        break;
      case 'showdown':
        this.showdown = msg;
        for (const r of msg.reveals) {
          this.log(`${this.nameOf(r.seat)} shows ${r.cards.map(cardName).join(' ')} (${HAND_CATEGORY_NAMES[handCategory(r.score)]})`);
        }
        break;
      case 'hand_end': {
        this.result = msg;
        const winners = msg.deltas.filter((d) => d.delta > 0).map((d) => `${this.nameOf(d.seat)} +${d.delta}`);
        this.log(`hand over: ${winners.join(', ') || 'no chips moved'}`);
        break;
      }
      case 'hand_abort':
        this.abort = msg;
        this.log(`hand aborted: ${msg.reason}`);
        break;
      case 'need_keys': {
        const key = this.keyFor(msg.handId).toString(16);
        this.send({ t: 'reveal_key', handId: msg.handId, key, sig: this.signed(msg.handId, 'reveal_key', { key }) });
        break;
      }
      case 'cards_shown':
        this.log(`${this.nameOf(msg.seat)} showed ${msg.cards.map(cardName).join(' ')}`);
        break;
      case 'seven_deuce':
        this.log(`7-2 offsuit bounty: ${this.nameOf(msg.seat)} collects ${msg.amount}`);
        break;
      case 'peek_offer':
        this.peekOffers.push({ offerId: msg.offerId, fromName: msg.fromName, amount: msg.amount });
        this.log(`${msg.fromName} offers ${msg.amount} chips to privately see your last hand (offerId ${msg.offerId})`);
        break;
      case 'peek_result':
        if (msg.status === 'accepted' && msg.cards) {
          this.log(`peek accepted: seat ${msg.targetSeat + 1} had ${msg.cards.map(cardName).join(' ')} (only you can see this)`);
        } else {
          this.log('your peek offer was declined');
        }
        break;
      case 'chat':
        this.log(`${msg.from}: ${msg.text}`);
        break;
      case 'error':
        this.log(`server: ${msg.message}`);
        break;
      case 'auto_deal':
        this.log(`next hand deals itself in ${Math.round(msg.inMs / 1000)}s`);
        break;
      case 'ready_check':
        // a robot is always ready for the next hand
        this.send({ t: 'im_ready' });
        break;
      default:
        break;
    }
    for (const w of this.waiters) w();
  }

  private log(line: string): void {
    this.events.push(line);
    if (this.events.length > 60) this.events.splice(0, this.events.length - 60);
  }

  // ---------- reads ----------

  mySeat(): number | null {
    return this.seats.find((s) => s.userId === this.userId)?.seat ?? this.room?.players.find((p) => p.userId === this.userId)?.seat ?? null;
  }

  private nameOf(seat: number): string {
    const userId = this.seats.find((s) => s.seat === seat)?.userId;
    const p = this.room?.players.find((x) => x.userId === userId);
    return p?.displayName ?? this.seats.find((s) => s.seat === seat)?.username ?? `seat ${seat + 1}`;
  }

  handLive(): boolean {
    return this.handId !== null && !this.result && !this.abort;
  }

  myTurn(): boolean {
    if (!this.handLive() || !this.betting) return false;
    // after acting, wait for the table to advance before acting again -
    // prevents double-sends from a snapshot that has not caught up yet
    if (this.actionSeq === this.lastActedSeq) return false;
    const la = legalActions(this.betting);
    return la !== null && la.seat === this.mySeat();
  }

  /** A compact, human/agent-readable snapshot of everything visible. */
  stateSummary(): string {
    const lines: string[] = [];
    if (!this.room) return 'Not in a room yet. Use join_room with a 6-letter code, or my_rooms to list rooms.';
    const r = this.room.room;
    lines.push(`Room "${r.name}" (code ${r.joinCode}), blinds ${r.sb}/${r.bb}${r.sevenDeuceBonus ? `, 7-2 bounty ${r.sevenDeuceBonus}` : ''}`);
    const me = this.room.players.find((p) => p.userId === this.userId);
    lines.push(`You are ${me?.displayName ?? this.username}${me?.seat !== null && me?.seat !== undefined ? ` in seat ${me.seat + 1}` : ' (no seat yet - use take_seat)'} with ${me?.stack ?? 0} chips.`);
    if (this.userId === r.hostId) lines.push('You are the host (you can start_hand).');
    if (this.userId === r.bankerId || this.userId === r.coBankerId) lines.push('You are a banker (bank_requests / approve_purchase work).');
    lines.push('Players:');
    for (const p of this.room.players) {
      lines.push(
        `  ${p.seat !== null ? `seat ${p.seat + 1}` : 'no seat'}: ${p.displayName} - ${p.stack} chips${p.sittingOut ? ', sitting out' : ''}${p.connected ? '' : ', disconnected'}`,
      );
    }
    if (this.handLive() && this.betting) {
      const st = this.betting;
      const pot = st.seats.reduce((s, x) => s + x.total, 0);
      lines.push(`Hand in progress (${st.street}). Board: ${this.board.map(cardName).join(' ') || 'not dealt yet'}. Pot ${pot}.`);
      if (this.myCards.length) {
        lines.push(`Your cards: ${this.myCards.map(cardName).join(' ')}`);
        if (this.board.length === 5) lines.push(`Your best hand: ${describeScore(evaluate7([...this.myCards, ...this.board]))}`);
      }
      const la = legalActions(st);
      if (la && la.seat === this.mySeat()) {
        const opts = [
          'fold',
          la.canCheck ? 'check' : `call ${la.callAmount}`,
          la.canRaise ? `${st.currentBet === 0 ? 'bet' : 'raise'} between ${la.minRaiseTo} and ${la.maxRaiseTo}` : null,
        ].filter(Boolean);
        const secs = this.deadline ? Math.max(0, Math.round((this.deadline - Date.now()) / 1000)) : null;
        lines.push(`IT IS YOUR TURN. Options: ${opts.join(' | ')}${secs !== null ? `. ${secs}s left before auto-fold` : ''}`);
      } else if (la) {
        lines.push(`Waiting for ${this.nameOf(la.seat)} to act.`);
      } else {
        lines.push('Cards are being dealt/revealed (the crypto runs automatically).');
      }
    } else if (this.result) {
      lines.push('The last hand is over.');
      if (this.myCards.length) lines.push(`You held: ${this.myCards.map(cardName).join(' ')}`);
    } else {
      lines.push('No hand in progress.');
    }
    if (this.peekOffers.length) {
      for (const o of this.peekOffers) lines.push(`PENDING PEEK OFFER: ${o.fromName} pays ${o.amount} to see your cards (answer_peek offerId=${o.offerId}).`);
    }
    if (this.events.length) {
      lines.push('Recent events:');
      for (const e of this.events.slice(-12)) lines.push(`  - ${e}`);
    }
    return lines.join('\n');
  }

  // ---------- writes ----------

  act(action: PlayerAction): string {
    if (!this.handId) throw new Error('no hand in progress');
    if (!this.betting) throw new Error('betting has not started');
    const la = legalActions(this.betting);
    if (!la || la.seat !== this.mySeat()) throw new Error('it is not your turn');
    if (action.type === 'check' && !la.canCheck) throw new Error(`cannot check: call ${la.callAmount} or fold`);
    if ((action.type === 'bet' || action.type === 'raise') && action.amount !== undefined) {
      if (action.amount < la.minRaiseTo || action.amount > la.maxRaiseTo)
        throw new Error(`amount must be between ${la.minRaiseTo} and ${la.maxRaiseTo}`);
    }
    this.send({ t: 'action', handId: this.handId, action, sig: this.signed(this.handId, 'action', { action }) });
    this.lastActedSeq = this.actionSeq;
    return `sent ${action.type}${action.amount ? ` ${action.amount}` : ''}`;
  }

  showCards(): void {
    if (!this.handId || this.myCardPoints.length === 0) throw new Error('no cards to show for the last hand');
    const k = this.keyFor(this.handId);
    const shares = this.myCardPoints.map(({ deckIndex, point }) => {
      const { out, proof } = proveUnmask(k, pointFromHex(point));
      return { deckIndex, out: pointHex(out), proof };
    });
    this.send({ t: 'show_cards', handId: this.handId, shares, sig: this.signed(this.handId, 'show_cards', { shares }) });
  }

  answerPeek(offerId: string, accept: boolean): void {
    if (!this.handId) throw new Error('no hand context');
    this.peekOffers = this.peekOffers.filter((o) => o.offerId !== offerId);
    if (!accept) {
      this.send({ t: 'peek_decline', handId: this.handId, offerId });
      return;
    }
    const k = this.keyFor(this.handId);
    const shares = this.myCardPoints.map(({ deckIndex, point }) => {
      const { out, proof } = proveUnmask(k, pointFromHex(point));
      return { deckIndex, out: pointHex(out), proof };
    });
    this.send({ t: 'peek_accept', handId: this.handId, offerId, shares, sig: this.signed(this.handId, 'peek_accept', { offerId, shares }) });
  }

  /** Waits until it is my turn, the hand ends, or the timeout passes. */
  async waitForTurn(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    await new Promise((r) => setTimeout(r, 25)); // let queued frames drain first
    while (Date.now() < deadline) {
      if (this.myTurn() || this.result || this.abort) return;
      await new Promise<void>((res) => {
        const w = () => {
          this.waiters.delete(w);
          res();
        };
        this.waiters.add(w);
        setTimeout(w, Math.min(500, Math.max(50, deadline - Date.now())));
      });
    }
  }
}
