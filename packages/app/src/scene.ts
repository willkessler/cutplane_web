import * as THREE from 'three';
import { ROOM } from '@cutplane/kernel';

/** The original's long-lens view: ~13.7° vertical FOV, eye at z = 4000. */
export const CAMERA_FOV = 13.7;
export const CAMERA_EYE_Z = 4000;

export function createCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, 100, 10000);
  camera.position.set(0, 0, CAMERA_EYE_Z);
  camera.lookAt(0, 0, 0);
  return camera;
}

/** M0 placeholder scene: the room bounds and the cutplane at z = 0. */
export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1c1d22);

  const [x0, y0, z0] = ROOM.min;
  const [x1, y1, z1] = ROOM.max;
  const size = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
  const center = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

  const room = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
    new THREE.LineBasicMaterial({ color: 0x5a5e6b }),
  );
  room.position.copy(center);
  scene.add(room);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x, size.y),
    new THREE.MeshBasicMaterial({
      color: 0x7fa7d9,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  plane.position.set(center.x, center.y, 0);
  scene.add(plane);

  return scene;
}
