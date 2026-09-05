import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Avatar3D } from './avatar.ts';

/** Dispose each owned resource once, including textures on sprites and meshes. */
export function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

/** A little vinyl astronaut. Accessories follow the head and emotes use the existing rig. */
export function buildCharacter(cfg: Avatar3D, dimmed = false): THREE.Group {
  const root = new THREE.Group();
  const shell = new THREE.MeshPhysicalMaterial({
    color: cfg.c,
    metalness: 0.2,
    roughness: 0.3,
    clearcoat: 0.7,
    clearcoatRoughness: 0.25,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x171527, roughness: 0.38, metalness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0c1828,
    roughness: 0.16,
    metalness: 0.65,
    clearcoat: 1,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: cfg.t,
    emissive: cfg.t,
    emissiveIntensity: 1.3,
    roughness: 0.3,
  });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f5ff, roughness: 0.35 });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    metalness: 0.72,
    roughness: 0.24,
  });
  if (dimmed)
    [shell, dark, glass, glow, white, gold].forEach((mat) => {
      mat.color.multiplyScalar(0.48);
    });
  if (dimmed) glow.emissiveIntensity = 0.25;
  const add = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (x: number, y: number, z: number, radius = 0.08) =>
    new RoundedBoxGeometry(x, y, z, 3, radius);
  add(root, box(0.66, 0.65, 0.43, 0.14), shell, 0, 0.78, 0);
  add(root, box(0.38, 0.3, 0.055, 0.045), dark, 0, 0.81, 0.224);
  add(root, new THREE.SphereGeometry(0.066, 16, 12), glow, 0, 0.85, 0.265);
  for (let i = 0; i < 3; i++)
    add(root, box(0.045, 0.019, 0.02, 0.005), white, (i - 1) * 0.075, 0.72, 0.26);
  add(root, box(0.57, 0.08, 0.45, 0.035), dark, 0, 0.53, 0);
  add(root, box(0.14, 0.075, 0.03, 0.02), glow, 0, 0.53, 0.235);
  add(root, new THREE.CylinderGeometry(0.13, 0.15, 0.15, 16), dark, 0, 1.15, 0);

  const head = new THREE.Group();
  head.position.y = 1.49;
  root.add(head);
  root.userData.head = head;
  if (cfg.head === 'cube') add(head, box(0.7, 0.6, 0.59, 0.12), shell, 0, 0, 0);
  else if (cfg.head === 'cone') {
    const helmet = add(head, new THREE.SphereGeometry(0.37, 24, 18), shell, 0, 0, 0);
    helmet.scale.set(0.93, 0.87, 0.9);
    add(head, new THREE.ConeGeometry(0.24, 0.3, 24), shell, 0, 0.34, -0.015);
  } else {
    const helmet = add(head, new THREE.SphereGeometry(0.38, 28, 20), shell, 0, 0, 0);
    helmet.scale.set(1, 0.93, 0.92);
  }
  add(head, box(0.56, 0.29, 0.14, 0.095), glass, 0, -0.02, 0.286);
  const eyes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    eyes.push(add(head, box(0.063, 0.1, 0.025, 0.024), glow, side * 0.125, 0.012, 0.366));
    const ear = add(
      head,
      new THREE.CylinderGeometry(0.115, 0.115, 0.09, 20),
      dark,
      side * 0.363,
      0,
      0,
    );
    ear.rotation.z = Math.PI / 2;
    const earLight = add(
      head,
      new THREE.CylinderGeometry(0.065, 0.065, 0.095, 20),
      glow,
      side * 0.365,
      0,
      0,
    );
    earLight.rotation.z = Math.PI / 2;
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.39, 1.0, 0);
    root.add(shoulder);
    add(shoulder, new THREE.SphereGeometry(0.12, 16, 12), dark, 0, 0, 0);
    add(shoulder, new THREE.CapsuleGeometry(0.105, 0.19, 5, 14), shell, 0, -0.17, 0);
    add(shoulder, new THREE.SphereGeometry(0.09, 14, 12), dark, 0, -0.32, 0);
    add(shoulder, new THREE.CapsuleGeometry(0.105, 0.14, 5, 14), shell, 0, -0.42, 0.018);
    add(shoulder, box(0.2, 0.08, 0.21, 0.03), glow, 0, -0.51, 0.02);
    add(shoulder, new THREE.SphereGeometry(0.112, 16, 12), white, 0, -0.6, 0.032);
    shoulder.rotation.z = side * 0.16;
    root.userData[side === -1 ? 'armL' : 'armR'] = shoulder;
    add(root, new THREE.CapsuleGeometry(0.13, 0.16, 5, 14), dark, side * 0.175, 0.34, 0);
    add(root, box(0.29, 0.23, 0.44, 0.075), shell, side * 0.175, 0.145, 0.07);
    add(root, box(0.3, 0.045, 0.44, 0.015), dark, side * 0.175, 0.047, 0.07);
  }
  root.userData.eyes = eyes;
  const smile = add(
    head,
    new THREE.TorusGeometry(0.052, 0.008, 6, 16, Math.PI),
    glow,
    0,
    -0.063,
    0.365,
  );
  smile.rotation.z = Math.PI;
  if (cfg.hat === 'cap') {
    add(
      head,
      new THREE.SphereGeometry(0.385, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      dark,
      0,
      0.12,
      0,
    );
    add(head, box(0.61, 0.055, 0.38, 0.025), shell, 0, 0.12, 0.27);
    add(head, new THREE.SphereGeometry(0.045, 12, 8), glow, 0, 0.51, 0);
  } else if (cfg.hat === 'halo') {
    const halo = add(head, new THREE.TorusGeometry(0.37, 0.025, 10, 40), glow, 0, 0.57, 0);
    halo.rotation.x = Math.PI / 2 + 0.15;
    add(head, new THREE.CylinderGeometry(0.014, 0.014, 0.18, 8), dark, 0, 0.43, -0.23);
  } else if (cfg.hat === 'crown') {
    add(head, new THREE.CylinderGeometry(0.27, 0.29, 0.12, 24, 1, true), gold, 0, 0.35, 0);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      add(
        head,
        new THREE.ConeGeometry(0.08, 0.22, 4),
        gold,
        Math.sin(angle) * 0.23,
        0.49,
        Math.cos(angle) * 0.23,
      );
      add(
        head,
        new THREE.SphereGeometry(0.035, 10, 8),
        glow,
        Math.sin(angle) * 0.23,
        0.61,
        Math.cos(angle) * 0.23,
      );
    }
  }
  return root;
}

export function idleCharacter(char: THREE.Group, t: number, phase = 0, reduced = false) {
  const wave = reduced ? 0 : Math.sin(t * 1.6 + phase);
  char.scale.setScalar(1 + wave * 0.007);
  (char.userData.armL as THREE.Group).rotation.set(0, 0, -0.16 + wave * 0.035);
  (char.userData.armR as THREE.Group).rotation.set(0, 0, 0.16 - wave * 0.035);
  (char.userData.head as THREE.Group).rotation.set(
    0,
    reduced ? 0 : Math.sin(t * 0.5 + phase) * 0.1,
    0,
  );
  const blink = !reduced && (t + phase * 0.7) % 4.8 > 4.65;
  (char.userData.eyes as THREE.Mesh[]).forEach((eye) => {
    eye.scale.y = blink ? 0.12 : 1;
  });
}
