import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel, Mat4 as ManifoldMat4 } from 'manifold-3d';
import { Brep, buildShell, mat4, snap, validate, type Mat4 } from '@cutplane/kernel';

type V3 = [number, number, number];

let wasm: ManifoldToplevel | undefined;

/**
 * Loads manifold-3d's WebAssembly (once). In a browser, `wasmUrl` says where
 * `manifold.wasm` is served; Node finds it next to the module.
 */
export async function initBooleans(wasmUrl?: string): Promise<void> {
  if (wasm) return;
  const m = await Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  m.setup();
  wasm = m;
}

export const booleansReady = (): boolean => wasm !== undefined;

function lib(): ManifoldToplevel {
  if (!wasm) throw new Error('booleans: initBooleans() has not finished');
  return wasm;
}

/** A solid as the boolean sees it: a B-rep in its own frame, placed in the room. */
export interface Solid {
  brep: Brep;
  xform: Mat4;
}

/** Where a result face came from: a face of operand 0 or 1, or nothing (a slice's cap). */
export type FaceSource = { operand: 0 | 1; face: number } | null;

/** One face of a result: loops of vertex indices, the outer loop first. */
export interface ResultFace {
  loops: number[][];
  source: FaceSource;
}

/** A closed shell of a result, in the frame asked for. */
export interface ResultShell {
  positions: V3[];
  faces: ResultFace[];
  /** Signed volume: negative for a void inside another shell. */
  volume: number;
}

/** A face's plane in the room: unit normal n and offset d, with n·p = d. */
interface Plane {
  n: V3;
  d: number;
}

/** What a mesh built from solids remembers, to map the result back. */
interface Tagged {
  manifold: Manifold;
  /** Each operand's face ids, by manifold faceID. */
  faces: number[];
  planes: Plane[];
  /** Exact room positions of the operand's vertices. */
  points: V3[];
  /** For each vertex of `points`, its position in operand 0's frame when exactly known. */
  local: (V3 | null)[];
  /** The original id its triangles' runs carry through operations. */
  run: number;
  /** Faults it came with (a 1991 file's slightly bent faces): the result may keep them. */
  faults: Set<string>;
}

const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]; // prettier-ignore
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!; // prettier-ignore
const cross = (a: readonly number[], b: readonly number[]): V3 => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
const norm = (a: readonly number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);

/** Newell's normal of a loop of room points (length: twice its area). */
function newell(pts: readonly V3[]): V3 {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

/** The axis to drop when flattening a face with normal n (the largest component). */
function dropAxis(n: readonly number[]): number {
  const ax = Math.abs(n[0]!);
  const ay = Math.abs(n[1]!);
  const az = Math.abs(n[2]!);
  return az >= ax && az >= ay ? 2 : ax >= ay ? 0 : 1;
}

/** 2D coordinates of p with axis `drop` removed, wound so that n points at the viewer. */
function flat(p: readonly number[], drop: number, n: readonly number[]): [number, number] {
  const [u, v] = drop === 0 ? [1, 2] : drop === 1 ? [2, 0] : [0, 1];
  return n[drop]! >= 0 ? [p[u]!, p[v]!] : [p[v]!, p[u]!];
}

/**
 * A B-rep as a manifold mesh in the room: every face triangulated (holes
 * included), each triangle tagged with its face, so the result can be put back
 * together face by face. Returns null if manifold won't take it (not closed).
 */
function toManifold(s: Solid, base: number, frame: Mat4 | null): Tagged | null {
  const M = lib();
  const b = s.brep;
  const index = new Map<number, number>();
  const points: V3[] = [];
  const local: (V3 | null)[] = [];
  // In operand 0's own frame its vertices come back exactly as they were.
  const same = frame !== null && frame.every((v, i) => v === s.xform[i]);
  for (const v of b.vertices()) {
    index.set(v, points.length);
    const p = b.vertexPos(v);
    points.push([...mat4.transformPoint(s.xform, p[0], p[1], p[2])] as V3);
    local.push(same ? [p[0], p[1], p[2]] : null);
  }
  const tris: number[] = [];
  const faceID: number[] = [];
  const faces: number[] = [];
  const planes: Plane[] = [];
  for (const f of b.faces()) {
    const loops = b
      .faceLoops(f)
      .map((l) => b.loopHalfEdges(l).map((h) => index.get(b.heVertex(h))!));
    if (loops.length === 0 || loops[0]!.length < 3) continue;
    const outer = loops[0]!.map((i) => points[i]!);
    const nn = newell(outer);
    const len = norm(nn);
    if (len === 0) return null;
    const n: V3 = [nn[0] / len, nn[1] / len, nn[2] / len];
    const id = faces.length;
    faces.push(f);
    planes.push({ n, d: dot(n, outer[0]!) });
    const drop = dropAxis(n);
    const polys = loops.map((loop) => loop.map((i) => flat(points[i]!, drop, n)));
    const flatIdx = loops.flat();
    let out: [number, number, number][];
    try {
      out = M.triangulate(polys, 1e-9) as [number, number, number][];
    } catch {
      return null;
    }
    for (const t of out) {
      tris.push(flatIdx[t[0]]!, flatIdx[t[1]]!, flatIdx[t[2]]!);
      faceID.push(base + id);
    }
  }
  const mesh = new M.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(points.flat()),
    triVerts: new Uint32Array(tris),
    faceID: new Uint32Array(faceID),
  });
  mesh.merge();
  let manifold: Manifold;
  try {
    manifold = new M.Manifold(mesh);
  } catch {
    return null;
  }
  if (manifold.status() !== 'NoError' || manifold.isEmpty()) {
    manifold.delete();
    return null;
  }
  // A mesh-made manifold reports no originalID(), but its triangles' run carries one.
  const runs = manifold.getMesh().runOriginalID;
  const faults = new Set(
    validate(b)
      .issues.map((i) => i.code)
      .filter((c) => FAULTS.includes(c)),
  );
  return { manifold, faces, planes, points, local, run: runs[0] ?? -1, faults };
}

/** Exact positions of input vertices, found again by where the float32 mesh put them. */
class PointIndex {
  private readonly cells = new Map<string, number[]>();
  constructor(
    private readonly pts: readonly V3[],
    private readonly cell = 0.01,
  ) {
    pts.forEach((p, i) => {
      const k = this.key(p);
      const list = this.cells.get(k);
      if (list) list.push(i);
      else this.cells.set(k, [i]);
    });
  }
  private key(p: readonly number[], dx = 0, dy = 0, dz = 0): string {
    const c = this.cell;
    return `${Math.floor(p[0]! / c) + dx},${Math.floor(p[1]! / c) + dy},${Math.floor(p[2]! / c) + dz}`;
  }
  /** The input point within `tol` of p, if there is one. */
  near(p: readonly number[], tol: number): number {
    let best = -1;
    let bd = tol;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const i of this.cells.get(this.key(p, dx, dy, dz)) ?? []) {
            const d = norm(sub(this.pts[i]!, p));
            if (d <= bd) {
              bd = d;
              best = i;
            }
          }
    return best;
  }
}

/**
 * Where a new vertex really is: on every plane of the faces around it. Solved in
 * double precision from the float32 estimate p (least squares over the distinct
 * planes, staying nearest p along any direction they leave free).
 */
function refine(p: V3, planes: readonly Plane[]): V3 {
  const distinct: Plane[] = [];
  for (const pl of planes)
    if (
      !distinct.some(
        (q) =>
          Math.abs(dot(q.n, pl.n)) > 1 - 1e-9 &&
          Math.abs(q.d - pl.d * Math.sign(dot(q.n, pl.n))) < 1e-6,
      )
    )
      // prettier-ignore
      distinct.push(pl);
  // Minimise |x - p|² · ε + Σ (n·x - d)²: the planes win, p settles what they leave open.
  const eps = 1e-6;
  const A = [
    [eps, 0, 0],
    [0, eps, 0],
    [0, 0, eps],
  ];
  const r = [eps * p[0], eps * p[1], eps * p[2]];
  for (const { n, d } of distinct)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i]![j]! += n[i]! * n[j]!;
      r[i]! += n[i]! * d;
    }
  const det = (m: number[][]) =>
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const D = det(A);
  if (Math.abs(D) < 1e-30) return p;
  const col = (k: number) => A.map((row, i) => row.map((v, j) => (j === k ? r[i]! : v)));
  const x: V3 = [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
  // Never move far from where manifold put it (bad planes): keep its own estimate.
  return norm(sub(x, p)) > 0.05 ? p : x;
}

/**
 * A manifold result back as polygon shells. Triangles are grouped by the face they
 * came from (and by edge-connected piece), each group's boundary is chained into
 * loops, and vertices left in the middle of a straight edge are dropped.
 */
function fromManifold(
  r: Manifold,
  ins: readonly Tagged[],
  frame: Mat4,
  caps: Plane[],
): ResultShell[] {
  const got = r.getMesh();
  const nt = got.triVerts.length / 3;
  if (nt === 0) return [];
  // The output may repeat a vertex (one copy per side of a property seam): one index each.
  const canon = new Map<string, number>();
  const verts: number[] = [];
  const merged = new Uint32Array(got.vertProperties.length / got.numProp);
  for (let v = 0; v < merged.length; v++) {
    const o = v * got.numProp;
    const key = `${got.vertProperties[o]},${got.vertProperties[o + 1]},${got.vertProperties[o + 2]}`;
    let i = canon.get(key);
    if (i === undefined) {
      i = verts.length / 3;
      canon.set(key, i);
      verts.push(got.vertProperties[o]!, got.vertProperties[o + 1]!, got.vertProperties[o + 2]!);
    }
    merged[v] = i;
  }
  const mesh = {
    numProp: 3,
    vertProperties: verts,
    triVerts: got.triVerts.map((v) => merged[v]!),
    faceID: got.faceID,
    runIndex: got.runIndex,
    runOriginalID: got.runOriginalID,
  };
  const nv = verts.length / 3;
  const ids = ins.map((t) => t.run);
  // Which operand and face each triangle came from (runs carry the original id).
  const triOperand = new Int32Array(nt).fill(-1);
  for (let run = 0; run < mesh.runOriginalID.length; run++) {
    const op = ids.indexOf(mesh.runOriginalID[run]!);
    const from = mesh.runIndex[run]! / 3;
    const to = mesh.runIndex[run + 1]! / 3;
    for (let t = from; t < to; t++) triOperand[t] = op;
  }
  const ownKey = (t: number): string => {
    const op = triOperand[t]!;
    return op < 0 ? `cap:${mesh.faceID[t]}` : `${op}:${mesh.faceID[t]}`;
  };
  // Faces of the two operands that lie in one plane (a union's flush sides) join into one
  // face; faces of one operand stay as they were, even where coplanar (painted apart, say).
  const planeClass = new Map<string, string>();
  const classes: { plane: Plane; key: string; ops: Set<number> }[] = [];
  const faceKey = (t: number): string => {
    const own = ownKey(t);
    let k = planeClass.get(own);
    if (k !== undefined) return k;
    const op = triOperand[t]!;
    const { plane } = sourceOf(t);
    k = own;
    if (plane && op >= 0) {
      const same = classes.find(
        (c) =>
          !c.ops.has(op) &&
          dot(c.plane.n, plane.n) > 1 - 1e-9 &&
          Math.abs(c.plane.d - plane.d) < 1e-6,
      );
      if (same) {
        same.ops.add(op);
        k = same.key;
      } else classes.push({ plane, key: own, ops: new Set([op]) });
    }
    planeClass.set(own, k);
    return k;
  };
  const sourceOf = (t: number): { src: FaceSource; plane: Plane | null } => {
    const op = triOperand[t]!;
    const fid = mesh.faceID[t]!;
    if (op < 0) return { src: null, plane: null };
    const base = op === 0 ? 0 : ins[0]!.faces.length;
    const k = fid - base;
    const tag = ins[op]!;
    return { src: { operand: op as 0 | 1, face: tag.faces[k]! }, plane: tag.planes[k] ?? null };
  };

  // Positions: input vertices exactly; new ones on their faces' planes.
  const raw: V3[] = [];
  for (let v = 0; v < nv; v++) {
    const o = v * mesh.numProp;
    raw.push([mesh.vertProperties[o]!, mesh.vertProperties[o + 1]!, mesh.vertProperties[o + 2]!]);
  }
  const allPoints = ins.flatMap((t) => t.points);
  const allLocal = ins.flatMap((t) => t.local);
  const index = new PointIndex(allPoints);
  const vertPlanes: Plane[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) {
    const { plane } = sourceOf(t);
    const pl = plane ?? capPlane(raw, mesh.triVerts, t, caps);
    if (!pl) continue;
    for (let k = 0; k < 3; k++) vertPlanes[mesh.triVerts[3 * t + k]!]!.push(pl);
  }
  const inv = mat4.invert(frame) ?? mat4.identity();
  const positions: V3[] = raw.map((p, v) => {
    const i = index.near(p, 1e-4);
    if (i >= 0) {
      const l = allLocal[i];
      if (l) return l;
      const q = allPoints[i]!;
      return [...mat4.transformPoint(inv, q[0], q[1], q[2])] as V3;
    }
    const q = refine(p, vertPlanes[v]!);
    return [...mat4.transformPoint(inv, q[0], q[1], q[2])] as V3;
  });

  // Group triangles into faces: same source face, connected across shared edges.
  const edgeTris = new Map<string, number[]>();
  const ekey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const a = mesh.triVerts[3 * t + k]!;
      const b = mesh.triVerts[3 * t + ((k + 1) % 3)]!;
      const key = ekey(a, b);
      const list = edgeTris.get(key);
      if (list) list.push(t);
      else edgeTris.set(key, [t]);
    }
  const group = new Int32Array(nt).fill(-1);
  // A sliver whose corners merged into one (two output vertices at one position) has no
  // area, and its edges, there and back, would hide its neighbour's edge from the face's
  // boundary: it belongs to no face. (Two tori on one axis make them.)
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => mesh.triVerts[3 * t + k]!);
    if (a === b || b === c || c === a) group[t] = -2;
  }
  const groups: number[][] = [];
  for (let t0 = 0; t0 < nt; t0++) {
    if (group[t0] !== -1) continue;
    const g = groups.length;
    const members = [t0];
    group[t0] = g;
    const key = faceKey(t0);
    for (let i = 0; i < members.length; i++) {
      const t = members[i]!;
      for (let k = 0; k < 3; k++) {
        const a = mesh.triVerts[3 * t + k]!;
        const b = mesh.triVerts[3 * t + ((k + 1) % 3)]!;
        for (const u of edgeTris.get(ekey(a, b)) ?? [])
          if (group[u] === -1 && faceKey(u) === key) {
            group[u] = g;
            members.push(u);
          }
      }
    }
    groups.push(members);
  }

  // Each group's boundary: directed edges whose reverse isn't in the group.
  const polyFaces: { loops: number[][]; source: FaceSource; normal: V3 }[] = [];
  for (const members of groups) {
    const directed = new Set<string>();
    for (const t of members)
      for (let k = 0; k < 3; k++)
        directed.add(`${mesh.triVerts[3 * t + k]},${mesh.triVerts[3 * t + ((k + 1) % 3)]}`);
    const out = new Map<number, number[]>();
    for (const e of directed) {
      const [a, b] = e.split(',').map(Number) as [number, number];
      if (directed.has(`${b},${a}`)) continue;
      const list = out.get(a);
      if (list) list.push(b);
      else out.set(a, [b]);
    }
    // The face's normal, from its triangles (in the room).
    const n: V3 = [0, 0, 0];
    for (const t of members) {
      const [a, b, c] = [0, 1, 2].map((k) => raw[mesh.triVerts[3 * t + k]!]!) as [V3, V3, V3];
      const tn = cross(sub(b, a), sub(c, a));
      n[0] += tn[0];
      n[1] += tn[1];
      n[2] += tn[2];
    }
    const drop = dropAxis(n);
    const loops: number[][] = [];
    for (;;) {
      const startEntry = [...out.entries()].find(([, l]) => l.length > 0);
      if (!startEntry) break;
      const start = startEntry[0];
      const loop = [start];
      let prev = start;
      let cur = takeNext(out, start, -1, raw, drop, n);
      let guard = 0;
      while (cur !== start && guard++ < 100000) {
        loop.push(cur);
        const next = takeNext(out, cur, prev, raw, drop, n);
        prev = cur;
        cur = next;
        if (cur < 0) break;
      }
      if (cur === start && loop.length >= 3) loops.push(loop);
    }
    if (loops.length === 0) continue;
    // A face joined from both operands takes the first operand's face.
    const lead = members.find((t) => triOperand[t] === 0) ?? members[0]!;
    polyFaces.push({ loops, source: sourceOf(lead).src, normal: n });
  }

  // Outer loops wind with the face (positive area); holes go to the outer loop around them.
  const faces: ResultFace[] = [];
  for (const pf of polyFaces) {
    const drop = dropAxis(pf.normal);
    const area = (loop: number[]) => signedArea(loop.map((v) => flat(raw[v]!, drop, pf.normal)));
    const outers = pf.loops.filter((l) => area(l) > 0);
    const holes = pf.loops.filter((l) => area(l) <= 0);
    if (outers.length === 1) {
      faces.push({ loops: [outers[0]!, ...holes], source: pf.source });
      continue;
    }
    const assigned = outers.map((o) => ({ loops: [o], area: area(o) }));
    for (const h of holes) {
      const p = flat(raw[h[0]!]!, drop, pf.normal);
      let best: (typeof assigned)[number] | undefined;
      for (const a of assigned)
        if (
          inside(
            p,
            a.loops[0]!.map((v) => flat(raw[v]!, drop, pf.normal)),
          )
        )
          if (!best || a.area < best.area) best = a;
      (best ?? assigned[0])?.loops.push(h);
    }
    for (const a of assigned) faces.push({ loops: a.loops, source: pf.source });
  }

  mergeCoincident(faces, positions);
  dropSpurs(faces);
  dropStraightVertices(faces, positions);
  dropFlatTriangles(faces, positions);

  // Shells: faces joined through shared vertices.
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]!]!;
    return x;
  };
  for (const f of faces) {
    const first = f.loops[0]![0]!;
    for (const l of f.loops) for (const v of l) parent[find(v)] = find(first);
  }
  const shells = new Map<number, ResultFace[]>();
  for (const f of faces) {
    const root = find(f.loops[0]![0]!);
    const list = shells.get(root);
    if (list) list.push(f);
    else shells.set(root, [f]);
  }
  const result: ResultShell[] = [];
  for (const fs of shells.values()) {
    const remap = new Map<number, number>();
    const pts: V3[] = [];
    const idx = (v: number) => {
      let i = remap.get(v);
      if (i === undefined) {
        i = pts.length;
        remap.set(v, i);
        pts.push(positions[v]!);
      }
      return i;
    };
    const out = fs.map((f) => ({ loops: f.loops.map((l) => l.map(idx)), source: f.source }));
    result.push({ positions: pts, faces: out, volume: shellVolume(pts, out) });
  }
  const allowed = new Set(ins.flatMap((t) => [...t.faults]));
  for (const r of result) if (!sound(r, allowed)) throw new Unsound();
  return result;
}

/** A result that didn't come back as closed, valid shells: the operation is refused. */
class Unsound extends Error {}

/** Faults a result mustn't gain (warnings the validator gives a closed shell). */
const FAULTS = ['degenerate-face', 'zero-length-edge', 'nonplanar-face', 'nonmanifold-vertex'];

/**
 * Whether a shell builds into a closed B-rep the validator passes, with no fault
 * the operands didn't already have.
 */
function sound(s: ResultShell, allowed: ReadonlySet<string>): boolean {
  if (s.faces.some((f) => f.loops.some((l) => l.length < 3))) return false;
  const b = new Brep();
  buildShell(b, { positions: s.positions, faces: s.faces.map((f) => f.loops) });
  const r = validate(b);
  return (
    r.ok &&
    r.closedManifold &&
    !r.issues.some(
      (i) => i.severity === 'error' || (FAULTS.includes(i.code) && !allowed.has(i.code)),
    )
  );
}

/** Runs a conversion back, or null if it wasn't sound. */
function attempt<T>(f: () => T): T | null {
  try {
    return f();
  } catch (e) {
    if (e instanceof Unsound) return null;
    throw e;
  }
}

/** The cap plane a manifold-made triangle (no operand) lies in, if one is known. */
function capPlane(raw: V3[], tv: ArrayLike<number>, t: number, caps: Plane[]): Plane | null {
  const [a, b, c] = [0, 1, 2].map((k) => raw[tv[3 * t + k]!]!) as [V3, V3, V3];
  const n = cross(sub(b, a), sub(c, a));
  const len = norm(n);
  if (len === 0) return null;
  for (const pl of caps) if (Math.abs(dot(pl.n, a) - pl.d) < 1e-3) return pl;
  return { n: [n[0] / len, n[1] / len, n[2] / len], d: dot(n, a) / len };
}

/**
 * The next boundary vertex after `cur` (arrived at from `prev`): at a vertex the
 * face touches twice, the edge turning most sharply clockwise keeps loops simple.
 */
function takeNext(
  out: Map<number, number[]>,
  cur: number,
  prev: number,
  raw: V3[],
  drop: number,
  n: V3,
): number {
  const list = out.get(cur);
  if (!list || list.length === 0) return -1;
  let pick = 0;
  if (list.length > 1 && prev >= 0) {
    const c = flat(raw[cur]!, drop, n);
    const p = flat(raw[prev]!, drop, n);
    const back = Math.atan2(p[1] - c[1], p[0] - c[0]);
    let best = Infinity;
    list.forEach((v, i) => {
      const q = flat(raw[v]!, drop, n);
      let a = back - Math.atan2(q[1] - c[1], q[0] - c[0]); // clockwise from the way back
      while (a <= 0) a += 2 * Math.PI;
      if (a < best) {
        best = a;
        pick = i;
      }
    });
  }
  const [v] = list.splice(pick, 1);
  return v!;
}

function signedArea(pts: readonly [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function inside(p: [number, number], poly: readonly [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      c = !c;
  }
  return c;
}

/**
 * Removes vertices that only sit in the middle of a straight edge: two neighbours
 * in every loop that has them, and in line with both (triangulation leftovers).
 */
/**
 * Vertices at one point of the grid (two of manifold's closer than a grid step, as where
 * a fine sphere meets another solid) become one, and a loop doesn't go from it to itself:
 * the B-rep snaps them together anyway, an edge of no length, and the result was refused.
 * A loop or face that comes to nothing goes.
 */
function mergeCoincident(faces: ResultFace[], pos: readonly V3[]): void {
  const first = new Map<string, number>();
  const to = pos.map((p, v) => {
    const k = `${snap(p[0])},${snap(p[1])},${snap(p[2])}`;
    const u = first.get(k);
    if (u !== undefined) return u;
    first.set(k, v);
    return v;
  });
  if (to.every((u, v) => u === v)) return;
  for (const f of faces) {
    const loops = f.loops.map((l) =>
      l.map((v) => to[v]!).filter((v, i, m) => v !== m[(i + 1) % m.length]),
    );
    // The outer loop gone, the face is: its holes don't stand for it.
    f.loops = loops[0]!.length >= 3 ? loops.filter((l) => l.length >= 3) : [];
  }
  for (let i = faces.length - 1; i >= 0; i--) if (faces[i]!.loops.length === 0) faces.splice(i, 1);
}

/**
 * A loop that goes out to a vertex and straight back (a, b, a) loses the spur: where a
 * grazing cut leaves slivers finer than the grid, a face can chain into one, of no area.
 * Its edges' partners in the faces either side then pair with each other, so the shell
 * stays closed. A loop or face that comes to nothing goes.
 */
function dropSpurs(faces: ResultFace[]): void {
  for (const f of faces) {
    f.loops = f.loops.map((l) => {
      const m = [...l];
      for (let i = 0; m.length >= 3 && i < m.length;) {
        const n = m.length;
        if (m[(i + n - 1) % n] !== m[(i + 1) % n]) {
          i++;
          continue;
        }
        // m[i] is the spur's tip: it goes, with the repeat of the vertex before it.
        const at = [i, (i + 1) % n].sort((a, b) => b - a);
        for (const k of at) m.splice(k, 1);
        i = Math.max(0, i - 2);
      }
      return m;
    });
    f.loops = f.loops[0]!.length >= 3 ? f.loops.filter((l) => l.length >= 3) : [];
  }
  for (let i = faces.length - 1; i >= 0; i--) if (faces[i]!.loops.length === 0) faces.splice(i, 1);
}

/**
 * A triangle of no area once its corners are on the grid (in a line, as a grazing cut can
 * leave them) goes, and its middle corner goes into the face across its long edge instead,
 * so that face's edge meets the two short edges' faces as the triangle's did.
 */
function dropFlatTriangles(faces: ResultFace[], pos: readonly V3[]): void {
  for (let i = faces.length - 1; i >= 0; i--) {
    const f = faces[i]!;
    if (f.loops.length !== 1 || f.loops[0]!.length !== 3) continue;
    const l = f.loops[0]!;
    const at = (v: number) => pos[v]!.map(snap) as V3;
    const [p, q, r] = l.map(at) as [V3, V3, V3];
    if (norm(cross(sub(q, p), sub(r, p))) >= 1e-9) continue;
    // The middle corner is the one across from the longest edge, which runs a → c.
    const span = (k: number) => norm(sub(at(l[(k + 1) % 3]!), at(l[(k + 2) % 3]!)));
    const k = [0, 1, 2].reduce((m, j) => (span(j) > span(m) ? j : m), 0);
    const [b, c, a] = [l[k]!, l[(k + 1) % 3]!, l[(k + 2) % 3]!];
    // This triangle's edge c → a has its partner a → c in another face: b goes between.
    let done = false;
    for (const g of faces) {
      if (g === f || done) continue;
      for (const gl of g.loops) {
        const j = gl.findIndex((v, j) => v === a && gl[(j + 1) % gl.length] === c);
        if (j < 0) continue;
        gl.splice(j + 1, 0, b);
        done = true;
        break;
      }
    }
    if (done) faces.splice(i, 1);
  }
}

function dropStraightVertices(faces: ResultFace[], pos: readonly V3[]): void {
  const neighbours = new Map<number, Set<number>>();
  for (const f of faces)
    for (const l of f.loops)
      l.forEach((v, i) => {
        const s = neighbours.get(v) ?? new Set<number>();
        s.add(l[(i + 1) % l.length]!);
        s.add(l[(i + l.length - 1) % l.length]!);
        neighbours.set(v, s);
      });
  const straight = new Set<number>();
  for (const [v, s] of neighbours) {
    if (s.size !== 2) continue;
    const [a, b] = [...s] as [number, number];
    const u = sub(pos[a]!, pos[v]!);
    const w = sub(pos[b]!, pos[v]!);
    const lu = norm(u);
    const lw = norm(w);
    if (lu === 0 || lw === 0) continue;
    if (norm(cross(u, w)) / (lu * lw) < 1e-9 && dot(u, w) < 0) straight.add(v);
  }
  if (straight.size === 0) return;
  for (const f of faces) f.loops = f.loops.map((l) => l.filter((v) => !straight.has(v)));
}

function shellVolume(pts: readonly V3[], faces: readonly ResultFace[]): number {
  let vol = 0;
  for (const f of faces)
    for (const l of f.loops)
      for (let i = 1; i + 1 < l.length; i++)
        vol += dot(pts[l[0]!]!, cross(pts[l[i]!]!, pts[l[i + 1]!]!)) / 6;
  return vol;
}

export type BoolOp = 'union' | 'subtract' | 'intersect';

/**
 * A boolean of two solids, as polygon shells in `frame` (operand 0's by default).
 * Null when an operand isn't a closed solid manifold will take, or the result
 * wouldn't come back as sound shells: the caller then leaves things as they were.
 */
export function booleanSolids(
  a: Solid,
  b: Solid,
  op: BoolOp,
  frame: Mat4 = a.xform,
): ResultShell[] | null {
  const ta = toManifold(a, 0, frame);
  if (!ta) return null;
  const tb = toManifold(b, ta.faces.length, null);
  if (!tb) {
    ta.manifold.delete();
    return null;
  }
  const r =
    op === 'union'
      ? ta.manifold.add(tb.manifold)
      : op === 'subtract'
        ? ta.manifold.subtract(tb.manifold)
        : ta.manifold.intersect(tb.manifold);
  try {
    return attempt(() => fromManifold(r, [ta, tb], frame, []));
  } finally {
    r.delete();
    ta.manifold.delete();
    tb.manifold.delete();
  }
}

/** A solid made ready for overlap tests, in its own frame. Free it with dispose(). */
export interface SolidMesh {
  dispose(): void;
}

class Meshed implements SolidMesh {
  constructor(readonly manifold: Manifold) {}
  dispose(): void {
    this.manifold.delete();
  }
}

const IDENTITY: Mat4 = mat4.identity();

/** A B-rep made ready for overlap tests; null if it isn't a closed solid manifold will take. */
export function solidMesh(brep: Brep): SolidMesh | null {
  const t = toManifold({ brep, xform: IDENTITY }, 0, null);
  return t ? new Meshed(t.manifold) : null;
}

/**
 * Whether two solids, each placed by its xform, share some volume (more than
 * `minVolume`): one that only touches the other, or misses it, doesn't overlap.
 */
export function solidsOverlap(
  a: SolidMesh,
  xa: Mat4,
  b: SolidMesh,
  xb: Mat4,
  minVolume = 1e-3,
): boolean {
  const pa = (a as Meshed).manifold.transform(xa as unknown as ManifoldMat4);
  const pb = (b as Meshed).manifold.transform(xb as unknown as ManifoldMat4);
  const r = pa.intersect(pb);
  try {
    return !r.isEmpty() && r.volume() > minVolume;
  } finally {
    r.delete();
    pa.delete();
    pb.delete();
  }
}

/**
 * A solid cut by the plane z = `z` (in the room): the shells behind it and the
 * shells in front, each in the solid's own frame. Null if it isn't a closed solid.
 */
export function sliceSolid(
  s: Solid,
  z: number,
): { back: ResultShell[]; front: ResultShell[] } | null {
  const t = toManifold(s, 0, s.xform);
  if (!t) return null;
  const [front, back] = t.manifold.splitByPlane([0, 0, 1], z);
  const cap: Plane[] = [
    { n: [0, 0, 1], d: z },
    { n: [0, 0, -1], d: -z },
  ];
  try {
    const b = attempt(() => fromManifold(back, [t], s.xform, cap));
    const f = attempt(() => fromManifold(front, [t], s.xform, cap));
    return b && f ? { back: b, front: f } : null;
  } finally {
    front.delete();
    back.delete();
    t.manifold.delete();
  }
}

/**
 * A closed outline that crosses itself made simple: the region it encloses
 * (non-zero winding), and of that the largest piece's outer boundary,
 * anticlockwise. Null if it encloses nothing.
 */
export function simpleOutline(
  points: readonly (readonly [number, number])[],
): [number, number][] | null {
  const M = lib();
  const cs = new M.CrossSection([points.map((p) => [p[0], p[1]] as [number, number])], 'NonZero');
  try {
    let best: [number, number][] | null = null;
    let bestArea = 0;
    for (const piece of cs.decompose()) {
      const a = piece.area();
      const outer = piece.toPolygons().find((loop) => signedArea2(loop) > 0);
      piece.delete();
      if (outer && a > bestArea) {
        best = outer.map((p) => [p[0], p[1]]);
        bestArea = a;
      }
    }
    return best;
  } finally {
    cs.delete();
  }
}

function signedArea2(loop: readonly (readonly number[])[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]!;
    const q = loop[(i + 1) % loop.length]!;
    a += p[0]! * q[1]! - q[0]! * p[1]!;
  }
  return a / 2;
}
