import { newell, type V3 } from './faces.ts';
import type { Soup } from './polygonize.ts';

/** Of a terrain's area, how much faces along its up. */
const FACING = 0.7;
/** Fewer polygons than this is a picture or a sign, not ground. */
const GROUND = 1000;
/** How far below its lowest point a terrain's slab goes, of its width. */
const SLAB = 0.05;

/**
 * Turns a terrain made with Z up (JPL's Mars meshes; Z points down there)
 * so it lies on the room's floor, Y up: an open sheet of many faces nearly all
 * facing one way along Z. A solid's faces face every way, so no solid is
 * turned. Those turned are marked to stand on a slab (see `slab`). Returns
 * whether it turned them.
 */
export function layFlat(soups: Soup[]): boolean {
  const sum = [0, 0, 0];
  let area = 0;
  let count = 0;
  const walk = (list: readonly Soup[]) => {
    for (const s of list) {
      if (!s.unordered && !s.xform)
        for (const poly of s.polygons) {
          const n = newell(poly.map((k) => s.positions[k]!));
          for (let k = 0; k < 3; k++) sum[k]! += n[k]!;
          area += Math.hypot(n[0], n[1], n[2]);
          count++;
        }
      walk(s.children ?? []);
    }
  };
  walk(soups);
  const [x, y, z] = sum.map(Math.abs) as [number, number, number];
  if (count < GROUND || !(z >= FACING * area) || z < x || z < y) return false;
  // A quarter turn about X takes the way the faces face to Y: (x, y, z) to (x, −z, y) or (x, z, −y).
  const down = sum[2]! < 0;
  const turn = (list: Soup[]) => {
    for (const s of list) {
      s.positions = s.positions.map(([px, py, pz]) => (down ? [px, 0 - pz, py] : [px, pz, 0 - py]));
      if (s.polygons.length) s.slab = true;
      turn(s.children ?? []);
    }
  };
  turn(soups);
  return true;
}

/**
 * A terrain stood on a slab, as a block of ground is cut out: its outer edge
 * taken straight down to a flat bottom a little below its lowest point. Closing
 * that edge with one face instead (as other holes are closed) would cut up
 * through the ground, the edge being far from flat. Each side takes the
 * texture of the edge above it. Done once simplified (which keeps the edge
 * where it was), before the texture is painted on.
 */
export function slab(s: Soup): Soup {
  if (!s.slab) return s;
  const rest: Soup = { ...s };
  delete rest.slab;
  // Corners at one place are one corner.
  const same = new Map<string, number>();
  const canon = s.positions.map((p, i) => {
    const k = p.join();
    const c = same.get(k);
    if (c !== undefined) return c;
    same.set(k, i);
    return i;
  });
  const N = s.positions.length;
  const edges = new Set<number>();
  for (const poly of s.polygons)
    poly.forEach((a, i) => edges.add(canon[a]! * N + canon[poly[(i + 1) % poly.length]!]!));
  // The edges no face goes back along: the sheet's borders, each followed round its loop.
  const next = new Map<number, number>();
  for (const e of edges) {
    const a = Math.floor(e / N);
    const b = e % N;
    if (!edges.has(b * N + a)) next.set(a, b);
  }
  let outer: number[] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    for (let v: number | undefined = start; v !== undefined && !seen.has(v); v = next.get(v)) {
      seen.add(v);
      loop.push(v);
    }
    if (loop.length > outer.length) outer = loop;
  }
  if (outer.length < 3) return rest;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of s.positions)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p[k]!);
      max[k] = Math.max(max[k]!, p[k]!);
    }
  const lo = min[1]! - SLAB * Math.max(max[0]! - min[0]!, max[2]! - min[2]!);
  const positions: V3[] = [...s.positions];
  const uvs = s.uvs && [...s.uvs];
  const under = outer.map((v) => {
    const p = s.positions[v]!;
    uvs?.push(s.uvs![v] ?? null);
    return positions.push([p[0], lo, p[2]]) - 1;
  });
  const polygons = [...s.polygons];
  // Each border edge a → b gets a side going back along it, b → a, and down.
  outer.forEach((a, i) => {
    const j = (i + 1) % outer.length;
    polygons.push([outer[j]!, a, under[i]!, under[j]!]);
  });
  polygons.push([...under].reverse()); // the bottom
  const colors = s.colors && [...s.colors, ...Array<null>(polygons.length - s.polygons.length).fill(null)]; // prettier-ignore
  const out: Soup = { ...rest, positions, polygons, ...(colors ? { colors } : {}), ...(uvs ? { uvs } : {}) }; // prettier-ignore
  delete out.faces;
  return out;
}
