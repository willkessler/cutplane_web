import earcut from 'earcut';
import { mat4, type CutObject, type Rgb } from '@cutplane/kernel';

export type V3 = [number, number, number];

/** One face of an object, ready for a mesh format: in the room, with its triangles. */
export interface MeshFace {
  /** Loops of room positions, the outer loop first. */
  loops: V3[][];
  /** Triangles as indices into `loops.flat()`, wound like the face. */
  triangles: [number, number, number][];
  /** Unit normal (Newell's), facing out. */
  normal: V3;
  color: Rgb;
}

/** Newell's normal of a loop: its direction, twice its area long. */
export function newell(pts: readonly (readonly number[])[]): V3 {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    n[0] += (a[1]! - b[1]!) * (a[2]! + b[2]!);
    n[1] += (a[2]! - b[2]!) * (a[0]! + b[0]!);
    n[2] += (a[0]! - b[0]!) * (a[1]! + b[1]!);
  }
  return n;
}

/** The 2D coordinates a face with normal `n` flattens to (dropping its largest axis). */
export function flattener(n: readonly number[]): (p: readonly number[]) => [number, number] {
  const ax = Math.abs(n[0]!), ay = Math.abs(n[1]!), az = Math.abs(n[2]!); // prettier-ignore
  if (az >= ax && az >= ay) return (p) => [p[0]!, p[1]!];
  if (ax >= ay) return (p) => [p[1]!, p[2]!];
  return (p) => [p[2]!, p[0]!];
}

/** A face's loops as triangles (holes cut out), wound to agree with `normal`. */
export function triangulate(loops: readonly V3[][], normal: V3): [number, number, number][] {
  const all = loops.flat();
  if (loops[0]!.length === 3 && loops.length === 1) return [[0, 1, 2]];
  const flat = flattener(normal);
  const coords: number[] = [];
  const holes: number[] = [];
  for (const [i, l] of loops.entries()) {
    if (i > 0) holes.push(coords.length / 2);
    for (const p of l) coords.push(...flat(p));
  }
  const idx = earcut(coords, holes);
  const out: [number, number, number][] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    const [p, q, r] = [all[a]!, all[b]!, all[c]!];
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const d =
      (u[1]! * v[2]! - u[2]! * v[1]!) * normal[0] +
      (u[2]! * v[0]! - u[0]! * v[2]!) * normal[1] +
      (u[0]! * v[1]! - u[1]! * v[0]!) * normal[2];
    out.push(d >= 0 ? [a, b, c] : [a, c, b]);
  }
  return out;
}

/**
 * An object's faces in the room (its xform applied), each with its colour
 * (the face's own, else the object's) and its triangles. Faces with no area are left out.
 */
export function meshFaces(o: CutObject): MeshFace[] {
  const b = o.brep;
  const room = (v: number): V3 => {
    const [x, y, z] = b.vertexPos(v);
    return [...mat4.transformPoint(o.xform, x, y, z)] as V3;
  };
  const faces: MeshFace[] = [];
  for (const f of b.faces()) {
    const loops = b
      .faceLoops(f)
      .map((l) => b.loopHalfEdges(l).map((h) => room(b.heVertex(h))))
      .filter((l) => l.length >= 3);
    if (loops.length === 0) continue;
    const n = newell(loops[0]!);
    const len = Math.hypot(...n);
    if (len === 0) continue;
    const normal: V3 = [n[0] / len, n[1] / len, n[2] / len];
    const triangles = triangulate(loops, normal);
    if (triangles.length === 0) continue;
    faces.push({ loops, triangles, normal, color: b.faceColors.get(f) ?? o.color });
  }
  return faces;
}
