import * as THREE from 'three';
import { ROOM } from '@cutplane/kernel';
import { CLASSIC, rgb } from './viewer/palette.ts';

/** The original's long-lens view: ~13.7° vertical FOV, eye at z = 4000. */
export const CAMERA_FOV = 13.7;
export const CAMERA_EYE_Z = 4000;

export function createCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, 100, 10000);
  camera.position.set(0, 0, CAMERA_EYE_Z);
  camera.lookAt(0, 0, 0);
  return camera;
}

/**
 * Rotates the room: the camera orbits the room centre, as the original's
 * room rotation does (yaw ±90°, pitch 0..90°, looking down from above).
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
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
}

export interface RoomScene {
  scene: THREE.Scene;
  /** The cutplane; always z = planeZ in room space. */
  plane: THREE.Group;
  setPlaneZ(z: number): void;
}

/** The room (black edges on the classic orange), lights, and the cutplane. */
export function createScene(): RoomScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(rgb(CLASSIC.background));

  const [x0, y0, z0] = ROOM.min;
  const [x1, y1, z1] = ROOM.max;
  const size = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
  const center = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

  const room = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
    new THREE.LineBasicMaterial({ color: rgb(CLASSIC.roomEdges) }),
  );
  room.position.copy(center);
  scene.add(room);

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(300, 800, 1000);
  scene.add(key);

  const plane = new THREE.Group();
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x, size.y),
    new THREE.MeshBasicMaterial({
      color: rgb(CLASSIC.cutplane),
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  fill.renderOrder = 1;
  const rim = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(size.x, size.y)),
    new THREE.LineBasicMaterial({ color: 0xffffff }),
  );
  plane.add(fill, rim);
  plane.position.set(center.x, center.y, 0);
  scene.add(plane);

  return { scene, plane, setPlaneZ: (z) => plane.position.setZ(z) };
}
