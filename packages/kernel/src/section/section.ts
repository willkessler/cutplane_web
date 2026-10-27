import { transformPoint, type Mat4 } from '../math/mat4.ts';
import { Brep, NONE } from '../topology/brep.ts';

/**
 * Section computation: where the cutplane z = c meets an object.
 *
 * A rewrite of the original's intersect.c, which built per-face segments but
 * never chained them ("sort and break up ring...to be done"). Here:
 *
 * - Every vertex is classified once, as in front (+1), behind (-1) or on the
 *   plane (0: on it, or within ON_PLANE on a face lying in it). Edges and faces only ever look at those
 *   classes, so the faces sharing an edge always agree about it.
 * - On-plane vertices are treated symbolically as being just in front
 *   (the plane at c - ε). Then every edge either crosses or doesn't, every
 *   loop crosses an even number of times, and the degenerate cases (a vertex
 *   touching the plane, an edge or a whole face lying in it) fall out as
 *   limits of the generic case, without special-casing.
 * - Each crossing is keyed by its edge, which both of the edge's faces share,
 *   so segments chain into loops by edge id alone: no point matching, no
 *   epsilon.
 *
 * Loops run counter-clockwise seen from the front (+z) around material, and
 * clockwise around holes, so a loop's signed area says which it is.
 */

/**
 * Distance from the plane (room units) within which a vertex counts as on it: the
 * original's Tolerance (intersect.c, slice.c). Old files' faces are up to a tenth of
 * a unit out of flat, so a face laid in the plane must not be cut by its own drift.
 */
export const ON_PLANE = 0.5;
/** Nearer than this, a vertex is on the plane whatever its faces (float noise). */
const ON_EXACT = 1e-6;

export interface SectionSegment {
  /** The face this segment cuts across. */
  face: number;
  /** The edges where the segment starts and ends (its endpoints lie on them). */
  startEdge: number;
  endEdge: number;
}

export interface SectionLoop {
  shell: number;
  /** World-space points, x y z interleaved; z is always the plane depth. */
  points: Float64Array;
  /** One per span between consecutive points (points.length / 3 - 1 when open). */
  segments: SectionSegment[];
  /** False when the chain ran off a boundary or a non-manifold edge. */
  closed: boolean;
}

export interface ObjectSection {
  loops: SectionLoop[];
  /** Faces whose every vertex lies on the plane. */
  inPlaneFaces: number[];
  /** Edges whose two endpoints lie on the plane. */
  inPlaneEdges: number[];
}

/**
 * World-space copies of an object's vertex positions and face normals,
 * indexed by element id. Build once per edit, reuse for every plane depth.
 */
export class WorldGeometry {
  readonly pos: Float64Array;
  /** World z range, for culling. */
  readonly zMin: number;
  readonly zMax: number;
  private readonly normals = new Map<number, [number, number, number]>();

  constructor(
    readonly brep: Brep,
    readonly xform: Mat4,
  ) {
    const verts = brep.vertices();
    let max = 0;
    for (const v of verts) if (v > max) max = v;
    this.pos = new Float64Array(3 * (max + 1));
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of verts) {
      const [x, y, z] = transformPoint(xform, brep.vx(v), brep.vy(v), brep.vz(v));
      this.pos[3 * v] = x;
      this.pos[3 * v + 1] = y;
      this.pos[3 * v + 2] = z;
      if (z < lo) lo = z;
      if (z > hi) hi = z;
    }
    this.zMin = lo;
    this.zMax = hi;
  }

  x(v: number): number {
    return this.pos[3 * v]!;
  }
  y(v: number): number {
    return this.pos[3 * v + 1]!;
  }
  z(v: number): number {
    return this.pos[3 * v + 2]!;
  }

  /** Unit Newell normal of a face's outer loop, in world space ([0,0,0] if degenerate). */
  faceNormal(f: number): [number, number, number] {
    let n = this.normals.get(f);
    if (!n) {
      const hes = this.brep.loopHalfEdges(this.brep.faceLoop(f));
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = 0; i < hes.length; i++) {
        const a = this.brep.heVertex(hes[i]!);
        const b = this.brep.heVertex(hes[(i + 1) % hes.length]!);
        nx += (this.y(a) - this.y(b)) * (this.z(a) + this.z(b));
        ny += (this.z(a) - this.z(b)) * (this.x(a) + this.x(b));
        nz += (this.x(a) - this.x(b)) * (this.y(a) + this.y(b));
      }
      const len = Math.hypot(nx, ny, nz);
      n = len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 0];
      this.normals.set(f, n);
    }
    return n;
  }

  private index: DepthIndex | null | undefined;

  /**
   * The faces the plane at depth `c` might meet (every face reaching within
   * ON_PLANE of it), in ID order, and the edges without a face; null: look at
   * every face (a brep too small to index).
   */
  near(c: number): { faces: number[]; loose: readonly number[] } | null {
    if (this.index === undefined) this.index = depthIndex(this);
    return this.index && this.index.near(c);
  }
}

/**
 * A mesh with more vertices than this is fine (a scan's, a terrain's): too
 * fine for the plane to stop at each vertex, or to be cut and drawn anew each
 * frame it turns.
 */
export const FINE = 20_000;

/** Below this many faces, a section looks at every face. */
const INDEXED = 512;
/** Of the faces, the deepest ones looked at every time rather than sorted (a terrain's bottom). */
const LONG = 0.01;

interface DepthIndex {
  near(c: number): { faces: number[]; loose: readonly number[] };
}

/**
 * Each face's depth range, sorted by its shallow end, so a plane looks only at
 * the faces near it: a big mesh is crossed by a few thousand of its faces.
 * The deepest faces (a slab's bottom, a long side) would make every face
 * near, so those few are kept apart and always looked at.
 */
function depthIndex(g: WorldGeometry): DepthIndex | null {
  const b = g.brep;
  const faces = b.faces();
  if (faces.length < INDEXED) return null;
  const n = faces.length;
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = Infinity;
    let z = -Infinity;
    for (const l of b.faceLoops(faces[i]!))
      for (const h of b.loopHalfEdges(l)) {
        const d = g.z(b.heVertex(h));
        if (d < a) a = d;
        if (d > z) z = d;
      }
    lo[i] = a;
    hi[i] = z;
  }
  const spans = hi.map((z, i) => z - lo[i]!).sort();
  const wide = spans[Math.floor((1 - LONG) * (n - 1))]!;
  const long: number[] = [];
  const short: number[] = [];
  for (let i = 0; i < n; i++) (hi[i]! - lo[i]! > wide ? long : short).push(i);
  short.sort((p, q) => lo[p]! - lo[q]!);
  const order = Int32Array.from(short);
  const starts = Float64Array.from(short, (i) => lo[i]!);
  // Edges no face has (a wire): too few to index, and on no face to find them by.
  const loose = b.edges().filter((e) => {
    const h2 = b.edgeHe2(e);
    return b.heFace(b.edgeHe1(e)) === NONE && (h2 === NONE || b.heFace(h2) === NONE);
  });
  return {
    near(c) {
      const top = c + ON_PLANE;
      const bottom = c - ON_PLANE;
      // The first face starting deep enough to reach the plane: no shorter face starts further back.
      let i = 0;
      let j = starts.length;
      while (i < j) {
        const m = (i + j) >> 1;
        if (starts[m]! < bottom - wide) i = m + 1;
        else j = m;
      }
      const out: number[] = [];
      for (; i < starts.length && starts[i]! <= top; i++) {
        const k = order[i]!;
        if (hi[k]! >= bottom) out.push(k);
      }
      for (const k of long) if (lo[k]! <= top && hi[k]! >= bottom) out.push(k);
      return { faces: out.sort((p, q) => p - q).map((k) => faces[k]!), loose };
    },
  };
}

interface Crossing {
  edge: number;
  /** Loop goes front → back here (a segment starts) or back → front (one ends). */
  down: boolean;
  x: number;
  y: number;
  z: number;
  /** Position along the face's cut line, then the symbolic tie-break. */
  s: number;
  k: number;
}

interface Seg {
  shell: number;
  face: number;
  a: Crossing;
  b: Crossing;
  used: boolean;
}

/** Computes the section of every shell of `g.brep` at plane depth `c`. */
export function computeSection(g: WorldGeometry, c: number): ObjectSection {
  const b = g.brep;
  const out: ObjectSection = { loops: [], inPlaneFaces: [], inPlaneEdges: [] };
  if (g.zMin > c + ON_PLANE || g.zMax < c - ON_PLANE) return out;

  // A big brep is looked at only where the plane might meet it.
  const near = g.near(c);
  let byShell: Map<number, number[]>;
  if (near) {
    byShell = new Map(b.shells().map((sh) => [sh, [] as number[]]));
    for (const f of near.faces) byShell.get(b.faceShell(f))?.push(f);
  } else byShell = b.facesByShell();

  // Within ON_PLANE of it, a vertex is on the plane only if a face it is on lies in the
  // plane, all of it (an old file's drift), or if it is on it. A face tilted a hair,
  // its hole within ON_PLANE but its far side not, had the hole drawn alone, inside out.
  const flat = new Set<number>();
  for (const faces of byShell.values())
    face: for (const f of faces) {
      const loops = b.faceLoops(f);
      for (const l of loops)
        for (const h of b.loopHalfEdges(l))
          if (Math.abs(g.z(b.heVertex(h)) - c) > ON_PLANE) continue face;
      out.inPlaneFaces.push(f);
      for (const l of loops) for (const h of b.loopHalfEdges(l)) flat.add(b.heVertex(h));
    }
  const side = (v: number): -1 | 0 | 1 => {
    const d = g.z(v) - c;
    if (Math.abs(d) <= ON_EXACT || (Math.abs(d) <= ON_PLANE && flat.has(v))) return 0;
    return d > 0 ? 1 : -1;
  };
  // Perturbed class: on-plane is just in front.
  const front = (v: number) => side(v) >= 0;

  const crossingPoint = (e: number): [number, number, number] => {
    // Computed from the edge's endpoints in a fixed order, so both faces get identical points.
    let [p, q] = b.edgeVertices(e);
    if (p > q) [p, q] = [q, p];
    const sp = side(p);
    const sq = side(q);
    if (sp === 0) return [g.x(p), g.y(p), c];
    if (sq === 0) return [g.x(q), g.y(q), c];
    const t = (c - g.z(p)) / (g.z(q) - g.z(p));
    return [g.x(p) + t * (g.x(q) - g.x(p)), g.y(p) + t * (g.y(q) - g.y(p)), c];
  };

  for (const [shell, faces] of byShell) {
    const segs: Seg[] = [];
    for (const f of faces) {
      const loops = b.faceLoops(f);

      const [nx, ny] = g.faceNormal(f);
      // The cut line's direction: material on its left seen from +z.
      const tl = Math.hypot(nx, ny);
      const tx = tl > 0 ? -ny / tl : 1;
      const ty = tl > 0 ? nx / tl : 0;

      const xs: Crossing[] = [];
      for (const l of loops) {
        for (const h of b.loopHalfEdges(l)) {
          const e = b.heEdge(h);
          if (e === NONE) continue;
          const m = b.heMate(h);
          // A strut (both halves in this face) is crossed twice at one point; the two cancel.
          if (m !== NONE && b.heFace(m) === f) continue;
          const v0 = b.heVertex(h);
          const v1 = b.heVertex(b.heNext(h));
          const f0 = front(v0);
          if (f0 === front(v1)) continue;
          const [x, y, z] = crossingPoint(e);
          // When the crossing sits on an on-plane vertex, the ε-shifted plane meets the
          // edge a little way toward its far end: that direction breaks ties.
          let k = 0;
          const on = side(v0) === 0 ? v0 : side(v1) === 0 ? v1 : NONE;
          if (on !== NONE) {
            const far = on === v0 ? v1 : v0;
            k = ((g.x(far) - g.x(on)) * tx + (g.y(far) - g.y(on)) * ty) / (c - g.z(far));
          }
          xs.push({ edge: e, down: f0, x, y, z, s: x * tx + y * ty, k });
        }
      }
      if (xs.length === 0) continue;
      if (xs.length === 2) {
        const [p, q] = xs as [Crossing, Crossing];
        if (p.down !== q.down) {
          const [a, bb] = p.down ? [p, q] : [q, p];
          segs.push({ shell, face: f, a, b: bb, used: false });
        }
        continue;
      }
      xs.sort((p, q) => p.s - q.s || p.k - q.k);
      // Pair each start with the next unused end along the line (exact alternation in the generic case).
      const taken = new Array<boolean>(xs.length).fill(false);
      for (let i = 0; i < xs.length; i++) {
        if (taken[i] || !xs[i]!.down) continue;
        for (let j = i + 1; j < xs.length; j++) {
          if (taken[j] || xs[j]!.down) continue;
          taken[i] = taken[j] = true;
          segs.push({ shell, face: f, a: xs[i]!, b: xs[j]!, used: false });
          break;
        }
      }
      // A face nearly parallel to the plane and not quite flat (float drift in old files) can
      // defeat the ordering. Every loop has as many starts as ends, so pair whatever is left:
      // the geometry is ill-conditioned there anyway, and a complete pairing keeps loops closed.
      const starts = xs.filter((x, i) => !taken[i] && x.down);
      const ends = xs.filter((x, i) => !taken[i] && !x.down);
      for (let i = 0; i < Math.min(starts.length, ends.length); i++)
        segs.push({ shell, face: f, a: starts[i]!, b: ends[i]!, used: false });
    }
    chain(segs, shell, out.loops);
  }

  // An edge in the plane is on a face near it (or on none).
  let edges: number[];
  if (!near) edges = b.edges();
  else {
    const on = new Set(near.loose);
    for (const f of near.faces)
      for (const l of b.faceLoops(f))
        for (const h of b.loopHalfEdges(l)) {
          const e = b.heEdge(h);
          if (e !== NONE) on.add(e);
        }
    edges = [...on].sort((p, q) => p - q);
  }
  for (const e of edges) {
    const [p, q] = b.edgeVertices(e);
    if (side(p) === 0 && side(q) === 0) out.inPlaneEdges.push(e);
  }
  return out;
}

/** Links segments end-to-start through shared edges into closed loops or open chains. */
function chain(segs: Seg[], shell: number, loops: SectionLoop[]): void {
  const byStart = new Map<number, Seg>();
  const ends = new Set<number>();
  for (const s of segs) {
    if (!byStart.has(s.a.edge)) byStart.set(s.a.edge, s);
    ends.add(s.b.edge);
  }
  const emit = (first: Seg) => {
    const pts: number[] = [first.a.x, first.a.y, first.a.z];
    const segments: SectionSegment[] = [];
    let s: Seg | undefined = first;
    let closed = false;
    while (s && !s.used) {
      s.used = true;
      pts.push(s.b.x, s.b.y, s.b.z);
      segments.push({ face: s.face, startEdge: s.a.edge, endEdge: s.b.edge });
      s = byStart.get(s.b.edge);
      if (s === first) closed = true;
    }
    if (closed) pts.length -= 3; // the last point repeats the first
    loops.push({ shell, points: Float64Array.from(pts), segments, closed });
  };
  // Open chains first, from starts that nothing ends at; then whatever is left is closed loops.
  for (const s of segs) if (!s.used && !ends.has(s.a.edge)) emit(s);
  for (const s of segs) if (!s.used) emit(s);
}

/** Signed area of a section loop seen from +z: positive around material, negative around holes. */
export function loopArea(loop: SectionLoop): number {
  const p = loop.points;
  const n = p.length / 3;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[3 * i]! * p[3 * j + 1]! - p[3 * j]! * p[3 * i + 1]!;
  }
  return a / 2;
}
