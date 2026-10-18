import * as THREE from 'three';
import { mat4, subtree, type CutObject } from '@cutplane/kernel';
import type { Runtime } from '@cutplane/behaviors';
import { CLASSIC } from '../viewer/palette.ts';
import { Lines, closedPolyline } from './lines.ts';

/** Where the camera's lens is and which way it looks (a unit vector), in the room. */
export interface Shot {
  eye: [number, number, number];
  dir: [number, number, number];
}

/**
 * Where the camera's lens is and which way it looks: along the camera's own +z,
 * from a little in front of its lens cap (set_camera's lens face centroid and normal).
 */
export function lensShot(rt: Runtime, camera: CutObject): Shot {
  const lens = camera.children[0];
  const lb = lens ? rt.bbox(lens) : null;
  const o = mat4.transformPoint(camera.xform, 0, 0, 0);
  const z = mat4.transformPoint(camera.xform, 0, 0, 1);
  const d = new THREE.Vector3(z[0] - o[0], z[1] - o[1], z[2] - o[2]).normalize();
  const eye = lb
    ? new THREE.Vector3(
        (lb[0][0] + lb[1][0]) / 2,
        (lb[0][1] + lb[1][1]) / 2,
        (lb[0][2] + lb[1][2]) / 2,
      )
    : new THREE.Vector3(o[0], o[1], o[2]);
  eye.addScaledVector(d, 40);
  return { eye: [eye.x, eye.y, eye.z], dir: [d.x, d.y, d.z] };
}

/** The screen's size in the room, and its picture's in pixels. */
const W = 240;
const H = 180;
const PX = [480, 360] as const;
/** How far above the camera the screen floats. */
const ABOVE = 30;
/** grafx.c's draw_on_slide clears to light blue. */
const LIGHT_BLUE = 0x87cefa;

/**
 * The camera goodie's view (nikon.cpl's set_camera and toggle_slide). The
 * original opened a second window, "Camera's View"; here the picture is a
 * small screen with a thin black border, a panel in the room like the save
 * and measure plates, floating above the camera, so nothing flat covers the
 * room and it can't get lost behind the browser. It shows what the camera's lens looks
 * at, live as the camera is carried and aimed.
 */
export class CameraSlide {
  readonly object = new THREE.Group();
  private readonly target = new THREE.WebGLRenderTarget(PX[0], PX[1]);
  private readonly lens = new THREE.PerspectiveCamera(50, PX[0] / PX[1], 1, 4000);
  private readonly frame = new Lines({ color: CLASSIC.black, width: 2, renderOrder: 60 });
  private readonly background = new THREE.Color(LIGHT_BLUE);

  /** `hidden`: what the camera mustn't see (the plane, the crosshair, the tools riding on the plane). */
  constructor(private readonly hidden: () => readonly THREE.Object3D[] = () => []) {
    const picture = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ map: this.target.texture, side: THREE.DoubleSide }),
    );
    const pts: number[] = [];
    closedPolyline([-W / 2, -H / 2, 0.5, W / 2, -H / 2, 0.5, W / 2, H / 2, 0.5, -W / 2, H / 2, 0.5], pts); // prettier-ignore
    this.frame.set(pts);
    this.object.add(picture, this.frame.object);
    this.object.visible = false;
  }

  /** Whether the screen is up. */
  get shown(): boolean {
    return this.object.visible;
  }

  /** Places the screen above `camera` (or hides it, with no camera); renders the camera's view onto it. */
  update(
    rt: Runtime,
    camera: CutObject | undefined,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
  ): void {
    if (!camera) {
      this.object.visible = false;
      return;
    }
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (const o of subtree(camera)) {
      const b = rt.bbox(o);
      if (!b) continue;
      lo = lo.map((v, k) => Math.min(v, b[0][k]!));
      hi = hi.map((v, k) => Math.max(v, b[1][k]!));
    }
    if (!Number.isFinite(lo[0])) return;
    const shot = lensShot(rt, camera);
    const eye = new THREE.Vector3(...shot.eye);
    this.lens.position.copy(eye);
    this.lens.up.set(0, 1, 0);
    this.lens.lookAt(eye.add(new THREE.Vector3(...shot.dir)));
    this.lens.updateMatrixWorld();

    this.object.position.set((lo[0]! + hi[0]!) / 2, hi[1]! + ABOVE + H / 2, (lo[2]! + hi[2]!) / 2);

    // Render the camera's view, without the screen itself or what rides on the plane.
    const hidden = this.hidden();
    const was = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;
    this.object.visible = false;
    const bg = scene.background;
    scene.background = this.background;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, this.lens);
    renderer.setRenderTarget(null);
    scene.background = bg;
    hidden.forEach((o, i) => (o.visible = was[i]!));
    this.object.visible = true;
  }
}
