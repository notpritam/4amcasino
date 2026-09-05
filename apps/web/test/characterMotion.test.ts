import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCharacter, disposeObject, idleCharacter } from '../src/pages/table3d/character.ts';
import { DEFAULT_AVATAR } from '../src/pages/table3d/avatar.ts';
import { EMOTES } from '../src/pages/table3d/emotes.ts';

function transforms(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  return [root, root.userData.armL, root.userData.armR, root.userData.head].flatMap(
    (node: THREE.Object3D) => node.matrixWorld.elements,
  );
}

describe('character animation boundaries', () => {
  for (const [name, emote] of Object.entries(EMOTES)) {
    it(`${name} enters and leaves the rest pose without a snap`, () => {
      const char = buildCharacter(DEFAULT_AVATAR);
      for (const p of [0, 1]) {
        char.position.set(5.1, 0, -1.8);
        char.rotation.set(0, 1.2, 0);
        idleCharacter(char, 0, 0, true);
        const base = transforms(char);
        emote!.apply(char, p, 0.417);
        const animated = transforms(char);
        animated.forEach((value, i) => expect(value).toBeCloseTo(base[i]!, 6));
      }
      disposeObject(char);
    });
  }
  it('has articulated hips, knees, and elbows instead of fixed standing legs', () => {
    const char = buildCharacter(DEFAULT_AVATAR);
    for (const joint of ['body', 'legL', 'legR', 'kneeL', 'kneeR', 'elbowL', 'elbowR']) {
      expect(char.userData[joint], joint).toBeInstanceOf(THREE.Group);
    }
    disposeObject(char);
  });
});

import {
  CharacterMotions,
  applyMotion,
  chipPosition,
  CONTACT_MS,
  motionDuration,
  type MotionKind,
} from '../src/pages/table3d/motion.ts';
import { blendPose, capturePose, poseNodes } from '../src/pages/table3d/pose.ts';
import {
  boardPlacement,
  buildChair,
  seatPlacement,
  dealPose,
  orientChair,
} from '../src/pages/table3d/layout.ts';
import { buildLounge } from '../src/pages/table3d/scenery.ts';

describe('seating, motion stages, and replacement', () => {
  it('places hips on the cushion, thighs horizontally, and both soles on the rug', () => {
    const char = buildCharacter(DEFAULT_AVATAR);
    idleCharacter(char, 0, 0, true, true);
    char.updateMatrixWorld(true);
    for (const side of ['L', 'R']) {
      const hip = char.userData['leg' + side].getWorldPosition(new THREE.Vector3());
      const knee = char.userData['knee' + side].getWorldPosition(new THREE.Vector3());
      const foot = char.userData['foot' + side].getWorldPosition(new THREE.Vector3());
      expect(hip.y).toBeCloseTo(0.73);
      expect(knee.y).toBeCloseTo(hip.y);
      expect(knee.z - hip.z).toBeCloseTo(0.3);
      expect(foot.z).toBeCloseTo(knee.z);
      expect(new THREE.Box3().setFromObject(char.userData['foot' + side]).min.y).toBeCloseTo(
        0.0055,
        3,
      );
    }
    const chair = buildChair();
    expect(new THREE.Box3().setFromObject(chair.children[0]!).max.y).toBeCloseTo(0.61);
    disposeObject(char);
    disposeObject(chair);
  });

  it('blends toward the actual target rotation, including at the midpoint', () => {
    const char = buildCharacter(DEFAULT_AVATAR);
    const base = capturePose(char);
    char.userData.armR.rotation.z += 2;
    const target = char.userData.armR.quaternion.clone();
    blendPose(char, base, 0.5);
    expect(char.userData.armR.quaternion.angleTo(target)).toBeCloseTo(1);
    disposeObject(char);
  });

  for (const [name, emote] of Object.entries(EMOTES)) {
    it(`${name}: all seated stages stay finite, animate, and return to the same seat`, () => {
      const char = buildCharacter(DEFAULT_AVATAR);
      const chair = buildChair();
      for (let seat = 0; seat < 9; seat++) {
        const home = seatPlacement(seat, 2);
        let changes = 0;
        for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
          char.position.copy(home.position);
          char.rotation.set(0, home.yaw, 0);
          idleCharacter(char, 0, 0, true, true);
          const base = transforms(char);
          emote!.apply(char, p, 75);
          const result = transforms(char);
          orientChair(chair, char);
          chair.updateMatrixWorld(true);
          const cushion = chair.children[0]!.getWorldPosition(new THREE.Vector3());
          const back = chair.children[1]!.getWorldPosition(new THREE.Vector3());
          const chairFacing = cushion.sub(back).setY(0).normalize();
          const characterFacing = new THREE.Vector3(0, 0, 1).applyQuaternion(char.quaternion);
          expect(chairFacing.dot(characterFacing)).toBeCloseTo(1, 6);
          expect(result.every(Number.isFinite)).toBe(true);
          if (p === 0 || p === 1) result.forEach((v, i) => expect(v).toBeCloseTo(base[i]!, 6));
          else changes += result.reduce((sum, v, i) => sum + Math.abs(v - base[i]!), 0);
          expect(
            Math.hypot(char.position.x - home.position.x, char.position.z - home.position.z),
          ).toBeLessThan(0.08);
          expect(new THREE.Box3().setFromObject(char.userData.footL).min.y).toBeGreaterThanOrEqual(
            0.005 - 1e-6,
          );
        }
        expect(changes).toBeGreaterThan(0.05);
      }
      disposeObject(chair);
      disposeObject(char);
    });
  }

  for (const kind of [
    'shove',
    'slap',
    'chip',
    'poke',
    'fold',
    'rocket',
    'boom',
    'sparks',
    'throw',
  ] as MotionKind[]) {
    it(`${kind}: contact, peak and recovery never move into another seat`, () => {
      const char = buildCharacter(DEFAULT_AVATAR);
      const home = seatPlacement(7).position;
      const anim = { kind, seat: 7, t0: 0, direction: new THREE.Vector3(1, 0, 1).normalize() };
      for (const p of [0, 0.1, CONTACT_MS / motionDuration(anim), 0.5, 0.75, 0.9, 1]) {
        char.position.copy(home);
        char.rotation.set(0, 0.6, 0);
        idleCharacter(char, 0, 0, true, true);
        const base = transforms(char);
        applyMotion(char, anim, p);
        const result = transforms(char);
        expect(result.every(Number.isFinite)).toBe(true);
        expect(char.position.x).toBe(home.x);
        expect(char.position.z).toBe(home.z);
        if (
          p === 0 ||
          p === 1 ||
          (['shove', 'slap', 'chip', 'poke'].includes(kind) &&
            p <= CONTACT_MS / motionDuration(anim))
        )
          result.forEach((v, i) => expect(v).toBeCloseTo(base[i]!, 6));
      }
      disposeObject(char);
    });
  }

  it('replaces an in-flight gesture without a snap; reduced motion restores the seated pose', () => {
    const char = buildCharacter(DEFAULT_AVATAR),
      home = seatPlacement(3).position;
    const player = new CharacterMotions();
    player.frame(char, 3, home, 0);
    player.start({ kind: 'emote', emote: 'wave', seat: 3, t0: 0 }, char);
    player.frame(char, 3, home, 700);
    const prior = transforms(char);
    player.start({ kind: 'emote', emote: 'dance', seat: 3, t0: 700 }, char);
    player.frame(char, 3, home, 700);
    expect(player.active.size).toBe(1);
    transforms(char).forEach((v, i) => expect(v).toBeCloseTo(prior[i]!, 6));
    player.frame(char, 3, home, 900, true);
    expect(player.active.size).toBe(0);
    expect(char.position.equals(home)).toBe(true);
    expect(char.userData.legL.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(poseNodes(char).every((node) => node.matrix.elements.every(Number.isFinite))).toBe(true);
    disposeObject(char);
  });

  it('lands the chip at the target, following a raised arc', () => {
    const from = new THREE.Vector3(3, 1.55, 2),
      to = new THREE.Vector3(-3, 1.65, -2);
    expect(chipPosition(from, to, 0).distanceTo(from)).toBeCloseTo(0);
    expect(chipPosition(from, to, 1).distanceTo(to)).toBeCloseTo(0);
    expect(chipPosition(from, to, 0.5).y).toBeGreaterThan(2.7);
  });
});

describe('layout and overhead clearance', () => {
  it('keeps physical seat coordinates independent of occupied seats', () => {
    const initial = [0, 2, 5, 8].map((seat) => seatPlacement(seat, 2));
    const joined = [0, 1, 2, 4, 5, 8].map((seat) => ({ seat, ...seatPlacement(seat, 2) }));
    [0, 2, 5, 8].forEach((seat, i) =>
      expect(joined.find((p) => p.seat === seat)!.position.equals(initial[i]!.position)).toBe(true),
    );
    for (let seat = 0; seat < 9; seat++) {
      const p = seatPlacement(seat);
      const facing = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      expect(facing.dot(p.position.clone().normalize())).toBeCloseTo(-1);
    }
  });
  it('has no scenery between an overhead camera and any card in either board', () => {
    const lounge = buildLounge();
    lounge.updateMatrixWorld(true);
    for (const second of [false, true])
      for (let i = 0; i < 5; i++) {
        const { x, z } = boardPlacement(i, second, true);
        // Corners as well as centers must stay clear.
        for (const dx of [-0.31, 0, 0.31])
          for (const dz of [-0.431, 0, 0.431]) {
            const ray = new THREE.Raycaster(
              new THREE.Vector3(x + dx, 15, z + dz),
              new THREE.Vector3(0, -1, 0),
              0,
              13.95,
            );
            expect(ray.intersectObject(lounge, true)).toHaveLength(0);
          }
      }
    const row1 = boardPlacement(0, false, true),
      row2 = boardPlacement(0, true, true);
    expect(row1.z - row2.z).toBeGreaterThan(0.62 * 1.39);
    disposeObject(lounge);
  });
});

describe('gesture clearance', () => {
  for (const [name, emote] of Object.entries(EMOTES))
    it(`${name} keeps hands out of the torso`, () => {
      const char = buildCharacter(DEFAULT_AVATAR);
      for (const p of [0.1, 0.25, 0.4, 0.6, 0.8, 0.95]) {
        idleCharacter(char, 0, 0, true, true);
        char.position.set(0, 0, 0);
        char.rotation.set(0, 0, 0);
        emote!.apply(char, p, 0);
        char.updateMatrixWorld(true);
        for (const side of ['L', 'R']) {
          const hand = char.userData['hand' + side].getWorldPosition(new THREE.Vector3());
          const local = char.userData.body.worldToLocal(hand);
          const inside =
            Math.abs(local.x) < 0.3 && local.y > -0.05 && local.y < 0.55 && Math.abs(local.z) < 0.2;
          expect(inside, `${side} at ${p}: ${local.toArray()}`).toBe(false);
        }
      }
      disposeObject(char);
    });
});

it('keeps both edges of every flipping card above the felt throughout the deal', () => {
  for (const width of [0.36, 0.62, 0.72])
    for (let step = 0; step <= 100; step++) {
      const { angle, lift } = dealPose(width, step / 100);
      const lowestEdge = 0.02 + lift - (Math.abs(Math.sin(angle)) * width * 1.39) / 2;
      expect(lowestEdge).toBeGreaterThanOrEqual(0.02 - 1e-6);
      if (step === 100) {
        expect(angle).toBe(0);
        expect(lift).toBe(0);
      }
    }
});
