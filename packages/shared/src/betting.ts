export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export interface SeatInHand {
  seat: number; // absolute table seat number
  stack: number; // chips behind
  committed: number; // this street
  total: number; // this hand (side-pot basis)
  folded: boolean;
  allIn: boolean;
  lastActedAt: number | null; // currentBet level when seat last acted this street
}

export interface BettingState {
  street: Street;
  seats: SeatInHand[]; // dealing order: index 0 is small blind (or button in heads-up)
  buttonSeat: number;
  sb: number;
  bb: number;
  currentBet: number;
  lastRaiseSize: number;
  lastFullRaiseAt: number;
  toAct: number | null; // absolute seat number
  needToAct: number[]; // absolute seat numbers
  winnerByFold: number | null;
}

export interface PlayerAction {
  type: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  amount?: number; // raise-to / bet-to total for this street
}

function clone(st: BettingState): BettingState {
  return { ...st, seats: st.seats.map((s) => ({ ...s })), needToAct: [...st.needToAct] };
}

function commit(s: SeatInHand, amount: number): void {
  const put = Math.min(amount, s.stack);
  s.stack -= put;
  s.committed += put;
  s.total += put;
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

export function startHand(
  seats: { seat: number; stack: number }[],
  buttonSeat: number,
  sb: number,
  bb: number,
): BettingState {
  if (seats.length < 2) throw new Error('need at least 2 players');
  const st: BettingState = {
    street: 'preflop',
    seats: seats.map((s) => ({
      seat: s.seat,
      stack: s.stack,
      committed: 0,
      total: 0,
      folded: false,
      allIn: false,
      lastActedAt: null,
    })),
    buttonSeat,
    sb,
    bb,
    currentBet: bb,
    lastRaiseSize: bb,
    lastFullRaiseAt: bb,
    toAct: null,
    needToAct: [],
    winnerByFold: null,
  };
  commit(st.seats[0]!, sb); // SB is index 0 by construction (button itself heads-up)
  commit(st.seats[1]!, bb); // BB is index 1
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
  return {
    seat: s.seat,
    canCheck,
    canRaise,
    callAmount,
    minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
    maxRaiseTo,
  };
}

export function applyAction(prev: BettingState, seat: number, action: PlayerAction): BettingState {
  const st = clone(prev);
  if (st.toAct !== seat) throw new Error('not your turn');
  const s = st.seats.find((x) => x.seat === seat)!;
  const la = legalActions(st)!;
  const dropFromNeed = () => {
    st.needToAct = st.needToAct.filter((x) => x !== seat);
  };

  switch (action.type) {
    case 'fold': {
      s.folded = true;
      dropFromNeed();
      const unfolded = st.seats.filter((x) => !x.folded);
      if (unfolded.length === 1) {
        st.winnerByFold = unfolded[0]!.seat;
        st.needToAct = [];
      }
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
      if (!allInShort) {
        st.lastRaiseSize = raiseSize;
        st.lastFullRaiseAt = to;
      }
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
  st.currentBet = 0;
  st.lastRaiseSize = st.bb;
  st.lastFullRaiseAt = 0;
  for (const s of st.seats) {
    s.committed = 0;
    s.lastActedAt = null;
  }
  st.needToAct = [];
  if (st.winnerByFold === null && activeNonAllIn(st) >= 2) {
    // action starts at the first live seat after the button (ring: SB; heads-up: BB)
    const btnIdx = st.seats.findIndex((s) => s.seat === st.buttonSeat);
    for (let d = 1; d <= st.seats.length; d++) {
      const s = st.seats[(btnIdx + d) % st.seats.length]!;
      if (!s.folded && !s.allIn && !st.needToAct.includes(s.seat)) st.needToAct.push(s.seat);
    }
  }
  st.toAct = st.needToAct[0] ?? null;
  return st;
}
