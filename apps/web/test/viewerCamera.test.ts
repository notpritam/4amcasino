import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { loungeSeat } from '@4am/shared';
import { cameraPresetFor } from '../src/pages/table3d/camera.ts';
import { buildLounge, createLoungeCutaway } from '../src/pages/table3d/scenery.ts';
import { disposeObject } from '../src/pages/table3d/character.ts';

it('keeps architecture clear of the viewer and felt from every table camera, restoring it inside', () => {
  const lounge = buildLounge();
  const cutaway = createLoungeCutaway(lounge);
  for (const view of ['Table', 'Close', 'Overhead'] as const)
    for (const aspect of [1440 / 900, 390 / 844])
      for (let seat = 0; seat < 9; seat++) {
        const preset = cameraPresetFor(view, seat);
        const target = new Vector3(...preset.look);
        const position = new Vector3(...preset.pos)
          .sub(target)
          .multiplyScalar(Math.min(Math.max(1, 1.5 / aspect), 2.3))
          .add(target);
        cutaway(position, target);
        const home = loungeSeat(seat);
        for (const point of [new Vector3(home.x, 1.8, home.z), new Vector3(0, 1.1, 0)]) {
          const ray = new Raycaster(
            position,
            point.clone().sub(position).normalize(),
            0,
            position.distanceTo(point),
          );
          const hits = ray.intersectObject(lounge, true).filter(({ object }) => {
            for (let node = object; node; node = node.parent!) if (!node.visible) return false;
            return true;
          });
          expect(hits, `${view}, seat ${seat}, aspect ${aspect}`).toHaveLength(0);
        }
      }
  cutaway(new Vector3(0, 3.4, -2.5), new Vector3(0, 2.9, -8.3));
  expect(lounge.children.every((object) => object.visible)).toBe(true);
  expect(lounge.getObjectByName('lounge-tv-screen')?.visible).toBe(true);
  disposeObject(lounge);
});

describe('viewer-centred table camera', () => {
  for (const view of ['Table', 'Close', 'Overhead'] as const) {
    it(`${view} centres every physical seat at desktop and phone aspect ratios`, () => {
      for (let seat = 0; seat < 9; seat++) {
        const home = loungeSeat(seat);
        const preset = cameraPresetFor(view, seat);
        for (const aspect of [1440 / 900, 390 / 844]) {
          const camera = new PerspectiveCamera(50, aspect, 0.1, 60);
          const target = new Vector3(...preset.look);
          camera.position
            .set(...preset.pos)
            .sub(target)
            .multiplyScalar(Math.min(Math.max(1, 1.5 / aspect), 2.3))
            .add(target);
          camera.lookAt(target);
          camera.updateMatrixWorld();
          const projected = new Vector3(home.x, 1, home.z).project(camera);
          expect(projected.x).toBeCloseTo(0, 8);
          expect(Math.abs(projected.y)).toBeLessThan(1);
          expect(projected.z).toBeLessThan(1);
          expect(projected.z).toBeGreaterThan(-1);
          // The viewer sits between the camera and the centre of the felt.
          expect(camera.position.x * home.x + camera.position.z * home.z).toBeGreaterThan(0);
        }
        expect(loungeSeat(seat)).toEqual(home);
      }
    });
  }
  it('keeps room destinations independent of seating', () => {
    for (const view of ['Side', 'Lounge', 'TV'] as const)
      for (let seat = 0; seat < 9; seat++)
        expect(cameraPresetFor(view, seat)).toEqual(cameraPresetFor(view, null));
  });
  it('has a stable room view while spectating or waiting for a seat', () => {
    for (const seat of [null, -1, 9, 0.5])
      expect(cameraPresetFor('Table', seat)).toEqual({ pos: [0, 6.5, 10.8], look: [0, 0.7, 0] });
  });
});
