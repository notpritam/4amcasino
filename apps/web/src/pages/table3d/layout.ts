import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Physical seats never redistribute when someone joins or leaves. */
export function seatPlacement(seat: number, anchor = 0) {
  const angle = Math.PI / 2 + (((seat - anchor + 9) % 9) / 9) * Math.PI * 2;
  const position = new THREE.Vector3(Math.cos(angle) * 5.35, 0, Math.sin(angle) * 3.8);
  return { angle, position, yaw: Math.atan2(position.x, position.z) + Math.PI };
}

export function buildChair() {
  const chair = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: 0x263c3b, roughness: 0.72 });
  const brass = new THREE.MeshStandardMaterial({
    color: 0x96794f,
    metalness: 0.72,
    roughness: 0.34,
  });
  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    chair.add(mesh);
  };
  add(new RoundedBoxGeometry(0.83, 0.12, 0.65, 3, 0.06), leather, 0, 0.55, -0.015);
  add(new RoundedBoxGeometry(0.86, 0.65, 0.14, 3, 0.065), leather, 0, 0.92, -0.32);
  add(new THREE.CylinderGeometry(0.065, 0.09, 0.47, 12), brass, 0, 0.27, -0.04);
  add(new THREE.CylinderGeometry(0.35, 0.38, 0.045, 24), brass, 0, 0.025, -0.04);
  return chair;
}

export function boardPlacement(index: number, second: boolean, doubleRunout: boolean) {
  return { x: (index - 2) * 0.72, z: doubleRunout ? (second ? -0.57 : 0.57) : 0 };
}

/** Flip clearance includes the card's rotating half-height, not just its center. */
export function dealPose(width: number, progress: number) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const remaining = (1 - p) ** 3;
  const angle = remaining * Math.PI;
  return { angle, lift: remaining * 0.6 + (Math.abs(Math.sin(angle)) * width * 1.39) / 2 };
}

/** A yaw-only Euler decomposition can flip a chair by 180 degrees mid-emote. */
export function orientChair(chair: THREE.Group, character: THREE.Group) {
  chair.quaternion.copy(character.quaternion);
}
