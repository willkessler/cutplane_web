import { Brep, NONE } from '../topology/brep.ts';
import { buildShell, type PolygonShell } from '../topology/build.ts';
import { EulerError, mef, mev, mvfs } from '../topology/euler.ts';

/**
 * Translational sweep (GWB `sweep`, the original's extrude_face). Every loop of
 * `face` is swept by d: the face moves to the far end and side faces fill the
 * gap. Sweep along the face's normal for outward-facing results.
 */
export function extrudeFace(b: Brep, face: number, dx: number, dy: number, dz: number): void {
  for (const l of b.faceLoops(face)) {
    const first = b.loopHe(l);
    let scan = b.heNext(first);
    const up = (h: number) => {
      const [x, y, z] = b.vertexPos(b.heVertex(h));
      mev(b, h, h, x + dx, y + dy, z + dz);
    };
    up(scan);
    let guard = 0;
    while (scan !== first) {
      up(b.heNext(scan));
      mef(b, b.hePrev(scan), b.heNext(b.heNext(scan)));
      scan = b.heNext(b.heMate(b.heNext(scan)));
      if (++guard > b.numHalfEdges) throw new EulerError('extrudeFace: loop did not close');
    }
    mef(b, b.hePrev(scan), b.heNext(b.heNext(scan)));
  }
}

/**
 * Splits a single-loop face into a fan of triangles around a new vertex at p
 * (the original's split_face_at_vert). Placing p off the face's plane makes a
 * cone or pyramid. Returns the new vertex.
 */
export function splitFaceAtVertex(b: Brep, face: number, x: number, y: number, z: number): number {
  const l = b.faceLoop(face);
  if (b.loopNext(l) !== NONE) throw new EulerError('splitFaceAtVertex: face has holes');
  const ring = b.loopHalfEdges(l);
  const h0 = ring[0]!;
  const { vertex, he } = mev(b, h0, h0, x, y, z);
  let apex = he; // starts at the new vertex
  for (let i = 1; i < ring.length; i++) {
    const { edge } = mef(b, apex, ring[i]!);
    apex = b.edgeHe1(edge); // the half of the new edge left in the old loop, starting at the apex
  }
  return vertex;
}

/**
 * Builds a lamina (a flat two-faced shell) from a closed polygon, using Euler
 * operators the way the original does: mvfs, a chain of mev, then mef.
 * `front` has the polygon's own (counter-clockwise) orientation; `back` is
 * its reverse.
 */
export function makeLamina(
  b: Brep,
  pts: readonly (readonly [number, number, number])[],
): { shell: number; front: number; back: number } {
  if (pts.length < 3) throw new EulerError('makeLamina: need at least 3 points');
  const [x0, y0, z0] = pts[0]!;
  const { shell, face, he: h0 } = mvfs(b, x0, y0, z0);
  let h = h0;
  for (let i = 1; i < pts.length; i++) {
    const [x, y, z] = pts[i]!;
    h = mev(b, h, h, x, y, z).he;
  }
  // h starts at the last vertex and h0 at the first. Closing the wire leaves
  // the forward polygon in the mvfs face and the reversed one in the new face.
  const { face: back } = mef(b, h, h0);
  return { shell, front: face, back };
}

export type Axis = 'x' | 'y' | 'z';

/**
 * Solid of revolution (the original's make_solid_of_rotation): revolves an
 * open profile polyline about an axis through the origin in `segments` steps.
 * Profile points on the axis become poles; open ends off the axis are capped.
 * Faces are oriented outward.
 */
export function revolve(
  b: Brep,
  profile: readonly (readonly [number, number, number])[],
  axis: Axis,
  segments: number,
  closed = false,
): number {
  const ax = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const onAxis = (p: readonly number[]) => p.every((c, i) => i === ax || Math.abs(c) < 1e-9);
  const rotate = (p: readonly [number, number, number], t: number): [number, number, number] => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    const [x, y, z] = p;
    if (axis === 'x') return [x, y * c - z * s, y * s + z * c];
    if (axis === 'y') return [x * c + z * s, y, -x * s + z * c];
    return [x * c - y * s, x * s + y * c, z];
  };
  const positions: [number, number, number][] = [];
  const ring: number[][] = [];
  for (const p of profile) {
    if (onAxis(p)) {
      const i = positions.push([p[0], p[1], p[2]]) - 1;
      ring.push(Array<number>(segments).fill(i));
    } else {
      const r: number[] = [];
      for (let j = 0; j < segments; j++)
        r.push(positions.push(rotate(p, (2 * Math.PI * j) / segments)) - 1);
      ring.push(r);
    }
  }
  const faces: number[][][] = [];
  const n = profile.length;
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const a = ring[i]!;
    const c = ring[(i + 1) % n]!;
    for (let j = 0; j < segments; j++) {
      const k = (j + 1) % segments;
      const quad = [a[j]!, a[k]!, c[k]!, c[j]!];
      const loop = quad.filter((v, idx) => v !== quad[(idx + 1) % 4]);
      if (loop.length >= 3) faces.push([loop]);
    }
  }
  if (!closed) {
    if (!onAxis(profile[0]!)) faces.push([[...ring[0]!].reverse()]);
    if (!onAxis(profile[n - 1]!)) faces.push([[...ring[n - 1]!]]);
  }
  const input: PolygonShell = { positions, faces };
  const built = buildShell(b, input);
  if (signedVolume(b, built.shell) < 0) reverseShell(b, built.shell);
  return built.shell;
}

/** Signed volume of a shell by the divergence theorem (positive when outward-oriented). */
export function signedVolume(b: Brep, shell: number): number {
  let vol = 0;
  for (const f of b.faces(shell))
    for (const l of b.faceLoops(f)) {
      const hs = b.loopHalfEdges(l);
      const [ox, oy, oz] = b.vertexPos(b.heVertex(hs[0]!));
      for (let i = 1; i + 1 < hs.length; i++) {
        const [ax, ay, az] = b.vertexPos(b.heVertex(hs[i]!));
        const [cx, cy, cz] = b.vertexPos(b.heVertex(hs[i + 1]!));
        vol += ox * (ay * cz - az * cy) - oy * (ax * cz - az * cx) + oz * (ax * cy - ay * cx);
      }
    }
  return vol / 6;
}

/** Flips the orientation of every face in a shell. */
export function reverseShell(b: Brep, shell: number): void {
  for (const f of b.faces(shell))
    for (const l of b.faceLoops(f)) {
      const hs = b.loopHalfEdges(l);
      const verts = hs.map((h) => b.heVertex(b.heNext(h)));
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i]!;
        const nxt = b.heNext(h);
        const prv = b.hePrev(h);
        b.setHeNext(h, prv);
        b.setHePrev(h, nxt);
        b.setHeVertex(h, verts[i]!);
      }
    }
  for (const v of b.vertices(shell)) b.setVertexHe(v, NONE);
  for (const h of b.halfEdges())
    if (b.vertexShell(b.heVertex(h)) === shell && b.vertexHe(b.heVertex(h)) === NONE)
      b.setVertexHe(b.heVertex(h), h);
}
