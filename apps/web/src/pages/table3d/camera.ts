import { loungeSeat } from '@4am/shared';

export const CAMERA_VIEWS = ['Table', 'Overhead', 'Side', 'Close', 'Lounge', 'TV'] as const;
export type CameraView = (typeof CAMERA_VIEWS)[number];
type Point3 = [number, number, number];
type CameraPreset = { pos: Point3; look: Point3 };

export function isSeatCamera(view: CameraView) {
  return view === 'Table' || view === 'Close' || view === 'Overhead';
}

/** Turn the camera towards the viewer's physical seat; never rotate the shared room. */
export function cameraPresetFor(view: CameraView, seat: number | null): CameraPreset {
  const presets: Record<CameraView, CameraPreset> = {
    Table: { pos: [0, 6.5, 10.8], look: [0, 0.7, 0] },
    Overhead: { pos: [0, 15, 0.01], look: [0, 1, 0] },
    Side: { pos: [12, 5, 3], look: [0, 1, 0] },
    Close: { pos: [0, 3.6, 7.4], look: [0, 1, 0] },
    Lounge: { pos: [11, 10, 17], look: [0, 1, 0] },
    TV: { pos: [0, 3.4, -2.5], look: [0, 2.9, -8.3] },
  };
  const preset = presets[view];
  if (!isSeatCamera(view) || seat === null || !Number.isInteger(seat) || seat < 0 || seat > 8)
    return preset;
  const point = loungeSeat(seat);
  const length = Math.hypot(point.x, point.z);
  // The long sides of the ellipse put the viewer farther from the felt centre.
  // Preserve the clearance behind their chair when looking across the table.
  const radius = preset.pos[2] + (view === 'Overhead' ? 0 : length - loungeSeat(0).z);
  return {
    pos: [(point.x / length) * radius, preset.pos[1], (point.z / length) * radius],
    look: preset.look,
  };
}
