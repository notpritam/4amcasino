/** Canonical room coordinates, shared by navigation, scenery, and the server. */
export interface LoungePoint {
  x: number;
  z: number;
}
export interface LoungePosition extends LoungePoint {
  revision: number;
}

/** Give arrivals personal space instead of stacking avatars on one destination. */
export function availableLoungePoint(
  point: LoungePoint,
  occupied: LoungePoint[],
): LoungePoint | null {
  for (let i = 0; i < 33; i++) {
    const angle = i * 2.399963229728653;
    const radius = i === 0 ? 0 : 0.85 + Math.floor((i - 1) / 12) * 0.6;
    const candidate = {
      x: point.x + Math.cos(angle) * radius,
      z: point.z + Math.sin(angle) * radius,
    };
    if (
      isLoungeWalkable(candidate) &&
      occupied.every((p) => Math.hypot(p.x - candidate.x, p.z - candidate.z) > 0.8)
    )
      return candidate;
  }
  return null;
}

export const LOUNGE_DESTINATIONS = {
  entry: { x: 0, z: 6.4, label: 'Lounge entrance' },
  tv: { x: 0, z: -6.7, label: 'Watch TV' },
  bar: { x: 9.2, z: -3.8, label: 'Drinks counter' },
  sofa: { x: -7.1, z: 0, label: 'Sofa corner' },
  dance: { x: -7.2, z: 3.8, label: 'Dance floor' },
  window: { x: 4.7, z: -7, label: 'City view' },
} as const;

/** Obstacles include the character's shoulder clearance. */
export function isLoungeWalkable(p: LoungePoint): boolean {
  const { x, z } = p;
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 11.2 || Math.abs(z) > 7.5)
    return false;
  if ((x / 6.3) ** 2 + (z / 4.8) ** 2 < 1) return false;
  if (Math.abs(x) > 7.95 && Math.abs(x) < 10.05 && Math.abs(z) < 2.65) return false;
  if (x > 7.3 && x < 11 && z < -4.9) return false;
  for (const side of [-1, 1])
    for (const end of [-1, 1]) {
      if (side === 1 && end === -1) continue; // The drinks counter owns this corner.
      if (Math.hypot(x - side * 8.2, z - end * 5.8) < 0.95) return false;
    }
  for (const side of [-1, 1]) if (Math.hypot(x - side * 6.8, z + 6.5) < 0.75) return false;
  return true;
}

export function loungeSeat(seat: number) {
  const angle = Math.PI / 2 + (seat / 9) * Math.PI * 2;
  const x = Math.cos(angle) * 5.65,
    z = Math.sin(angle) * 4.05;
  return { x, z, yaw: Math.atan2(x, z) + Math.PI };
}

/** Stand in front, sidestep clear of the cushion, then step into the aisle. */
export function seatExit(seat: number): LoungePoint[] {
  const home = loungeSeat(seat);
  const at = (right: number, forward: number) => ({
    x: home.x + Math.cos(home.yaw) * right + Math.sin(home.yaw) * forward,
    z: home.z - Math.sin(home.yaw) * right + Math.cos(home.yaw) * forward,
  });
  return [at(0, 0), at(0, 0.44), at(0.92, 0.44), at(0.92, -1.25)];
}

function clearSegment(a: LoungePoint, b: LoungePoint) {
  const samples = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.08);
  for (let i = 0; i <= samples; i++) {
    const t = samples ? i / samples : 0;
    if (!isLoungeWalkable({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
  }
  return true;
}

/** Small deterministic A* grid. The simplified result still checks whole segments. */
export function loungePath(from: LoungePoint, to: LoungePoint): LoungePoint[] {
  if (!isLoungeWalkable(from) || !isLoungeWalkable(to)) return [];
  const start = { x: from.x, z: from.z },
    end = { x: to.x, z: to.z };
  if (clearSegment(start, end)) return [start, end];
  const step = 0.4,
    width = 55,
    height = 37;
  const point = (id: number) => ({
    x: ((id % width) - 27) * step,
    z: (Math.floor(id / width) - 18) * step,
  });
  const nearest = (p: LoungePoint) => {
    let best = -1,
      distance = Infinity;
    for (let id = 0; id < width * height; id++) {
      const q = point(id),
        d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < distance && isLoungeWalkable(q) && clearSegment(p, q)) {
        best = id;
        distance = d;
      }
    }
    return best;
  };
  const first = nearest(start),
    last = nearest(end);
  if (first < 0 || last < 0) return [];
  const open = new Set([first]),
    came = new Map<number, number>(),
    cost = new Map([[first, 0]]);
  const goal = point(last);
  const heuristic = (id: number) => {
    const p = point(id);
    return Math.hypot(p.x - goal.x, p.z - goal.z);
  };
  while (open.size) {
    let current = -1,
      score = Infinity;
    for (const id of open) {
      const s = cost.get(id)! + heuristic(id);
      if (s < score) {
        current = id;
        score = s;
      }
    }
    if (current === last) {
      const route = [end, point(last)];
      while (came.has(current)) {
        current = came.get(current)!;
        route.push(point(current));
      }
      route.push(start);
      route.reverse();
      const simplified = [route[0]!];
      let i = 0;
      while (i < route.length - 1) {
        let next = route.length - 1;
        while (next > i + 1 && !clearSegment(route[i]!, route[next]!)) next--;
        simplified.push(route[next]!);
        i = next;
      }
      return simplified;
    }
    open.delete(current);
    const col = current % width,
      row = Math.floor(current / width);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if ((!dx && !dz) || col + dx < 0 || col + dx >= width || row + dz < 0 || row + dz >= height)
          continue;
        const next = current + dx + dz * width;
        if (!clearSegment(point(current), point(next))) continue;
        const nextCost = cost.get(current)! + Math.hypot(dx, dz) * step;
        if (nextCost >= (cost.get(next) ?? Infinity)) continue;
        came.set(next, current);
        cost.set(next, nextCost);
        open.add(next);
      }
  }
  return [];
}
