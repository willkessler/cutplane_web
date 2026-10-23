import { describe, expect, it } from 'vitest';
import { ROOM } from '@cutplane/kernel';
import {
  CAMERA_EYE_Z,
  CAMERA_FOV,
  createCamera,
  deeperOnScreen,
  fitFov,
  orbitCamera,
} from './scene.ts';
import { shadeFace } from './viewer/palette.ts';

describe('camera', () => {
  it('uses the original long-lens view', () => {
    const camera = createCamera(16 / 10);
    expect(camera.fov).toBe(CAMERA_FOV);
    expect(camera.position.z).toBe(CAMERA_EYE_Z);
  });

  it('frames the full room height at the cutplane', () => {
    const halfHeight = CAMERA_EYE_Z * Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);
    expect(halfHeight * 2).toBeGreaterThan(ROOM.max[1] - ROOM.min[1]);
  });

  it('widens the view on narrow windows so the room still fits across', () => {
    expect(fitFov(16 / 9)).toBe(CAMERA_FOV);
    expect(fitFov(0.75)).toBeGreaterThan(CAMERA_FOV);
  });
});

describe('orbitCamera', () => {
  /** The camera's right axis in room space. */
  const right = (yaw: number, pitch: number) => {
    const c = createCamera(16 / 10);
    orbitCamera(c, yaw, pitch);
    c.updateMatrixWorld();
    const e = c.matrixWorld.elements;
    return [e[0]!, e[1]!, e[2]!];
  };

  it('keeps the turn when the room is tipped straight down', () => {
    for (const yaw of [-60, -20, 30, 90]) {
      const a = right(yaw, 89);
      const b = right(yaw, 90);
      expect(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!).toBeGreaterThan(0.999);
      const t = (yaw * Math.PI) / 180;
      expect(b[0]).toBeCloseTo(Math.cos(t));
      expect(b[2]).toBeCloseTo(-Math.sin(t));
    }
  });
});

describe('deeperOnScreen', () => {
  const at = (yaw: number, pitch: number) => {
    const c = createCamera(16 / 10);
    orbitCamera(c, yaw, pitch);
    return deeperOnScreen(c);
  };

  it('has no screen direction looking straight into the room', () => {
    const [x, y] = at(0, 0);
    expect(Math.hypot(x, y)).toBeLessThan(1e-9);
  });

  it('points up the screen seen from above, and sideways with the room turned', () => {
    expect(at(0, 90)[1]).toBeCloseTo(1);
    expect(at(0, 30)[1]).toBeCloseTo(0.5);
    expect(Math.abs(at(90, 0)[0])).toBeCloseTo(1);
    expect(at(90, 0)[0]).toBeCloseTo(-at(-90, 0)[0]);
  });
});

describe('shadeFace (shade.c)', () => {
  it('gives downward faces ambient light only', () => {
    expect(shadeFace([0, -1, 0], [255, 255, 255])[0]).toBeCloseTo(80 / 255);
  });

  it('lights a face toward <1,1,1> fully', () => {
    const k = 1 / Math.sqrt(3);
    const [r] = shadeFace([k, k, k], [255, 0, 0]);
    expect(r).toBeCloseTo(Math.min(1, (80 + 125 + 50 * (1 / 3)) / 255));
  });

  it("shows a photo's colour as it is on a level face, and most of it on any (new)", () => {
    const c: [number, number, number] = [96, 72, 60];
    expect(shadeFace([0, 1, 0], c, undefined, undefined, true).map((x) => x * 255)).toEqual([96, 72, 60].map((x) => expect.closeTo(x, 6))); // prettier-ignore
    expect(shadeFace([0, -1, 0], c, undefined, undefined, true)[0]! * 255).toBeCloseTo(96 * 0.6);
    expect(shadeFace([0, 1, 0], c)[0]! * 255).toBeLessThan(96 * 0.75); // the room's own light, as before
  });
});
