import { isLoungeWalkable, type LoungePoint } from '@4am/shared';

const WALK_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
export const isWalkKey = (code: string) => WALK_KEYS.has(code);

/** Project camera forward onto the floor; diagonal keys never increase speed. */
export function walkDirection(keys: ReadonlySet<string>, forward: LoungePoint): LoungePoint {
  const ahead =
    Number(keys.has('KeyW') || keys.has('ArrowUp')) -
    Number(keys.has('KeyS') || keys.has('ArrowDown'));
  const right =
    Number(keys.has('KeyD') || keys.has('ArrowRight')) -
    Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const length = Math.hypot(right, ahead);
  if (!length) return { x: 0, z: 0 };
  const cameraLength = Math.hypot(forward.x, forward.z);
  const fx = cameraLength > 0.001 ? forward.x / cameraLength : 0;
  const fz = cameraLength > 0.001 ? forward.z / cameraLength : -1;
  return { x: (fx * ahead - fz * right) / length, z: (fz * ahead + fx * right) / length };
}

/** Small swept steps slide along furniture instead of tunnelling through it. */
export function stepLoungeWalk(
  from: LoungePoint,
  direction: LoungePoint,
  dt: number,
  occupied: readonly LoungePoint[] = [],
): LoungePoint {
  let point = { x: from.x, z: from.z };
  const length = Math.hypot(direction.x, direction.z);
  if (!length || !Number.isFinite(length) || !isLoungeWalkable(from)) return point;
  const distance = 2.05 * Math.max(0, Math.min(dt, 0.05));
  const steps = Math.max(1, Math.ceil(distance / 0.035));
  const dx = ((direction.x / length) * distance) / steps;
  const dz = ((direction.z / length) * distance) / steps;
  const clear = (p: LoungePoint) =>
    isLoungeWalkable(p) &&
    occupied.every((other) => {
      const before = Math.hypot(point.x - other.x, point.z - other.z);
      const after = Math.hypot(p.x - other.x, p.z - other.z);
      return after >= 0.82 || after > before; // An overlapping arrival can move out.
    });
  for (let i = 0; i < steps; i++) {
    const next = { x: point.x + dx, z: point.z + dz };
    if (clear(next)) point = next;
    else {
      const alongX = { x: point.x + dx, z: point.z };
      const alongZ = { x: point.x, z: point.z + dz };
      if (Math.abs(dx) >= Math.abs(dz) && clear(alongX)) point = alongX;
      else if (clear(alongZ)) point = alongZ;
      else if (clear(alongX)) point = alongX;
    }
  }
  return point;
}

/** Latest position wins. Final stops and quick destinations survive the server's 180ms limit. */
export class LoungeMoveQueue {
  private lastSent = -Infinity;
  private pending?: LoungePoint;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private send: (point: LoungePoint) => void) {}
  offer(point: LoungePoint) {
    this.pending = { x: point.x, z: point.z };
    this.flush();
  }
  clear() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
  private flush = () => {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending) return;
    const wait = 250 - (performance.now() - this.lastSent);
    if (wait > 0) {
      this.timer = setTimeout(this.flush, wait);
      return;
    }
    const point = this.pending;
    this.pending = undefined;
    this.lastSent = performance.now();
    this.send(point);
  };
}
