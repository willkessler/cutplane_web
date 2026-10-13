import { T, featuresWord, first, offsetWord, type VM } from '@cutplane/cpl';
import {
  Brep,
  drawAcrossFace,
  extrudeFace,
  makeLamina,
  mat4,
  snap,
  validate,
  type CutObject,
  type Spot,
} from '@cutplane/kernel';
import { booleansReady, simpleOutline } from '@cutplane/booleans';
import { isObject, isSub, type Sub } from '../features.ts';
import type { Runtime, V3 } from '../runtime.ts';
import type { WorldFeature } from '../features.ts';

/**
 * The pencil (cplib.c's start_draw, extend_draw, end_draw), run by the original
 * pencil.cpl: pressing starts a scribble at the crosshair, moving draws it, and
 * letting go closes it into a face and extrudes it 50 deep (extrude_face).
 *
 * New here: the stroke is tidied before it is closed (steps under MIN_STEP
 * dropped, straight runs merged). An open stroke is closed with a straight line
 * from its end back to its start; one that then crosses itself (an end that
 * overshoots the start, a figure eight) becomes the largest region it encloses.
 * Only a stroke too small to be a face is thrown away, as end_draw threw away
 * one that wasn't flat.
 */

/** end_draw's extrusion: 50 units along z. */
export const SCRIBBLE_DEPTH = 50;
/** Points closer than this to the last one kept are dropped. */
const MIN_STEP = 2;
/** How far a point may be from the line through its neighbours and still be dropped. */
const STRAIGHT = 0.75;
/** How far off the stroke's starting depth a point may be and still count as flat. */
const FLAT_TOL = 0.05;
/** The smallest face a scribble may close into. */
const MIN_AREA = 25;

/** The points of each scribble being drawn, in its own frame. */
const strokes = new WeakMap<CutObject, { pts: V3[]; last: number }>();

/** Whether `o` is a scribble still being drawn (draw_scribble_technique). */
export const isScribble = (o: CutObject): boolean => o.drawTechnique === 'draw_scribble_technique';

/** draw_on_surface's first end (its static vfe1/evf1 and cutpt1), until the second. */
const surfaceStart = new WeakMap<Runtime, { feature: Sub; at: V3 }>();

/**
 * Where draw_on_surface takes a vertex or edge: a vertex where it is; an edge where
 * the plane crosses it, or (lying in the plane) its point nearest the crosshair.
 */
function spotAt(rt: Runtime, f: Sub): V3 {
  const g = rt.world(f.object);
  const at = (v: number): V3 => [g.x(v), g.y(v), g.z(v)];
  if (f.type === T.Vfe) return at(f.id);
  const [p, q] = f.object.brep.edgeVertices(f.id).map(at) as [V3, V3];
  const c = rt.cursor();
  const z = c[2];
  const dz = q[2] - p[2];
  let t: number;
  if (Math.abs(dz) > 1e-9 && (p[2] - z) * (q[2] - z) <= 0) t = (z - p[2]) / dz;
  else {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const len = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
    t = len === 0 ? 0 : ((c[0] - p[0]) * d[0]! + (c[1] - p[1]) * d[1]! + (c[2] - p[2]) * d[2]!) / len; // prettier-ignore
    t = Math.min(1, Math.max(0, t));
  }
  return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])];
}

const isEnd = (f: unknown): f is Sub => isSub(f as Sub) && ((f as Sub).type === T.Vfe || (f as Sub).type === T.Evf); // prettier-ignore

const offsetOf = (w: { offset: readonly number[] }): V3 => [w.offset[0] ?? 0, w.offset[1] ?? 0, w.offset[2] ?? 0]; // prettier-ignore

export const PENCIL_CRTNS: Partial<Record<string, (rt: Runtime, vm: VM) => void>> = {
  /** CPL_start_draw: (selectables) → (scribble): a one-vertex object at the crosshair. */
  start_draw(rt, vm) {
    vm.pop();
    const at = rt.cursor();
    const o = rt.makeObj(vm.working as WorldFeature, at, null, [], {
      selectTechnique: 'set_always_selectable',
      drawTechnique: 'draw_scribble_technique',
    });
    const v = o.brep.vertices()[0]!;
    strokes.set(o, { pts: [[...at] as V3], last: v });
    vm.push(featuresWord(o));
  },

  /** CPL_extend_draw: (scribble, crosshair move): a new vertex that far from the last. */
  extend_draw(rt, vm) {
    const move = offsetOf(vm.pop());
    const o = first(vm.pop());
    const s = isObject(o) ? strokes.get(o) : undefined;
    if (!isObject(o) || !s) {
      vm.push(featuresWord(null));
      return;
    }
    if (move[0] !== 0 || move[1] !== 0 || move[2] !== 0) {
      const p = o.brep.vertexPos(s.last);
      const to: V3 = [p[0] + move[0], p[1] + move[1], p[2] + move[2]];
      s.last = rt.addVertexEdge(o, s.last, to);
      s.pts.push(to);
      rt.changed(o);
    }
    vm.push(featuresWord(o));
  },

  /**
   * CPL_draw_on_surface: (vertex or edge, connect) → (start point) | (). The first
   * press marks where the line starts; the second, on the same object, draws it
   * across the face the two share, splitting that face in two (one undo step).
   * The original broke the first edge even when no face was shared; here nothing
   * changes unless the line is drawn.
   */
  draw_on_surface(rt, vm) {
    const connect = vm.pop().bool;
    const f = first(vm.pop());
    if (!isEnd(f)) return;
    if (!connect) {
      const at = spotAt(rt, f);
      surfaceStart.set(rt, { feature: f, at });
      vm.push(offsetWord(at));
      return;
    }
    const start = surfaceStart.get(rt);
    surfaceStart.delete(rt);
    if (!start || start.feature.object !== f.object) return;
    const o = f.object;
    const local = (p: V3): V3 => {
      const [x, y, z] = mat4.transformPoint(o.invXform, p[0], p[1], p[2]);
      return [snap(x), snap(y), snap(z)];
    };
    const spot = (s: Sub, at: V3): Spot =>
      s.type === T.Vfe ? { vertex: s.id } : { edge: s.id, at: local(at) };
    const b = o.brep.clone();
    if (drawAcrossFace(b, spot(start.feature, start.at), spot(f, spotAt(rt, f))) === null) return;
    const was = validate(o.brep);
    const now = validate(b);
    if (!now.ok || (was.closedManifold && !now.closedManifold)) return;
    rt.reshape(o, b);
  },

  /** CPL_draw_line: (from, to) → (): the Line object (the rubber band) runs between them. */
  draw_line(rt, vm) {
    const to = offsetOf(vm.pop());
    const from = offsetOf(vm.pop());
    const [a, c] = rt.line.brep.vertices() as [number, number];
    rt.line.brep.setVertexPos(a, ...from);
    rt.line.brep.setVertexPos(c, ...to);
    rt.changed(rt.line);
  },

  /**
   * CPL_end_draw: (selectables, scribble) → (solid or Nil): a flat stroke closes
   * into a face, extruded; anything else is thrown away.
   */
  end_draw(rt, vm) {
    const o = first(vm.pop());
    vm.pop();
    const s = isObject(o) ? strokes.get(o) : undefined;
    if (!isObject(o) || !s) {
      vm.push(featuresWord(null));
      return;
    }
    strokes.delete(o);
    const brep = closeStroke(s.pts);
    if (!brep) {
      rt.killNow(o);
      vm.push(featuresWord(null));
      return;
    }
    rt.reshape(o, brep);
    o.selectTechnique = 'set_object_selectable';
    o.drawTechnique = 'normal_draw_technique';
    rt.changed(o);
    vm.push(featuresWord(o));
  },
};

/** A stroke closed into a face and extruded; null if it isn't flat, simple and big enough. */
export function closeStroke(raw: readonly V3[]): Brep | null {
  if (raw.length < 3) return null;
  const z = raw[0]![2];
  // end_draw: only finish if flat. Each step comes through CPL's single-precision
  // words, so off z = 0 the points drift a little off the plane they were drawn in.
  if (raw.some((p) => Math.abs(p[2] - z) > FLAT_TOL)) return null;
  let pts = tidy(raw.map((p) => [snap(p[0]), snap(p[1]), z] as V3));
  if (pts.length < 3) return null;
  if (!simple(pts)) {
    const outline = booleansReady() ? simpleOutline(pts.map((p) => [p[0], p[1]] as const)) : null;
    if (!outline) return null;
    pts = tidy(outline.map((p) => [snap(p[0]), snap(p[1]), z] as V3));
    if (pts.length < 3 || !simple(pts)) return null;
  }
  const area = signedArea(pts);
  if (Math.abs(area) < MIN_AREA) return null;
  if (area < 0) pts = pts.reverse();
  const b = new Brep();
  const { front, back } = makeLamina(b, pts);
  const up = b.faceNormal(front)[2] > 0 ? front : back;
  extrudeFace(b, up, 0, 0, SCRIBBLE_DEPTH);
  const r = validate(b);
  return r.ok && r.closedManifold ? b : null;
}

/** Drops steps too small to see and points on straight runs (the loop is closed). */
function tidy(pts: V3[]): V3[] {
  const kept: V3[] = [];
  for (const p of pts) {
    const q = kept[kept.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= MIN_STEP) kept.push(p);
  }
  while (kept.length > 2) {
    const a = kept[0]!;
    const b = kept[kept.length - 1]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= MIN_STEP) break;
    kept.pop();
  }
  // Merge straight runs until nothing more goes.
  let changed = true;
  while (changed && kept.length > 3) {
    changed = false;
    for (let i = 0; i < kept.length && kept.length > 3; i++) {
      const a = kept[(i + kept.length - 1) % kept.length]!;
      const p = kept[i]!;
      const b = kept[(i + 1) % kept.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const off = len === 0 ? 0 : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len; // prettier-ignore
      if (off < STRAIGHT) {
        kept.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return kept;
}

function signedArea(pts: readonly V3[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** No two edges of the closed polygon meet except neighbours at their shared corner. */
function simple(pts: readonly V3[]): boolean {
  const n = pts.length;
  const cross = (o: V3, a: V3, b: V3) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); // prettier-ignore
  const hits = (p1: V3, p2: V3, p3: V3, p4: V3) => {
    const d1 = cross(p3, p4, p1);
    const d2 = cross(p3, p4, p2);
    const d3 = cross(p1, p2, p3);
    const d4 = cross(p1, p2, p4);
    if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0) return overlap(p1, p2, p3, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)); // prettier-ignore
  };
  // Two segments on one line overlap if their spans along it do.
  const overlap = (p1: V3, p2: V3, p3: V3, p4: V3) => {
    const k = Math.abs(p2[0] - p1[0]) >= Math.abs(p2[1] - p1[1]) ? 0 : 1;
    const [a0, a1] = [Math.min(p1[k], p2[k]), Math.max(p1[k], p2[k])];
    const [b0, b1] = [Math.min(p3[k], p4[k]), Math.max(p3[k], p4[k])];
    return Math.min(a1, b1) > Math.max(a0, b0);
  };
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (hits(pts[i]!, pts[(i + 1) % n]!, pts[j]!, pts[(j + 1) % n]!)) return false;
    }
  return true;
}
