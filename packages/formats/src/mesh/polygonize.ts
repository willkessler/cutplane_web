import {
  Brep,
  buildShell,
  createObject,
  mat4,
  type CutObject,
  type Mat4,
  type Rgb,
} from '@cutplane/kernel';
import { roomBox } from './fit.ts';
import { flattener, newell, type V3 } from './faces.ts';

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
  /** Local → room placement (rigid) when the format had one; the positions are local. */
  xform?: Mat4;
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

/** Positions that are equal to within `tol` become one vertex. */
function weld(positions: readonly V3[], tol: number): { points: V3[]; index: Int32Array } {
  const cells = new Map<string, number[]>();
  const points: V3[] = [];
  const index = new Int32Array(positions.length);
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  positions.forEach((p, i) => {
    const c = p.map((v) => Math.round(v / tol));
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++)
      for (let dy = -1; dy <= 1 && found < 0; dy++)
        for (let dz = -1; dz <= 1 && found < 0; dz++)
          for (const j of cells.get(key(c[0]! + dx, c[1]! + dy, c[2]! + dz)) ?? []) {
            const q = points[j]!;
            if (
              Math.abs(q[0] - p[0]) <= tol &&
              Math.abs(q[1] - p[1]) <= tol &&
              Math.abs(q[2] - p[2]) <= tol
            ) {
              found = j;
              break;
            }
          }
    if (found < 0) {
      found = points.length;
      points.push([p[0], p[1], p[2]]);
      const k = key(c[0]!, c[1]!, c[2]!);
      const list = cells.get(k);
      if (list) list.push(found);
      else cells.set(k, [found]);
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

const sameColor = (a: Rgb | null, b: Rgb | null) =>
  a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);

/**
 * The faces a group of coplanar pieces makes: its boundary chained into loops,
 * the outer one first. Null when the boundary isn't simple (it pinches), so the
 * pieces stay as they are.
 */
function mergeGroup(pieces: readonly Piece[], points: readonly V3[]): number[][] | null {
  if (pieces.length === 1) return [pieces[0]!.loop];
  const edges = new Set<string>();
  for (const p of pieces)
    p.loop.forEach((v, i) => edges.add(`${v},${p.loop[(i + 1) % p.loop.length]}`));
  const next = new Map<number, number>();
  for (const e of edges) {
    const [a, b] = e.split(',').map(Number) as [number, number];
    if (edges.has(`${b},${a}`)) continue; // inside the group
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
 * A mesh made into a solid the way Cutplane keeps them: equal positions welded
 * into shared vertices, and triangles that lie in one plane (and share a
 * colour) joined into one polygon face, holes and all. Each connected piece
 * becomes a shell.
 * Null when nothing with area is left.
 */
export function polygonize(soup: Soup): CutObject | null {
  const span = soup.positions.reduce(
    (m, p) => Math.max(m, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])),
    0,
  );
  const tol = Math.max(span * 1e-9, 1e-9);
  const { points, index } = weld(soup.positions, tol);

  // Pieces: the polygons, welded, without repeated corners or zero area.
  const pieces: Piece[] = [];
  soup.polygons.forEach((poly, i) => {
    const loop: number[] = [];
    for (const v of poly) {
      const w = index[v];
      if (w === undefined) continue;
      if (loop[loop.length - 1] !== w) loop.push(w);
    }
    while (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop.pop();
    if (new Set(loop).size !== loop.length || loop.length < 3) return;
    const nn = newell(loop.map((v) => points[v]!));
    const len = Math.hypot(...nn);
    if (len < tol * tol) return;
    const n: V3 = [nn[0] / len, nn[1] / len, nn[2] / len];
    const p0 = points[loop[0]!]!;
    const d = n[0] * p0[0] + n[1] * p0[1] + n[2] * p0[2];
    pieces.push({ loop, face: soup.faces?.[i], n, d, color: soup.colors?.[i] ?? null });
  });
  if (pieces.length === 0) return null;

  // Coplanar neighbours across an edge only they share join one group.
  const byEdge = new Map<string, number[]>();
  pieces.forEach((p, i) =>
    p.loop.forEach((a, k) => {
      const b = p.loop[(k + 1) % p.loop.length]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const list = byEdge.get(key);
      if (list) list.push(i);
      else byEdge.set(key, [i]);
    }),
  );
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
  for (const list of soup.faces ? [] : byEdge.values()) {
    if (list.length !== 2) continue;
    const [p, q] = [pieces[list[0]!]!, pieces[list[1]!]!];
    const dot = p.n[0] * q.n[0] + p.n[1] * q.n[1] + p.n[2] * q.n[2];
    if (dot > PARALLEL && Math.abs(p.d - q.d) < dist && sameColor(p.color, q.color))
      groups.join(list[0]!, list[1]!);
  }
  const members = new Map<number, Piece[]>();
  pieces.forEach((p, i) => {
    const g = groups.find(i);
    const list = members.get(g);
    if (list) list.push(p);
    else members.set(g, [p]);
  });
  const faces: { loops: number[][]; color: Rgb | null }[] = [];
  for (const list of members.values()) {
    const merged = mergeGroup(list, points);
    if (merged) faces.push({ loops: merged, color: list[0]!.color });
    else for (const p of list) faces.push({ loops: [p.loop], color: p.color });
  }

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
  return createObject(brep, {
    name: soup.name,
    ...(main ? { color: [...main] } : {}),
    ...(soup.xform ? { xform: soup.xform } : {}),
  });
}

/**
 * Soups and their children as objects. One with no faces that holds two or
 * more becomes their grouper; otherwise what it holds takes its place.
 */
export function soupObjects(soups: readonly Soup[]): CutObject[] {
  const out: CutObject[] = [];
  for (const s of soups) {
    const o = polygonize(s);
    const kids = soupObjects(s.children ?? []);
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
