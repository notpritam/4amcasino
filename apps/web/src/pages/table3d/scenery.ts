import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** An open-roof lounge. All tall furnishings are outside the playing area. */
export function buildLounge() {
  const room = new THREE.Group();
  room.name = 'midnight-lounge';
  const material = (color: number, roughness = 0.8, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const walnut = material(0x4b3327),
    wall = material(0x142b30),
    brass = material(0xb39560, 0.38, 0.72);
  const stone = material(0x252d2d),
    fabric = material(0x294d49),
    leaf = material(0x31584a);
  const glow = new THREE.MeshStandardMaterial({
    color: 0xffe3aa,
    emissive: 0xffd28a,
    emissiveIntensity: 0.7,
  });
  const add = (
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = room,
  ) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (x: number, y: number, z: number, radius = 0.04) =>
    new RoundedBoxGeometry(x, y, z, 2, radius);
  const foundation = add(new THREE.PlaneGeometry(60, 60), walnut, 0, -0.085, 0);
  foundation.userData.walkFloor = true;
  foundation.rotation.x = -Math.PI / 2;
  // Instanced floorboards keep the architectural detail inexpensive.
  const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(2.98, 0.08, 0.48), walnut, 1760);
  const transform = new THREE.Object3D();
  for (let i = 0; i < 1760; i++) {
    transform.position.set(
      ((i % 20) - 9.5) * 3 + (Math.floor(i / 20) % 2) * 1.5,
      -0.04,
      (Math.floor(i / 20) - 43.5) * 0.5,
    );
    transform.updateMatrix();
    boards.setMatrixAt(i, transform.matrix);
    boards.setColorAt(i, new THREE.Color().setHSL(0.075, 0.23, 0.33 + ((i * 17) % 7) * 0.013));
  }
  boards.receiveShadow = true;
  boards.userData.walkFloor = true;
  room.add(boards);
  const rug = add(new THREE.CircleGeometry(1, 80), material(0x192c30), 0, 0.005, 0);
  rug.rotation.x = -Math.PI / 2;
  rug.scale.set(7.5, 5.8, 1);
  rug.userData.walkFloor = true;
  // Low wainscot and slim window frames leave the skyline visible from table height.
  add(box(27, 1.2, 0.25), wall, 0, 0.6, -8.7);
  add(box(27, 0.045, 0.3), brass, 0, 1.2, -8.65);
  const night = new THREE.MeshBasicMaterial({ color: 0x132632 });
  add(new THREE.PlaneGeometry(27, 7), night, 0, 4.7, -12);
  for (let i = 0; i < 24; i++) {
    const h = 1.2 + ((i * 13) % 11) * 0.3;
    add(
      box(0.65 + (i % 3) * 0.2, h, 0.3),
      material(i % 2 ? 0x213842 : 0x1a303a),
      (i - 11.5) * 1.05,
      1.2 + h / 2,
      -11.5,
    );
    for (let row = 0; row < Math.floor(h / 0.4); row++) {
      if ((i + row) % 3 === 0) continue;
      add(
        new THREE.PlaneGeometry(0.09, 0.15),
        glow,
        (i - 11.5) * 1.05 - 0.15,
        1.4 + row * 0.4,
        -11.32,
      );
      add(
        new THREE.PlaneGeometry(0.09, 0.15),
        glow,
        (i - 11.5) * 1.05 + 0.15,
        1.4 + row * 0.4,
        -11.32,
      );
    }
  }
  for (let i = -3; i <= 3; i++) add(box(0.065, 6.8, 0.12), brass, i * 3.7, 3.7, -8.7);
  add(box(27, 0.06, 0.12), brass, 0, 5.7, -8.7);
  for (const side of [-1, 1]) {
    const seating = new THREE.Group();
    seating.position.set(side * 9, 0, 0);
    seating.rotation.y = (side * Math.PI) / 2;
    seating.userData.loungePoint = { x: side * 7.1, z: 0 };
    add(box(4.4, 0.3, 1.2, 0.12), fabric, 0, 0.58, 0, seating);
    add(box(4.4, 0.7, 0.25, 0.12), fabric, 0, 1.02, -0.5, seating);
    for (const x of [-1.7, 1.7]) add(box(0.1, 0.4, 0.65), brass, x, 0.25, 0, seating);
    room.add(seating);
    for (const z of [-5.8, 5.8]) {
      if (side === 1 && z < 0) continue;
      const x = side * 8.2;
      add(new THREE.CylinderGeometry(0.45, 0.32, 0.75, 24), stone, x, 0.38, z);
      for (let i = 0; i < 7; i++) {
        const angle = i * 2.4;
        const foliage = add(
          new THREE.SphereGeometry(0.3, 12, 8),
          leaf,
          x + Math.cos(angle) * 0.32,
          1.15 + (i % 3) * 0.26,
          z + Math.sin(angle) * 0.32,
        );
        foliage.scale.set(0.6, 2, 0.65);
        foliage.rotation.z = Math.cos(angle) * 0.4;
      }
    }
    const lx = side * 6.8;
    add(new THREE.CylinderGeometry(0.34, 0.4, 0.05, 24), brass, lx, 0.03, -6.5);
    add(new THREE.CylinderGeometry(0.025, 0.025, 2.7, 12), brass, lx, 1.38, -6.5);
    add(new THREE.CylinderGeometry(0.38, 0.6, 0.6, 32, 1, true), glow, lx, 2.55, -6.5);
    const light = new THREE.PointLight(0xffd6a0, 12, 9);
    light.position.set(lx, 2.3, -6.5);
    room.add(light);
  }
  // An actual screen and media cabinet, behind the table and clear from overhead.
  const tv = new THREE.Group();
  tv.userData.loungeSpot = 'tv';
  add(box(6.15, 3.65, 0.2, 0.1), stone, 0, 2.9, -8.38, tv);
  add(box(6.25, 0.045, 0.24), brass, 0, 1.08, -8.34, tv);
  const screen = add(
    new THREE.PlaneGeometry(5.8, 3.2625),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    0,
    2.9,
    -8.265,
    tv,
  );
  screen.name = 'lounge-tv-screen';
  add(box(6.6, 0.55, 0.85, 0.08), walnut, 0, 0.38, -8.45, tv);
  for (const side of [-1, 1]) {
    add(box(0.35, 0.72, 0.32), stone, side * 3.55, 0.65, -8.25, tv);
    add(
      new THREE.CylinderGeometry(0.095, 0.095, 0.018, 20),
      brass,
      side * 3.55,
      0.83,
      -8.07,
      tv,
    ).rotation.x = Math.PI / 2;
  }
  room.add(tv);
  const counter = new THREE.Group();
  counter.userData.loungeSpot = 'bar';
  add(box(3.4, 1.1, 1.1, 0.08), walnut, 9.2, 0.55, -6.2, counter);
  add(box(3.65, 0.12, 1.3, 0.06), stone, 9.2, 1.16, -6.2, counter);
  add(box(3.4, 0.04, 0.05), brass, 9.2, 0.42, -5.62, counter);
  for (let i = 0; i < 8; i++) {
    const glass = material(i % 3 === 0 ? 0x789f92 : i % 3 === 1 ? 0x87613a : 0x354e59, 0.25, 0.2);
    add(
      new THREE.CylinderGeometry(0.07, 0.09, 0.3 + (i % 2) * 0.08, 12),
      glass,
      7.95 + i * 0.34,
      1.38,
      -6.35,
      counter,
    );
    add(
      new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10),
      brass,
      7.95 + i * 0.34,
      1.6 + (i % 2) * 0.04,
      -6.35,
      counter,
    );
  }
  room.add(counter);
  const dance = add(new THREE.CylinderGeometry(1.1, 1.1, 0.002, 48), fabric, -7.2, 0.004, 3.8);
  dance.userData.loungeSpot = 'dance';
  const danceTrim = add(new THREE.RingGeometry(1.04, 1.06, 48), brass, -7.2, 0.005, 3.8);
  danceTrim.rotation.x = -Math.PI / 2;
  danceTrim.userData.loungeSpot = 'dance';
  room.add(new THREE.HemisphereLight(0xc6e3e4, 0x5b4233, 1.2));
  const fill = new THREE.DirectionalLight(0x8dbfc9, 1.6);
  fill.position.set(-6, 6, -8);
  room.add(fill);
  return room;
}
