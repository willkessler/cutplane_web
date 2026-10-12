import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { rgb } from '../viewer/palette.ts';

/**
 * Wide lines. WebGL ignores lineWidth, and the original leans on 1–6 px
 * lines layered over each other (a black outline under a coloured core,
 * a background-coloured halo under room edges), so everything line-like
 * goes through LineSegments2.
 */
export interface LineStyle {
  color: readonly number[];
  /** Pixels (CSS). */
  width: number;
  dashed?: boolean;
  /** Dash and gap length in room units. */
  dash?: number;
  depthTest?: boolean;
  /** Lines in front of the plane write depth, or its stipple (drawn later) covers them. */
  depthWrite?: boolean;
  renderOrder?: number;
}

const materials = new Set<LineMaterial>();
const resolution = new THREE.Vector2(1, 1);

/** Every line material needs the drawing-buffer size to turn pixel widths into clip space. */
export function setLineResolution(width: number, height: number): void {
  resolution.set(width, height);
  for (const m of materials) m.resolution.copy(resolution);
}

export function lineMaterial(style: LineStyle): LineMaterial {
  const m = new LineMaterial({
    color: rgb(style.color),
    linewidth: style.width,
    dashed: style.dashed ?? false,
    dashSize: style.dash ?? 6,
    gapSize: style.dash ?? 6,
    depthTest: style.depthTest ?? true,
    depthWrite: style.depthWrite ?? false,
  });
  // Lines made after the last resize (a pencil stroke, say) need the size too.
  m.resolution.copy(resolution);
  materials.add(m);
  return m;
}

/** A set of independent segments (x y z pairs) drawn in one style. */
export class Lines {
  readonly object: LineSegments2;
  readonly material: LineMaterial;

  constructor(style: LineStyle, positions: ArrayLike<number> = []) {
    this.material = lineMaterial(style);
    this.object = new LineSegments2(new LineSegmentsGeometry(), this.material);
    this.object.renderOrder = style.renderOrder ?? 0;
    this.object.frustumCulled = false;
    this.set(positions);
  }

  /** Replaces the segments: six numbers (two points) per segment. */
  set(positions: ArrayLike<number>): void {
    if (positions.length === 0) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    // A fresh geometry every time: three.js caches an instanced geometry's instance count
    // the first time it draws it, so refilling one that grew would silently drop segments.
    this.object.geometry.dispose();
    const g = new LineSegmentsGeometry();
    g.setPositions(positions as number[] | Float32Array);
    this.object.geometry = g;
    if (this.material.dashed) this.object.computeLineDistances();
  }
}

/** Turns a closed polygon (x y z points) into segment pairs. */
export function closedPolyline(pts: ArrayLike<number>, out: number[] = []): number[] {
  const n = pts.length / 3;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push(
      pts[3 * i]!,
      pts[3 * i + 1]!,
      pts[3 * i + 2]!,
      pts[3 * j]!,
      pts[3 * j + 1]!,
      pts[3 * j + 2]!,
    );
  }
  return out;
}

export function circle(
  cx: number,
  cy: number,
  z: number,
  r: number,
  n = 32,
  out: number[] = [],
): number[] {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    pts.push(cx + r * Math.cos(t), cy + r * Math.sin(t), z);
  }
  return closedPolyline(pts, out);
}

export function group(...lines: Lines[]): THREE.Group {
  const g = new THREE.Group();
  for (const l of lines) g.add(l.object);
  return g;
}
