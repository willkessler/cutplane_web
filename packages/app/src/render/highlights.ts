import * as THREE from 'three';
import { NONE, ROOM, type Brep, type CutObject } from '@cutplane/kernel';
import type { Editor } from '../edit/editor.ts';
import { CLASSIC, rgb } from '../viewer/palette.ts';
import { Lines, closedPolyline, group, type LineStyle } from './lines.ts';
import type { Model } from './models.ts';

/** grafx.c's draw_selectable_highlights / draw_picked_highlights sizes, in room units. */
const HOVER_VERTEX = 8;
const PICKED_VERTEX = 12;
const PICK_BOX = 10;

/**
 * A highlight colour drawn twice, like the section: solid where it can be
 * seen, and a dotted copy through everything, so a picked feature behind an
 * object is never lost (the original dotted back-facing highlights).
 */
class Pen {
  readonly object: THREE.Group;
  private readonly seen: Lines;
  private readonly through: Lines;
  readonly pts: number[] = [];

  constructor(style: LineStyle) {
    this.seen = new Lines(style);
    this.through = new Lines({
      ...style,
      width: Math.max(1, style.width - 1),
      dashed: true,
      dash: 4,
      depthTest: false,
      renderOrder: (style.renderOrder ?? 30) - 1,
    });
    this.object = group(this.through, this.seen);
  }

  flush(): void {
    this.seen.set(this.pts);
    this.through.set(this.pts);
    this.pts.length = 0;
  }
}

function square(out: number[], x: number, y: number, z: number, r: number): void {
  closedPolyline([x - r, y - r, z, x + r, y - r, z, x + r, y + r, z, x - r, y + r, z], out);
}

/**
 * Hover, picks and the marquee, drawn in the room as the original drew them:
 * the hover in white with a hollow yellow pick box at the picked point, picks
 * in red, the marquee as a box with its shadow on the floor.
 */
export class Highlights {
  readonly object = new THREE.Group();
  private readonly hover = new Pen({ color: CLASSIC.white, width: 4, renderOrder: 31 });
  private readonly picked = new Pen({ color: CLASSIC.red, width: 3, renderOrder: 33 });
  private readonly contour = new Pen({ color: CLASSIC.pickedContour, width: 3, renderOrder: 33 });
  private readonly boxShadow = new Lines({ color: CLASSIC.black, width: 2, renderOrder: 34 });
  private readonly box = new Lines({ color: CLASSIC.yellow, width: 2, renderOrder: 35 });
  private readonly boxThrough = new Lines({
    color: [165, 165, 0],
    width: 2,
    dashed: true,
    dash: 2,
    depthTest: false,
    renderOrder: 34,
  });
  private readonly marquee = new Lines({ color: CLASSIC.black, width: 3, renderOrder: 36 });
  private readonly marqueeThrough = new Lines({
    color: CLASSIC.white,
    width: 2,
    dashed: true,
    dash: 6,
    depthTest: false,
    renderOrder: 37,
  });
  private readonly marqueeShadow = new Lines({ color: CLASSIC.shadow, width: 2, renderOrder: 5 });
  private readonly dot = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * HOVER_VERTEX, 2 * HOVER_VERTEX),
    new THREE.MeshBasicMaterial({ color: rgb(CLASSIC.white), side: THREE.DoubleSide }),
  );

  constructor() {
    this.dot.renderOrder = 32;
    this.object.add(
      this.hover.object,
      this.picked.object,
      this.contour.object,
      group(
        this.boxThrough,
        this.boxShadow,
        this.box,
        this.marquee,
        this.marqueeThrough,
        this.marqueeShadow,
      ),
      this.dot,
    );
  }

  /** `outlined`: other things under the crosshair (a goodie's part) to outline as hovered. */
  update(
    editor: Editor,
    models: readonly Model[],
    eye: THREE.Vector3,
    outlined: readonly Model[] = [],
  ): void {
    const modelOf = new Map(models.map((m) => [m.object, m]));
    this.dot.visible = false;
    for (const m of outlined) silhouette(m, eye, this.hover.pts);

    // Hover: white.
    const h = editor.hover;
    const box: number[] = [];
    const shadow: number[] = [];
    if (h) {
      const { model, pick } = h;
      if (pick.kind === 'vertex') {
        this.dot.visible = true;
        this.dot.position.set(...pick.at);
      } else if (pick.kind === 'object' || model.object.attrs.props.includes('Lockedgeometry'))
        silhouette(model, eye, this.hover.pts);
      else
        outline(model, pick.kind === 'inPlaneFace' ? 'face' : pick.kind, pick.id, this.hover.pts);
      if (pick.kind !== 'inPlaneFace' && pick.kind !== 'object') {
        const [x, y, z] = pick.at;
        square(box, x, y, z, PICK_BOX);
        square(shadow, x + 2, y - 2, z, PICK_BOX);
      }
    }
    this.hover.flush();
    this.box.set(box);
    this.boxThrough.set(box);
    this.boxShadow.set(shadow);

    // Picks: red, objects by their contour.
    for (const f of editor.picked) {
      if (f.kind === 'object') {
        for (const o of subtree(f.object)) {
          const m = modelOf.get(o);
          if (m) silhouette(m, eye, this.contour.pts);
        }
      } else if (f.kind === 'vertex') {
        const g = f.model.world;
        square(this.picked.pts, g.x(f.id), g.y(f.id), g.z(f.id), PICKED_VERTEX);
      } else outline(f.model, f.kind, f.id, this.picked.pts);
    }
    this.picked.flush();
    this.contour.flush();

    // Marquee: a box between the press point and the crosshair, and its shadow on the floor.
    const mq = editor.marquee;
    const mpts: number[] = [];
    const mshadow: number[] = [];
    if (mq) {
      const lo = mq.from.map((c, i) => Math.min(c, mq.to[i]!));
      const hi = mq.from.map((c, i) => Math.max(c, mq.to[i]!));
      boxEdges(lo, hi, mpts);
      const y = ROOM.min[1] + 1;
      closedPolyline(
        [lo[0]!, y, lo[2]!, hi[0]!, y, lo[2]!, hi[0]!, y, hi[2]!, lo[0]!, y, hi[2]!],
        mshadow,
      );
    }
    this.marquee.set(mpts);
    this.marqueeThrough.set(mpts);
    this.marqueeShadow.set(mshadow);
  }
}

function* subtree(o: CutObject): IterableIterator<CutObject> {
  yield o;
  for (const c of o.children) yield* subtree(c);
}

function pushEdge(m: Model, e: number, out: number[]): void {
  const g = m.world;
  const [p, q] = m.object.brep.edgeVertices(e);
  out.push(g.x(p), g.y(p), g.z(p), g.x(q), g.y(q), g.z(q));
}

/** Edges of a set of faces that border a face outside it. */
function boundary(b: Brep, faces: readonly number[]): number[] {
  const set = new Set(faces);
  const out = new Set<number>();
  for (const f of faces)
    for (const l of b.faceLoops(f))
      for (const h of b.loopHalfEdges(l)) {
        const e = b.heEdge(h);
        const m = b.heMate(h);
        if (e !== NONE && (m === NONE || !set.has(b.heFace(m)))) out.add(e);
      }
  return [...out];
}

/** An edge, or a face's outline; a face or edge inside a surface shows the whole surface. */
function outline(m: Model, kind: 'edge' | 'face', id: number, out: number[]): void {
  const b = m.object.brep;
  let faces: number[];
  if (kind === 'edge') {
    const s = b.faceSurface.get(b.heFace(b.edgeHe1(id)));
    const h2 = b.edgeHe2(id);
    if (s === undefined || h2 === NONE || b.faceSurface.get(b.heFace(h2)) !== s) {
      pushEdge(m, id, out);
      return;
    }
    faces = b.surfaceFaces(b.heFace(h2));
  } else faces = b.surfaceFaces(id);
  for (const e of boundary(b, faces)) pushEdge(m, e, out);
}

/** grafx.c's contour: edges between a face turned toward the eye and one turned away. */
function silhouette(m: Model, eye: THREE.Vector3, out: number[]): void {
  const b = m.object.brep;
  const g = m.world;
  const facing = new Map<number, boolean>();
  const faces = (f: number) => {
    let v = facing.get(f);
    if (v === undefined) {
      const [nx, ny, nz] = g.faceNormal(f);
      const p = b.heVertex(b.loopHe(b.faceLoop(f)));
      v = nx * (eye.x - g.x(p)) + ny * (eye.y - g.y(p)) + nz * (eye.z - g.z(p)) > 0;
      facing.set(f, v);
    }
    return v;
  };
  for (const e of b.edges()) {
    const h2 = b.edgeHe2(e);
    if (h2 === NONE || faces(b.heFace(b.edgeHe1(e))) !== faces(b.heFace(h2))) pushEdge(m, e, out);
  }
}

function boxEdges(lo: readonly number[], hi: readonly number[], out: number[]): void {
  const c = (i: number) => [0, 1, 2].map((k) => (i & (1 << k) ? hi[k]! : lo[k]!));
  for (let i = 0; i < 8; i++)
    for (let k = 0; k < 3; k++)
      if (!(i & (1 << k)) && lo[k] !== hi[k]) out.push(...c(i), ...c(i | (1 << k)));
}
