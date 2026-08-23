import { describe, expect, it } from 'vitest';
import { cardFromName } from '../src/cards.js';
import { bestFive, describeScore, evaluate5, evaluate7, handCategory, HAND_CATEGORY_NAMES } from '../src/evaluate.js';

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
    expect(evaluate5(h('Ac Ad Kh Qs 2c'))).toBeGreaterThan(evaluate5(h('Ac Ad Kh Js 9c')));
    expect(evaluate5(h('Kc Kd Qh Qs Ac'))).toBeGreaterThan(evaluate5(h('Kc Kd Jh Js Ac')));
  });
  it('equal hands tie exactly', () => {
    expect(evaluate5(h('Ac Kd 9h 5s 3c'))).toBe(evaluate5(h('Ad Kc 9s 5h 3d')));
  });
});

describe('evaluate7', () => {
  it('finds the best five of seven', () => {
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

describe('describeScore', () => {
  const d5 = (s: string) => describeScore(evaluate5(h(s)));
  it('explains every category in plain words', () => {
    expect(d5('As Ks Qs Js Ts')).toBe('a Royal Flush');
    expect(d5('9s 8s 7s 6s 5s')).toBe('a Straight Flush, Nine high');
    expect(d5('9c 9d 9h 9s 2c')).toBe('Four Nines');
    expect(d5('Qc Qd Qh 9s 9c')).toBe('a Full House, Queens full of Nines');
    expect(d5('As Ks 9s 5s 3s')).toBe('a Flush, Ace high');
    expect(d5('9c 8d 7h 6s 5c')).toBe('a Straight, Nine high');
    expect(d5('Ac 2d 3h 4s 5c')).toBe('a Straight, Five high');
    expect(d5('6c 6d 6h Ks 2c')).toBe('Three Sixes');
    expect(d5('9c 9d Kh Ks 2c')).toBe('Two Pair, Kings and Nines');
    expect(d5('Qc Qd Kh 9s 2c')).toBe('a Pair of Queens');
    expect(d5('Ac Kd 9h 5s 3c')).toBe('Ace high');
  });
});

describe('bestFive', () => {
  it('picks the five cards that make the winning hand', () => {
    const seven = h('Qc Qd 2h 7s Qh 9c 4d');
    const five = bestFive(seven);
    expect(five).toHaveLength(5);
    expect(evaluate5(five)).toBe(evaluate7(seven));
    expect(five).toContain(h('Qc')[0]);
    expect(five).toContain(h('Qd')[0]);
    expect(five).toContain(h('Qh')[0]);
  });
});
