import * as THREE from 'three';
import { FINE, NONE, ROOM, mat4, type Brep, type CutObject, type Mat4 } from '@cutplane/kernel';
import { CLASSIC, rgb } from '../viewer/palette.ts';
import { Lines, closedPolyline, group, type LineStyle } from './lines.ts';
import type { Model } from './models.ts';

/** grafx.c's draw_selectable_highlights / draw_picked_highlights sizes, in room units. */
const HOVER_VERTEX = 8;
const PICKED_VERTEX = 12;
const PICK_BOX = 10;
/** The magnet's ghost: its edges light grey, as the 1 key's wire, its faces faint (15% opaque). */
const GHOST = [200, 200, 200] as const;
const GHOST_OPACITY = 0.15;
/** How bright an edge turned away from the eye is drawn, against one facing it. */
const BACK_DIM = 0.45;
/** The stencil value where a fine mesh outlined is on the screen. */
const MASKED = 1;

/**
 * A fine mesh (a terrain, a scan) is outlined round its outside only (new): its
 * contour runs round every bump on it, each small facet turned away from the
 * eye, and drawn as a box's is, would cover it in white. Its contour is drawn
 * twice as wide, where the mesh isn't on the screen: only its outer half, at
 * the mesh's own outline, shows.
 */
const isFine = (m: Model) => m.object.brep.numVertices > FINE;
const dim = (c: readonly number[]) => c.map((k) => Math.round(k * BACK_DIM)) as [number, number, number]; // prettier-ignore

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

  /** `outside`: drawn only off the fine meshes masked (see `Highlights.masks`). */
  constructor(style: LineStyle, outside = false) {
    this.seen = new Lines(style);
    this.through = new Lines({
      ...style,
      width: Math.max(1, style.width - 1),
      dashed: true,
      dash: 4,
      depthTest: false,
      renderOrder: (style.renderOrder ?? 30) - 1,
    });
    if (outside)
      for (const m of [this.seen.material, this.through.material]) {
        // (three tests the stencil only for a material that writes it; this one keeps it as it is.)
        m.stencilWrite = true;
        m.stencilFunc = THREE.NotEqualStencilFunc;
        m.stencilRef = MASKED;
      }
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

type V3 = [number, number, number];

/** A picked feature, with the model it belongs to (whole objects by themselves). */
export type Picked =
  | { kind: 'vertex' | 'edge' | 'face'; model: Model; id: number }
  | { kind: 'object'; object: CutObject };

/** What to highlight: the crosshair's selectable, the picks, the marquee. */
export interface HighlightState {
  hover:
    | {
        model: Model;
        pick: { kind: 'vertex' | 'edge' | 'face' | 'inPlaneFace' | 'object'; id: number; at: V3 };
      }
    | undefined;
  picked: readonly Picked[];
  marquee: { from: V3; to: V3 } | undefined;
  /** A magnet drag's ghost: what it drags, moved by `move` (world, row vectors) to where it would snap. */
  ghost?: { models: readonly Model[]; move: Mat4 } | undefined;
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
  // New here: the magnet's ghost where its release would put it: drawn as it is, but faint
  // seen through, every edge in light grey.
  private readonly ghost = new Pen({ color: GHOST, width: 2, renderOrder: 29 });
  private readonly ghostFaces = new THREE.Group();
  private readonly ghostMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: GHOST_OPACITY,
    depthWrite: false,
  });
  // New here: an edge on the far side of its object (its faces all turned away) is
  // drawn dimmer, so it isn't taken for one on the near side.
  private readonly hoverBack = new Pen({ color: dim(CLASSIC.white), width: 3, renderOrder: 30 });
  private readonly pickedBack = new Pen({ color: dim(CLASSIC.red), width: 3, renderOrder: 32 });
  private readonly contour = new Pen({ color: CLASSIC.pickedContour, width: 3, renderOrder: 33 });
  private readonly hoverOutside = new Pen({ color: CLASSIC.white, width: 8, renderOrder: 31 }, true); // prettier-ignore
  private readonly contourOutside = new Pen({ color: CLASSIC.pickedContour, width: 6, renderOrder: 33 }, true); // prettier-ignore
  /** Where the fine meshes outlined are on the screen, marked in the stencil before the outlines. */
  private readonly masks = new THREE.Group();
  private readonly maskMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: MASKED,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  });

  /** Masks `m`'s mesh (once), and returns the pen's points its outline goes in. */
  private outside(m: Model, pen: Pen): number[] {
    const mesh = m.mesh;
    if (mesh && !this.masks.children.some((c) => (c as THREE.Mesh).geometry === mesh.geometry)) {
      const mask = new THREE.Mesh(mesh.geometry, this.maskMaterial);
      mask.frustumCulled = false;
      mask.renderOrder = 27;
      mask.matrixAutoUpdate = false;
      if (mesh.matrixAutoUpdate) mesh.updateMatrix();
      mask.matrix.copy(mesh.matrix);
      this.masks.add(mask);
    }
    return pen.pts;
  }
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
  // New here: a tool in hand (the saw, the globe) shows through what it's in or
  // behind as a dotted contour, as the crosshair does, so it's never lost.
  private readonly heldThrough = new Lines({
    color: CLASSIC.white,
    width: 2,
    dashed: true,
    dash: 4,
    depthTest: true,
    renderOrder: 38,
  });
  private readonly dot = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * HOVER_VERTEX, 2 * HOVER_VERTEX),
    new THREE.MeshBasicMaterial({ color: rgb(CLASSIC.white), side: THREE.DoubleSide }),
  );

  constructor() {
    this.dot.renderOrder = 32;
    // Only where something hides it: where the tool shows, its own look does.
    this.heldThrough.material.depthFunc = THREE.GreaterDepth;
    this.object.add(
      this.ghostFaces,
      this.ghost.object,
      this.hover.object,
      this.picked.object,
      this.hoverBack.object,
      this.pickedBack.object,
      this.contour.object,
      this.masks,
      this.hoverOutside.object,
      this.contourOutside.object,
      group(
        this.boxThrough,
        this.boxShadow,
        this.box,
        this.marquee,
        this.marqueeThrough,
        this.marqueeShadow,
        this.heldThrough,
      ),
      this.dot,
    );
  }

  /**
   * `outlined`: other things under the crosshair (a goodie's part) to outline as
   * hovered; `held`: the tool in hand.
   */
  update(
    editor: HighlightState,
    models: readonly Model[],
    eye: THREE.Vector3,
    outlined: readonly Model[] = [],
    held: readonly Model[] = [],
  ): void {
    const through: number[] = [];
    for (const m of held) silhouette(m, eye, through);
    this.heldThrough.set(through);

    this.masks.clear();
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
        silhouette(model, eye, isFine(model) ? this.outside(model, this.hoverOutside) : this.hover.pts); // prettier-ignore
      else {
        const kind = pick.kind === 'inPlaneFace' ? 'face' : pick.kind;
        outline(model, kind, pick.id, eye, this.hover.pts, this.hoverBack.pts);
      }
      if (pick.kind !== 'inPlaneFace' && pick.kind !== 'object') {
        const [x, y, z] = pick.at;
        square(box, x, y, z, PICK_BOX);
        square(shadow, x + 2, y - 2, z, PICK_BOX);
      }
    }
    this.hover.flush();
    this.hoverBack.flush();
    this.hoverOutside.flush();

    // The magnet's ghost: each model's mesh (its triangles shared), moved.
    const ghost = editor.ghost;
    this.ghostFaces.clear();
    if (ghost) {
      const move = new THREE.Matrix4().fromArray(ghost.move);
      for (const m of ghost.models) {
        if (!m.mesh) continue;
        const face = new THREE.Mesh(m.mesh.geometry, this.ghostMaterial);
        face.frustumCulled = false;
        face.renderOrder = 28;
        face.matrixAutoUpdate = false;
        // (A mesh is built in world space, then shifted as its object moves.)
        face.matrix.makeTranslation(m.mesh.position).premultiply(move);
        this.ghostFaces.add(face);
      }
    }
    if (ghost)
      for (const m of ghost.models) {
        const at = this.ghost.pts.length;
        for (const e of m.object.brep.edges()) pushEdge(m, e, this.ghost.pts);
        const p: [number, number, number] = [0, 0, 0];
        for (let i = at; i < this.ghost.pts.length; i += 3) {
          const [x, y, z] = this.ghost.pts.slice(i, i + 3) as V3;
          mat4.transformPoint(ghost.move, x, y, z, p);
          this.ghost.pts.splice(i, 3, ...p);
        }
      }
    this.ghost.flush();
    this.box.set(box);
    this.boxThrough.set(box);
    this.boxShadow.set(shadow);

    // Picks: red, objects by their contour.
    for (const f of editor.picked) {
      if (f.kind === 'object') {
        for (const o of subtree(f.object)) {
          const m = modelOf.get(o);
          if (m) silhouette(m, eye, isFine(m) ? this.outside(m, this.contourOutside) : this.contour.pts); // prettier-ignore
        }
      } else if (f.kind === 'vertex') {
        const g = f.model.world;
        square(this.picked.pts, g.x(f.id), g.y(f.id), g.z(f.id), PICKED_VERTEX);
      } else outline(f.model, f.kind, f.id, eye, this.picked.pts, this.pickedBack.pts);
    }
    this.picked.flush();
    this.pickedBack.flush();
    this.contour.flush();
    this.contourOutside.flush();

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

/**
 * An edge, or a face's outline; a face or edge inside a surface shows the whole
 * surface. Edges whose faces are all turned away from the eye go to `back`.
 */
function outline(
  m: Model,
  kind: 'edge' | 'face',
  id: number,
  eye: THREE.Vector3,
  out: number[],
  back: number[],
): void {
  const [o, k] = remembered(m, eye, `${kind} ${id}`, (o, k) => outlineOf(m, kind, id, eye, o, k));
  for (const x of o) out.push(x);
  for (const x of k) back.push(x);
}

/**
 * Each model's outlines and contour as last drawn, while neither it nor the eye
 * moves: a big mesh's take a pass over all its edges, and the crosshair and the
 * plane move far more often than they change.
 */
const drawn = new WeakMap<Model['world'], { eye: string; lines: Map<string, [number[], number[]]> }>(); // prettier-ignore

function remembered(
  m: Model,
  eye: THREE.Vector3,
  key: string,
  make: (out: number[], back: number[]) => void,
): [number[], number[]] {
  const at = `${eye.x},${eye.y},${eye.z}`;
  let d = drawn.get(m.world);
  if (d?.eye !== at) drawn.set(m.world, (d = { eye: at, lines: new Map() }));
  let lines = d.lines.get(key);
  if (!lines) {
    lines = [[], []];
    make(...lines);
    d.lines.set(key, lines);
  }
  return lines;
}

function outlineOf(
  m: Model,
  kind: 'edge' | 'face',
  id: number,
  eye: THREE.Vector3,
  out: number[],
  back: number[],
): void {
  const b = m.object.brep;
  const faces = facingFrom(m, eye);
  const push = (e: number) => {
    const h2 = b.edgeHe2(e);
    const away = !faces(b.heFace(b.edgeHe1(e))) && (h2 === NONE || !faces(b.heFace(h2)));
    pushEdge(m, e, away ? back : out);
  };
  let set: number[];
  if (kind === 'edge') {
    const s = b.faceSurface.get(b.heFace(b.edgeHe1(id)));
    const h2 = b.edgeHe2(id);
    if (s === undefined || h2 === NONE || b.faceSurface.get(b.heFace(h2)) !== s) {
      push(id);
      return;
    }
    set = b.surfaceFaces(b.heFace(h2));
  } else set = b.surfaceFaces(id);
  for (const e of boundary(b, set)) push(e);
}

/** Whether each face of a model is turned toward the eye (memoised). */
function facingFrom(m: Model, eye: THREE.Vector3): (f: number) => boolean {
  const b = m.object.brep;
  const g = m.world;
  const facing = new Map<number, boolean>();
  return (f: number) => {
    let v = facing.get(f);
    if (v === undefined) {
      const [nx, ny, nz] = g.faceNormal(f);
      const p = b.heVertex(b.loopHe(b.faceLoop(f)));
      v = nx * (eye.x - g.x(p)) + ny * (eye.y - g.y(p)) + nz * (eye.z - g.z(p)) > 0;
      facing.set(f, v);
    }
    return v;
  };
}

/** grafx.c's contour: edges between a face turned toward the eye and one turned away. */
function silhouette(m: Model, eye: THREE.Vector3, out: number[]): void {
  for (const x of remembered(m, eye, 'contour', (o) => contourOf(m, eye, o))[0]) out.push(x);
}

function contourOf(m: Model, eye: THREE.Vector3, out: number[]): void {
  const b = m.object.brep;
  const faces = facingFrom(m, eye);
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
