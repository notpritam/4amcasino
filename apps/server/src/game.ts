import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  Transcript,
  cardLookup,
  handKeyCommit,
  initialDeck,
  pointFromHex,
  pointHex,
  recoverCard,
  signContent,
  verifyContent,
  verifyUnmask,
  type Point,
} from '@4am/mental-poker';
import {
  activeNonAllIn,
  applyAction,
  awardPots,
  computePots,
  evaluate7,
  nextStreet,
  startHand,
  streetClosed,
  type BettingState,
  type CardId,
  type ClientMsg,
  type PlayerAction,
  type ServerMsg,
  signedBody,
} from '@4am/shared';
import type { DB } from './db.js';
import { appendLedger } from './ledger.js';
import { getRoom, roomPlayers } from './rooms.js';

export interface GameOpts {
  cryptoTimeoutMs: number;
  actionTimeoutMs: number;
  /** Extra chances a stalled player gets before the hand aborts (default 3). */
  cryptoRetries?: number;
  /** Delay before the next hand deals itself while the host is online (default 15s). */
  autoDealMs?: number;
}

interface Identity {
  publicKey: string;
  secretKey: string;
}

interface HandSeatInfo {
  seat: number;
  userId: number;
  username: string;
  pubkey: string;
  stack: number;
}

interface Chain {
  deckIndex: number;
  forSeat: number | null;
  purpose: 'hole' | 'board' | 'showdown';
  current: Point;
  remaining: number[]; // seats yet to apply their unmask, in order
}

/** Rooms with a hand in flight; REST money moves must wait for the settle. */
export const activeHands = new Set<string>();

/** The classic house rule: 7-2 offsuit wins collect a bounty from everyone. */
export function isSevenDeuce(cards: CardId[]): boolean {
  if (cards.length !== 2) return false;
  const ranks = cards.map((c) => Math.floor(c / 4)).sort((a, b) => a - b);
  const suits = cards.map((c) => c % 4);
  return ranks[0] === 0 && ranks[1] === 5 && suits[0] !== suits[1]; // 2 and 7, offsuit
}

interface SnapshotSeat {
  userId: number;
  pubkey: string;
  commit: Point;
  cards: { deckIndex: number; point: Point }[];
}

interface ShowSnapshot {
  handId: string;
  bySeat: Map<number, SnapshotSeat>;
  revealedSeats: Set<number>;
  winnerSeats: number[];
  reveals: Map<number, CardId[]>;
}

type Share = { deckIndex: number; out: string; proof: { A1: string; A2: string; z: string } };

/** Verifies a player's DLEQ unmask shares against a finished hand's snapshot. */
function verifySnapshotShares(
  entry: SnapshotSeat,
  shares: Share[],
  lookup: ReturnType<typeof cardLookup>,
): CardId[] | null {
  const points = new Map(entry.cards.map((c) => [c.deckIndex, c.point]));
  const cards: CardId[] = [];
  const seen = new Set<number>();
  for (const sh of shares) {
    const pIn = points.get(sh.deckIndex);
    if (!pIn || seen.has(sh.deckIndex)) return null;
    seen.add(sh.deckIndex);
    let out: Point;
    try {
      out = pointFromHex(sh.out);
    } catch {
      return null;
    }
    if (!verifyUnmask(entry.commit, pIn, out, sh.proof)) return null;
    const card = recoverCard(out, lookup);
    if (card === null) return null;
    cards.push(card);
  }
  return cards;
}

export class GameRoom {
  private sockets = new Map<number, WebSocket>();
  private hand: Hand | null = null;
  private lastButton: number | null = null;
  // voluntary card shows for the current (or most recently ended) hand
  private shown = new Map<number, CardId[]>();
  private shownHandId: string | null = null;
  private lastHandShow: ShowSnapshot | null = null;
  private peekOffers = new Map<string, { handId: string; fromUserId: number; targetSeat: number; amount: number }>();
  private sevenDeucePaid = new Set<string>();
  private autoDeal: NodeJS.Timeout | null = null;
  private lookup = cardLookup();

  constructor(
    private db: DB,
    readonly roomId: string,
    private serverId: Identity,
    private opts: GameOpts,
  ) {}

  join(userId: number, ws: WebSocket): void {
    this.sockets.set(userId, ws);
    this.broadcastRoomState();
    // late joiners and reconnects still get to see voluntarily shown cards
    if (this.shownHandId) {
      for (const [seat, cards] of this.shown) {
        this.send(userId, { t: 'cards_shown', handId: this.shownHandId, seat, cards });
      }
    }
    // a rejoining participant gets the whole hand context back, plus any
    // request (shuffle turn, unmask share) the table is still waiting on
    this.hand?.resendPending(userId);
  }

  leave(userId: number, ws: WebSocket): void {
    if (this.sockets.get(userId) === ws) {
      this.sockets.delete(userId);
      this.broadcastRoomState();
    }
  }

  shutdown(): void {
    this.hand?.clearTimer();
    this.hand = null;
    activeHands.delete(this.roomId);
    if (this.autoDeal) clearTimeout(this.autoDeal);
    this.autoDeal = null;
  }

  /** While the host is online the next hand deals itself after a short break. */
  private scheduleAutoDeal(): void {
    if (this.autoDeal) clearTimeout(this.autoDeal);
    const delay = this.opts.autoDealMs ?? 15_000;
    const room = getRoom(this.db, this.roomId);
    if (!room || !this.sockets.has(room.host_id)) return;
    this.autoDeal = setTimeout(() => {
      this.autoDeal = null;
      if (this.hand || !this.db.open) return;
      const current = getRoom(this.db, this.roomId);
      if (!current || !this.sockets.has(current.host_id)) return;
      this.startHand(true);
    }, delay);
    this.broadcast({ t: 'auto_deal', inMs: delay });
  }

  send(userId: number, msg: ServerMsg): void {
    this.sockets.get(userId)?.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets.values()) ws.send(data);
  }

  broadcastRoomState(): void {
    if (!this.db.open) return; // server shutting down
    const room = getRoom(this.db, this.roomId);
    if (!room) return;
    const players = roomPlayers(this.db, this.roomId).map((p) => ({
      userId: p.userId,
      username: p.username,
      displayName: p.displayName,
      avatarVersion: p.avatarVersion,
      publicKey: p.publicKey,
      seat: p.seat,
      stack: p.stack,
      sittingOut: !!p.sittingOut,
      connected: this.sockets.has(p.userId),
      totalBought: p.privateMode ? 0 : p.totalBought,
      privateStats: !!p.privateMode,
      pendingBuy: p.pendingBuy,
      avatar3d: p.avatar3d,
    }));
    const state: ServerMsg = {
      t: 'room_state',
      room: {
        id: room.id,
        name: room.name,
        joinCode: room.join_code,
        hostId: room.host_id,
        bankerId: room.banker_id,
        sb: room.sb,
        bb: room.bb,
        auditMode: room.audit_mode,
        actionTimeoutMs: room.action_secs !== null ? room.action_secs * 1000 : this.opts.actionTimeoutMs,
        actionSecs: room.action_secs,
        coBankerId: room.co_banker_id,
        minSettleHands: room.min_settle_hands,
        autoApproveBuys: !!room.auto_approve_buys,
        sevenDeuceBonus: room.seven_deuce_bonus,
        voided: !!room.voided,
        meetLink: room.meet_link,
      },
      players,
      handActive: this.hand !== null,
    };
    // spectators watch the table but never see the join code
    const memberIds = new Set(players.map((p) => p.userId));
    const masked = JSON.stringify({ ...state, room: { ...state.room, joinCode: '' } });
    const full = JSON.stringify(state);
    for (const [uid, ws] of this.sockets) ws.send(memberIds.has(uid) ? full : masked);
  }

  handleMessage(userId: number, msg: ClientMsg): void {
    switch (msg.t) {
      case 'chat': {
        const user = this.db
          .prepare('SELECT COALESCE(display_name, username) as name FROM users WHERE id = ?')
          .get(userId) as { name: string };
        this.broadcast({
          t: 'chat',
          from: user.name,
          userId,
          text: msg.text,
          kind: msg.kind ?? 'text',
          ts: Date.now(),
        });
        return;
      }
      case 'rtc': {
        // voice-chat signaling: relay verbatim to one room member; server never sees audio
        this.send(msg.to, { t: 'rtc', from: userId, data: msg.data });
        return;
      }
      case 'voice_state': {
        this.broadcast({ t: 'voice_state', userId, muted: msg.muted });
        return;
      }
      case 'sit': {
        if (this.hand) return this.send(userId, { t: 'error', message: 'wait for the hand to end' });
        const taken = this.db
          .prepare('SELECT 1 FROM room_players WHERE room_id = ? AND seat = ?')
          .get(this.roomId, msg.seat);
        if (taken) return this.send(userId, { t: 'error', message: 'seat taken' });
        this.db
          .prepare('UPDATE room_players SET seat = ?, sitting_out = 0 WHERE room_id = ? AND user_id = ?')
          .run(msg.seat, this.roomId, userId);
        this.broadcastRoomState();
        return;
      }
      case 'leave_seat': {
        if (this.hand) return this.send(userId, { t: 'error', message: 'wait for the hand to end' });
        this.db
          .prepare('UPDATE room_players SET seat = NULL WHERE room_id = ? AND user_id = ?')
          .run(this.roomId, userId);
        this.broadcastRoomState();
        return;
      }
      case 'start_hand': {
        const room = getRoom(this.db, this.roomId)!;
        if (room.host_id !== userId)
          return this.send(userId, { t: 'error', message: 'only the host starts hands' });
        if (this.hand) return this.send(userId, { t: 'error', message: 'hand already running' });
        if (this.autoDeal) {
          clearTimeout(this.autoDeal);
          this.autoDeal = null;
        }
        this.startHand();
        return;
      }
      case 'key_commit':
      case 'shuffle_deck':
      case 'unmask_share':
      case 'action':
      case 'reveal_key': {
        if (!this.hand || this.hand.id !== msg.handId)
          return this.send(userId, { t: 'error', message: 'no such hand' });
        this.hand.onMessage(userId, msg);
        return;
      }
      case 'show_cards': {
        if (this.hand && this.hand.id === msg.handId) return this.hand.onMessage(userId, msg);
        return this.onPostHandShow(userId, msg);
      }
      case 'sit_out': {
        this.db
          .prepare('UPDATE room_players SET sitting_out = ? WHERE room_id = ? AND user_id = ?')
          .run(msg.sittingOut ? 1 : 0, this.roomId, userId);
        this.broadcastRoomState();
        return;
      }
      case 'peek_offer':
        return this.onPeekOffer(userId, msg);
      case 'peek_accept':
      case 'peek_decline':
        return this.onPeekAnswer(userId, msg);
      default:
        return;
    }
  }

  private startHand(auto = false): void {
    const room = getRoom(this.db, this.roomId)!;
    const eligible = roomPlayers(this.db, this.roomId)
      .filter((p) => p.seat !== null && !p.sittingOut && p.stack > 0 && this.sockets.has(p.userId))
      .sort((a, b) => a.seat! - b.seat!);
    if (eligible.length < 2) {
      if (!auto) this.broadcast({ t: 'error', message: 'need at least 2 seated, funded, connected players' });
      return;
    }
    const seats = eligible.map((p) => p.seat!);
    // rotate the button to the next occupied seat
    let button: number;
    if (this.lastButton === null) button = seats[0]!;
    else button = seats.find((s) => s > this.lastButton!) ?? seats[0]!;
    const btnIdx = seats.indexOf(button);
    // dealing order: heads-up starts with the button (it is the SB); ring starts left of the button
    const startIdx = eligible.length === 2 ? btnIdx : (btnIdx + 1) % seats.length;
    const order = [...eligible.slice(startIdx), ...eligible.slice(0, startIdx)];
    const handSeats: HandSeatInfo[] = order.map((p) => ({
      seat: p.seat!,
      userId: p.userId,
      username: p.username,
      pubkey: p.publicKey,
      stack: p.stack,
    }));
    // the host's turn-time setting is read at deal time, so edits apply from the next hand
    const handOpts: GameOpts = {
      ...this.opts,
      actionTimeoutMs: room.action_secs !== null ? room.action_secs * 1000 : this.opts.actionTimeoutMs,
    };
    this.shown.clear();
    this.shownHandId = null;
    this.peekOffers.clear();
    activeHands.add(this.roomId);
    this.hand = new Hand(this, this.db, room.id, handSeats, button, room.sb, room.bb, room.audit_mode, this.serverId, handOpts, () => {
      activeHands.delete(this.roomId);
      this.lastButton = button;
      this.lastHandShow = this.hand?.showSnapshot() ?? null;
      this.hand = null;
      // showdown winners already revealed their cards: the 7-2 bounty applies now
      const snap = this.lastHandShow;
      if (snap) {
        for (const seat of snap.winnerSeats) {
          const cards = snap.reveals.get(seat);
          if (cards) this.trySevenDeuce(snap.handId, seat, cards);
        }
      }
      this.broadcastRoomState();
      this.scheduleAutoDeal();
    });
    this.hand.begin();
  }

  /** Records a verified voluntary show and tells the table. Returns false when already shown. */
  recordShow(handId: string, seat: number, cards: CardId[]): boolean {
    if (this.shownHandId !== handId) {
      this.shown.clear();
      this.shownHandId = handId;
    }
    if (this.shown.has(seat)) return false;
    this.shown.set(seat, cards);
    this.broadcast({ t: 'cards_shown', handId, seat, cards });
    // a fold-winner proving 7-2 offsuit collects the bounty too
    this.trySevenDeuce(handId, seat, cards);
    return true;
  }

  /** Pays the 7-2 offsuit bounty to a verified winner, once per hand. */
  private trySevenDeuce(handId: string, seat: number, cards: CardId[]): void {
    const snap = this.lastHandShow;
    if (!snap || snap.handId !== handId || this.sevenDeucePaid.has(handId)) return;
    if (!snap.winnerSeats.includes(seat) || !isSevenDeuce(cards)) return;
    const room = getRoom(this.db, this.roomId);
    if (!room || room.seven_deuce_bonus <= 0) return;
    const winner = snap.bySeat.get(seat);
    if (!winner) return;
    this.sevenDeucePaid.add(handId);
    const bonus = room.seven_deuce_bonus;
    let total = 0;
    const apply = this.db.transaction(() => {
      for (const [payerSeat, payer] of snap.bySeat) {
        if (payerSeat === seat) continue;
        const row = this.db
          .prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?')
          .get(this.roomId, payer.userId) as { stack: number } | undefined;
        const amt = Math.min(bonus, row?.stack ?? 0);
        if (amt <= 0) continue;
        appendLedger(this.db, {
          roomId: this.roomId,
          userId: payer.userId,
          delta: -amt,
          kind: 'seven-deuce',
          ref: handId,
          note: 'paid the 7-2 offsuit bounty',
        });
        this.db
          .prepare('UPDATE room_players SET stack = stack - ? WHERE room_id = ? AND user_id = ?')
          .run(amt, this.roomId, payer.userId);
        total += amt;
      }
      if (total > 0) {
        appendLedger(this.db, {
          roomId: this.roomId,
          userId: winner.userId,
          delta: total,
          kind: 'seven-deuce',
          ref: handId,
          note: 'won with 7-2 offsuit',
        });
        this.db
          .prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?')
          .run(total, this.roomId, winner.userId);
      }
    });
    apply();
    if (total > 0) {
      this.broadcast({ t: 'seven_deuce', handId, seat, amount: total });
      this.broadcastRoomState();
    }
  }

  /** A show after the hand ended: verified against the finished hand's snapshot. */
  private onPostHandShow(userId: number, msg: Extract<ClientMsg, { t: 'show_cards' }>): void {
    const snap = this.lastHandShow;
    if (!snap || snap.handId !== msg.handId)
      return this.send(userId, { t: 'error', message: 'no such hand' });
    const entry = [...snap.bySeat.entries()].find(([, v]) => v.userId === userId);
    if (!entry) return this.send(userId, { t: 'error', message: 'you were not in that hand' });
    const [seat, v] = entry;
    if (this.shownHandId === msg.handId && this.shown.has(seat)) return;
    if (!verifyContent(v.pubkey, msg.handId, 'show_cards', signedBody(msg), msg.sig))
      return this.send(userId, { t: 'error', message: 'bad signature' });
    const cards = verifySnapshotShares(v, msg.shares, this.lookup);
    if (!cards) return this.send(userId, { t: 'error', message: 'invalid card reveal' });
    this.recordShow(msg.handId, seat, cards);
  }

  /** A paid request to privately see someone's cards from the last hand. */
  private onPeekOffer(userId: number, msg: Extract<ClientMsg, { t: 'peek_offer' }>): void {
    const snap = this.lastHandShow;
    if (this.hand || !snap || snap.handId !== msg.handId)
      return this.send(userId, { t: 'error', message: 'peek offers only work between hands' });
    const target = snap.bySeat.get(msg.targetSeat);
    if (!target) return this.send(userId, { t: 'error', message: 'that player was not in the last hand' });
    if (target.userId === userId)
      return this.send(userId, { t: 'error', message: 'those are your own cards' });
    if (snap.revealedSeats.has(msg.targetSeat) || (this.shownHandId === msg.handId && this.shown.has(msg.targetSeat)))
      return this.send(userId, { t: 'error', message: 'those cards are already public' });
    const buyer = this.db
      .prepare(
        `SELECT rp.stack, COALESCE(u.display_name, u.username) as name
         FROM room_players rp JOIN users u ON u.id = rp.user_id
         WHERE rp.room_id = ? AND rp.user_id = ?`,
      )
      .get(this.roomId, userId) as { stack: number; name: string } | undefined;
    if (!buyer) return;
    if (buyer.stack < msg.amount)
      return this.send(userId, { t: 'error', message: 'not enough chips for that offer' });
    const offerId = randomBytes(6).toString('hex');
    this.peekOffers.set(offerId, {
      handId: msg.handId,
      fromUserId: userId,
      targetSeat: msg.targetSeat,
      amount: msg.amount,
    });
    this.send(target.userId, {
      t: 'peek_offer',
      offerId,
      handId: msg.handId,
      fromUserId: userId,
      fromName: buyer.name,
      targetSeat: msg.targetSeat,
      amount: msg.amount,
    });
  }

  private onPeekAnswer(
    userId: number,
    msg: Extract<ClientMsg, { t: 'peek_accept' } | { t: 'peek_decline' }>,
  ): void {
    const offer = this.peekOffers.get(msg.offerId);
    if (!offer || offer.handId !== msg.handId)
      return this.send(userId, { t: 'error', message: 'that offer is gone' });
    const snap = this.lastHandShow;
    const target = snap?.bySeat.get(offer.targetSeat);
    if (!snap || !target || target.userId !== userId)
      return this.send(userId, { t: 'error', message: 'that offer is not yours to answer' });
    this.peekOffers.delete(msg.offerId);
    if (msg.t === 'peek_decline') {
      this.send(offer.fromUserId, {
        t: 'peek_result',
        offerId: msg.offerId,
        handId: offer.handId,
        targetSeat: offer.targetSeat,
        status: 'declined',
        amount: offer.amount,
      });
      return;
    }
    if (this.hand) return this.send(userId, { t: 'error', message: 'a new hand already started' });
    if (!verifyContent(target.pubkey, offer.handId, 'peek_accept', signedBody(msg), msg.sig))
      return this.send(userId, { t: 'error', message: 'bad signature' });
    const cards = verifySnapshotShares(target, msg.shares, this.lookup);
    if (!cards) return this.send(userId, { t: 'error', message: 'invalid card reveal' });
    const buyerRow = this.db
      .prepare('SELECT stack FROM room_players WHERE room_id = ? AND user_id = ?')
      .get(this.roomId, offer.fromUserId) as { stack: number } | undefined;
    if (!buyerRow || buyerRow.stack < offer.amount)
      return this.send(userId, { t: 'error', message: 'the buyer no longer has enough chips' });
    const apply = this.db.transaction(() => {
      appendLedger(this.db, {
        roomId: this.roomId,
        userId: offer.fromUserId,
        delta: -offer.amount,
        kind: 'peek',
        ref: offer.handId,
        note: `paid to see seat ${offer.targetSeat + 1}'s cards`,
      });
      appendLedger(this.db, {
        roomId: this.roomId,
        userId,
        delta: offer.amount,
        kind: 'peek',
        ref: offer.handId,
        note: `showed cards privately`,
      });
      this.db
        .prepare('UPDATE room_players SET stack = stack - ? WHERE room_id = ? AND user_id = ?')
        .run(offer.amount, this.roomId, offer.fromUserId);
      this.db
        .prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?')
        .run(offer.amount, this.roomId, userId);
    });
    apply();
    this.send(offer.fromUserId, {
      t: 'peek_result',
      offerId: msg.offerId,
      handId: offer.handId,
      targetSeat: offer.targetSeat,
      status: 'accepted',
      amount: offer.amount,
      cards,
    });
    this.broadcastRoomState();
  }
}

class Hand {
  readonly id = randomBytes(8).toString('hex');
  private phase: 'commit' | 'shuffle' | 'deal' | 'betting' | 'reveal' | 'audit' | 'done' = 'commit';
  private readonly n: number;
  private commits = new Map<number, Point>();
  private transcript = new Transcript();
  private deck: Point[] = initialDeck();
  private shuffleIdx = 0;
  private chains = new Map<number, Chain>();
  private holeFinal = new Map<number, Point>();
  private boardCards = new Map<number, CardId>();
  private pendingBoard = new Set<number>();
  private betting: BettingState | null = null;
  private actionSeq = 0;
  private reveals = new Map<number, CardId[]>();
  private shownSeats = new Set<number>();
  private startMsg: ServerMsg | null = null;
  private lastDeadline: number | null = null;
  private retriesLeft: number;
  private revealedKeys = new Map<number, string>();
  private runout = false;
  private timer: NodeJS.Timeout | null = null;
  private lookup = cardLookup();
  private settlement: {
    awards: Map<number, number>;
    deltas: { seat: number; delta: number }[];
    stacks: { seat: number; stack: number }[];
    showdown: ServerMsg | null;
  } | null = null;

  constructor(
    private room: GameRoom,
    private db: DB,
    private roomId: string,
    private seats: HandSeatInfo[],
    private buttonSeat: number,
    private sb: number,
    private bb: number,
    private auditMode: string,
    private serverId: Identity,
    private opts: GameOpts,
    private onDone: () => void,
  ) {
    this.n = seats.length;
    this.retriesLeft = opts.cryptoRetries ?? 3;
  }

  // ---------- lifecycle ----------

  begin(): void {
    this.appendServer('hand_start', {
      roomId: this.roomId,
      seats: this.seats.map((s) => ({ seat: s.seat, userId: s.userId, pubkey: s.pubkey, stack: s.stack })),
      buttonSeat: this.buttonSeat,
      sb: this.sb,
      bb: this.bb,
    });
    this.startMsg = {
      t: 'hand_start',
      handId: this.id,
      seats: this.seats.map((s) => ({
        seat: s.seat,
        userId: s.userId,
        username: s.username,
        publicKey: s.pubkey,
        stack: s.stack,
      })),
      buttonSeat: this.buttonSeat,
      sb: this.sb,
      bb: this.bb,
      auditMode: this.auditMode,
    };
    this.room.broadcast(this.startMsg);
    this.armTimer(this.opts.cryptoTimeoutMs);
  }

  clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private armTimer(ms: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.onTimeout(), ms);
  }

  private onTimeout(): void {
    // give a stalled (often just disconnected) player a fixed grace window:
    // re-send whatever we are waiting on a few times before giving up
    if (this.phase !== 'betting' && this.phase !== 'audit' && this.phase !== 'done' && this.retriesLeft > 0) {
      this.retriesLeft--;
      this.renudge();
      this.armTimer(this.opts.cryptoTimeoutMs);
      return;
    }
    switch (this.phase) {
      case 'commit': {
        const missing = this.seats.find((s) => !this.commits.has(s.seat));
        this.abort('key commitment timeout', missing?.seat ?? null);
        return;
      }
      case 'shuffle': {
        this.abort('shuffle timeout', this.seats[this.shuffleIdx]?.seat ?? null);
        return;
      }
      case 'deal':
      case 'reveal': {
        const waiting = [...this.chains.values()].find((c) => c.remaining.length > 0);
        this.abort('unmask timeout', waiting?.remaining[0] ?? null);
        return;
      }
      case 'betting': {
        const seat = this.betting?.toAct;
        if (seat === null || seat === undefined) return;
        this.appendServer('timeout_fold', { seat });
        this.applyEngineAction(seat, { type: 'fold' }, true);
        return;
      }
      case 'audit': {
        this.finalizeSettlement();
        return;
      }
      default:
        return;
    }
  }

  private abort(reason: string, blamedSeat: number | null): void {
    if (this.phase === 'done') return;
    this.clearTimer();
    this.phase = 'done';
    this.appendServer('hand_abort', { reason, blamedSeat });
    // no sitting-out penalty: the next deal already skips disconnected players,
    // and punishing a flaky connection kept locking people out of their seat
    this.room.broadcast({ t: 'hand_abort', handId: this.id, reason, blamedSeat });
    this.onDone();
  }

  /** Re-send whatever request the stalled player(s) may have missed. */
  private renudge(): void {
    switch (this.phase) {
      case 'commit':
        if (this.startMsg)
          for (const s of this.seats)
            if (!this.commits.has(s.seat)) this.room.send(s.userId, this.startMsg);
        return;
      case 'shuffle':
        this.requestShuffle();
        return;
      case 'deal':
      case 'reveal':
        for (const chain of this.chains.values())
          if (chain.remaining.length > 0) this.kickChain(chain);
        return;
      default:
        return;
    }
  }

  /** Bring a (re)connecting participant fully back into the hand. */
  resendPending(userId: number): void {
    const info = this.seatOf(userId);
    if (!info || this.phase === 'done') return;
    if (this.startMsg) this.room.send(userId, this.startMsg);
    const orderIdx = this.seats.findIndex((s) => s.seat === info.seat);
    for (const idx of this.holeIndexes(orderIdx)) {
      const pt = this.holeFinal.get(idx);
      if (pt) this.room.send(userId, { t: 'your_card', handId: this.id, deckIndex: idx, point: pointHex(pt) });
    }
    for (const [deckIndex, card] of this.boardCards) {
      this.room.send(userId, { t: 'board_open', handId: this.id, deckIndex, card });
    }
    if (this.phase === 'shuffle' && this.seats[this.shuffleIdx]?.seat === info.seat) {
      this.requestShuffle();
    }
    if (this.phase === 'deal' || this.phase === 'reveal') {
      for (const chain of this.chains.values())
        if (chain.remaining[0] === info.seat) this.kickChain(chain);
    }
    if (this.phase === 'betting' && this.betting) {
      this.room.send(userId, {
        t: 'betting_state',
        handId: this.id,
        actionSeq: this.actionSeq,
        state: this.betting,
        board: this.currentBoard(),
        deadline: this.lastDeadline,
      });
    }
    if (this.phase === 'audit' && !this.revealedKeys.has(info.seat)) {
      this.room.send(userId, { t: 'need_keys', handId: this.id });
    }
  }

  // ---------- transcript ----------

  private appendServer(type: string, payload: unknown): void {
    const sig = signContent(this.serverId.secretKey, this.id, type, payload);
    const e = this.transcript.append({ type, from: this.serverId.publicKey, payload, sig });
    this.room.broadcast({ t: 'transcript_entry', handId: this.id, seq: e.seq, type, from: e.from, head: this.transcript.head });
  }

  private appendPlayer(type: string, pubkey: string, payload: unknown, sig: string): void {
    const e = this.transcript.append({ type, from: pubkey, payload, sig });
    this.room.broadcast({ t: 'transcript_entry', handId: this.id, seq: e.seq, type, from: e.from, head: this.transcript.head });
  }

  // ---------- helpers ----------

  private seatOf(userId: number): HandSeatInfo | undefined {
    return this.seats.find((s) => s.userId === userId);
  }

  private holeIndexes(orderIdx: number): [number, number] {
    return [orderIdx, this.n + orderIdx];
  }

  private boardIndexes(): number[] {
    return [2 * this.n, 2 * this.n + 1, 2 * this.n + 2, 2 * this.n + 3, 2 * this.n + 4];
  }

  private err(userId: number, message: string): void {
    this.room.send(userId, { t: 'error', message });
  }

  // ---------- message entry ----------

  onMessage(userId: number, msg: ClientMsg): void {
    if (this.phase === 'done') return;
    const info = this.seatOf(userId);
    if (!info) return this.err(userId, 'not in this hand');
    if (msg.t === 'key_commit' || msg.t === 'shuffle_deck' || msg.t === 'unmask_share' || msg.t === 'action' || msg.t === 'reveal_key' || msg.t === 'show_cards') {
      if (!verifyContent(info.pubkey, this.id, msg.t, signedBody(msg), msg.sig)) {
        return this.err(userId, 'bad signature');
      }
    }
    switch (msg.t) {
      case 'key_commit':
        return this.onKeyCommit(info, msg.commit, msg.sig);
      case 'shuffle_deck':
        return this.onShuffle(info, msg.deck, msg.sig);
      case 'unmask_share':
        return this.onUnmaskShare(info, msg.deckIndex, msg.out, msg.proof, msg.sig);
      case 'action':
        return this.onAction(info, msg.action, msg.sig);
      case 'reveal_key':
        return this.onRevealKey(info, msg.key, msg.sig);
      case 'show_cards':
        return this.onShowCards(info, msg.shares, msg.sig);
      default:
        return;
    }
  }

  // ---------- voluntary shows ----------

  /** Mid-hand a player may show their cards only once they have folded. */
  private onShowCards(
    info: HandSeatInfo,
    shares: { deckIndex: number; out: string; proof: { A1: string; A2: string; z: string } }[],
    sig: string,
  ): void {
    const folded = this.betting?.seats.find((s) => s.seat === info.seat)?.folded;
    if (!folded)
      return this.err(info.userId, 'you can show your cards after folding or once the hand ends');
    if (this.shownSeats.has(info.seat)) return;
    const cards = this.verifyShowShares(info.seat, shares);
    if (!cards) return this.err(info.userId, 'invalid card reveal');
    this.shownSeats.add(info.seat);
    this.appendPlayer('show_cards', info.pubkey, { shares }, sig);
    this.room.recordShow(this.id, info.seat, cards);
  }

  private verifyShowShares(
    seat: number,
    shares: { deckIndex: number; out: string; proof: { A1: string; A2: string; z: string } }[],
  ): CardId[] | null {
    const orderIdx = this.seats.findIndex((s) => s.seat === seat);
    const validIdx = new Set(this.holeIndexes(orderIdx));
    const commit = this.commits.get(seat);
    if (!commit) return null;
    const cards: CardId[] = [];
    const seen = new Set<number>();
    for (const sh of shares) {
      if (!validIdx.has(sh.deckIndex) || seen.has(sh.deckIndex)) return null;
      seen.add(sh.deckIndex);
      const pIn = this.holeFinal.get(sh.deckIndex);
      if (!pIn) return null;
      let out: Point;
      try {
        out = pointFromHex(sh.out);
      } catch {
        return null;
      }
      if (!verifyUnmask(commit, pIn, out, sh.proof)) return null;
      const card = recoverCard(out, this.lookup);
      if (card === null) return null;
      cards.push(card);
    }
    return cards;
  }

  /** What GameRoom needs to keep verifying shows after this hand is gone. */
  showSnapshot(): ShowSnapshot {
    const bySeat = new Map<number, SnapshotSeat>();
    for (let k = 0; k < this.n; k++) {
      const s = this.seats[k]!;
      const commit = this.commits.get(s.seat);
      if (!commit) continue;
      const cards = this.holeIndexes(k)
        .filter((i) => this.holeFinal.has(i))
        .map((i) => ({ deckIndex: i, point: this.holeFinal.get(i)! }));
      if (cards.length) bySeat.set(s.seat, { userId: s.userId, pubkey: s.pubkey, commit, cards });
    }
    const winnerSeats = this.settlement
      ? [...this.settlement.awards.entries()].filter(([, amt]) => amt > 0).map(([seat]) => seat)
      : [];
    return {
      handId: this.id,
      bySeat,
      revealedSeats: new Set(this.reveals.keys()),
      winnerSeats,
      reveals: new Map(this.reveals),
    };
  }

  // ---------- commit + shuffle ----------

  private onKeyCommit(info: HandSeatInfo, commitHex: string, sig: string): void {
    if (this.phase !== 'commit') return this.err(info.userId, 'not in commit phase');
    if (this.commits.has(info.seat)) return;
    let commit: Point;
    try {
      commit = pointFromHex(commitHex);
    } catch {
      return this.err(info.userId, 'bad commit point');
    }
    this.commits.set(info.seat, commit);
    this.retriesLeft = this.opts.cryptoRetries ?? 3;
    this.appendPlayer('key_commit', info.pubkey, { commit: commitHex }, sig);
    this.room.broadcast({ t: 'key_commit_applied', handId: this.id, seat: info.seat, commit: commitHex });
    if (this.commits.size === this.n) {
      this.phase = 'shuffle';
      this.requestShuffle();
    } else {
      this.armTimer(this.opts.cryptoTimeoutMs);
    }
  }

  private requestShuffle(): void {
    const seat = this.seats[this.shuffleIdx]!;
    this.room.send(seat.userId, {
      t: 'shuffle_turn',
      handId: this.id,
      seat: seat.seat,
      deck: this.deck.map(pointHex),
    });
    this.armTimer(this.opts.cryptoTimeoutMs);
  }

  private onShuffle(info: HandSeatInfo, deckHexes: string[], sig: string): void {
    if (this.phase !== 'shuffle') return this.err(info.userId, 'not in shuffle phase');
    if (this.seats[this.shuffleIdx]!.seat !== info.seat) return this.err(info.userId, 'not your shuffle turn');
    let points: Point[];
    try {
      points = deckHexes.map(pointFromHex);
    } catch {
      return this.abort('invalid deck from shuffler', info.seat);
    }
    if (new Set(deckHexes).size !== 52) return this.abort('shuffled deck has duplicates', info.seat);
    this.deck = points;
    this.retriesLeft = this.opts.cryptoRetries ?? 3;
    this.appendPlayer('shuffle_deck', info.pubkey, { deck: deckHexes }, sig);
    this.room.broadcast({ t: 'deck_state', handId: this.id, seat: info.seat, deck: deckHexes });
    this.shuffleIdx++;
    if (this.shuffleIdx < this.n) {
      this.requestShuffle();
    } else {
      this.phase = 'deal';
      this.startDealing();
    }
  }

  // ---------- dealing ----------

  private startDealing(): void {
    for (let k = 0; k < this.n; k++) {
      const recipient = this.seats[k]!;
      for (const idx of this.holeIndexes(k)) {
        const remaining = this.seats.filter((s) => s.seat !== recipient.seat).map((s) => s.seat);
        this.chains.set(idx, {
          deckIndex: idx,
          forSeat: recipient.seat,
          purpose: 'hole',
          current: this.deck[idx]!,
          remaining,
        });
      }
    }
    for (const chain of this.chains.values()) this.kickChain(chain);
    this.armTimer(this.opts.cryptoTimeoutMs);
  }

  private kickChain(chain: Chain): void {
    const seat = chain.remaining[0];
    if (seat === undefined) return;
    const info = this.seats.find((s) => s.seat === seat)!;
    this.room.send(info.userId, {
      t: 'need_share',
      handId: this.id,
      deckIndex: chain.deckIndex,
      point: pointHex(chain.current),
      forSeat: chain.forSeat,
      purpose: chain.purpose,
    });
  }

  private onUnmaskShare(
    info: HandSeatInfo,
    deckIndex: number,
    outHex: string,
    proof: { A1: string; A2: string; z: string },
    sig: string,
  ): void {
    const chain = this.chains.get(deckIndex);
    if (!chain || chain.remaining[0] !== info.seat) return this.err(info.userId, 'no share expected from you');
    let out: Point;
    try {
      out = pointFromHex(outHex);
    } catch {
      return this.abort('malformed unmask point', info.seat);
    }
    const commit = this.commits.get(info.seat)!;
    if (!verifyUnmask(commit, chain.current, out, proof)) {
      return this.abort('invalid unmask proof', info.seat);
    }
    this.retriesLeft = this.opts.cryptoRetries ?? 3;
    this.appendPlayer('unmask_share', info.pubkey, { deckIndex, out: outHex, proof }, sig);
    this.room.broadcast({
      t: 'share_applied',
      handId: this.id,
      deckIndex,
      seat: info.seat,
      out: outHex,
      forSeat: chain.forSeat,
    });
    chain.current = out;
    chain.remaining.shift();
    if (chain.remaining.length === 0) {
      this.chains.delete(deckIndex);
      this.chainDone(chain);
    } else {
      this.kickChain(chain);
      this.armTimer(this.opts.cryptoTimeoutMs);
    }
  }

  private chainDone(chain: Chain): void {
    if (this.phase === 'done') return;
    switch (chain.purpose) {
      case 'hole': {
        this.holeFinal.set(chain.deckIndex, chain.current);
        const recipient = this.seats.find((s) => s.seat === chain.forSeat)!;
        this.room.send(recipient.userId, {
          t: 'your_card',
          handId: this.id,
          deckIndex: chain.deckIndex,
          point: pointHex(chain.current),
        });
        if (this.holeFinal.size === 2 * this.n) this.startBetting();
        else this.armTimer(this.opts.cryptoTimeoutMs);
        return;
      }
      case 'board': {
        const card = recoverCard(chain.current, this.lookup);
        if (card === null) return this.abort(`opened board point at index ${chain.deckIndex} is not a card (mis-shuffle)`, null);
        this.boardCards.set(chain.deckIndex, card);
        this.appendServer('board_open', { deckIndex: chain.deckIndex, card });
        this.room.broadcast({ t: 'board_open', handId: this.id, deckIndex: chain.deckIndex, card });
        this.pendingBoard.delete(chain.deckIndex);
        if (this.pendingBoard.size === 0) this.afterBoardOpened();
        else this.armTimer(this.opts.cryptoTimeoutMs);
        return;
      }
      case 'showdown': {
        const card = recoverCard(chain.current, this.lookup);
        if (card === null) return this.abort(`revealed hole point at index ${chain.deckIndex} is not a card (mis-shuffle)`, null);
        const list = this.reveals.get(chain.forSeat!) ?? [];
        list.push(card);
        this.reveals.set(chain.forSeat!, list);
        const needed = this.betting!.seats.filter((s) => !s.folded).length;
        const complete = [...this.reveals.values()].filter((c) => c.length === 2).length;
        if (complete === needed) this.afterRevealsComplete();
        else this.armTimer(this.opts.cryptoTimeoutMs);
        return;
      }
    }
  }

  // ---------- betting ----------

  private startBetting(): void {
    this.phase = 'betting';
    this.betting = startHand(
      this.seats.map((s) => ({ seat: s.seat, stack: s.stack })),
      this.buttonSeat,
      this.sb,
      this.bb,
    );
    this.appendServer('betting_start', { street: 'preflop' });
    this.broadcastBetting();
    this.armActionTimer();
  }

  /** actionTimeoutMs of 0 means unlimited thinking time: no timer, no auto-fold. */
  private armActionTimer(): void {
    if (this.opts.actionTimeoutMs > 0) this.armTimer(this.opts.actionTimeoutMs);
    else this.clearTimer();
  }

  private broadcastBetting(): void {
    this.room.broadcast({
      t: 'betting_state',
      handId: this.id,
      actionSeq: this.actionSeq,
      state: this.betting!,
      board: this.currentBoard(),
      deadline: (this.lastDeadline =
        this.opts.actionTimeoutMs > 0 ? Date.now() + this.opts.actionTimeoutMs : null),
    });
  }

  private currentBoard(): CardId[] {
    return this.boardIndexes()
      .filter((i) => this.boardCards.has(i))
      .map((i) => this.boardCards.get(i)!);
  }

  private onAction(info: HandSeatInfo, action: PlayerAction, sig: string): void {
    if (this.phase !== 'betting' || !this.betting) return this.err(info.userId, 'not in a betting round');
    this.appendPlayer('action', info.pubkey, { action, seat: info.seat }, sig);
    this.applyEngineAction(info.seat, action, false, info.userId);
  }

  private applyEngineAction(seat: number, action: PlayerAction, auto: boolean, userId?: number): void {
    try {
      this.betting = applyAction(this.betting!, seat, action);
    } catch (e) {
      if (userId !== undefined) this.err(userId, e instanceof Error ? e.message : 'illegal action');
      return;
    }
    this.actionSeq++;
    this.room.broadcast({ t: 'action_applied', handId: this.id, seat, action, ...(auto ? { auto: true } : {}) });
    this.broadcastBetting();
    this.afterBettingChange();
  }

  private afterBettingChange(): void {
    const st = this.betting!;
    if (!streetClosed(st)) {
      this.armActionTimer();
      return;
    }
    if (st.winnerByFold !== null) {
      this.settle();
      return;
    }
    if (activeNonAllIn(st) < 2) {
      this.runout = true;
      this.requestReveals();
      return;
    }
    if (st.street === 'river') {
      this.requestReveals();
      return;
    }
    this.openNextStreetBoards();
  }

  private streetIndexesToOpen(): number[] {
    const base = 2 * this.n;
    switch (this.betting!.street) {
      case 'preflop':
        return [base, base + 1, base + 2];
      case 'flop':
        return [base + 3];
      case 'turn':
        return [base + 4];
      default:
        return [];
    }
  }

  private openNextStreetBoards(): void {
    this.phase = 'deal';
    const idxs = this.streetIndexesToOpen().filter((i) => !this.boardCards.has(i));
    this.pendingBoard = new Set(idxs);
    for (const idx of idxs) {
      const chain: Chain = {
        deckIndex: idx,
        forSeat: null,
        purpose: 'board',
        current: this.deck[idx]!,
        remaining: this.seats.map((s) => s.seat),
      };
      this.chains.set(idx, chain);
      this.kickChain(chain);
    }
    this.armTimer(this.opts.cryptoTimeoutMs);
  }

  private afterBoardOpened(): void {
    if (this.runout) {
      const remaining = this.boardIndexes().filter((i) => !this.boardCards.has(i));
      if (remaining.length === 0) {
        this.settle();
      } else {
        this.openRemainingRunoutBoards();
      }
      return;
    }
    this.betting = nextStreet(this.betting!);
    this.phase = 'betting';
    this.appendServer('street', { street: this.betting.street, board: this.currentBoard() });
    this.broadcastBetting();
    this.armActionTimer();
  }

  private openRemainingRunoutBoards(): void {
    this.phase = 'deal';
    const next = this.boardIndexes().find((i) => !this.boardCards.has(i));
    if (next === undefined) {
      this.settle();
      return;
    }
    this.pendingBoard = new Set([next]);
    const chain: Chain = {
      deckIndex: next,
      forSeat: null,
      purpose: 'board',
      current: this.deck[next]!,
      remaining: this.seats.map((s) => s.seat),
    };
    this.chains.set(next, chain);
    this.kickChain(chain);
    this.armTimer(this.opts.cryptoTimeoutMs);
  }

  // ---------- showdown ----------

  private requestReveals(): void {
    this.phase = 'reveal';
    const revealing = this.betting!.seats.filter((s) => !s.folded);
    for (const s of revealing) {
      const orderIdx = this.seats.findIndex((x) => x.seat === s.seat);
      for (const idx of this.holeIndexes(orderIdx)) {
        const chain: Chain = {
          deckIndex: idx,
          forSeat: s.seat,
          purpose: 'showdown',
          current: this.holeFinal.get(idx)!,
          remaining: [s.seat],
        };
        this.chains.set(idx, chain);
        this.kickChain(chain);
      }
    }
    this.armTimer(this.opts.cryptoTimeoutMs);
  }

  private afterRevealsComplete(): void {
    if (this.runout) {
      const remaining = this.boardIndexes().filter((i) => !this.boardCards.has(i));
      if (remaining.length > 0) {
        this.openRemainingRunoutBoards();
        return;
      }
    }
    this.settle();
  }

  // ---------- settlement ----------

  private settle(): void {
    this.clearTimer();
    const st = this.betting!;
    const board = this.currentBoard();
    const pots = computePots(st.seats);
    const dealingOrder = this.seats.map((s) => s.seat);
    let awards: Map<number, number>;
    let showdownMsg: ServerMsg | null = null;

    if (st.winnerByFold !== null) {
      awards = new Map([[st.winnerByFold, pots.reduce((s, p) => s + p.amount, 0)]]);
    } else {
      const scores = new Map<number, number>();
      const revealList: { seat: number; cards: CardId[]; score: number }[] = [];
      for (const [seat, cards] of this.reveals) {
        const score = evaluate7([...cards, ...board]);
        scores.set(seat, score);
        revealList.push({ seat, cards, score });
      }
      awards = awardPots(pots, scores, dealingOrder);
      showdownMsg = {
        t: 'showdown',
        handId: this.id,
        reveals: revealList,
        awards: [...awards.entries()].map(([seat, amount]) => ({ seat, amount })),
      };
    }

    const deltas = st.seats.map((s) => ({ seat: s.seat, delta: (awards.get(s.seat) ?? 0) - s.total }));
    const stacks = st.seats.map((s) => ({ seat: s.seat, stack: s.stack + (awards.get(s.seat) ?? 0) }));
    this.settlement = { awards, deltas, stacks, showdown: showdownMsg };
    this.appendServer('settlement', {
      board,
      awards: [...awards.entries()].map(([seat, amount]) => ({ seat, amount })),
      deltas,
      reveals:
        showdownMsg && showdownMsg.t === 'showdown'
          ? showdownMsg.reveals.map((r) => ({ seat: r.seat, cards: r.cards }))
          : [],
    });
    if (showdownMsg) this.room.broadcast(showdownMsg);

    if (this.auditMode === 'strict-audit') {
      this.phase = 'audit';
      this.room.broadcast({ t: 'need_keys', handId: this.id });
      this.armTimer(this.opts.cryptoTimeoutMs);
    } else {
      this.finalizeSettlement();
    }
  }

  private onRevealKey(info: HandSeatInfo, keyHex: string, sig: string): void {
    if (this.phase !== 'audit') return;
    let valid = false;
    try {
      const commit = this.commits.get(info.seat)!;
      valid = pointHex(handKeyCommit(BigInt('0x' + keyHex))) === pointHex(commit);
    } catch {
      valid = false;
    }
    this.appendPlayer('reveal_key', info.pubkey, { key: keyHex, valid }, sig);
    this.revealedKeys.set(info.seat, keyHex);
    if (this.revealedKeys.size === this.n) this.finalizeSettlement();
  }

  private finalizeSettlement(): void {
    if (this.phase === 'done' || !this.settlement) return;
    this.clearTimer();
    this.phase = 'done';
    const { deltas, stacks } = this.settlement;
    const head = this.transcript.head;
    const write = this.db.transaction(() => {
      // settle by DELTA, never by absolute stack: the hand's snapshot predates
      // anything credited while it ran (a mid-hand buy, a banker revert), and
      // an absolute write would silently erase those chips
      for (const d of deltas) {
        if (d.delta !== 0) {
          const info = this.seats.find((x) => x.seat === d.seat)!;
          this.db
            .prepare('UPDATE room_players SET stack = stack + ? WHERE room_id = ? AND user_id = ?')
            .run(d.delta, this.roomId, info.userId);
        }
      }
      for (const d of deltas) {
        if (d.delta === 0) continue;
        const info = this.seats.find((x) => x.seat === d.seat)!;
        appendLedger(this.db, {
          roomId: this.roomId,
          userId: info.userId,
          delta: d.delta,
          kind: 'hand-settlement',
          ref: head,
        });
      }
      this.db
        .prepare('INSERT INTO transcripts (hand_id, room_id, head, entries, ts) VALUES (?, ?, ?, ?, ?)')
        .run(this.id, this.roomId, head, JSON.stringify(this.transcript.entries), Date.now());
    });
    write();
    this.room.broadcast({ t: 'hand_end', handId: this.id, head, stacks, deltas });
    this.onDone();
  }
}
