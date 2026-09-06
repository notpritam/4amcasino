import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLoungeWalkable, LOUNGE_DESTINATIONS } from '@4am/shared';
import { LoungeMoveQueue, stepLoungeWalk, walkDirection } from '../src/pages/table3d/navigation.ts';
import { LoungeLocomotion } from '../src/pages/table3d/locomotion.ts';

describe('camera-relative steering', () => {
  it('maps the camera plane and normalizes diagonal and duplicate inputs', () => {
    expect(walkDirection(new Set(['KeyW']), { x: 0, z: -3 })).toEqual({ x: 0, z: -1 });
    expect(walkDirection(new Set(['KeyD']), { x: 0, z: -3 })).toEqual({ x: 1, z: 0 });
    expect(walkDirection(new Set(['KeyW']), { x: 3, z: 0 })).toEqual({ x: 1, z: 0 });
    for (const keys of [
      ['KeyW', 'KeyD'],
      ['KeyW', 'ArrowUp', 'KeyD'],
    ]) {
      const direction = walkDirection(new Set(keys), { x: 0, z: -1 });
      expect(Math.hypot(direction.x, direction.z)).toBeCloseTo(1);
      expect(direction.x).toBeCloseTo(-direction.z);
    }
    expect(walkDirection(new Set(['KeyW', 'KeyS']), { x: 0, z: 0 })).toEqual({ x: 0, z: 0 });
    expect(walkDirection(new Set(['ArrowUp']), { x: 0, z: 0 })).toEqual({ x: 0, z: -1 });
  });
  it('clamps background time and never accelerates diagonal movement', () => {
    const point = { x: 0, z: 6.4 };
    const diagonal = stepLoungeWalk(point, { x: 1, z: 1 }, 500);
    expect(Math.hypot(diagonal.x - point.x, diagonal.z - point.z)).toBeCloseTo(2.05 * 0.05);
    expect(stepLoungeWalk(point, { x: 0, z: 0 }, 0.05)).toEqual(point);
  });
  it('cannot walk through table, sofas, bar, lamps, plants, or room boundaries', () => {
    for (const [start, direction] of [
      [
        { x: 0, z: 6.4 },
        { x: 0, z: -1 },
      ],
      [
        { x: 7, z: 0 },
        { x: 1, z: 0 },
      ],
      [
        { x: 9.2, z: -3.8 },
        { x: 0, z: -1 },
      ],
      [
        { x: 6.8, z: -5.3 },
        { x: 0, z: -1 },
      ],
      [
        { x: -8.2, z: 4.8 },
        { x: 0, z: 1 },
      ],
      [
        { x: 10.8, z: 5 },
        { x: 1, z: 1 },
      ],
    ]) {
      let p = start!;
      for (let i = 0; i < 400; i++) {
        const next = stepLoungeWalk(p, direction!, 0.05);
        expect(isLoungeWalkable(next)).toBe(true);
        expect(Math.hypot(next.x - p.x, next.z - p.z)).toBeLessThanOrEqual(0.10251);
        p = next;
      }
    }
  });
  it('slides along a wall and stops short of other characters', () => {
    const slide = stepLoungeWalk({ x: 11.2, z: 4 }, { x: 1, z: -1 }, 0.05);
    expect(slide.x).toBe(11.2);
    expect(slide.z).toBeLessThan(4);
    let p = { x: 0, z: 6.4 };
    for (let i = 0; i < 100; i++) p = stepLoungeWalk(p, { x: 1, z: 0 }, 0.05, [{ x: 1.4, z: 6.4 }]);
    expect(p.x).toBeLessThanOrEqual(0.58);
    expect(p.x).toBeGreaterThan(0.5);
  });
});

describe('keyboard and chair movement handoff', () => {
  it('finishes each chair corridor before direct steering, then stops without self-echo drift', () => {
    for (let seat = 0; seat < 9; seat++) {
      const travel = new LoungeLocomotion();
      let target: { x: number; z: number; revision: number } = {
        ...LOUNGE_DESTINATIONS.entry,
        revision: 1,
      };
      travel.update(1, seat, undefined, 0);
      let last = travel.update(1, seat, target, 0);
      const stages = new Set<string>();
      for (let t = 50; t <= 8000; t += 50) {
        const pose = travel.update(1, seat, target, t, false, {
          direction: { x: 0, z: 0 },
          dt: 0.05,
          occupied: [],
        });
        stages.add(pose.status);
        expect(Math.hypot(pose.x - last.x, pose.z - last.z)).toBeLessThan(0.104);
        last = pose;
      }
      expect(stages.has('getting-up')).toBe(true);
      expect(isLoungeWalkable(last)).toBe(true);
      expect(last.status).toBe('standing');
      target = { ...last, revision: 2 };
      const next = travel.update(1, seat, target, 8050, false, {
        direction: { x: 1, z: 0 },
        dt: 0.05,
        occupied: [],
      });
      const stopped = travel.update(1, seat, target, 8100, false, {
        direction: { x: 0, z: 0 },
        dt: 0.05,
        occupied: [],
      });
      expect(stopped.x).toBe(next.x);
      expect(stopped.z).toBe(next.z);
      expect(stopped.status).toBe('standing');
      travel.update(1, seat, undefined, 8150);
      expect(travel.update(1, seat, undefined, 60000).status).toBe('seated');
    }
  });
  it('keeps direct movement continuous under reduced motion', () => {
    const travel = new LoungeLocomotion();
    const target = { ...LOUNGE_DESTINATIONS.entry, revision: 1 };
    const first = travel.update(1, null, target, 0, true);
    const next = travel.update(1, null, target, 10000, true, {
      direction: { x: 1, z: 0 },
      dt: 0.05,
      occupied: [],
    });
    expect(next.x - first.x).toBeCloseTo(0.1025);
    // Releasing ownership (disconnect / another control) reconciles the last
    // acknowledged target even if its revision has not changed.
    const reconciled = travel.update(1, null, target, 10050, true);
    expect(reconciled.x).toBe(first.x);
    expect(reconciled.z).toBe(first.z);
  });
});

describe('shared movement pacing', () => {
  afterEach(() => vi.useRealTimers());
  it('coalesces frames and delivers a final stop after the rate-limit window', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const sent: { x: number; z: number }[] = [];
    const queue = new LoungeMoveQueue((p) => sent.push(p));
    queue.offer({ x: 0, z: 6.4 });
    for (let i = 1; i <= 10; i++) {
      vi.advanceTimersByTime(10);
      queue.offer({ x: i / 10, z: 6.4 });
    }
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(150);
    expect(sent).toEqual([
      { x: 0, z: 6.4 },
      { x: 1, z: 6.4 },
    ]);
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(2);
  });
  it('cancels pending travel on return or unmount and preserves pacing for a new destination', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const send = vi.fn();
    const queue = new LoungeMoveQueue(send);
    queue.offer(LOUNGE_DESTINATIONS.entry);
    queue.offer(LOUNGE_DESTINATIONS.bar);
    queue.clear();
    vi.advanceTimersByTime(100);
    queue.offer(LOUNGE_DESTINATIONS.tv);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(150);
    expect(send).toHaveBeenLastCalledWith({ x: 0, z: -6.7 });
  });
});
