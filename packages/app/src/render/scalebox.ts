import * as THREE from 'three';
import { CORNER_SHOW, HANDLE_SIZE, type Handle, type ScaleBoxes } from '../edit/scalebox.ts';
import { CLASSIC } from '../viewer/palette.ts';
import { Lines, closedPolyline, group } from './lines.ts';

/** Handles are drawn this far toward the viewer of the plane (draw_scalebbox_technique). */
const LIFT = 5;
const GREY = [150, 150, 150];
const DARK = [50, 50, 50];

function square(out: number[], x: number, y: number, z: number, r: number): void {
  closedPolyline([x - r, y - r, z, x + r, y - r, z, x + r, y + r, z, x - r, y + r, z], out);
}

/** A filled square, as two triangles, for a handle being dragged. */
function fill(out: number[], x: number, y: number, z: number, r: number): void {
  out.push(
    x - r,
    y - r,
    z,
    x + r,
    y - r,
    z,
    x + r,
    y + r,
    z,
    x - r,
    y - r,
    z,
    x + r,
    y + r,
    z,
    x - r,
    y + r,
    z,
  );
}

const same = (a: Handle | undefined, b: Handle) =>
  !!a &&
  a.box === b.box &&
  a.kind === b.kind &&
  a.corner === b.corner &&
  (a.kind !== 'edge' || (b.kind === 'edge' && a.axis === b.axis));

/**
 * Scale-box handles: pick squares with a black drop shadow and a dotted copy
 * showing through, grey where box edges pierce the plane, white at corners
 * the plane is near, yellow under the crosshair, filled while dragged; the
 * box itself in dark grey while a handle is in use.
 */
export class ScaleBoxView {
  readonly object: THREE.Group;
  private readonly lines = {
    grey: new Lines({ color: GREY, width: 2, renderOrder: 44 }),
    white: new Lines({ color: CLASSIC.white, width: 2, renderOrder: 44 }),
    yellow: new Lines({ color: CLASSIC.yellow, width: 2, renderOrder: 45 }),
    shadow: new Lines({ color: CLASSIC.black, width: 2, renderOrder: 43 }),
    through: new Lines({
      color: [100, 100, 100],
      width: 1,
      dashed: true,
      dash: 3,
      depthTest: false,
      renderOrder: 42,
    }),
    box: new Lines({ color: DARK, width: 2, renderOrder: 41 }),
  };
  private readonly filled = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, depthTest: false }),
  );

  constructor() {
    this.object = group(...Object.values(this.lines));
    this.filled.renderOrder = 46;
    this.filled.frustumCulled = false;
    this.object.add(this.filled);
  }

  update(boxes: ScaleBoxes, z: number): void {
    const out = { grey: [] as number[], white: [] as number[], yellow: [] as number[], shadow: [] as number[], through: [] as number[], box: [] as number[] }; // prettier-ignore
    const solid: number[] = [];
    const hot = boxes.dragged ?? boxes.hover;
    const handle = (h: Handle, x: number, y: number, colour: 'grey' | 'white') => {
      const zz = z + LIFT;
      const lit = same(hot, h);
      if (lit && boxes.dragged) fill(solid, x, y, zz, HANDLE_SIZE);
      square(out[lit ? 'yellow' : colour], x, y, zz, HANDLE_SIZE);
      square(out.shadow, x + 2, y - 2, zz, HANDLE_SIZE);
      square(out.through, x, y, zz, HANDLE_SIZE);
    };
    for (const b of boxes.boxes) {
      const c = boxes.corners(b);
      c.forEach((p, i) => {
        const h: Handle = { kind: 'corner', box: b, corner: i };
        if (Math.abs(p[2] - z) <= CORNER_SHOW || same(hot, h)) handle(h, p[0], p[1], 'white');
      });
      for (const h of boxes.piercings(b, z)) handle(h, h.at[0], h.at[1], 'grey');
      if (hot?.box === b) {
        // The box, and where it crosses the plane.
        for (let i = 0; i < 8; i++)
          for (let k = 0; k < 3; k++)
            if (!(i & (1 << k))) out.box.push(...c[i]!, ...c[i | (1 << k)]!);
        const ring = boxes.piercings(b, z).map((h) => h.at);
        const cx = ring.reduce((s, p) => s + p[0], 0) / (ring.length || 1);
        const cy = ring.reduce((s, p) => s + p[1], 0) / (ring.length || 1);
        ring.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
        if (ring.length > 2) closedPolyline(ring.flat(), out.box);
      }
    }
    for (const [k, l] of Object.entries(this.lines)) l.set(out[k as keyof typeof out]);
    this.filled.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(solid, 3));
    this.filled.geometry = g;
    this.filled.visible = solid.length > 0;
  }
}
