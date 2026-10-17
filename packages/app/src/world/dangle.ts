import { mat4, subtree, type CutObject, type Mat4, type Pick } from '@cutplane/kernel';
import { P } from '@cutplane/cpl';
import type { Runtime, V3 } from '@cutplane/behaviors';
import { GRAVITY } from './gravity.ts';

/**
 * Permanent gravity's dangling: an object held whole hangs from where it was
 * taken hold of, as a solid would. Held by a vertex (or anywhere in its section,
 * or by a face), it swings freely about that point until its weight hangs below
 * it; held by an edge, it swings only about that edge, which keeps its slant.
 * Moving the crosshair swings it too. Its weight is spread over its surface
 * (each face's area at the face's middle): near enough a solid's for hanging.
 */

/** How fast a swing dies away (a second), and the steps a frame. */
const DAMPING = 1.6;
const SUBSTEPS = 4;
/** The most of its faces that carry its weight (a bigger object's are taken evenly). */
const MOST_POINTS = 4000;
/** The hardest the crosshair's moving pushes it (room units a second squared). */
const MOST_PUSH = 20 * GRAVITY;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const at = (m: Mat4, p: V3): V3 => mat4.transformPoint(m, p[0], p[1], p[2]) as V3;

const det3 = (m: number[][]) =>
  m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
  m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
  m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);

/** Solves `m x = b` (a 3×3 `m`, by rows) by Cramer's rule, or null if `m` is singular. */
export function solve3(m: number[][], b: V3): V3 | null {
  const d = det3(m);
  if (Math.abs(d) < 1e-12) return null;
  // Each unknown: `m` with its column swapped for `b`.
  return [0, 1, 2].map((k) => det3(m.map((row, i) => row.map((v, j) => (j === k ? b[i]! : v)))) / d) as V3; // prettier-ignore
}

export class Dangle {
  /** Each weighed point (x y z) where the root's placement puts it, and its share of the weight. */
  private readonly points: Float64Array;
  private readonly weights: Float64Array;
  /** Where it's held, in the root's own coordinates (so it goes where the drag takes it). */
  private readonly pivot: V3;
  /** Held by an edge: the edge's direction, which it keeps. */
  private readonly hinge: V3 | null;
  /** How fast it's turning (radians a second, about this axis). */
  private spin: V3 = [0, 0, 0];
  private last: { at: V3; v: V3 } | null = null;

  private constructor(
    private readonly rt: Runtime,
    readonly root: CutObject,
    points: V3[],
    weights: number[],
    pivot: V3,
    hinge: V3 | null,
  ) {
    const inv = mat4.invert(root.xform) ?? mat4.identity();
    this.points = new Float64Array(points.length * 3);
    points.forEach((p, i) => this.points.set(at(inv, p), i * 3));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    this.weights = Float64Array.from(weights, (w) => w / total);
    this.pivot = at(inv, pivot);
    this.hinge = hinge;
  }

  /**
   * Takes hold of `root`'s branch (a group, or the scale box round what is picked),
   * where `part` was clicked (`pick`: the click's vertex, edge, face or inside).
   * Null if it has nothing to weigh.
   */
  static hold(rt: Runtime, root: CutObject, part: CutObject, pick: Pick): Dangle | null {
    const points: V3[] = [];
    const weights: number[] = [];
    for (const o of subtree(root)) {
      // (Its scale box, which turns with it, weighs nothing.)
      if (o.brep.numFaces === 0 || !rt.vm.props.has(o, P.Visible)) continue;
      if (rt.vm.props.has(o, P.Scalebbox) || rt.hasProp(o, 'Grouper')) continue;
      const g = rt.world(o);
      const b = o.brep;
      for (const f of b.faces()) {
        const vs = b.loopHalfEdges(b.faceLoop(f)).map((h) => b.heVertex(h));
        const ps = vs.map((v): V3 => [g.x(v), g.y(v), g.z(v)]);
        // Newell's normal: its length is twice the face's area.
        const n: V3 = [0, 0, 0];
        const c: V3 = [0, 0, 0];
        ps.forEach((p, i) => {
          const q = ps[(i + 1) % ps.length]!;
          n[0] += (p[1] - q[1]) * (p[2] + q[2]);
          n[1] += (p[2] - q[2]) * (p[0] + q[0]);
          n[2] += (p[0] - q[0]) * (p[1] + q[1]);
          for (let k = 0; k < 3; k++) c[k]! += p[k]! / ps.length;
        });
        const area = Math.hypot(...n) / 2;
        if (area > 0) {
          points.push(c);
          weights.push(area);
        }
      }
    }
    if (points.length === 0) return null;
    // A big object's weight is taken from a sample of its faces (the same share each).
    const step = Math.max(1, Math.ceil(points.length / MOST_POINTS));
    const ps = points.filter((_, i) => i % step === 0);
    const ws = weights.filter((_, i) => i % step === 0);
    let hinge: V3 | null = null;
    if (pick.kind === 'edge') {
      try {
        const g = rt.world(part);
        const [a, b] = part.brep.edgeVertices(pick.id);
        const d: V3 = [g.x(b) - g.x(a), g.y(b) - g.y(a), g.z(b) - g.z(a)];
        const len = Math.hypot(...d);
        if (len > 1e-9) hinge = scale(d, 1 / len);
      } catch {
        // (An edge gone already: held by a point.)
      }
    }
    return new Dangle(rt, root, ps, ws, [...pick.at] as V3, hinge);
  }

  /** Where it's held now, in the room. */
  get heldAt(): V3 {
    return at(this.root.xform, this.pivot);
  }

  /**
   * Swings it on by `dt` seconds (gravity, and the crosshair's pull as it moves),
   * turning its group about where it's held.
   */
  step(dt: number): void {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1 / 20);
    const pivot = this.heldAt;
    // How the hand accelerates: in its frame the weight is pushed the other way.
    let push: V3 = [0, 0, 0];
    if (this.last) {
      const v = scale(sub(pivot, this.last.at), 1 / dt);
      push = scale(sub(v, this.last.v), -1 / dt);
      const p = Math.hypot(...push);
      if (p > MOST_PUSH) push = scale(push, MOST_PUSH / p);
      this.last = { at: pivot, v: [(v[0] + this.last.v[0]) / 2, (v[1] + this.last.v[1]) / 2, (v[2] + this.last.v[2]) / 2] }; // prettier-ignore
    } else this.last = { at: pivot, v: [0, 0, 0] };
    const pull: V3 = [push[0], push[1] - GRAVITY, push[2]];

    const n = this.weights.length;
    const xf = this.root.xform;
    const pts = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = at(xf, [this.points[i * 3]!, this.points[i * 3 + 1]!, this.points[i * 3 + 2]!]);
      pts.set(sub(p, pivot), i * 3);
    }
    let turn = mat4.identity();
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      // The weight's middle, and how hard it is to turn about the hold (its inertia there).
      const c: V3 = [0, 0, 0];
      const I = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      for (let i = 0; i < n; i++) {
        const w = this.weights[i]!;
        const r: V3 = [pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!];
        for (let k = 0; k < 3; k++) c[k]! += w * r[k]!;
        const rr = dot(r, r);
        for (let a = 0; a < 3; a++)
          for (let b = 0; b < 3; b++) I[a]![b]! += w * ((a === b ? rr : 0) - r[a]! * r[b]!);
      }
      const torque = cross(c, pull);
      if (this.hinge) {
        const e = this.hinge;
        const Ie = dot(e, [dot(I[0] as V3, e), dot(I[1] as V3, e), dot(I[2] as V3, e)]);
        const alpha = Ie > 1e-9 ? dot(e, torque) / Ie : 0;
        const w = dot(this.spin, e) + alpha * h;
        this.spin = scale(e, w);
      } else {
        // A little stiffness on every axis keeps a thin thing (all in a line) from spinning wild.
        const tr = I[0]![0]! + I[1]![1]! + I[2]![2]!;
        for (let k = 0; k < 3; k++) I[k]![k]! += tr * 1e-3 + 1e-6;
        const alpha = solve3(I, torque) ?? [0, 0, 0];
        this.spin = [
          this.spin[0] + alpha[0] * h,
          this.spin[1] + alpha[1] * h,
          this.spin[2] + alpha[2] * h,
        ];
      }
      this.spin = scale(this.spin, Math.exp(-DAMPING * h));
      const w = Math.hypot(...this.spin);
      if (w * h < 1e-7) continue;
      const axis = scale(this.spin, 1 / w);
      const r = mat4.rotationAbout([0, 0, 0], axis as [number, number, number], w * h);
      for (let i = 0; i < n; i++) {
        const q = at(r, [pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!]);
        pts.set(q, i * 3);
      }
      turn = mat4.multiply(turn, r);
    }
    if (turn.every((v, i) => v === (i % 5 === 0 ? 1 : 0))) return;
    // The turn found about the origin, made about where it's held.
    const about = mat4.multiply(
      mat4.multiply(mat4.translation(-pivot[0], -pivot[1], -pivot[2]), turn),
      mat4.translation(...pivot),
    );
    this.rt.transformBranch(this.root, about);
  }
}
