import { describe, expect, it } from 'vitest';
import { ROOM } from '@cutplane/kernel';
import { CAMERA_EYE_Z, CAMERA_FOV, createCamera } from './scene.ts';

describe('camera', () => {
  it('uses the original long-lens view', () => {
    const camera = createCamera(4 / 3);
    expect(camera.fov).toBe(CAMERA_FOV);
    expect(camera.position.z).toBe(CAMERA_EYE_Z);
  });

  it('frames the full room height at the cutplane', () => {
    const halfHeight = CAMERA_EYE_Z * Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);
    expect(halfHeight * 2).toBeGreaterThan(ROOM.max[1] - ROOM.min[1]);
  });
});
