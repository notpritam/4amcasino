import {
  loungePath,
  loungeSeat,
  seatExit,
  isLoungeWalkable,
  LOUNGE_DESTINATIONS,
  type LoungePoint,
  type LoungePosition,
} from '@4am/shared';
import { smooth } from './pose.ts';

export interface TravelPose extends LoungePoint {
  yaw: number;
  sitting: number;
  distance: number;
  status: 'seated' | 'standing' | 'getting-up' | 'walking' | 'sitting-down';
}
interface Segment {
  from: TravelPose;
  to: TravelPose;
  duration: number;
}
interface Traveller {
  pose: TravelPose;
  segments: Segment[];
  start: number;
  request: string;
  lastSeat: number | null;
  pending?: { seat: number | null; target?: LoungePosition };
}
const angleMix = (a: number, b: number, p: number) =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * p;
const intent = (seat: number | null, target?: LoungePosition) =>
  target ? `${target.revision}:${target.x}:${target.z}` : `seat:${seat}`;

/** Travel owns root placement; gestures only layer on the resulting posture. */
export class LoungeLocomotion {
  private travellers = new Map<number, Traveller>();
  remove(id: number) {
    this.travellers.delete(id);
  }
  get(id: number) {
    return this.travellers.get(id)?.pose;
  }

  update(
    id: number,
    seat: number | null,
    target: LoungePosition | undefined,
    now: number,
    reduced = false,
  ): TravelPose {
    let actor = this.travellers.get(id);
    const requested = intent(seat, target);
    if (!actor) {
      const point =
        target ?? (seat === null ? { x: ((id % 5) - 2) * 0.65, z: 6.4 } : loungeSeat(seat));
      const sitting = !target && seat !== null ? 1 : 0;
      actor = {
        pose: {
          x: point.x,
          z: point.z,
          yaw: sitting ? loungeSeat(seat!).yaw : Math.PI,
          sitting,
          distance: 0,
          status: sitting ? 'seated' : 'standing',
        },
        segments: [],
        start: now,
        request: requested,
        lastSeat: seat,
      };
      this.travellers.set(id, actor);
    }
    this.sample(actor, now, reduced);
    if (seat !== null && actor.pose.sitting === 1) {
      const home = loungeSeat(seat);
      if (Math.hypot(actor.pose.x - home.x, actor.pose.z - home.z) < 0.01) actor.lastSeat = seat;
    }
    if (actor.request !== requested) {
      actor.request = requested;
      actor.pending = { seat, target };
    }
    // Complete the tight chair corridor before changing direction in the open aisle.
    if (
      actor.pending &&
      (!actor.segments.length || (actor.pose.sitting === 0 && isLoungeWalkable(actor.pose)))
    ) {
      const pending = actor.pending;
      actor.pending = undefined;
      this.plan(actor, pending.seat, pending.target, now);
      this.sample(actor, now, reduced);
    }
    return { ...actor.pose };
  }

  private sample(actor: Traveller, now: number, reduced: boolean) {
    if (reduced && actor.segments.length) {
      actor.pose = { ...actor.segments.at(-1)!.to };
      actor.segments = [];
    }
    while (actor.segments.length) {
      const segment = actor.segments[0]!;
      const progress = Math.max(0, (now - actor.start) / segment.duration);
      if (progress >= 1) {
        actor.pose = { ...segment.to };
        actor.start += segment.duration;
        actor.segments.shift();
        continue;
      }
      const changingPosture = segment.from.sitting !== segment.to.sitting;
      const p = changingPosture ? smooth(progress) : progress;
      actor.pose = {
        x: segment.from.x + (segment.to.x - segment.from.x) * p,
        z: segment.from.z + (segment.to.z - segment.from.z) * p,
        yaw: angleMix(
          segment.from.yaw,
          segment.to.yaw,
          smooth(Math.min(1, (progress * segment.duration) / 220)),
        ),
        sitting: segment.from.sitting + (segment.to.sitting - segment.from.sitting) * p,
        distance: segment.from.distance + (segment.to.distance - segment.from.distance) * p,
        status: changingPosture
          ? segment.to.sitting
            ? 'sitting-down'
            : 'getting-up'
          : segment.from.distance === segment.to.distance
            ? 'standing'
            : 'walking',
      };
      return;
    }
    actor.pose.status = actor.pose.sitting ? 'seated' : 'standing';
  }

  private plan(
    actor: Traveller,
    seat: number | null,
    target: LoungePosition | undefined,
    now: number,
  ) {
    actor.segments = [];
    actor.start = now;
    let tail = { ...actor.pose };
    const add = (point: LoungePoint, sitting = 0, duration?: number, yaw?: number) => {
      const distance = Math.hypot(point.x - tail.x, point.z - tail.z);
      const endYaw =
        yaw ?? (distance > 0.01 ? Math.atan2(point.x - tail.x, point.z - tail.z) : tail.yaw);
      if (distance < 0.001 && sitting === tail.sitting && Math.cos(endYaw - tail.yaw) > 0.9999)
        return;
      const to: TravelPose = {
        ...point,
        yaw: endYaw,
        sitting,
        distance: tail.distance + (duration ? 0 : distance),
        status: sitting ? 'seated' : 'standing',
      };
      actor.segments.push({
        from: tail,
        to,
        duration: duration ?? Math.max(100, (distance / 2.05) * 1000),
      });
      tail = to;
    };
    const walk = (to: LoungePoint) => {
      const path = loungePath(tail, to);
      path.slice(1).forEach((p) => add(p));
      return path.length > 0;
    };
    if (
      tail.sitting > 0 &&
      actor.lastSeat !== null &&
      (target || seat === null || seat !== actor.lastSeat)
    ) {
      const exit = seatExit(actor.lastSeat);
      add(exit[1]!, 0, 850, loungeSeat(actor.lastSeat).yaw);
      add(exit[2]!);
      add(exit[3]!);
    }
    if (target || seat === null) {
      walk(target ?? LOUNGE_DESTINATIONS.entry);
      if (target) {
        const facing = [
          [LOUNGE_DESTINATIONS.tv, Math.PI],
          [LOUNGE_DESTINATIONS.bar, Math.PI],
          [LOUNGE_DESTINATIONS.window, Math.PI],
          [LOUNGE_DESTINATIONS.sofa, -Math.PI / 2],
        ] as const;
        const destination = facing.find(
          ([point]) => Math.hypot(target.x - point.x, target.z - point.z) < 1,
        );
        if (destination) add(tail, 0, 220, destination[1]);
      }
    } else if (seat !== null) {
      const exit = seatExit(seat);
      if (tail.sitting === 1 && Math.hypot(tail.x - exit[0]!.x, tail.z - exit[0]!.z) < 0.01) return;
      if (!walk(exit[3]!)) return;
      add(exit[2]!);
      add(exit[1]!);
      add(exit[0]!, 1, 900, loungeSeat(seat).yaw);
    }
  }
}
