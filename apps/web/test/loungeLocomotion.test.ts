import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LOUNGE_DESTINATIONS, loungeSeat, isLoungeWalkable } from '@4am/shared';
import { LoungeLocomotion, type TravelPose } from '../src/pages/table3d/locomotion.ts';
import { buildCharacter, idleCharacter, disposeObject } from '../src/pages/table3d/character.ts';
import { posture, walkPose } from '../src/pages/table3d/rigPose.ts';
import { DEFAULT_AVATAR } from '../src/pages/table3d/avatar.ts';
import { CharacterMotions } from '../src/pages/table3d/motion.ts';

function display(char: THREE.Group, pose: TravelPose) {
  char.position.set(pose.x, 0, pose.z);
  char.rotation.set(0, pose.yaw, 0);
  idleCharacter(char, 0, 0, true, false);
  posture(char, pose.sitting);
  if (pose.status === 'walking') walkPose(char, pose.distance);
  char.updateMatrixWorld(true);
}

describe('getting up, walking, and returning', () => {
  for (let seat = 0; seat < 9; seat++)
    it(`seat ${seat}: grounded stages, clear travel, and exact return`, () => {
      const travel = new LoungeLocomotion(),
        char = buildCharacter(DEFAULT_AVATAR);
      const target = { ...LOUNGE_DESTINATIONS.tv, revision: 1 };
      const home = travel.update(12, seat, undefined, 0);
      const stages = new Set<string>();
      let last = home;
      for (let t = 0; t <= 18000; t += 60) {
        const pose = travel.update(12, seat, target, t);
        stages.add(pose.status);
        display(char, pose);
        expect(Math.hypot(pose.x - last.x, pose.z - last.z)).toBeLessThan(0.16);
        for (const side of ['L', 'R']) {
          const bottom = new THREE.Box3().setFromObject(char.userData['foot' + side]).min.y;
          expect(bottom).toBeGreaterThanOrEqual(0.0049);
          if (pose.status !== 'walking') expect(bottom).toBeLessThan(0.007);
        }
        if (pose.status === 'getting-up' || pose.status === 'walking')
          expect((pose.x / 5) ** 2 + (pose.z / 3.35) ** 2).toBeGreaterThan(1);
        last = pose;
      }
      expect(stages).toEqual(new Set(['getting-up', 'walking', 'standing']));
      expect(last.x).toBeCloseTo(target.x);
      expect(last.z).toBeCloseTo(target.z);
      for (let t = 18000; t <= 36000; t += 60) {
        last = travel.update(12, seat, undefined, t);
        display(char, last);
        for (const side of ['L', 'R'])
          expect(
            new THREE.Box3().setFromObject(char.userData['foot' + side]).min.y,
          ).toBeGreaterThanOrEqual(0.0049);
      }
      expect(last.status).toBe('seated');
      expect(last.x).toBeCloseTo(home.x);
      expect(last.z).toBeCloseTo(home.z);
      expect(Math.cos(last.yaw - loungeSeat(seat).yaw)).toBeCloseTo(1);
      expect(new THREE.Box3().setFromObject(char.userData.pelvis).min.y).toBeCloseTo(0.61);
      disposeObject(char);
    });
  it('reroutes in the aisle without jumping, and reduced motion settles immediately', () => {
    const travel = new LoungeLocomotion();
    travel.update(1, 0, undefined, 0);
    travel.update(1, 0, { ...LOUNGE_DESTINATIONS.tv, revision: 1 }, 0);
    const before = travel.update(1, 0, { ...LOUNGE_DESTINATIONS.tv, revision: 1 }, 5000);
    const after = travel.update(1, 0, { ...LOUNGE_DESTINATIONS.bar, revision: 2 }, 5000);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.z).toBeCloseTo(before.z);
    const end = travel.update(1, 0, { ...LOUNGE_DESTINATIONS.bar, revision: 2 }, 25000);
    expect(end.x).toBe(LOUNGE_DESTINATIONS.bar.x);
    expect(isLoungeWalkable(end)).toBe(true);
    expect(travel.update(1, 0, undefined, 25001, true).status).toBe('seated');
  });
  it('keeps locomotion in charge while a wave plays during walking', () => {
    const char = buildCharacter(DEFAULT_AVATAR),
      motions = new CharacterMotions();
    const pose: TravelPose = { x: 0, z: 6.4, yaw: 1, sitting: 0, distance: 0.7, status: 'walking' };
    display(char, pose);
    const foot = char.userData.footL.getWorldPosition(new THREE.Vector3());
    motions.start({ kind: 'emote', emote: 'wave', seat: 0, t0: 0 });
    motions.layer(char, 0, 600, false, true);
    char.updateMatrixWorld(true);
    expect(char.position.toArray()).toEqual([0, 0, 6.4]);
    expect(char.userData.footL.getWorldPosition(new THREE.Vector3()).distanceTo(foot)).toBeCloseTo(
      0,
    );
    expect(char.userData.armR.rotation.z).toBeGreaterThan(1);
    disposeObject(char);
  });
  it('exits the original chair when switching seats or freeing a seated player', () => {
    for (const nextSeat of [null, 4]) {
      const travel = new LoungeLocomotion();
      const start = travel.update(1, 0, undefined, 0);
      const first = travel.update(1, nextSeat, undefined, 0);
      expect(first.x).toBe(start.x);
      expect(first.z).toBe(start.z);
      expect(first.status).toBe('getting-up');
      let previous = first;
      for (let t = 60; t <= 20000; t += 60) {
        const pose = travel.update(1, nextSeat, undefined, t);
        expect(Math.hypot(pose.x - previous.x, pose.z - previous.z)).toBeLessThan(0.16);
        expect((pose.x / 5) ** 2 + (pose.z / 3.35) ** 2).toBeGreaterThan(1);
        previous = pose;
      }
      expect(previous.status).toBe(nextSeat === null ? 'standing' : 'seated');
    }
  });
  it('faces the television on arrival', () => {
    const travel = new LoungeLocomotion();
    travel.update(1, 0, undefined, 0);
    const target = { ...LOUNGE_DESTINATIONS.tv, revision: 1 };
    travel.update(1, 0, target, 0);
    const end = travel.update(1, 0, target, 30000);
    expect(Math.cos(end.yaw - Math.PI)).toBeCloseTo(1);
    expect(end.status).toBe('standing');
  });
});
