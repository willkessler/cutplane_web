import {
  Brep,
  buildShell,
  createObject,
  mat4,
  PairMap,
  type CutObject,
  type Mat4,
  type Rgb,
} from '@cutplane/kernel';
import { roomBox } from './fit.ts';
import { flattener, newell, triangulate, type V3 } from './faces.ts';
import { part, type MeshOptions, type Progress } from './options.ts';
import { polygonCount, simplifySoups } from './simplify.ts';
import { slab } from './terrain.ts';
import { paintSoups } from './texture.ts';
import type { Pixels } from './gltf.ts';

/** Terrains stood on their slabs (see terrain.ts). */
const slabs = (list: readonly Soup[]): Soup[] =>
  list.map((s) => {
    const out = slab(s);
    return s.children ? { ...out, children: slabs(s.children) } : out;
  });

/**
 * A mesh as the formats hand it over: positions and polygons (often
 * triangles) indexing them, with an optional colour per polygon.
 */
export interface Soup {
  name: string | null;
  positions: V3[];
  polygons: number[][];
  colors?: (Rgb | null)[];
  /** The face each polygon belongs to, when the format kept it: these join, and only these. */
  faces?: number[];
  /** The format doesn't say which way faces wind (Inventor's UNKNOWN_ORDERING, DXF): turn each piece outward. */
  unordered?: boolean;
  /** Local → room placement (rigid) when the format had one; the positions are local. */
  xform?: Mat4;
  /**
   * A texture, and where each position is on it ((0, 0) its top left): each
   * polygon is coloured from it once simplified (see texture.ts), its colour
   * then the texture's times its own.
   */
  texture?: Pixels;
  uvs?: (readonly [number, number] | null)[];
  /** A terrain, to stand on a slab of ground (terrain.ts). */
  slab?: boolean;
  /** Its colours are a photo's (painted from its texture): its object is lit softly. */
  photo?: boolean;
  children?: Soup[];
}

/**
 * group.cpl's grouper: the object a group's members hang under, a single
 * point with no faces to draw, placed in the middle of what it holds.
 */
export function grouper(name: string | null, members: readonly CutObject[]): CutObject {
  const box = roomBox(members);
  const at = box ? [0, 1, 2].map((k) => (box.lo[k]! + box.hi[k]!) / 2) : [0, 0, 0];
  const brep = new Brep();
  buildShell(brep, { positions: [[0, 0, 0]], faces: [[[0]]] });
  const o = createObject(brep, {
    name,
    attrs: { props: ['Nonmanifold', 'Grouper', 'Noshadow', 'Forcedcpnormal', 'Visible'] },
    xform: mat4.translation(at[0]!, at[1]!, at[2]!),
  });
  for (const m of members) {
    m.parent = o;
    m.linked = false;
    o.children.push(m);
  }
  return o;
}

/** Neighbours this close to one plane (normals within ~0.06°) merge into one face. */
const PARALLEL = 1 - 5e-7;

class Sets {
  private readonly up: Int32Array;
  constructor(n: number) {
    this.up = new Int32Array(n).map((_, i) => i);
  }
  find(i: number): number {
    const up = this.up;
    while (up[i] !== i) i = up[i] = up[up[i]!]!;
    return i;
  }
  join(a: number, b: number): void {
    this.up[this.find(a)] = this.find(b);
  }
}

/** A grid cell as one non-negative number: a hash, so two cells may share one (the distance check sorts them out). */
const cell = (x: number, y: number, z: number) =>
  (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791)) &
  0x7fffffff;

/** Positions that are equal to within `tol` become one vertex. */
function weld(positions: readonly V3[], tol: number): { points: V3[]; index: Int32Array } {
  // Each cell's points: the first in `cells`, then on through `after`.
  const cells = new PairMap(positions.length);
  const after = new Int32Array(positions.length);
  const points: V3[] = [];
  const index = new Int32Array(positions.length);
  const near = (p: V3, q: V3) =>
    Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol && Math.abs(q[2] - p[2]) <= tol;
  const inCell = (p: V3, x: number, y: number, z: number) => {
    for (let j = cells.get(cell(x, y, z), 0); j >= 0; j = after[j]!)
      if (near(p, points[j]!)) return j;
    return -1;
  };
  positions.forEach((p, i) => {
    const x = Math.round(p[0] / tol);
    const y = Math.round(p[1] / tol);
    const z = Math.round(p[2] / tol);
    // Its own cell first (most likely), then the ones round it.
    let found = inCell(p, x, y, z);
    for (let dx = -1; dx <= 1 && found < 0; dx++)
      for (let dy = -1; dy <= 1 && found < 0; dy++)
        for (let dz = -1; dz <= 1 && found < 0; dz++)
          if (dx || dy || dz) found = inCell(p, x + dx, y + dy, z + dz);
    if (found < 0) {
      found = points.length;
      points.push([p[0], p[1], p[2]]);
      const e = cells.add(cell(x, y, z), 0, -1);
      after[found] = cells.value[e]!;
      cells.value[e] = found;
    }
    index[i] = found;
  });
  return { points, index };
}

interface Piece {
  loop: number[];
  face: number | undefined;
  n: V3;
  d: number;
  color: Rgb | null;
}

/** Two loops with the same corners, in whatever order. */
const sameCorners = (a: readonly number[], b: readonly number[]) => {
  if (a.length !== b.length) return false;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.every((v, k) => v === y[k]);
};

const sameColor = (a: Rgb | null, b: Rgb | null) =>
  a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);

/**
 * The faces a group of coplanar pieces makes: its boundary chained into loops,
 * the outer one first. Null when the boundary isn't simple (it pinches), so the
 * pieces stay as they are.
 */
function mergeGroup(pieces: readonly Piece[], points: readonly V3[]): number[][] | null {
  if (pieces.length === 1) return [pieces[0]!.loop];
  const edges = new PairMap();
  for (const p of pieces) p.loop.forEach((v, i) => edges.add(v, p.loop[(i + 1) % p.loop.length]!));
  const next = new Map<number, number>();
  for (let e = 0; e < edges.size; e++) {
    const a = edges.a[e]!;
    const b = edges.b[e]!;
    if (edges.has(b, a)) continue; // inside the group
    if (next.has(a)) return null; // two ways on from one vertex
    next.set(a, b);
  }
  const loops: number[][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    for (let v = start; !seen.has(v); v = next.get(v)!) {
      if (!next.has(v)) return null;
      seen.add(v);
      loop.push(v);
    }
    if (loop[0] !== start || next.get(loop[loop.length - 1]!) !== start) return null;
    loops.push(loop);
  }
  const n = pieces[0]!.n;
  const flat = flattener(n);
  const axis = Math.abs(n[2]) >= Math.abs(n[0]) && Math.abs(n[2]) >= Math.abs(n[1]) ? 2 : Math.abs(n[0]) >= Math.abs(n[1]) ? 0 : 1; // prettier-ignore
  const sign = n[axis]! >= 0 ? 1 : -1;
  const area = (l: number[]) => {
    let s = 0;
    l.forEach((v, i) => {
      const [x0, y0] = flat(points[v]!);
      const [x1, y1] = flat(points[l[(i + 1) % l.length]!]!);
      s += x0 * y1 - x1 * y0;
    });
    return (s / 2) * sign;
  };
  const outer = loops.filter((l) => area(l) > 0);
  if (outer.length !== 1) return null;
  return [outer[0]!, ...loops.filter((l) => l !== outer[0])];
}

/**
 * The pieces round each edge, either way along it: how many, and the first
 * two (enough for an edge between two; more is a fold, which nothing joins across).
 */
class EdgePieces {
  readonly edges: PairMap;
  readonly first: Int32Array;
  readonly second: Int32Array;
  constructor(pieces: readonly Piece[]) {
    let n = 0;
    for (const p of pieces) n += p.loop.length;
    const edges = (this.edges = new PairMap(n));
    this.first = new Int32Array(n);
    this.second = new Int32Array(n);
    pieces.forEach((p, i) =>
      p.loop.forEach((a, k) => {
        const b = p.loop[(k + 1) % p.loop.length]!;
        const e = a < b ? edges.add(a, b) : edges.add(b, a);
        const count = edges.value[e]!++;
        if (count === 0) this.first[e] = i;
        else if (count === 1) this.second[e] = i;
      }),
    );
  }
  /** The edge between a and b (either way). */
  of(a: number, b: number): number {
    return a < b ? this.edges.entry(a, b) : this.edges.entry(b, a);
  }
  count(e: number): number {
    return this.edges.value[e]!;
  }
}

/**
 * Turns pieces to wind like their neighbours: across an edge two pieces
 * share, each runs it the other way. With `outward`, each connected part is
 * then turned so it encloses positive volume.
 */
function orient(pieces: Piece[], points: readonly V3[], outward: boolean): void {
  const flip = (p: Piece) => {
    p.loop.reverse();
    p.n = [-p.n[0], -p.n[1], -p.n[2]];
    p.d = -p.d;
  };
  const byEdge = new EdgePieces(pieces);
  const runs = (p: Piece, a: number, b: number) =>
    p.loop.some((v, k) => v === a && p.loop[(k + 1) % p.loop.length] === b);
  const seen = new Uint8Array(pieces.length);
  for (let start = 0; start < pieces.length; start++) {
    if (seen[start]) continue;
    seen[start] = 1;
    const part = [start];
    for (let q = 0; q < part.length; q++) {
      const p = pieces[part[q]!]!;
      p.loop.forEach((a, k) => {
        const b = p.loop[(k + 1) % p.loop.length]!;
        const e = byEdge.of(a, b);
        if (byEdge.count(e) !== 2) return; // a fold of three or more: no way to agree
        const j = byEdge.first[e] === part[q] ? byEdge.second[e]! : byEdge.first[e]!;
        if (seen[j]) return;
        seen[j] = 1;
        if (runs(pieces[j]!, a, b)) flip(pieces[j]!);
        part.push(j);
      });
    }
    if (!outward) continue;
    let vol = 0;
    for (const i of part) {
      const l = pieces[i]!.loop.map((v) => points[v]!);
      for (let k = 1; k + 1 < l.length; k++) {
        const [p, q, r] = [l[0]!, l[k]!, l[k + 1]!];
        vol += p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0]); // prettier-ignore
      }
    }
    if (vol < 0) for (const i of part) flip(pieces[i]!);
  }
}

/** How many holes an import closed, by object (shown when it comes in). */
export const holesClosed = new WeakMap<CutObject, number>();

type Face = { loops: number[][]; color: Rgb | null };

/**
 * Stitches T-junctions: where a corner of one face lies on the middle of an
 * edge that has a face on one side only, the corner goes into that edge, so
 * the two sides meet edge to edge instead of leaving a slit. Returns how many.
 */
function stitch(faces: Face[], points: readonly V3[], dist: number): number {
  const sides = new PairMap();
  for (const f of faces)
    for (const l of f.loops) l.forEach((a, k) => sides.add(a, l[(k + 1) % l.length]!));
  const open: [number, number][] = [];
  for (let e = 0; e < sides.size; e++) {
    const [a, b] = [sides.a[e]!, sides.b[e]!];
    if (!sides.has(b, a)) open.push([a, b]);
  }
  const ends = [...new Set(open.flat())];
  // Too many to compare pairwise: leave the slits.
  if (open.length * ends.length > 4e7) return 0;
  const on = new PairMap(); // an edge → its place in `inserts`
  const inserts: number[][] = [];
  let count = 0;
  for (const [a, b] of open) {
    const p = points[a]!;
    const q = points[b]!;
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const len2 = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
    if (len2 === 0) continue;
    const lo = [0, 1, 2].map((k) => Math.min(p[k]!, q[k]!) - dist);
    const hi = [0, 1, 2].map((k) => Math.max(p[k]!, q[k]!) + dist);
    const found: [number, number][] = [];
    for (const v of ends) {
      if (v === a || v === b) continue;
      const r = points[v]!;
      if (r[0] < lo[0]! || r[0] > hi[0]! || r[1] < lo[1]! || r[1] > hi[1]! || r[2] < lo[2]! || r[2] > hi[2]!) continue; // prettier-ignore
      const t = ((r[0] - p[0]) * d[0]! + (r[1] - p[1]) * d[1]! + (r[2] - p[2]) * d[2]!) / len2;
      if (t <= 0 || t >= 1) continue;
      const off = Math.hypot(
        p[0] + t * d[0]! - r[0],
        p[1] + t * d[1]! - r[1],
        p[2] + t * d[2]! - r[2],
      );
      if (off <= dist) found.push([t, v]);
    }
    if (found.length) {
      on.set(a, b, inserts.length);
      inserts.push(found.sort((x, y) => x[0] - y[0]).map(([, v]) => v));
      count += found.length;
    }
  }
  if (count === 0) return 0;
  for (const f of faces)
    f.loops = f.loops.map((l) =>
      l.flatMap((a, k) => {
        const at = on.get(a, l[(k + 1) % l.length]!);
        return at < 0 ? [a] : [a, ...inserts[at]!];
      }),
    );
  return count;
}

/**
 * Closes the holes in a mesh that isn't a solid (a car body made of open
 * sheets, a wheel open on the inside): each run of edges with a face on one
 * side only is chained into a loop, and the loop gets a face of its own, one
 * polygon if it's flat, else its triangles. Cutplane picks an object from
 * inside its section, which only closes round a solid. Returns how many.
 */
function closeHoles(faces: Face[], points: V3[], dist: number): number {
  const sides = new PairMap(); // each side → the face it's a side of
  faces.forEach((f, i) => {
    for (const l of f.loops) l.forEach((a, k) => sides.set(a, l[(k + 1) % l.length]!, i));
  });
  // The cap runs each open edge the other way.
  const out = new Map<number, number[]>();
  const colorAt = new PairMap(); // a cap's side → the face across it
  for (let e = 0; e < sides.size; e++) {
    const [a, b] = [sides.a[e]!, sides.b[e]!];
    if (sides.has(b, a)) continue;
    const list = out.get(b);
    if (list) list.push(a);
    else out.set(b, [a]);
    colorAt.set(b, a, sides.value[e]!);
  }
  const loops: number[][] = [];
  for (const start of [...out.keys()]) {
    while (out.get(start)?.length) {
      const loop = [start];
      const place = new Map([[start, 0]]); // where each vertex is in the loop
      let v = out.get(start)!.pop()!;
      let ok = true;
      while (v !== start) {
        const at = place.get(v);
        if (at !== undefined) {
          // It pinches here: that part is a hole of its own.
          const part = loop.splice(at);
          for (const w of part) place.delete(w);
          loops.push(part);
        }
        place.set(v, loop.length);
        loop.push(v);
        const next = out.get(v)?.pop();
        if (next === undefined) {
          ok = false;
          break;
        }
        v = next;
      }
      if (ok) loops.push(loop);
    }
  }
  let closed = 0;
  for (const loop of loops) {
    if (loop.length < 3) continue;
    const pts = loop.map((i) => points[i]!);
    const nn = newell(pts);
    const len = Math.hypot(...nn);
    if (len === 0) continue;
    const n: V3 = [nn[0] / len, nn[1] / len, nn[2] / len];
    const d = n[0] * pts[0]![0] + n[1] * pts[0]![1] + n[2] * pts[0]![2];
    const across = colorAt.get(loop[0]!, loop[1]!);
    const color = across < 0 ? null : faces[across]!.color;
    const flat = pts.every((p) => Math.abs(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d) <= dist);
    if (flat) faces.push({ loops: [loop], color });
    else {
      // Its triangles, if it flattens without overlapping itself; else a fan from its middle.
      const tris = triangulate([pts], n);
      if (tris.length === loop.length - 2)
        for (const t of tris) faces.push({ loops: [t.map((k) => loop[k]!)], color });
      else {
        const mid = points.length;
        points.push(
          [0, 1, 2].map((k) => pts.reduce((sum, p) => sum + p[k]!, 0) / pts.length) as V3,
        );
        loop.forEach((a, k) =>
          faces.push({ loops: [[a, loop[(k + 1) % loop.length]!, mid]], color }),
        );
      }
    }
    closed++;
  }
  return closed;
}

/**
 * A mesh made into a solid the way Cutplane keeps them: equal positions welded
 * into shared vertices, and triangles that lie in one plane (and share a
 * colour) joined into one polygon face, holes and all, and any holes in the
 * surface closed. Each connected piece becomes a shell.
 * Null when nothing with area is left.
 */
export function polygonize(soup: Soup, progress?: Progress): CutObject | null {
  const span = soup.positions.reduce(
    (m, p) => Math.max(m, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])),
    0,
  );
  const tol = Math.max(span * 1e-9, 1e-9);
  const { points, index } = weld(soup.positions, tol);
  progress?.(0.15);

  // Pieces: the polygons, welded, without repeated corners or zero area.
  const pieces: Piece[] = [];
  // The same corners twice (either way round) is one face drawn twice: kept once.
  const corners = new Map<number, number[][]>(); // by a hash of the sorted corners
  soup.polygons.forEach((poly, i) => {
    const loop: number[] = [];
    for (const v of poly) {
      const w = index[v];
      if (w === undefined) continue;
      if (loop[loop.length - 1] !== w) loop.push(w);
    }
    while (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop.pop();
    if (new Set(loop).size !== loop.length || loop.length < 3) return;
    // A hash that doesn't depend on the order of the corners (a sum), so nothing is sorted
    // unless two polygons share it.
    let key = loop.length;
    for (const v of loop) key = (key + Math.imul(v ^ (v >>> 13), 0x9e3779b1)) | 0;
    key &= 0x3fffffff;
    const same = corners.get(key);
    if (same?.some((c) => sameCorners(c, loop))) return;
    if (same) same.push(loop);
    else corners.set(key, [loop]);
    const nn = newell(loop.map((v) => points[v]!));
    const len = Math.hypot(...nn);
    if (len < tol * tol) return;
    const n: V3 = [nn[0] / len, nn[1] / len, nn[2] / len];
    const p0 = points[loop[0]!]!;
    const d = n[0] * p0[0] + n[1] * p0[1] + n[2] * p0[2];
    pieces.push({ loop, face: soup.faces?.[i], n, d, color: soup.colors?.[i] ?? null });
  });
  if (pieces.length === 0) return null;
  progress?.(0.25);
  orient(pieces, points, soup.unordered ?? false);
  progress?.(0.4);

  // Coplanar neighbours across an edge only they share join one group.
  const byEdge = new EdgePieces(pieces);
  const groups = new Sets(pieces.length);
  if (soup.faces) {
    const first = new Map<number, number>();
    pieces.forEach((p, i) => {
      const f = first.get(p.face!);
      if (f === undefined) first.set(p.face!, i);
      else groups.join(i, f);
    });
  }
  const dist = Math.max(span * 1e-6, 1e-7); // offsets apart by float32 rounding at most
  for (let e = 0; !soup.faces && e < byEdge.edges.size; e++) {
    if (byEdge.count(e) !== 2) continue;
    const [i, j] = [byEdge.first[e]!, byEdge.second[e]!];
    const [p, q] = [pieces[i]!, pieces[j]!];
    const dot = p.n[0] * q.n[0] + p.n[1] * q.n[1] + p.n[2] * q.n[2];
    if (dot > PARALLEL && Math.abs(p.d - q.d) < dist && sameColor(p.color, q.color))
      groups.join(i, j);
  }
  const members = new Map<number, Piece[]>();
  pieces.forEach((p, i) => {
    const g = groups.find(i);
    const list = members.get(g);
    if (list) list.push(p);
    else members.set(g, [p]);
  });
  const faces: Face[] = [];
  for (const list of members.values()) {
    const merged = mergeGroup(list, points);
    if (merged) faces.push({ loops: merged, color: list[0]!.color });
    else for (const p of list) faces.push({ loops: [p.loop], color: p.color });
  }
  progress?.(0.55);
  stitch(faces, points, Math.max(dist * 10, span * 1e-5));
  progress?.(0.65);
  const holes = closeHoles(faces, points, dist);
  progress?.(0.75);

  // Each connected piece is a shell.
  const shells = new Sets(points.length);
  for (const f of faces) for (const l of f.loops) for (const v of l) shells.join(v, l[0]!);
  for (const f of faces) for (const l of f.loops.slice(1)) shells.join(l[0]!, f.loops[0]![0]!);
  const byShell = new Map<number, typeof faces>();
  for (const f of faces) {
    const s = shells.find(f.loops[0]![0]!);
    const list = byShell.get(s);
    if (list) list.push(f);
    else byShell.set(s, [f]);
  }

  // The colour most faces have is the object's; the others are painted on their faces.
  const counts = new Map<string, { c: Rgb; n: number }>();
  for (const f of faces)
    if (f.color) {
      const k = f.color.join(',');
      const e = counts.get(k);
      if (e) e.n++;
      else counts.set(k, { c: f.color, n: 1 });
    }
  const main = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.c ?? null;

  const brep = new Brep();
  for (const list of byShell.values()) {
    const used = new Map<number, number>();
    const positions: V3[] = [];
    const at = (v: number) => {
      let i = used.get(v);
      if (i === undefined) {
        i = positions.length;
        used.set(v, i);
        positions.push(points[v]!);
      }
      return i;
    };
    const loops = list.map((f) => f.loops.map((l) => l.map(at)));
    const built = buildShell(brep, { positions, faces: loops });
    list.forEach((f, i) => {
      if (f.color && main && !sameColor(f.color, main))
        brep.faceColors.set(built.faces[i]!, [...f.color]);
    });
  }
  const o = createObject(brep, {
    name: soup.name,
    ...(main ? { color: [...main] } : {}),
    ...(soup.xform ? { xform: soup.xform } : {}),
    ...(soup.photo ? { attrs: { props: ['Visible'], photo: true } } : {}),
  });
  if (holes) holesClosed.set(o, holes);
  return o;
}

/**
 * Soups and their children as objects. One with no faces that holds two or
 * more becomes their grouper; otherwise what it holds takes its place.
 */
export function soupObjects(soups: readonly Soup[], opts: MeshOptions = {}): CutObject[] {
  const { progress, budget } = opts;
  if (budget !== undefined) {
    const from = polygonCount(soups);
    if (from > budget) {
      soups = simplifySoups(soups, budget / from);
      opts.simplified?.(from, polygonCount(soups));
    }
  }
  soups = paintSoups(slabs(soups));
  if (!progress) return objectsOf(soups);
  const size = (list: readonly Soup[]): number =>
    list.reduce((n, s) => n + s.polygons.length + size(s.children ?? []), 0);
  const total = Math.max(1, size(soups));
  let done = 0;
  const out = objectsOf(soups, (s) => {
    const p = part(progress, done / total, (done + s.polygons.length) / total);
    done += s.polygons.length;
    return p;
  });
  progress(1);
  return out;
}

function objectsOf(
  soups: readonly Soup[],
  progressOf?: (s: Soup) => Progress | undefined,
): CutObject[] {
  const out: CutObject[] = [];
  for (const s of soups) {
    const o = polygonize(s, progressOf?.(s));
    const kids = objectsOf(s.children ?? [], progressOf);
    if (!o) {
      if (kids.length >= 2) out.push(grouper(s.name, kids));
      else out.push(...kids);
      continue;
    }
    for (const k of kids) {
      k.parent = o;
      k.linked = false;
      o.children.push(k);
    }
    out.push(o);
  }
  return out;
}
