import { Brep, NONE } from './brep.ts';

/** One shell as polygons: faces → loops (outer first) → 0-based vertex indices. */
export interface PolygonShell {
  positions: readonly (readonly [number, number, number])[];
  faces: readonly (readonly (readonly number[])[])[];
}

export interface BuiltShell {
  shell: number;
  /** Brep vertex id for each input position. */
  vertices: number[];
  /** Brep face id for each input face. */
  faces: number[];
  /** Edge ids in canonical order (first encounter walking faces → loops → half-edges). */
  edges: number[];
}

/**
 * Builds a shell directly from polygon loops, pairing half-edges into edges
 * the way the original's make_shell_evfs does: walk faces → loops →
 * half-edges, and give each unpaired half-edge a new edge whose other half is
 * the opposite-direction half-edge (preferring another face). Faults are
 * tolerated rather than rejected, so damaged or non-manifold files still load:
 * a same-direction partner pairs as a misoriented edge, and a half-edge with
 * no partner becomes a boundary edge. The validator reports all of these.
 */
export function buildShell(b: Brep, input: PolygonShell): BuiltShell {
  const shell = b.newShell();
  const vertices = input.positions.map(([x, y, z]) => b.newVertex(shell, x, y, z));
  const faces: number[] = [];
  const order: number[] = []; // half-edges in canonical order
  const byDir = new Map<string, number[]>();

  for (const loops of input.faces) {
    const f = b.newFace(shell);
    faces.push(f);
    for (const idx of loops) {
      const l = b.newLoop(f);
      let first = NONE;
      let prev = NONE;
      for (const i of idx) {
        const v = vertices[i];
        if (v === undefined) throw new RangeError(`vertex index ${i + 1} out of range`);
        const h = b.newHalfEdge(l, v);
        if (first === NONE) first = h;
        else b.link(prev, h);
        prev = h;
        if (b.vertexHe(v) === NONE) b.setVertexHe(v, h);
      }
      if (first === NONE) {
        // An empty loop can't exist in a Brep; drop it.
        b.removeLoopFromFace(l);
        b.freeLoop(l);
        continue;
      }
      b.link(prev, first);
      b.setLoopHe(l, first);
      for (const h of b.loopHalfEdges(l)) {
        order.push(h);
        if (b.heNext(h) === h) continue; // lone half-edge: no edge
        const key = `${b.heVertex(h)},${b.heVertex(b.heNext(h))}`;
        const list = byDir.get(key);
        if (list) list.push(h);
        else byDir.set(key, [h]);
      }
    }
  }

  const take = (key: string, h: number): number => {
    const list = byDir.get(key);
    if (!list) return NONE;
    const face = b.heFace(h);
    let pick = list.findIndex((c) => c !== h && b.heEdge(c) === NONE && b.heFace(c) !== face);
    if (pick < 0) pick = list.findIndex((c) => c !== h && b.heEdge(c) === NONE);
    if (pick < 0) return NONE;
    const [m] = list.splice(pick, 1);
    return m!;
  };

  const edges: number[] = [];
  for (const h of order) {
    if (b.heEdge(h) !== NONE || b.heNext(h) === h) continue;
    const u = b.heVertex(h);
    const v = b.heVertex(b.heNext(h));
    const e = b.newEdge(h, NONE);
    b.setHeEdge(h, e);
    edges.push(e);
    const self = byDir.get(`${u},${v}`);
    if (self) self.splice(self.indexOf(h), 1);
    let m = take(`${v},${u}`, h);
    if (m === NONE) m = take(`${u},${v}`, h); // misoriented neighbour
    if (m !== NONE) {
      b.setHeEdge(m, e);
      b.setEdgeHes(e, h, m);
    }
  }
  return { shell, vertices, faces, edges };
}

/** Canonical edge order of a shell, as used for "Edge N" numbering in .cut files. */
export function canonicalEdges(b: Brep, shell: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const f of b.faces(shell))
    for (const l of b.faceLoops(f))
      for (const h of b.loopHalfEdges(l)) {
        const e = b.heEdge(h);
        if (e !== NONE && !seen.has(e)) {
          seen.add(e);
          out.push(e);
        }
      }
  return out;
}
