import { describe, expect, it } from 'vitest';
import { startHand } from '../src/betting.js';

const seats3 = [
  { seat: 2, stack: 1000 },
  { seat: 5, stack: 800 },
  { seat: 7, stack: 50 },
]; // dealing order: SB=2, BB=5, button=7

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
    const st = startHand(
      [
        { seat: 1, stack: 500 },
        { seat: 3, stack: 500 },
      ],
      1,
      5,
      10,
    );
    expect(st.seats[0]).toMatchObject({ seat: 1, committed: 5 });
    expect(st.seats[1]).toMatchObject({ seat: 3, committed: 10 });
    expect(st.toAct).toBe(1);
  });
  it('short stack posts all-in blind', () => {
    const st = startHand(
      [
        { seat: 0, stack: 8 },
        { seat: 1, stack: 100 },
        { seat: 2, stack: 100 },
      ],
      2,
      10,
      20,
    );
    expect(st.seats[0]).toMatchObject({ seat: 0, committed: 8, stack: 0, allIn: true });
  });
});
