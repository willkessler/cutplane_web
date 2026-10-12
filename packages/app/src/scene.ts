import * as THREE from 'three';
import { ROOM } from '@cutplane/kernel';

/** The original's long-lens view: ~13.7° vertical FOV, eye at z = 4000. */
export const CAMERA_FOV = 13.7;
export const CAMERA_EYE_Z = 4000;

/**
 * grafx.c's init_projmatrix frames the room's front opening exactly at the
 * near plane (eye − room radius). Keep that framing on any window shape:
 * widen the vertical FOV when the window is too narrow for the room.
 */
const HALF_W = (ROOM.max[0] - ROOM.min[0] + 1) / 2;
const HALF_H = (ROOM.max[1] - ROOM.min[1] + 1) / 2;
/** Distance at which the room's cross-section exactly fills the default view. */
const FRAME_DIST = HALF_H / Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);

export function fitFov(aspect: number): number {
  if (aspect >= HALF_W / HALF_H) return CAMERA_FOV;
  return (2 * Math.atan(HALF_W / aspect / FRAME_DIST) * 180) / Math.PI;
}

export function createCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fitFov(aspect), aspect, 100, 10000);
  camera.position.set(0, 0, CAMERA_EYE_Z);
  camera.lookAt(0, 0, 0);
  return camera;
}

/**
 * Rotates the room: the camera orbits the room centre, equivalent to the
 * original rotating the room under a fixed eye (yaw ±90°, pitch 0..90°,
 * looking down from above).
 */
export function orbitCamera(
  camera: THREE.PerspectiveCamera,
  yawDeg: number,
  pitchDeg: number,
): void {
  const yaw = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(yawDeg, -90, 90));
  const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pitchDeg, 0, 90));
  camera.position.set(
    CAMERA_EYE_Z * Math.sin(yaw) * Math.cos(pitch),
    CAMERA_EYE_Z * Math.sin(pitch),
    CAMERA_EYE_Z * Math.cos(yaw) * Math.cos(pitch),
  );
  // Straight down, "up" would be degenerate; keep the room's back wall at the top.
  camera.up.set(0, pitch > 1.5 ? 0 : 1, pitch > 1.5 ? -1 : 0);
  camera.lookAt(0, 0, 0);
}

/** Room units per CSS pixel at depth z, looking straight on: converts pointer motion to crosshair motion. */
export function unitsPerPixel(
  camera: THREE.PerspectiveCamera,
  cssHeight: number,
  z: number,
): number {
  const dist = CAMERA_EYE_Z - z;
  return (2 * dist * Math.tan(((camera.fov / 2) * Math.PI) / 180)) / Math.max(1, cssHeight);
}
