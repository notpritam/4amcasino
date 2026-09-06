import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Cut away perimeter architecture only when the camera looks through it into the room. */
export function createLoungeCutaway(room: THREE.Group) {
  room.updateMatrixWorld(true);
  const walls = room.children.flatMap((object) => {
    if (object.userData.walkFloor || object instanceof THREE.Light) return [];
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return [];
    const north = bounds.max.z < -8;
    const east = bounds.min.x > 11;
    const west = bounds.max.x < -11;
    return north || east || west ? [{ object, north, east, west }] : [];
  });
  return (camera: THREE.Vector3, target: THREE.Vector3) => {
    let changed = false;
    for (const { object, north, east, west } of walls) {
      const visible = !(
        (north && camera.z < -8 && target.z > -8) ||
        (east && camera.x > 11 && target.x < 11) ||
        (west && camera.x < -11 && target.x > -11)
      );
      if (object.visible !== visible) {
        object.visible = visible;
        changed = true;
      }
    }
    return changed;
  };
}

/** An open-roof lounge. All tall furnishings are outside the playing area. */
export function buildLounge() {
  const room = new THREE.Group();
  room.name = 'midnight-lounge';
  const material = (color: number, roughness = 0.8, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const walnut = material(0x392820),
    wall = material(0x142b30),
    brass = material(0xb39560, 0.38, 0.72);
  const stone = material(0x252d2d),
    fabric = material(0x24433f),
    leaf = material(0x31584a);
  const upholstery = material(0x69766a),
    cushion = material(0x9c7050);
  const softGlow = new THREE.MeshBasicMaterial({ color: 0xffce87 });
  const coolGlow = new THREE.MeshBasicMaterial({ color: 0x93c5d5 });
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
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (x: number, y: number, z: number, radius = 0.04) =>
    new RoundedBoxGeometry(x, y, z, 2, radius);
  const foundation = add(new THREE.PlaneGeometry(60, 60), walnut, 0, -0.085, 0);
  foundation.userData.walkFloor = true;
  foundation.castShadow = false;
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
    boards.setColorAt(i, new THREE.Color().setHSL(0.065, 0.27, 0.23 + ((i * 17) % 7) * 0.009));
  }
  boards.receiveShadow = true;
  boards.userData.walkFloor = true;
  room.add(boards);
  const rug = add(new THREE.CircleGeometry(1, 80), material(0x192c30), 0, 0.005, 0);
  rug.rotation.x = -Math.PI / 2;
  rug.scale.set(7.5, 5.8, 1);
  rug.userData.walkFloor = true;
  rug.castShadow = false;
  // Low wainscot and slim window frames leave the skyline visible from table height.
  add(box(27, 1.2, 0.25), wall, 0, 0.6, -8.7);
  add(box(27, 0.045, 0.3), brass, 0, 1.2, -8.65);
  // Layered skyline, with every lit window in one instanced draw call.
  const city = new THREE.Group();
  city.name = 'city-skyline';
  const silhouettes = [material(0x132735), material(0x1b3341), material(0x27414c)];
  const windows: THREE.Matrix4[] = [];
  const windowColors: THREE.Color[] = [];
  for (let layer = 0; layer < 3; layer++) {
    for (let i = 0; i < 28; i++) {
      const x = (i - 13.5) * 1.55 + (layer % 2) * 0.65;
      const h = 1.7 + ((i * 13 + layer * 7) % 17) * 0.3;
      const z = -21 + layer * 3.6;
      const w = 0.85 + (i % 3) * 0.22;
      add(new THREE.BoxGeometry(w, h, 0.6), silhouettes[layer]!, x, h / 2 + 0.9, z, city);
      if (i % 7 === 2) {
        add(new THREE.BoxGeometry(0.035, 0.7, 0.035), silhouettes[layer]!, x, h + 1.25, z, city);
        add(new THREE.SphereGeometry(0.035, 6, 4), softGlow, x, h + 1.6, z, city);
      }
      for (let row = 0; row < Math.floor(h / 0.35); row++) {
        for (let col = 0; col < 3; col++) {
          if ((i * 19 + row * 7 + col * 3 + layer) % 5 < 2) continue;
          transform.position.set(x + (col - 1) * 0.23, 1.08 + row * 0.35, z + 0.31);
          transform.updateMatrix();
          windows.push(transform.matrix.clone());
          windowColors.push(new THREE.Color((i + row + col) % 4 ? 0xe7bb81 : 0x8fc2d2));
        }
      }
    }
  }
  const cityWindows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.085, 0.14),
    new THREE.MeshBasicMaterial(),
    windows.length,
  );
  windows.forEach((matrix, i) => {
    cityWindows.setMatrixAt(i, matrix);
    cityWindows.setColorAt(i, windowColors[i]!);
  });
  city.add(cityWindows);
  room.add(city);
  // A perimeter portal frames the view without a ceiling over the table.
  add(box(27, 0.28, 0.5), walnut, 0, 6.7, -8.7);
  add(box(26.4, 0.04, 0.06), softGlow, 0, 6.53, -8.4);
  for (const side of [-1, 1]) {
    add(box(0.45, 6.7, 0.55), walnut, side * 12, 3.35, -8.6);
    add(box(0.035, 5.8, 0.03), softGlow, side * 11.75, 3.1, -8.29);
    add(box(0.25, 3.8, 16), wall, side * 11.75, 1.9, -0.2);
    add(box(0.31, 0.07, 16), brass, side * 11.73, 3.8, -0.2);
    add(box(0.03, 0.045, 15.6), softGlow, side * 11.58, 0.18, -0.2);
    for (let i = 0; i < 36; i++)
      add(new THREE.BoxGeometry(0.06, 1.35, 0.035), walnut, side * 11.59, 0.92, -7.5 + i * 0.42);
    // Upholstered wall alcoves and luminous brass sconces behind each sofa.
    for (let i = -1; i <= 1; i++) {
      add(box(0.09, 1.85, 1.65, 0.1), upholstery, side * 11.56, 2.35, i * 1.85);
    }
    for (const z of [-3.5, 3.5]) {
      add(box(0.12, 1.1, 0.28), brass, side * 11.49, 2.6, z);
      add(box(0.15, 0.75, 0.13), softGlow, side * 11.39, 2.6, z);
    }
    const seatingLight = new THREE.PointLight(0xffca8c, 16, 9, 2);
    seatingLight.position.set(side * 10.5, 3.2, 0);
    room.add(seatingLight);
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
    for (let i = -1; i <= 1; i++) {
      add(box(1.3, 0.16, 1, 0.07), upholstery, i * 1.35, 0.78, 0.05, seating);
      const pillow = add(box(0.6, 0.54, 0.2, 0.12), cushion, i * 1.45, 1.06, -0.25, seating);
      pillow.rotation.z = i * 0.12;
      pillow.rotation.x = -0.15;
    }
    for (const x of [-2.05, 2.05]) add(box(0.22, 0.44, 1.15, 0.09), fabric, x, 0.95, 0, seating);
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
    const light = new THREE.PointLight(0xffd6a0, 17, 8, 2);
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
  // Recessed shelving and under-counter light make the bar a distinct destination.
  add(box(3.7, 2.55, 0.2), walnut, 9.2, 2.85, -8.4, counter);
  for (const y of [1.8, 2.65, 3.5]) {
    add(box(3.6, 0.065, 0.55), brass, 9.2, y, -8.1, counter);
    add(box(3.35, 0.035, 0.045), softGlow, 9.2, y + 0.055, -8.02, counter);
    for (let i = 0; i < 7; i++) {
      const x = 7.87 + i * 0.44;
      add(
        new THREE.CylinderGeometry(0.065, 0.08, 0.34, 10),
        i % 2 ? fabric : cushion,
        x,
        y + 0.22,
        -8.05,
        counter,
      );
      add(new THREE.CylinderGeometry(0.026, 0.026, 0.14, 8), brass, x, y + 0.46, -8.05, counter);
    }
  }
  for (let i = 0; i < 24; i++)
    add(new THREE.BoxGeometry(0.035, 0.8, 0.04), brass, 7.62 + i * 0.138, 0.59, -5.62, counter);
  add(box(3.3, 0.025, 0.04), softGlow, 9.2, 1.07, -5.56, counter);
  const barLight = new THREE.PointLight(0xffbd73, 22, 8, 2);
  barLight.position.set(9.2, 3.8, -6.5);
  counter.add(barLight);
  room.add(counter);
  const screenGlow = add(box(5.7, 0.035, 0.04), coolGlow, 0, 0.72, -8);
  screenGlow.name = 'tv-cabinet-light';
  // Low brass inlays guide the aisle without introducing collision obstacles.
  for (const radius of [1, 1.025]) {
    const inlay = add(new THREE.RingGeometry(radius, radius + 0.002, 100), brass, 0, 0.009, 0);
    inlay.rotation.x = -Math.PI / 2;
    inlay.scale.set(7.35, 5.65, 1);
    inlay.userData.walkFloor = true;
    inlay.castShadow = false;
    inlay.receiveShadow = false;
  }
  const dance = add(new THREE.CylinderGeometry(1.1, 1.1, 0.002, 48), fabric, -7.2, 0.004, 3.8);
  dance.userData.loungeSpot = 'dance';
  dance.castShadow = false;
  // The floor accent sits on the rug instead of sharing its depth.
  dance.position.y = 0.009;
  const danceTrim = add(new THREE.RingGeometry(1.04, 1.06, 48), brass, -7.2, 0.005, 3.8);
  danceTrim.rotation.x = -Math.PI / 2;
  danceTrim.userData.loungeSpot = 'dance';
  danceTrim.position.y = 0.011;
  danceTrim.castShadow = false;
  room.add(new THREE.HemisphereLight(0xb9d4e8, 0x5b4233, 0.65));
  const fill = new THREE.DirectionalLight(0x9fcbeb, 1.1);
  fill.position.set(-6, 6, -8);
  room.add(fill);
  return room;
}
