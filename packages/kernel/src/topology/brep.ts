import { snap } from '../math/snap.ts';

/** Null reference for every element kind. */
export const NONE = -1;

export type Rgb = [number, number, number];

/**
 * Per-feature data that isn't topology: the property names (in order, as the
 * file lists them), an optional decal file and an optional CPL private-code
 * reference. Property names are open-ended strings because CPL can define new
 * properties at runtime.
 */
export interface FeatureAttrs {
  props: string[];
  decalFile?: string;
  /** The original's reference to a CPL file of private code (./cpl/rotatexbar.cpl). */
  privateCode?: string;
  /** Private CPL code kept in the file itself (new: the original saved only references). */
  privateSource?: string;
}

/** Growable struct-of-arrays pool. IDs are never reused, so they stay stable. */
class Pool {
  count = 0;
  live = 0;
  alive: Uint8Array;
  i32: Int32Array[];
  f64: Float64Array[];

  constructor(nI32: number, nF64: number, cap = 16) {
    this.alive = new Uint8Array(cap);
    this.i32 = Array.from({ length: nI32 }, () => new Int32Array(cap).fill(NONE));
    this.f64 = Array.from({ length: nF64 }, () => new Float64Array(cap));
  }

  alloc(): number {
    if (this.count === this.alive.length) this.grow(this.count * 2);
    const id = this.count++;
    this.alive[id] = 1;
    this.live++;
    return id;
  }

  free(id: number): void {
    if (!this.alive[id]) throw new Error(`double free of element ${id}`);
    this.alive[id] = 0;
    this.live--;
  }

  private grow(cap: number): void {
    const a = new Uint8Array(cap);
    a.set(this.alive);
    this.alive = a;
    this.i32 = this.i32.map((c) => {
      const n = new Int32Array(cap).fill(NONE);
      n.set(c);
      return n;
    });
    this.f64 = this.f64.map((c) => {
      const n = new Float64Array(cap);
      n.set(c);
      return n;
    });
  }

  clone(): Pool {
    const p = new Pool(0, 0, 0);
    p.count = this.count;
    p.live = this.live;
    p.alive = this.alive.slice();
    p.i32 = this.i32.map((c) => c.slice());
    p.f64 = this.f64.map((c) => c.slice());
    return p;
  }

  *ids(): IterableIterator<number> {
    for (let i = 0; i < this.count; i++) if (this.alive[i]) yield i;
  }

  /** Mixes every live slot's values into the hash pair `h`. */
  hash(h: Uint32Array): void {
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      mix(h, i);
      for (const c of this.i32) mix(h, c[i]!);
      for (const c of this.f64) {
        F64[0] = c[i]!;
        mix(h, U32[0]!);
        mix(h, U32[1]!);
      }
    }
    mix(h, this.count);
  }
}

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
/** Two 32-bit FNV-1a style lanes, so a collision needs both to agree. */
function mix(h: Uint32Array, x: number): void {
  h[0] = Math.imul(h[0]! ^ x, 0x01000193);
  h[1] = Math.imul(h[1]! ^ x, 0x85ebca6b) ^ (h[1]! >>> 13);
}
function mixText(h: Uint32Array, s: string): void {
  for (let i = 0; i < s.length; i++) mix(h, s.charCodeAt(i));
  mix(h, s.length);
}

// Column indexes.
const V_HE = 0, V_SHELL = 1; // prettier-ignore
const V_X = 0, V_Y = 1, V_Z = 2; // prettier-ignore
const H_NEXT = 0, H_PREV = 1, H_LOOP = 2, H_VERT = 3, H_EDGE = 4; // prettier-ignore
const E_HE1 = 0, E_HE2 = 1; // prettier-ignore
const L_FACE = 0, L_HE = 1, L_NEXT = 2; // prettier-ignore
const F_SHELL = 0, F_LOOP = 1; // prettier-ignore

/**
 * Half-edge boundary representation (Mäntylä's GWB, as in the original's
 * topology.h): Shell → Face → Loop → HalfEdge ↔ Edge ↔ Vertex. One Brep holds
 * all shells of one object. Vertex positions are in the object's local
 * coordinates and always lie on the snap grid.
 *
 * A loop's first loop in a face is its outer boundary; the rest are holes
 * ("rings"). A half-edge with edge NONE is the lone half-edge of a
 * single-vertex loop (the state mvfs creates). An edge with he2 NONE is a
 * boundary edge (only produced when loading open, non-manifold files).
 */
export class Brep {
  private v = new Pool(2, 3);
  private h = new Pool(5, 0);
  private e = new Pool(2, 0);
  private l = new Pool(3, 0);
  private f = new Pool(2, 0);
  private s = new Pool(0, 0);

  readonly vertexAttrs = new Map<number, FeatureAttrs>();
  readonly edgeAttrs = new Map<number, FeatureAttrs>();
  readonly faceAttrs = new Map<number, FeatureAttrs>();
  readonly faceColors = new Map<number, Rgb>();
  /**
   * The original's surfaces (mothersurf): faces split from one face by
   * planarizing stay one logical face, highlighted and dragged together and
   * merged back on release where they are still coplanar. Face → surface id.
   */
  readonly faceSurface = new Map<number, number>();
  /**
   * Per surface, how far from flat its original face was (legacy files carry float32-era
   * faces that are slightly bent): its pieces may merge back while no worse than that.
   */
  readonly surfaceSlack = new Map<number, number>();
  private nextSurface = 1;

  newSurface(): number {
    return this.nextSurface++;
  }

  /** Faces of the surface `face` belongs to, or just [face]. */
  surfaceFaces(face: number): number[] {
    const s = this.faceSurface.get(face);
    if (s === undefined) return [face];
    const out: number[] = [];
    for (const [f, t] of this.faceSurface) if (t === s) out.push(f);
    return out;
  }

  clone(): Brep {
    const b = new Brep();
    b.v = this.v.clone();
    b.h = this.h.clone();
    b.e = this.e.clone();
    b.l = this.l.clone();
    b.f = this.f.clone();
    b.s = this.s.clone();
    const copyAttrs = (from: Map<number, FeatureAttrs>, to: Map<number, FeatureAttrs>) => {
      for (const [k, a] of from) to.set(k, { ...a, props: [...a.props] });
    };
    copyAttrs(this.vertexAttrs, b.vertexAttrs);
    copyAttrs(this.edgeAttrs, b.edgeAttrs);
    copyAttrs(this.faceAttrs, b.faceAttrs);
    for (const [k, c] of this.faceColors) b.faceColors.set(k, [...c]);
    for (const [k, t] of this.faceSurface) b.faceSurface.set(k, t);
    for (const [k, t] of this.surfaceSlack) b.surfaceSlack.set(k, t);
    b.nextSurface = this.nextSurface;
    return b;
  }

  /**
   * A hash of everything the B-rep holds: positions, wiring, colours, surfaces and
   * feature attributes. Equal hashes mean (all but certainly) an unchanged B-rep, so
   * whoever drew or wrote it can keep what they made.
   */
  fingerprint(): string {
    const h = new Uint32Array([0x811c9dc5, 0x9747b28c]);
    for (const p of [this.v, this.h, this.e, this.l, this.f, this.s]) p.hash(h);
    for (const [k, c] of this.faceColors) for (const x of [k, ...c]) mix(h, x);
    for (const [k, t] of this.faceSurface) for (const x of [k, t]) mix(h, x);
    for (const [k, t] of this.surfaceSlack) mixText(h, `${k}:${t}`);
    for (const m of [this.vertexAttrs, this.edgeAttrs, this.faceAttrs]) {
      mix(h, m.size);
      for (const [k, a] of m) mixText(h, `${k}:${JSON.stringify(a)}`);
    }
    return `${h[0]!.toString(36)}.${h[1]!.toString(36)}`;
  }

  // ---- counts and iteration (always in ID order, which is file order) ----

  get numVertices(): number {
    return this.v.live;
  }
  get numHalfEdges(): number {
    return this.h.live;
  }
  get numEdges(): number {
    return this.e.live;
  }
  get numLoops(): number {
    return this.l.live;
  }
  get numFaces(): number {
    return this.f.live;
  }
  get numShells(): number {
    return this.s.live;
  }

  shells(): number[] {
    return [...this.s.ids()];
  }
  vertices(shell = NONE): number[] {
    const out: number[] = [];
    for (const id of this.v.ids())
      if (shell === NONE || this.vertexShell(id) === shell) out.push(id);
    return out;
  }
  faces(shell = NONE): number[] {
    const out: number[] = [];
    for (const id of this.f.ids()) if (shell === NONE || this.faceShell(id) === shell) out.push(id);
    return out;
  }
  /** Every shell's vertices in one pass (vertices(shell) for each shell is a pass each). */
  verticesByShell(): Map<number, number[]> {
    const out = new Map(this.shells().map((s) => [s, [] as number[]]));
    for (const id of this.v.ids()) out.get(this.vertexShell(id))?.push(id);
    return out;
  }
  /** Every shell's faces in one pass, in ID order. */
  facesByShell(): Map<number, number[]> {
    const out = new Map(this.shells().map((s) => [s, [] as number[]]));
    for (const id of this.f.ids()) out.get(this.faceShell(id))?.push(id);
    return out;
  }
  edges(): number[] {
    return [...this.e.ids()];
  }
  halfEdges(): number[] {
    return [...this.h.ids()];
  }
  loops(): number[] {
    return [...this.l.ids()];
  }

  /** Loops of a face, outer loop first. */
  faceLoops(face: number): number[] {
    const out: number[] = [];
    for (let l = this.faceLoop(face); l !== NONE; l = this.loopNext(l)) {
      out.push(l);
      if (out.length > this.l.count)
        throw new Error(`faceLoops: face ${face}'s loop list is a cycle`);
    }
    return out;
  }

  /** Half-edges of a loop, starting at the loop's first half-edge. */
  loopHalfEdges(loop: number): number[] {
    const out: number[] = [];
    const first = this.loopHe(loop);
    let h = first;
    do {
      out.push(h);
      h = this.heNext(h);
    } while (h !== first && out.length <= this.h.count);
    return out;
  }

  isVertex(id: number): boolean {
    return id >= 0 && id < this.v.count && this.v.alive[id] === 1;
  }
  isHalfEdge(id: number): boolean {
    return id >= 0 && id < this.h.count && this.h.alive[id] === 1;
  }
  isEdge(id: number): boolean {
    return id >= 0 && id < this.e.count && this.e.alive[id] === 1;
  }
  isLoop(id: number): boolean {
    return id >= 0 && id < this.l.count && this.l.alive[id] === 1;
  }
  isFace(id: number): boolean {
    return id >= 0 && id < this.f.count && this.f.alive[id] === 1;
  }
  isShell(id: number): boolean {
    return id >= 0 && id < this.s.count && this.s.alive[id] === 1;
  }

  // ---- vertices ----

  vx(v: number): number {
    return this.v.f64[V_X]![v]!;
  }
  vy(v: number): number {
    return this.v.f64[V_Y]![v]!;
  }
  vz(v: number): number {
    return this.v.f64[V_Z]![v]!;
  }
  vertexPos(v: number): [number, number, number] {
    return [this.vx(v), this.vy(v), this.vz(v)];
  }
  /** Moves a vertex; the position is snapped to the grid. */
  setVertexPos(v: number, x: number, y: number, z: number): void {
    this.v.f64[V_X]![v] = snap(x);
    this.v.f64[V_Y]![v] = snap(y);
    this.v.f64[V_Z]![v] = snap(z);
  }
  vertexHe(v: number): number {
    return this.v.i32[V_HE]![v]!;
  }
  setVertexHe(v: number, h: number): void {
    this.v.i32[V_HE]![v] = h;
  }
  vertexShell(v: number): number {
    return this.v.i32[V_SHELL]![v]!;
  }

  // ---- half-edges ----

  heNext(h: number): number {
    return this.h.i32[H_NEXT]![h]!;
  }
  hePrev(h: number): number {
    return this.h.i32[H_PREV]![h]!;
  }
  heLoop(h: number): number {
    return this.h.i32[H_LOOP]![h]!;
  }
  heVertex(h: number): number {
    return this.h.i32[H_VERT]![h]!;
  }
  heEdge(h: number): number {
    return this.h.i32[H_EDGE]![h]!;
  }
  heFace(h: number): number {
    return this.loopFace(this.heLoop(h));
  }
  /** The other half of h's edge, or NONE for a lone or boundary half-edge. */
  heMate(h: number): number {
    const e = this.heEdge(h);
    if (e === NONE) return NONE;
    const a = this.edgeHe1(e);
    return a === h ? this.edgeHe2(e) : a;
  }
  setHeNext(h: number, n: number): void {
    this.h.i32[H_NEXT]![h] = n;
  }
  setHePrev(h: number, p: number): void {
    this.h.i32[H_PREV]![h] = p;
  }
  setHeLoop(h: number, l: number): void {
    this.h.i32[H_LOOP]![h] = l;
  }
  setHeVertex(h: number, v: number): void {
    this.h.i32[H_VERT]![h] = v;
  }
  setHeEdge(h: number, e: number): void {
    this.h.i32[H_EDGE]![h] = e;
  }
  /** Links a → b in a loop. */
  link(a: number, b: number): void {
    this.setHeNext(a, b);
    this.setHePrev(b, a);
  }

  // ---- edges ----

  edgeHe1(e: number): number {
    return this.e.i32[E_HE1]![e]!;
  }
  edgeHe2(e: number): number {
    return this.e.i32[E_HE2]![e]!;
  }
  setEdgeHes(e: number, he1: number, he2: number): void {
    this.e.i32[E_HE1]![e] = he1;
    this.e.i32[E_HE2]![e] = he2;
  }
  edgeVertices(e: number): [number, number] {
    const h = this.edgeHe1(e);
    return [this.heVertex(h), this.heVertex(this.heNext(h))];
  }

  // ---- loops ----

  loopFace(l: number): number {
    return this.l.i32[L_FACE]![l]!;
  }
  loopHe(l: number): number {
    return this.l.i32[L_HE]![l]!;
  }
  loopNext(l: number): number {
    return this.l.i32[L_NEXT]![l]!;
  }
  setLoopFace(l: number, f: number): void {
    this.l.i32[L_FACE]![l] = f;
  }
  setLoopHe(l: number, h: number): void {
    this.l.i32[L_HE]![l] = h;
  }
  setLoopNext(l: number, n: number): void {
    this.l.i32[L_NEXT]![l] = n;
  }

  // ---- faces and shells ----

  faceShell(f: number): number {
    return this.f.i32[F_SHELL]![f]!;
  }
  /** The face's first (outer) loop. */
  faceLoop(f: number): number {
    return this.f.i32[F_LOOP]![f]!;
  }
  setFaceLoop(f: number, l: number): void {
    this.f.i32[F_LOOP]![f] = l;
  }
  setFaceShell(f: number, s: number): void {
    this.f.i32[F_SHELL]![f] = s;
  }

  // ---- loop list maintenance ----

  /** Appends loop l to face f (as outer loop if the face has none). */
  addLoopToFace(f: number, l: number): void {
    this.setLoopFace(l, f);
    this.setLoopNext(l, NONE);
    let last = this.faceLoop(f);
    if (last === NONE) {
      this.setFaceLoop(f, l);
      return;
    }
    while (this.loopNext(last) !== NONE) last = this.loopNext(last);
    this.setLoopNext(last, l);
  }

  removeLoopFromFace(l: number): void {
    const f = this.loopFace(l);
    if (this.faceLoop(f) === l) this.setFaceLoop(f, this.loopNext(l));
    else {
      let p = this.faceLoop(f);
      while (p !== NONE && this.loopNext(p) !== l) p = this.loopNext(p);
      if (p === NONE) throw new Error(`loop ${l} not in face ${f}`);
      this.setLoopNext(p, this.loopNext(l));
    }
    this.setLoopNext(l, NONE);
    this.setLoopFace(l, NONE);
  }

  /** Makes loop l the outer (first) loop of its face. */
  makeOuterLoop(l: number): void {
    const f = this.loopFace(l);
    if (this.faceLoop(f) === l) return;
    this.removeLoopFromFace(l);
    this.setLoopFace(l, f);
    this.setLoopNext(l, this.faceLoop(f));
    this.setFaceLoop(f, l);
  }

  // ---- allocation (used by Euler operators and builders) ----

  newShell(): number {
    return this.s.alloc();
  }
  newVertex(shell: number, x: number, y: number, z: number): number {
    const id = this.v.alloc();
    this.v.i32[V_SHELL]![id] = shell;
    this.v.i32[V_HE]![id] = NONE;
    this.setVertexPos(id, x, y, z);
    return id;
  }
  newHalfEdge(loop: number, vertex: number): number {
    const id = this.h.alloc();
    for (const c of this.h.i32) c[id] = NONE;
    this.setHeLoop(id, loop);
    this.setHeVertex(id, vertex);
    this.setHeNext(id, id);
    this.setHePrev(id, id);
    return id;
  }
  newEdge(he1 = NONE, he2 = NONE): number {
    const id = this.e.alloc();
    this.setEdgeHes(id, he1, he2);
    return id;
  }
  newLoop(face: number): number {
    const id = this.l.alloc();
    for (const c of this.l.i32) c[id] = NONE;
    this.addLoopToFace(face, id);
    return id;
  }
  newFace(shell: number): number {
    const id = this.f.alloc();
    this.setFaceShell(id, shell);
    this.setFaceLoop(id, NONE);
    return id;
  }

  freeVertex(v: number): void {
    this.v.free(v);
    this.vertexAttrs.delete(v);
  }
  freeHalfEdge(h: number): void {
    this.h.free(h);
  }
  freeEdge(e: number): void {
    this.e.free(e);
    this.edgeAttrs.delete(e);
  }
  freeLoop(l: number): void {
    this.l.free(l);
  }
  freeFace(f: number): void {
    this.f.free(f);
    this.faceAttrs.delete(f);
    this.faceColors.delete(f);
    this.faceSurface.delete(f);
  }
  freeShell(s: number): void {
    this.s.free(s);
  }

  // ---- geometry helpers (local coordinates) ----

  /** Newell normal of a loop (unnormalized; length is twice the area). */
  loopNormal(l: number): [number, number, number] {
    let nx = 0,
      ny = 0,
      nz = 0;
    for (const h of this.loopHalfEdges(l)) {
      const a = this.heVertex(h);
      const b = this.heVertex(this.heNext(h));
      const ax = this.vx(a), ay = this.vy(a), az = this.vz(a); // prettier-ignore
      const bx = this.vx(b), by = this.vy(b), bz = this.vz(b); // prettier-ignore
      nx += (ay - by) * (az + bz);
      ny += (az - bz) * (ax + bx);
      nz += (ax - bx) * (ay + by);
    }
    return [nx, ny, nz];
  }

  /** Unit outward normal of a face from its outer loop, or [0,0,0] if degenerate. */
  faceNormal(f: number): [number, number, number] {
    const [x, y, z] = this.loopNormal(this.faceLoop(f));
    const len = Math.hypot(x, y, z);
    return len === 0 ? [0, 0, 0] : [x / len, y / len, z / len];
  }
}
