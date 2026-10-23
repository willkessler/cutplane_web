import { MeshoptSimplifier } from 'meshoptimizer';
import type { Rgb } from '@cutplane/kernel';
import type { Soup } from './polygonize.ts';

/**
 * Simplifying meshes too big to work with: a scan or a CAD export of millions
 * of triangles comes in with fewer (meshoptimizer's simplifier, which collapses
 * edges where that moves the surface least), so that it can be cut, carried
 * and undone without the browser stopping.
 */

let ready = false;
const loading = MeshoptSimplifier.ready.then(() => {
  ready = true;
});
/** Resolves once the simplifier (WebAssembly) has loaded; a budget needs it. */
export const simplifierReady = (): Promise<void> => loading;

/**
 * Polygons in soups and their children: about the faces they come in as (a
 * quad is one face; triangles in one plane join, so it's at most that).
 */
export function polygonCount(soups: readonly Soup[]): number {
  let n = 0;
  for (const s of soups) n += s.polygons.length + polygonCount(s.children ?? []);
  return n;
}

/** Below this many polygons a mesh is left as it is. */
const SMALL = 200;

/** Soups with about `keep` (0 to 1) of their polygons each, as triangles. */
export function simplifySoups(soups: readonly Soup[], keep: number): Soup[] {
  return soups.map((s) => {
    const kids = simplifySoups(s.children ?? [], keep);
    const out = s.polygons.length < SMALL ? { ...s } : simplifySoup(s, keep);
    if (s.children) out.children = kids;
    return out;
  });
}

function simplifySoup(s: Soup, keep: number): Soup {
  if (!ready) throw new Error('the mesh simplifier has not loaded (await simplifierReady())');
  const n = s.positions.length;
  const pos = new Float32Array(n * 3);
  s.positions.forEach((p, i) => pos.set(p, i * 3));
  // Corners at one place are one vertex, so the simplifier sees the surface whole.
  const same = MeshoptSimplifier.generatePositionRemap(pos, 3);
  // ...and only those vertices are handed over: an STL's corners are three a triangle,
  // and given millions of them unused, the simplifier quietly collapses nothing.
  const at = new Map<number, number>();
  const used: number[] = [];
  const vertex = (i: number): number => {
    const v = same[i]!;
    let k = at.get(v);
    if (k === undefined) at.set(v, (k = used.push(v) - 1));
    return k;
  };
  // Each colour simplified apart, its border kept, so colours keep their edges.
  const byColor = new Map<string, { color: Rgb | null; tris: number[]; polys: number }>();
  s.polygons.forEach((poly, i) => {
    const color = s.colors?.[i] ?? null;
    // (A textured soup's colours come from its texture afterwards: simplified as one.)
    const k = color && !s.texture ? color.join() : '';
    let g = byColor.get(k);
    if (!g) byColor.set(k, (g = { color, tris: [], polys: 0 }));
    g.polys++;
    for (let j = 1; j + 1 < poly.length; j++)
      g.tris.push(vertex(poly[0]!), vertex(poly[j]!), vertex(poly[j + 1]!));
  });
  const compact = new Float32Array(used.length * 3);
  used.forEach((v, k) => compact.set(pos.subarray(v * 3, v * 3 + 3), k * 3));
  const polygons: number[][] = [];
  const colors: (Rgb | null)[] = [];
  for (const { color, tris, polys } of byColor.values()) {
    // Polygons are kept in proportion: a quad's two triangles count as the one face it was.
    if (tris.length === 0) continue; // (polygons of fewer than three corners)
    const target = Math.min(tris.length, Math.max(3, Math.round(polys * keep) * 3));
    const [out] = MeshoptSimplifier.simplify(Uint32Array.from(tris), compact, 3, target, 1, ['LockBorder']); // prettier-ignore
    for (let k = 0; k + 2 < out.length; k += 3) {
      polygons.push([used[out[k]!]!, used[out[k + 1]!]!, used[out[k + 2]!]!]);
      colors.push(color);
    }
  }
  const simpler: Soup = { ...s, polygons, colors };
  delete simpler.faces; // the file's faces are gone with their triangles
  return simpler;
}
