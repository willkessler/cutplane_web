import * as THREE from 'three';
import { P } from '@cutplane/cpl';
import {
  HEADPAD_CORNER,
  HEADPAD_SQUARE,
  HEADPAD_ZOFFSET,
  TOOLPAD_ZOFFSET,
  decalOf,
  decaledPads,
  isPad,
  type Runtime,
} from '@cutplane/behaviors';
import { WorldGeometry, mat4, subtree, type CutObject } from '@cutplane/kernel';
import { CLASSIC, shadeFace } from '../viewer/palette.ts';
import { Lines, closedPolyline, group } from './lines.ts';
import { triangulate } from './models.ts';

/** draw_headpad_technique's outline: a square with a tab down its left side. */
const S = HEADPAD_SQUARE;
const C = HEADPAD_CORNER;
const HEADPAD: [number, number][] = [
  [S - C, -S],
  [-S + C, -S],
  [-S, -S - C],
  [-S, -S - 4 * C],
  [-S - 4 * C, -S - 4 * C],
  [-S - 4 * C, S - C],
  [-S - C, S],
  [S - C, S],
  [S, S - C],
  [S, -S + C],
];

const WHITE = [255, 255, 255];
/** How far each decal piece sits in front of the one before it (room units). */
const PIECE_STEP = 0.4;
/** tools.h's Normalpadcorner. */
const PLATE_CORNER = 60 / 16;

/**
 * Pads, rails and headpads as grafx.c drew them (draw_pad_technique,
 * draw_toolpad): a flat polygon in the pad's colour (white while it is
 * selectable), a black outline just behind it, a dotted outline showing
 * through everything, and the pad's decal (its tool's picture) in front.
 */
export class PadView {
  readonly object = new THREE.Group();
  private readonly through = new Lines({
    color: CLASSIC.black,
    width: 1,
    dashed: true,
    dash: 2,
    depthTest: false,
    renderOrder: 20,
  });
  private readonly black = new Lines({ color: CLASSIC.black, width: 3, renderOrder: 21 });
  private readonly fill: THREE.Mesh;
  private readonly decals: THREE.Mesh;

  constructor() {
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.fill = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.decals = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.fill.frustumCulled = this.decals.frustumCulled = false;
    this.fill.renderOrder = 22;
    this.decals.renderOrder = 23;
    this.object.add(group(this.through, this.black), this.fill, this.decals);
  }

  update(rt: Runtime): void {
    const through: number[] = [];
    const black: number[] = [];
    const pos: number[] = [];
    const col: number[] = [];
    const dpos: number[] = [];
    const dcol: number[] = [];
    for (const o of subtree(rt.environment.root)) {
      if (!isPad(o) || !rt.vm.props.has(o, P.Visible)) continue;
      const poly = outline(rt, o);
      if (poly.length < 3) continue;
      const lit = rt.selectableOf(o).feature !== null && !rt.vm.props.has(o, P.Nonselectable);
      const c = (lit ? WHITE : o.color).map((v) => v / 255);
      const off = o.drawTechnique === 'draw_headpad_technique' ? HEADPAD_ZOFFSET : TOOLPAD_ZOFFSET;
      const at = (dz: number) => poly.flatMap(([x, y, z]) => [x, y, z + dz]);
      closedPolyline(at(-2 * off), through);
      closedPolyline(at(-off), black);
      // The fill: a fan is enough for these convex-ish outlines; triangulate to be safe.
      const flat = poly.map(([x, y]) => new THREE.Vector2(x, y));
      for (const t of THREE.ShapeUtils.triangulateShape(flat, []))
        for (const i of t) {
          const p = poly[i]!;
          pos.push(p[0], p[1], p[2]);
          col.push(...c);
        }
    }
    // Decals: on pads, and on anything else that has one (the toolboxes' fronts).
    for (const o of decaledPads(rt)) {
      if (!rt.vm.props.has(o, P.Visible)) continue;
      const decal = decalOf(rt, o)!;
      decal.forEach((piece, i) => {
        // Each piece a hair in front of the one before, so pieces that share a face
        // (the grabber's two blocks) don't fight over it.
        const m = mat4.multiply(mat4.multiply(piece.matrix, mat4.translation(0, 0, i * PIECE_STEP)), o.xform); // prettier-ignore
        const b = piece.brep;
        const g = new WorldGeometry(b, m);
        triangulate(b, g, () => true, (f) => shadeFace(g.faceNormal(f), b.faceColors.get(f) ?? piece.color), dpos, dcol); // prettier-ignore
      });
    }
    this.through.set(through);
    this.black.set(black);
    setGeometry(this.fill, pos, col);
    setGeometry(this.decals, dpos, dcol);
  }
}

function setGeometry(mesh: THREE.Mesh, pos: number[], col: number[]): void {
  mesh.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  mesh.geometry = g;
}

/** A pad's outline in the room: the headpad's fixed shape at its first vertex, else its front face. */
function outline(rt: Runtime, o: CutObject): [number, number, number][] {
  const g = rt.world(o);
  const b = o.brep;
  if (o.drawTechnique === 'draw_headpad_technique') {
    const v = b.vertices()[0];
    if (v === undefined) return [];
    const [x, y, z] = [g.x(v), g.y(v), g.z(v)];
    return HEADPAD.map(([dx, dy]) => [x + dx, y + dy, z + HEADPAD_ZOFFSET]);
  }
  if (o.drawTechnique === 'draw_plate_technique') {
    // A rounded rectangle from the first vertex to the second (Normalpadcorner corners).
    const [v0, v1] = b.vertices();
    if (v0 === undefined || v1 === undefined) return [];
    const [x, y, z] = [g.x(v0), g.y(v0), g.z(v0)];
    const w = g.x(v1) - x;
    const h = g.y(v1) - y;
    const k = PLATE_CORNER;
    const corners: [number, number][] = [[k, 0], [w - k, 0], [w, k], [w, h - k], [w - k, h], [k, h], [0, h - k], [0, k]]; // prettier-ignore
    return corners.map(([dx, dy]) => [x + dx, y + dy, z]);
  }
  const f = b.faces()[0];
  if (f === undefined) return [];
  return b
    .loopHalfEdges(b.faceLoop(f))
    .map((h) => b.heVertex(h))
    .map((v) => [g.x(v), g.y(v), g.z(v)]);
}
