import { describe, expect, it } from 'vitest';
import {
  LOUNGE_DESTINATIONS,
  isLoungeWalkable,
  loungePath,
  loungeSeat,
  seatExit,
  availableLoungePoint,
} from '../src/lounge.js';

describe('lounge navigation', () => {
  it('spaces a group arriving at the TV without putting anyone into furniture', () => {
    const occupied: { x: number; z: number }[] = [];
    for (let i = 0; i < 9; i++) {
      const point = availableLoungePoint(LOUNGE_DESTINATIONS.tv, occupied);
      expect(point).not.toBeNull();
      expect(isLoungeWalkable(point!)).toBe(true);
      expect(occupied.every((p) => Math.hypot(p.x - point!.x, p.z - point!.z) > 0.8)).toBe(true);
      occupied.push(point!);
    }
  });
  it('rejects the table, furniture, invalid numbers, and points outside the room', () => {
    for (const p of [
      { x: 0, z: 0 },
      { x: -9, z: 0 },
      { x: 9, z: -6 },
      { x: 8.2, z: 5.8 },
      { x: 20, z: 0 },
      { x: NaN, z: 6 },
      { x: 0, z: Infinity },
    ])
      expect(isLoungeWalkable(p)).toBe(false);
  });
  it('connects every destination around the table with clear path segments', () => {
    for (const from of Object.values(LOUNGE_DESTINATIONS))
      for (const to of Object.values(LOUNGE_DESTINATIONS)) {
        const path = loungePath(from, to);
        expect(path.length).toBeGreaterThan(0);
        expect(path.at(-1)).toEqual({ x: to.x, z: to.z });
        for (let i = 1; i < path.length; i++)
          for (let j = 0; j <= 50; j++) {
            const a = path[i - 1]!,
              b = path[i]!,
              t = j / 50;
            expect(isLoungeWalkable({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })).toBe(
              true,
            );
          }
      }
  });
  it('gives all nine chairs an exit beside the chair, clear of the table', () => {
    for (let seat = 0; seat < 9; seat++) {
      const home = loungeSeat(seat);
      const exit = seatExit(seat);
      expect(isLoungeWalkable(exit.at(-1)!)).toBe(true);
      for (let i = 1; i < exit.length; i++)
        for (let j = 0; j <= 30; j++) {
          const a = exit[i - 1]!,
            b = exit[i]!,
            t = j / 30;
          const x = a.x + (b.x - a.x) * t,
            z = a.z + (b.z - a.z) * t;
          expect((x / 5) ** 2 + (z / 3.35) ** 2).toBeGreaterThan(1);
          if (i > 1) {
            const dx = x - home.x,
              dz = z - home.z;
            const right = dx * Math.cos(home.yaw) - dz * Math.sin(home.yaw);
            const forward = dx * Math.sin(home.yaw) + dz * Math.cos(home.yaw);
            expect(forward > 0.42 || Math.abs(right) > 0.65).toBe(true);
          }
        }
      expect(loungePath(exit.at(-1)!, LOUNGE_DESTINATIONS.tv).length).toBeGreaterThan(0);
    }
  });
  it('never invents a path through a blocked destination', () => {
    expect(loungePath(LOUNGE_DESTINATIONS.entry, { x: 0, z: 0 })).toEqual([]);
  });
});
