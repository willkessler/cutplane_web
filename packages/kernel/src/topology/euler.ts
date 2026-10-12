import { Brep, NONE } from './brep.ts';

/**
 * Euler operators, following Mäntylä's GWB (as ported in the original
 * topology.c). Each preserves V − E + F − (L − F) = 2(S − H). All operate on
 * one Brep; higher-level operations are built from them.
 */

export class EulerError extends Error {}

function check(cond: boolean, msg: string): void {
  if (!cond) throw new EulerError(msg);
}

/** Inserts a new half-edge for edge e with origin v just before `where` (or reuses a lone `where`). */
function addHe(b: Brep, e: number, v: number, where: number, first: boolean): number {
  let he: number;
  if (b.heEdge(where) === NONE) {
    he = where;
    b.setHeVertex(he, v);
  } else {
    he = b.newHalfEdge(b.heLoop(where), v);
    b.link(b.hePrev(where), he);
    b.link(he, where);
  }
  b.setHeEdge(he, e);
  if (first) b.setEdgeHes(e, he, b.edgeHe2(e));
  else b.setEdgeHes(e, b.edgeHe1(e), he);
  return he;
}

/**
 * Removes half-edge h from its loop. A loop's last half-edge stays behind as
 * a lone half-edge (edge NONE), as in GWB. Returns a half-edge still in the
 * loop, or NONE if h was already lone and has been freed.
 */
function delHe(b: Brep, h: number): number {
  if (b.heEdge(h) === NONE) {
    b.freeHalfEdge(h);
    return NONE;
  }
  if (b.heNext(h) === h) {
    b.setHeEdge(h, NONE);
    return h;
  }
  const prev = b.hePrev(h);
  b.link(prev, b.heNext(h));
  b.freeHalfEdge(h);
  return prev;
}

/** Points vertex v at the first live candidate starting there, else any half-edge starting there. */
function fixVertex(b: Brep, v: number, candidates: number[]): void {
  for (const c of candidates) {
    if (c !== NONE && b.isHalfEdge(c) && b.heVertex(c) === v) {
      b.setVertexHe(v, c);
      return;
    }
  }
  for (const h of b.halfEdges()) {
    if (b.heVertex(h) === v) {
      b.setVertexHe(v, h);
      return;
    }
  }
  b.setVertexHe(v, NONE);
}

function setLoopHead(b: Brep, l: number, h: number): void {
  if (h !== NONE) b.setLoopHe(l, h);
}

export interface MvfsResult {
  shell: number;
  face: number;
  loop: number;
  vertex: number;
  he: number;
}

/** mvfs: make vertex, face, shell. The new face has one loop with one lone half-edge. */
export function mvfs(b: Brep, x: number, y: number, z: number): MvfsResult {
  const shell = b.newShell();
  const face = b.newFace(shell);
  const loop = b.newLoop(face);
  const vertex = b.newVertex(shell, x, y, z);
  const he = b.newHalfEdge(loop, vertex);
  b.setLoopHe(loop, he);
  b.setVertexHe(vertex, he);
  return { shell, face, loop, vertex, he };
}

/** kvfs: inverse of mvfs. The shell must be a single vertex in a single face. */
export function kvfs(b: Brep, shell: number): void {
  const faces = b.faces(shell);
  const verts = b.vertices(shell);
  check(faces.length === 1 && verts.length === 1, 'kvfs: shell is not a single vertex');
  const f = faces[0]!;
  const l = b.faceLoop(f);
  check(b.loopNext(l) === NONE, 'kvfs: face has more than one loop');
  const h = b.loopHe(l);
  check(b.heNext(h) === h && b.heEdge(h) === NONE, 'kvfs: loop is not a lone half-edge');
  b.freeHalfEdge(h);
  b.freeLoop(l);
  b.freeFace(f);
  b.freeVertex(verts[0]!);
  b.freeShell(shell);
}

export interface MevResult {
  vertex: number;
  edge: number;
  /** The new half-edge that starts at the new vertex (chain the next mev from it). */
  he: number;
  /** The new half-edge that ends at the new vertex. */
  heIn: number;
}

/**
 * mev: make edge and vertex. h1 and h2 start at the same vertex v (h1 === h2
 * makes a dangling "strut"). The half-edges from h1 up to (not including) h2,
 * rotating around v, move to the new vertex, which is joined to v by a new edge.
 */
export function mev(b: Brep, h1: number, h2: number, x: number, y: number, z: number): MevResult {
  const v = b.heVertex(h1);
  check(b.heVertex(h2) === v, 'mev: half-edges do not share a start vertex');
  const nv = b.newVertex(b.vertexShell(v), x, y, z);
  const e = b.newEdge();
  let he = h1;
  let guard = 0;
  while (he !== h2) {
    b.setHeVertex(he, nv);
    const m = b.heMate(he);
    check(m !== NONE, 'mev: open fan around vertex');
    he = b.heNext(m);
    check(++guard <= b.numHalfEdges, 'mev: h2 not in the fan of h1');
  }
  const heIn = addHe(b, e, v, h1, false); // v → nv
  const heOut = addHe(b, e, nv, h2, true); // nv → v
  b.setVertexHe(nv, heOut);
  fixVertex(b, v, [h2, heIn]);
  return { vertex: nv, edge: e, he: heOut, heIn };
}

/**
 * kev: kill edge and vertex (inverse of mev). Removes edge e and its endpoint
 * `kill`; the half-edges that started at `kill` move to the other endpoint.
 */
export function kev(b: Brep, e: number, kill: number): void {
  let he1 = b.edgeHe1(e);
  let he2 = b.edgeHe2(e);
  check(he2 !== NONE, 'kev: boundary edge');
  if (b.heVertex(he1) !== kill) [he1, he2] = [he2, he1];
  check(b.heVertex(he1) === kill, 'kev: vertex is not an endpoint of the edge');
  const keep = b.heVertex(he2);
  check(keep !== kill, 'kev: edge is a loop edge');
  let he = b.heNext(he2);
  let guard = 0;
  while (he !== he1) {
    b.setHeVertex(he, keep);
    const m = b.heMate(he);
    check(m !== NONE, 'kev: open fan around vertex');
    he = b.heNext(m);
    check(++guard <= b.numHalfEdges, 'kev: broken fan');
  }
  const c1 = b.heNext(he1);
  const c2 = b.heNext(he2);
  const l1 = b.heLoop(he1);
  const l2 = b.heLoop(he2);
  setLoopHead(b, l1, delHe(b, he1));
  setLoopHead(b, l2, delHe(b, he2));
  b.freeEdge(e);
  b.freeVertex(kill);
  fixVertex(b, keep, [c1, c2, b.loopHe(l1), b.loopHe(l2)]);
}

/**
 * mef: make edge and face. h1 and h2 are in the same loop; a new edge joins
 * their start vertices and splits the loop. The part from h1 up to (not
 * including) h2 becomes the new face. Returns the new face.
 */
export function mef(b: Brep, h1: number, h2: number): { face: number; edge: number } {
  const ol = b.heLoop(h1);
  check(b.heLoop(h2) === ol, 'mef: half-edges are in different loops');
  check(h1 !== h2, 'mef: h1 and h2 are the same half-edge');
  const f = b.loopFace(ol);
  const nf = b.newFace(b.faceShell(f));
  const nl = b.newLoop(nf);
  const e = b.newEdge();
  let he = h1;
  let guard = 0;
  do {
    b.setHeLoop(he, nl);
    he = b.heNext(he);
    check(++guard <= b.numHalfEdges, 'mef: loop is broken');
  } while (he !== h2);
  const v1 = b.heVertex(h1);
  const v2 = b.heVertex(h2);
  // nhe1: v2 → v1, before h1 (new loop).  nhe2: v1 → v2, before h2 (old loop).
  const nhe1 = addHe(b, e, v2, h1, false);
  const nhe2 = addHe(b, e, v1, h2, true);
  const p1 = b.hePrev(nhe1);
  const p2 = b.hePrev(nhe2);
  b.link(p1, nhe2);
  b.link(p2, nhe1);
  b.setHeLoop(nhe1, nl);
  b.setHeLoop(nhe2, ol);
  b.setLoopHe(nl, nhe1);
  b.setLoopHe(ol, nhe2);
  return { face: nf, edge: e };
}

/**
 * kef: kill edge and face (inverse of mef). The two halves of e must be in
 * different faces; `killFace` (default: the face of he2) is removed and its
 * loops join the surviving face. Returns the surviving face.
 */
export function kef(b: Brep, e: number, killFace = NONE): number {
  let h1 = b.edgeHe1(e);
  let h2 = b.edgeHe2(e);
  check(h2 !== NONE, 'kef: boundary edge');
  if (killFace !== NONE && b.heFace(h1) === killFace) [h1, h2] = [h2, h1];
  const l1 = b.heLoop(h1);
  const l2 = b.heLoop(h2);
  const f1 = b.loopFace(l1);
  const f2 = b.loopFace(l2);
  check(f1 !== f2, 'kef: both sides are in the same face (use kemr)');
  for (const l of b.faceLoops(f2)) {
    if (l === l2) continue;
    b.removeLoopFromFace(l);
    b.addLoopToFace(f1, l);
  }
  for (const h of b.loopHalfEdges(l2)) b.setHeLoop(h, l1);
  const p1 = b.hePrev(h1);
  const p2 = b.hePrev(h2);
  b.link(p1, h2);
  b.link(p2, h1);
  const a = b.heVertex(h1);
  const c = b.heVertex(h2);
  const n1 = b.heNext(h1);
  const n2 = b.heNext(h2);
  setLoopHead(b, l1, delHe(b, h2));
  setLoopHead(b, l1, delHe(b, h1));
  b.removeLoopFromFace(l2);
  b.freeLoop(l2);
  b.freeFace(f2);
  b.freeEdge(e);
  fixVertex(b, a, [n2]);
  fixVertex(b, c, [n1]);
  return f1;
}

/**
 * kemr: kill edge, make ring. Both halves of e lie in the same loop; removing
 * the edge splits it in two, and the part containing `ringSideHe` (default:
 * he2) becomes a new inner loop of the same face. Returns the new loop.
 */
export function kemr(b: Brep, e: number, ringSideHe = NONE): number {
  let h1 = b.edgeHe1(e);
  let h2 = b.edgeHe2(e);
  check(h2 !== NONE, 'kemr: boundary edge');
  if (ringSideHe === h1) [h1, h2] = [h2, h1];
  const ol = b.heLoop(h1);
  check(b.heLoop(h2) === ol, 'kemr: halves are in different loops');
  const f = b.loopFace(ol);
  const a = b.heVertex(h1);
  const c = b.heVertex(h2);
  const h3 = b.heNext(h1);
  const h2n = b.heNext(h2);
  // Split: [h1, h2n ...] stays in ol, [h2, h3 ...] becomes the ring.
  b.link(h1, h2n);
  b.link(h2, h3);
  const nl = b.newLoop(f);
  b.setLoopHe(nl, h2);
  for (const h of b.loopHalfEdges(nl)) b.setHeLoop(h, nl);
  b.setLoopHe(ol, h1);
  setLoopHead(b, ol, delHe(b, h1));
  setLoopHead(b, nl, delHe(b, h2));
  b.freeEdge(e);
  fixVertex(b, a, [h2n, b.loopHe(ol)]);
  fixVertex(b, c, [h3, b.loopHe(nl)]);
  return nl;
}

/**
 * mekr: make edge, kill ring (inverse of kemr). h1 and h2 are in different
 * loops of the same face; a new edge joins their start vertices and the two
 * loops become one. The outer loop survives if either is outer.
 */
export function mekr(b: Brep, h1: number, h2: number): number {
  const l1 = b.heLoop(h1);
  const l2 = b.heLoop(h2);
  check(l1 !== l2, 'mekr: half-edges are in the same loop');
  const f = b.loopFace(l1);
  check(b.loopFace(l2) === f, 'mekr: loops are in different faces');
  const keep = b.faceLoop(f) === l2 ? l2 : l1;
  const kill = keep === l1 ? l2 : l1;
  for (const h of b.loopHalfEdges(kill)) b.setHeLoop(h, keep);
  const v1 = b.heVertex(h1);
  const v2 = b.heVertex(h2);
  const e = b.newEdge();
  const lone1 = b.heEdge(h1) === NONE;
  const lone2 = b.heEdge(h2) === NONE;
  // Result: a1 → n1(v1→v2) → h2 … b2 → n2(v2→v1) → h1 … a1
  let n1: number;
  let n2: number;
  if (lone1 && lone2) {
    n1 = h1;
    n2 = h2;
    b.link(h1, h2);
    b.link(h2, h1);
  } else if (lone2) {
    n1 = b.newHalfEdge(keep, v1);
    n2 = h2;
    b.link(b.hePrev(h1), n1);
    b.link(n1, h2);
    b.link(h2, h1);
  } else if (lone1) {
    n2 = b.newHalfEdge(keep, v2);
    n1 = h1;
    b.link(b.hePrev(h2), n2);
    b.link(n2, h1);
    b.link(h1, h2);
  } else {
    const a1 = b.hePrev(h1);
    const b2 = b.hePrev(h2);
    n1 = b.newHalfEdge(keep, v1);
    n2 = b.newHalfEdge(keep, v2);
    b.link(a1, n1);
    b.link(n1, h2);
    b.link(b2, n2);
    b.link(n2, h1);
  }
  b.setHeEdge(n1, e);
  b.setHeEdge(n2, e);
  b.setEdgeHes(e, n1, n2);
  b.setLoopHe(keep, n1);
  b.removeLoopFromFace(kill);
  b.freeLoop(kill);
  fixVertex(b, v1, [b.vertexHe(v1), n1]);
  fixVertex(b, v2, [b.vertexHe(v2), n2]);
  return e;
}

/** kfmrh: kill face f2, make its (single) loop a ring (hole) of f1. */
export function kfmrh(b: Brep, f1: number, f2: number): void {
  check(f1 !== f2, 'kfmrh: same face');
  check(b.faceShell(f1) === b.faceShell(f2), 'kfmrh: faces are in different shells');
  for (const l of b.faceLoops(f2)) {
    b.removeLoopFromFace(l);
    b.addLoopToFace(f1, l);
  }
  b.freeFace(f2);
}

/** mfkrh: make a new face whose outer loop is the inner loop `ring` (inverse of kfmrh). */
export function mfkrh(b: Brep, ring: number): number {
  const f = b.loopFace(ring);
  check(b.faceLoop(f) !== ring, 'mfkrh: loop is the outer loop');
  const nf = b.newFace(b.faceShell(f));
  b.removeLoopFromFace(ring);
  b.addLoopToFace(nf, ring);
  return nf;
}

/** Moves a loop to another face of the same shell, optionally as its outer loop. */
export function ringMove(b: Brep, loop: number, toFace: number, outer = false): void {
  b.removeLoopFromFace(loop);
  b.addLoopToFace(toFace, loop);
  if (outer) b.makeOuterLoop(loop);
}
