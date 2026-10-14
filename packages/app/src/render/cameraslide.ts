import * as THREE from 'three';
import { mat4, subtree, type CutObject } from '@cutplane/kernel';
import type { Runtime } from '@cutplane/behaviors';
import { CLASSIC } from '../viewer/palette.ts';
import { Lines, closedPolyline } from './lines.ts';
import type { Shot } from '../camera/flyover.ts';

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

/** The slide's size in the room, and its picture's in pixels. */
const W = 240;
const H = 180;
const PX = [480, 360] as const;
/** grafx.c's draw_on_slide clears to light blue. */
const LIGHT_BLUE = 0x87cefa;

/**
 * The camera goodie's view (nikon.cpl's set_camera and toggle_slide). The
 * original opened a second window, "Camera's View"; here the picture stands
 * in the room above the camera, so nothing flat covers the room. It shows
 * what the camera's lens looks at, and follows the camera as it is dragged.
 * It stands in for the camera's window (camerawindow.ts) when the browser
 * won't open one.
 */
export class CameraSlide {
  readonly object = new THREE.Group();
  private readonly target = new THREE.WebGLRenderTarget(PX[0], PX[1]);
  private readonly lens = new THREE.PerspectiveCamera(50, PX[0] / PX[1], 1, 4000);
  private readonly picture: THREE.Mesh;
  private readonly frame = new Lines({ color: CLASSIC.black, width: 3, renderOrder: 60 });
  private readonly background = new THREE.Color(LIGHT_BLUE);

  constructor() {
    this.picture = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ map: this.target.texture, side: THREE.DoubleSide }),
    );
    this.object.add(this.picture, this.frame.object);
    this.object.visible = false;
  }

  /** Places the slide and its lens for `camera` (or hides it); renders the camera's view. */
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

    const cx = (lo[0]! + hi[0]!) / 2;
    const cy = hi[1]! + 30 + H / 2;
    const cz = (lo[2]! + hi[2]!) / 2;
    this.picture.position.set(cx, cy, cz);
    const pts: number[] = [];
    closedPolyline([cx - W / 2, cy - H / 2, cz, cx + W / 2, cy - H / 2, cz, cx + W / 2, cy + H / 2, cz, cx - W / 2, cy + H / 2, cz], pts); // prettier-ignore
    this.frame.set(pts);

    // Render the camera's view (without the slide itself in it).
    this.object.visible = false;
    const bg = scene.background;
    scene.background = this.background;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, this.lens);
    renderer.setRenderTarget(null);
    scene.background = bg;
    this.object.visible = true;
  }
}
