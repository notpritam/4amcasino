import * as THREE from 'three';
import { idleCharacter } from './character.ts';
import { EMOTES, type EmoteKind } from './emotes.ts';
import { blendPose, capturePose, envelope, smooth, poseNodes, type Pose } from './pose.ts';

export type MotionKind =
  'poke' | 'shove' | 'slap' | 'chip' | 'fold' | 'boom' | 'rocket' | 'sparks' | 'emote' | 'throw';
export interface CharacterMotion {
  kind: MotionKind;
  emote?: string;
  seat: number;
  t0: number;
  fired?: boolean;
  direction?: THREE.Vector3;
  from?: Pose;
}
export const CONTACT_MS = 500;
export function motionDuration(anim: CharacterMotion) {
  return anim.kind === 'emote'
    ? (EMOTES[anim.emote as EmoteKind]?.dur ?? 1600)
    : anim.kind === 'fold'
      ? 1000
      : anim.kind === 'throw'
        ? 950
        : ['poke', 'shove', 'slap', 'chip'].includes(anim.kind)
          ? 1500
          : 2100;
}
export function chipPosition(from: THREE.Vector3, to: THREE.Vector3, p: number) {
  return new THREE.Vector3()
    .lerpVectors(from, to, p)
    .add(new THREE.Vector3(0, Math.sin(Math.PI * p) * 1.2, 0));
}
export function applyMotion(char: THREE.Group, anim: CharacterMotion, p: number) {
  if (p <= 0 || p >= 1) return;
  const body = char.userData.body as THREE.Group;
  const strength = Math.sin(Math.PI * p) ** 2;
  if (anim.kind === 'emote') {
    EMOTES[anim.emote as EmoteKind]?.apply(char, p, (p * motionDuration(anim)) / 1000);
  } else if (anim.kind === 'throw') {
    const r = char.userData.armR as THREE.Group;
    const elbow = char.userData.elbowR as THREE.Group;
    r.rotation.x = THREE.MathUtils.lerp(-1.15, -2.3 + smooth((p - 0.28) / 0.25) * 1.1, envelope(p));
    elbow.rotation.x = THREE.MathUtils.lerp(-0.42, -0.8, envelope(p));
    const aim = anim.direction
      ?.clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -char.rotation.y);
    body.rotation.y =
      (Math.sin(p * Math.PI * 2) * 0.15 +
        (aim ? THREE.MathUtils.clamp(Math.atan2(aim.x, aim.z), -0.65, 0.65) : 0)) *
      envelope(p);
  } else if (anim.kind === 'fold') {
    body.rotation.x = strength * 0.3;
    (char.userData.head as THREE.Group).rotation.x = strength * 0.2;
  } else if (['poke', 'shove', 'slap', 'chip'].includes(anim.kind)) {
    // Wait for the incoming chip / gesture, then recoil at the hips and recover.
    const contact = CONTACT_MS / motionDuration(anim);
    if (p <= contact) return;
    const hitP = (p - contact) / (1 - contact);
    const recoil = Math.sin(Math.PI * smooth(hitP)) * Math.exp(-hitP * 1.3);
    const direction = (anim.direction ?? new THREE.Vector3(0, 0, -1)).clone();
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), -char.rotation.y);
    const amount = anim.kind === 'chip' ? 0.16 : 0.3;
    body.rotation.x = direction.z * recoil * amount;
    body.rotation.z = -direction.x * recoil * amount;
    (char.userData.head as THREE.Group).rotation.z = recoil * (anim.kind === 'slap' ? 0.28 : 0.1);
  } else if (anim.kind === 'rocket') {
    char.position.y += strength * 2.1;
    body.rotation.y = Math.sin(p * Math.PI * 2) * 0.18 * envelope(p);
  } else {
    // Bust effects keep a recognizable character and return to the occupied seat.
    body.scale.multiplyScalar(1 - strength * 0.18);
    body.rotation.z = Math.sin(p * Math.PI * 6) * strength * 0.12;
  }
}

/** One writer per seat. Replacing a gesture crossfades from its displayed pose. */
export class CharacterMotions {
  readonly active = new Map<number, CharacterMotion>();
  start(anim: CharacterMotion, char?: THREE.Group) {
    this.active.set(anim.seat, { ...anim, from: char ? capturePose(char) : undefined });
  }
  remove(seat: number) {
    this.active.delete(seat);
  }
  frame(char: THREE.Group, seat: number, home: THREE.Vector3, now: number, reduced = false) {
    char.position.copy(home);
    char.rotation.set(0, Math.atan2(home.x, home.z) + Math.PI, 0);
    idleCharacter(char, now / 1000, seat, reduced, true);
    this.layer(char, seat, now, reduced);
  }
  layer(char: THREE.Group, seat: number, now: number, reduced = false, keepFeet = false) {
    const anim = this.active.get(seat);
    if (!anim) return;
    const p = (now - anim.t0) / motionDuration(anim);
    if (reduced || p >= 1) {
      this.active.delete(seat);
      return;
    }
    const base = capturePose(char);
    applyMotion(char, anim, p);
    if (anim.from && now - anim.t0 < 140) blendPose(char, anim.from, smooth((now - anim.t0) / 140));
    else anim.from = undefined;
    // Locomotion owns travel. A reaction cannot slide into a table or chair.
    char.position.x = base[0]!.position.x;
    char.position.z = base[0]!.position.z;
    if (keepFeet || char.userData.seated) {
      char.position.y = base[0]!.position.y;
      char.quaternion.copy(base[0]!.rotation);
    }
    if (keepFeet) {
      const nodes = poseNodes(char);
      for (let i = 7; i < nodes.length; i++) {
        nodes[i]!.position.copy(base[i]!.position);
        nodes[i]!.quaternion.copy(base[i]!.rotation);
      }
    }
  }
}
