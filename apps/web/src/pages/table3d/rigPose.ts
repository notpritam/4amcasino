import * as THREE from 'three';

export const THIGH = 0.38;
export const SHIN = 0.47;
export const ANKLE_HEIGHT = 0.18;
export const SEATED_HIP = 0.73;
export const STANDING_HIP = 1.03;
export const SEATED_FOOT = Math.sqrt(THIGH ** 2 - (SEATED_HIP - SHIN - ANKLE_HEIGHT) ** 2);

/** Two-link leg IK, with the ankle counter-rotated so the boot remains level. */
export function placeLeg(
  char: THREE.Group,
  side: 'L' | 'R',
  hipY: number,
  forward: number,
  ankleY = ANKLE_HEIGHT,
) {
  const down = hipY - ankleY;
  const distance = THREE.MathUtils.clamp(
    Math.hypot(down, forward),
    Math.abs(SHIN - THIGH) + 0.0001,
    SHIN + THIGH,
  );
  const knee = Math.acos(
    THREE.MathUtils.clamp((distance ** 2 - THIGH ** 2 - SHIN ** 2) / (2 * THIGH * SHIN), -1, 1),
  );
  const hip =
    -Math.atan2(forward, down) - Math.atan2(SHIN * Math.sin(knee), THIGH + SHIN * Math.cos(knee));
  const leg = char.userData['leg' + side] as THREE.Group;
  leg.position.set(side === 'L' ? -0.175 : 0.175, hipY, 0);
  leg.rotation.set(hip, 0, 0);
  (char.userData['knee' + side] as THREE.Group).rotation.set(knee, 0, 0);
  (char.userData['foot' + side] as THREE.Group).rotation.set(-hip - knee, 0, 0);
}

export function posture(char: THREE.Group, sitting: number) {
  const hipY = THREE.MathUtils.lerp(STANDING_HIP, SEATED_HIP, sitting);
  (char.userData.body as THREE.Group).position.y = hipY;
  for (const side of ['L', 'R'] as const) placeLeg(char, side, hipY, SEATED_FOOT * sitting);
  for (const side of ['L', 'R'] as const) {
    (char.userData['arm' + side] as THREE.Group).rotation.x = -1.15 * sitting;
    (char.userData['elbow' + side] as THREE.Group).rotation.x = -0.08 - 0.34 * sitting;
  }
  char.userData.seated = sitting > 0.5;
}

/** A planted stance and lifted swing, timed by distance travelled, not FPS. */
export function walkPose(char: THREE.Group, distance: number, reduced = false) {
  if (reduced) return;
  const cycle = distance / 1.1;
  const hipY = 0.985 + Math.cos(cycle * Math.PI * 4) * 0.009;
  (char.userData.body as THREE.Group).position.y = hipY;
  for (const [side, offset] of [
    ['L', 0],
    ['R', 0.5],
  ] as const) {
    const p = (cycle + offset) % 1;
    const stance = p < 0.55;
    const swing = (p - 0.55) / 0.45;
    const z = stance ? 0.23 - (p / 0.55) * 0.46 : -0.23 + swing * swing * (3 - 2 * swing) * 0.46;
    const lift = stance ? 0 : Math.sin(swing * Math.PI) * 0.13;
    placeLeg(char, side, hipY, z, ANKLE_HEIGHT + lift);
    (char.userData['arm' + side] as THREE.Group).rotation.x =
      Math.sin((cycle + offset) * Math.PI * 2) * 0.36;
    (char.userData['elbow' + side] as THREE.Group).rotation.x = -0.3;
  }
}
