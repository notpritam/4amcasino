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
