// ABOUTME: The emote library for the 3D casino - every entry is a keyframe
// ABOUTME: program applied to a character rig (body + shoulder-pivoted arms),
// ABOUTME: broadcast over the websocket so the whole table watches together.
import * as THREE from 'three';
import { EMOTE_KINDS } from '@4am/shared';
import type { SoundName } from '../../shared/sounds.ts';

/** Progress-driven pose program. `p` runs 0..1 over `dur`; `t` is wall time
 *  for oscillations. Characters are reset to their base pose every frame, so
 *  programs write absolute offsets and never accumulate. */
export interface EmoteDef {
  emoji: string;
  label: string;
  dur: number;
  sound?: SoundName;
  /** Particle burst color fired at the emote's midpoint. */
  burst?: number;
  /** Floating sprite text shown over the head. */
  sprite?: string;
  apply(char: THREE.Group, p: number, t: number): void;
}

interface Rig {
  armL?: THREE.Group;
  armR?: THREE.Group;
  head?: THREE.Object3D;
}

const rig = (char: THREE.Group): Rig => char.userData as Rig;
const wave = (p: number) => Math.sin(Math.PI * p);
const osc = (t: number, hz: number) => Math.sin(t * hz * Math.PI * 2);

export type EmoteKind = (typeof EMOTE_KINDS)[number];

// Partial because the wire allowlist also covers the targeted attacks below,
// which animate the TARGET and so have no entry here.
const EMOTE_DEFS: Partial<Record<EmoteKind, EmoteDef>> = {
  wave: {
    emoji: '👋',
    label: 'Wave',
    dur: 1800,
    apply(char, p, t) {
      const r = rig(char);
      if (r.armR) {
        r.armR.rotation.z = -2.4;
        r.armR.rotation.x = osc(t, 3) * 0.5;
      }
    },
  },
  dance: {
    emoji: '🕺',
    label: 'Dance',
    dur: 2600,
    sound: 'boing',
    apply(char, p, t) {
      char.position.y += Math.abs(osc(t, 2.4)) * 0.28;
      char.rotation.z = osc(t, 1.2) * 0.18;
      const r = rig(char);
      if (r.armL) r.armL.rotation.z = 1.6 + osc(t, 2.4) * 0.9;
      if (r.armR) r.armR.rotation.z = -1.6 + osc(t, 2.4) * 0.9;
    },
  },
  disco: {
    emoji: '🪩',
    label: 'Disco',
    dur: 2600,
    burst: 0xc4b5fd,
    apply(char, p, t) {
      const beat = Math.floor(t * 2.2) % 2;
      const r = rig(char);
      if (r.armR) r.armR.rotation.z = beat ? -2.8 : -0.6;
      if (r.armL) r.armL.rotation.z = beat ? 0.6 : 2.8;
      char.rotation.z = beat ? 0.14 : -0.14;
      char.position.y += Math.abs(osc(t, 2.2)) * 0.12;
    },
  },
  robot: {
    emoji: '🤖',
    label: 'Robot',
    dur: 2800,
    apply(char, p, t) {
      const step = Math.floor(t * 3) % 4;
      const r = rig(char);
      if (r.armL) r.armL.rotation.set(step === 0 ? -1.2 : 0, 0, step === 1 ? 1.4 : 0.4);
      if (r.armR) r.armR.rotation.set(step === 2 ? -1.2 : 0, 0, step === 3 ? -1.4 : -0.4);
      char.rotation.y += step * 0.05;
    },
  },
  twirl: {
    emoji: '💫',
    label: 'Twirl',
    dur: 1600,
    apply(char, p) {
      char.rotation.y += p * Math.PI * 4;
      const r = rig(char);
      if (r.armL) r.armL.rotation.z = 1.5;
      if (r.armR) r.armR.rotation.z = -1.5;
    },
  },
  jump: {
    emoji: '🦘',
    label: 'Jump',
    dur: 1400,
    sound: 'boing',
    apply(char, p) {
      char.position.y += Math.abs(Math.sin(p * Math.PI * 2)) * 0.9;
    },
  },
  clap: {
    emoji: '👏',
    label: 'Clap',
    dur: 2000,
    apply(char, p, t) {
      const closed = (osc(t, 3.4) + 1) / 2;
      const r = rig(char);
      if (r.armL) r.armL.rotation.set(-1.3, 0, 0.5 - closed * 0.45);
      if (r.armR) r.armR.rotation.set(-1.3, 0, -0.5 + closed * 0.45);
    },
  },
  bow: {
    emoji: '🙇',
    label: 'Bow',
    dur: 1800,
    apply(char, p) {
      char.rotation.x = wave(p) * 0.7;
    },
  },
  flex: {
    emoji: '💪',
    label: 'Flex',
    dur: 2000,
    burst: 0xfbbf24,
    apply(char, p) {
      const r = rig(char);
      const up = Math.min(1, p * 3);
      if (r.armL) r.armL.rotation.set(0, 0, 2.4 * up);
      if (r.armR) r.armR.rotation.set(0, 0, -2.4 * up);
      char.scale.setScalar(1 + wave(p) * 0.07);
    },
  },
  facepalm: {
    emoji: '🤦',
    label: 'Facepalm',
    dur: 2000,
    apply(char, p, t) {
      const r = rig(char);
      if (r.armR) r.armR.rotation.set(-2.6, 0, -0.3);
      if (r.head) r.head.rotation.z = osc(t, 1.4) * 0.12;
      char.rotation.x = 0.14;
    },
  },
  rage: {
    emoji: '😤',
    label: 'Rage',
    dur: 1800,
    burst: 0xf43f5e,
    apply(char, p, t) {
      char.position.x += osc(t, 14) * 0.05;
      char.position.z += osc(t + 7, 13) * 0.05;
      char.scale.setScalar(1 + wave(p) * 0.1);
      const r = rig(char);
      if (r.armL) r.armL.rotation.z = 0.9;
      if (r.armR) r.armR.rotation.z = -0.9;
    },
  },
  laugh: {
    emoji: '😂',
    label: 'Laugh',
    dur: 2000,
    apply(char, p, t) {
      char.rotation.x = -0.18;
      char.position.y += Math.abs(osc(t, 5)) * 0.08;
    },
  },
  cry: {
    emoji: '😭',
    label: 'Cry',
    dur: 2200,
    sprite: '💧',
    apply(char, p, t) {
      char.rotation.x = 0.3;
      const r = rig(char);
      if (r.armL) r.armL.rotation.z = 0.4 + Math.abs(osc(t, 4)) * 0.2;
      if (r.armR) r.armR.rotation.z = -0.4 - Math.abs(osc(t, 4)) * 0.2;
    },
  },
  shrug: {
    emoji: '🤷',
    label: 'Shrug',
    dur: 1600,
    apply(char, p) {
      const r = rig(char);
      const up = wave(Math.min(1, p * 1.4));
      if (r.armL) r.armL.rotation.set(0, 0.5, 1.1 * up);
      if (r.armR) r.armR.rotation.set(0, -0.5, -1.1 * up);
      char.position.y += up * 0.06;
    },
  },
  heart: {
    emoji: '❤️',
    label: 'Heart',
    dur: 2000,
    sprite: '❤',
    burst: 0xe879f9,
    apply(char, p) {
      const r = rig(char);
      if (r.armL) r.armL.rotation.set(-2.9, 0, 0.7);
      if (r.armR) r.armR.rotation.set(-2.9, 0, -0.7);
    },
  },
  thumbs: {
    emoji: '👍',
    label: 'Thumbs up',
    dur: 1600,
    sprite: '👍',
    apply(char) {
      const r = rig(char);
      if (r.armR) r.armR.rotation.set(-1.5, 0, 0);
    },
  },
  headbang: {
    emoji: '🎸',
    label: 'Headbang',
    dur: 2200,
    apply(char, p, t) {
      char.rotation.x = Math.abs(osc(t, 3.4)) * 0.5;
      const r = rig(char);
      if (r.armL) r.armL.rotation.z = 2.2;
    },
  },
  moonwalk: {
    emoji: '🌙',
    label: 'Moonwalk',
    dur: 2400,
    apply(char, p, t) {
      char.translateX(Math.sin(p * Math.PI * 2) * 0.8);
      char.rotation.x = -0.14;
      char.position.y += Math.abs(osc(t, 4)) * 0.04;
    },
  },
  spin: {
    emoji: '🌀',
    label: 'Spin',
    dur: 2000,
    apply(char, p) {
      char.rotation.y += p * Math.PI * 6;
      char.position.y += wave(p) * 0.3;
    },
  },
  wiggle: {
    emoji: '🐛',
    label: 'Wiggle',
    dur: 1800,
    apply(char, p, t) {
      char.rotation.z = osc(t, 4) * 0.25;
    },
  },
  salute: {
    emoji: '🫡',
    label: 'Salute',
    dur: 1600,
    apply(char) {
      const r = rig(char);
      if (r.armR) r.armR.rotation.set(-2.2, 0, -0.9);
      char.rotation.x = -0.05;
    },
  },
  guitar: {
    emoji: '🎶',
    label: 'Air guitar',
    dur: 2600,
    apply(char, p, t) {
      char.rotation.z = -0.15;
      const r = rig(char);
      if (r.armL) r.armL.rotation.set(-1.1, 0.5, 0.4);
      if (r.armR) r.armR.rotation.set(-0.5 + osc(t, 4) * 0.4, 0, -0.3);
    },
  },
  dab: {
    emoji: '🕶️',
    label: 'Dab',
    dur: 1400,
    burst: 0xa78bfa,
    apply(char, p) {
      const hit = Math.min(1, p * 4);
      const r = rig(char);
      if (r.armL) r.armL.rotation.set(-1.9 * hit, 0, 1.1 * hit);
      if (r.armR) r.armR.rotation.set(-0.7 * hit, 0, -2.5 * hit);
      if (r.head) r.head.rotation.z = 0.5 * hit;
      char.rotation.z = -0.12 * hit;
    },
  },
  chicken: {
    emoji: '🐔',
    label: 'Chicken',
    dur: 2200,
    apply(char, p, t) {
      const flap = Math.abs(osc(t, 5));
      const r = rig(char);
      if (r.armL) r.armL.rotation.z = 0.4 + flap * 0.9;
      if (r.armR) r.armR.rotation.z = -0.4 - flap * 0.9;
      char.position.y += flap * 0.1;
      if (r.head) r.head.rotation.x = osc(t, 5) * 0.2;
    },
  },
  pray: {
    emoji: '🙏',
    label: 'Pray',
    dur: 2000,
    sprite: '🙏',
    apply(char, p) {
      const r = rig(char);
      if (r.armL) r.armL.rotation.set(-1.5, 0.4, 0.25);
      if (r.armR) r.armR.rotation.set(-1.5, -0.4, -0.25);
      char.rotation.x = 0.18 * wave(p);
    },
  },
  levitate: {
    emoji: '🧘',
    label: 'Levitate',
    dur: 3000,
    burst: 0x8b5cf6,
    apply(char, p, t) {
      char.position.y += wave(p) * 1.1 + osc(t, 0.8) * 0.06;
      char.rotation.y += p * Math.PI * 2;
      const r = rig(char);
      if (r.armL) r.armL.rotation.set(0, 0, 0.9);
      if (r.armR) r.armR.rotation.set(0, 0, -0.9);
    },
  },
  celebrate: {
    emoji: '🎉',
    label: 'Celebrate',
    dur: 2600,
    sound: 'fanfare',
    burst: 0xfbbf24,
    sprite: '🏆',
    apply(char, p, t) {
      char.position.y += Math.abs(osc(t, 3)) * 0.5;
      const r = rig(char);
      if (r.armL) r.armL.rotation.z = 2.6;
      if (r.armR) r.armR.rotation.z = -2.6;
      char.rotation.y += osc(t, 1) * 0.3;
    },
  },
};

/** Null-prototype on purpose. A plain object literal inherits from
 *  Object.prototype, so EMOTES['__proto__'] returns a truthy object with no
 *  `apply` - and the resulting throw lands inside the render loop, freezing the
 *  3D table for every player in the room until they reload. The wire format
 *  rejects unknown kinds too; this is the belt to that pair of braces. */
export const EMOTES: Partial<Record<EmoteKind, EmoteDef>> = Object.assign(
  Object.create(null) as Partial<Record<EmoteKind, EmoteDef>>,
  EMOTE_DEFS,
);

/** Targeted mischief: applied to the TARGET character. */
export const ATTACKS: Record<string, { dur: number; sound: SoundName }> = {
  shove: { dur: 1100, sound: 'thwack' },
  slap: { dur: 1300, sound: 'slap' },
  chip: { dur: 1500, sound: 'boing' },
};
