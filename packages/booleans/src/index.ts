import { Brep, buildShell } from '@cutplane/kernel';
import type { FaceSource, ResultShell } from './manifold.ts';

export {
  booleanSolids,
  booleansReady,
  initBooleans,
  simpleOutline,
  sliceSolid,
  solidMesh,
  solidsOverlap,
  type SolidMesh,
  type BoolOp,
  type FaceSource,
  type ResultFace,
  type ResultShell,
  type Solid,
} from './manifold.ts';

/** Result shells as one B-rep, with each B-rep face's source. */
export function shellsToBrep(shells: readonly ResultShell[]): {
  brep: Brep;
  sources: Map<number, FaceSource>;
} {
  const brep = new Brep();
  const sources = new Map<number, FaceSource>();
  for (const s of shells) {
    const built = buildShell(brep, {
      positions: s.positions,
      faces: s.faces.map((f) => f.loops),
    });
    built.faces.forEach((f, i) => sources.set(f, s.faces[i]!.source));
  }
  return { brep, sources };
}

/**
 * Shells grouped into solids: each outward shell, with any voids (inward shells)
 * that sit inside it. Shells are tested by a vertex inside the outward shell's box,
 * which is enough for voids a boolean leaves.
 */
export function solidsOf(shells: readonly ResultShell[]): ResultShell[][] {
  const outer = shells.filter((s) => s.volume > 0);
  const voids = shells.filter((s) => s.volume <= 0);
  const groups = outer.map((s) => [s]);
  const box = (s: ResultShell) => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const p of s.positions)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, p[k]!);
        hi[k] = Math.max(hi[k]!, p[k]!);
      }
    return { lo, hi, vol: (hi[0]! - lo[0]!) * (hi[1]! - lo[1]!) * (hi[2]! - lo[2]!) };
  };
  const boxes = outer.map(box);
  for (const v of voids) {
    const p = v.positions[0];
    if (!p) continue;
    let best = -1;
    boxes.forEach((b, i) => {
      if ([0, 1, 2].every((k) => p[k]! >= b.lo[k]! && p[k]! <= b.hi[k]!))
        if (best < 0 || b.vol < boxes[best]!.vol) best = i;
    });
    if (best >= 0) groups[best]!.push(v);
  }
  return groups;
}
