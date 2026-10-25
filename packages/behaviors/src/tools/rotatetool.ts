import {
  Aux,
  P,
  T,
  boolWord,
  featuresWord,
  first,
  offsetWord,
  setupAux,
  Word,
  type VM,
} from '@cutplane/cpl';
import type { CutObject } from '@cutplane/kernel';
import { isObject, isSub, type Sub } from '../features.ts';
import { SelectKind, type Runtime, type V3 } from '../runtime.ts';

/**
 * The rotate tool (rotatetool.c's create_rotatetool and its C routines;
 * select.c's rotate selectechniques), run by the original rotatecircle.cpl,
 * rotatexbar.cpl and rotatebauble.cpl.
 *
 * Objects, as the C builds them: the inner circle (one vertex, the centre;
 * a child of the cutplane object, so it stays in the plane), and under it two
 * crossbars (two vertices and an edge each: the vertices are the baubles) and
 * the outer circle. The circles run rotatecircle.cpl, each bar's edge
 * rotatexbar.cpl and each bauble rotatebauble.cpl, as private code.
 *
 * - R (rotatecircle's Snaprotatetool) brings the tool to the feature under
 *   the crosshair, lined up with it, or squares it up at the crosshair; over
 *   the centre it puts the tool away. The centre can be carried and dropped.
 * - A bar rolls what is picked about the in-plane axis across it, 1° per unit
 *   along the bar; a bauble turns it about the plane normal (or the piercing
 *   edge the tool was set on), the tool turning along.
 *
 * Deliberate fixes, as in M4: the in-plane face snap's 7.5° input test uses
 * |angle| (the original let any negative angle through); bar and dial angles
 * keep their fractions (the original truncated each step to a whole tenth or
 * degree, losing slow motion); the dial's stops (every 45°, where the
 * original's rounding left only horizontal) bring the crosshair there with
 * the object, and hold, as the bar's stop with a face across the plane does; R over a vertex or an in-plane
 * face brings the tool there (the original left it where it was).
 */

/** rotatetool.h, in room units. */
export const ROTATE_RADIUS = 130; // Rotatetoolradius
const DOCK_MARGIN = ROTATE_RADIUS / 4; // Rotatedockmargin
/** Rotatetool_dockx/y (347.5, 220.5): Maxcrossx/y less the radius and margin. */
export const ROTATE_DOCK: V3 = [
  510 - ROTATE_RADIUS - DOCK_MARGIN,
  383 - ROTATE_RADIUS - DOCK_MARGIN,
  0,
];
const PK = 10;
export const BAUBLE_SIZE = PK; // Baublesize
const DRAG_BAUBLE_SIZE = PK * 1.3; // Dragbaublesize
export const CENTER_SIZE = PK * 2; // Rotateiconctrsize
/** rotateobj.h's tolznorm. */
const TOLZNORM = 0.996;
/**
 * How far (along the bar, 1° a unit) the face stood across the plane holds
 * before it turns on (new: the original's 5-event pause is gone in a blink at a
 * browser's event rate). As firm as the plane's stick (PLANE_STICK).
 */
export const PERP_HOLD = 15;
/** The dial's stops: compute_snapped_rotangle's snapangle (45). */
export const DIAL_STEP = 45;
/**
 * How near (degrees) a bauble is to a stop to count as on it: the tool sits on
 * the 1/256 grid, a few thousandths of a degree out at its radius.
 */
const STOP_TOL = 0.01;
const DEG = 180 / Math.PI;

export interface RotateTool {
  inner: CutObject;
  outer: CutObject;
  hbar: CutObject;
  vbar: CutObject;
}

/** rotatetool.c's globals, kept per runtime. */
interface ToolState {
  tool: RotateTool;
  /** The face that can snap into the plane (set on its section line). */
  snapFace: Sub | null;
  /** A piercing edge's direction: the dial turns about it. */
  otherAxis: V3 | null;
  /** Where snap_rotatetool puts the centre. */
  placePt: V3;
  /** Push along the bar so far against the stop with the face across the plane (new). */
  held: number | null;
  /** Push along the dial so far against one of its stops (new). */
  dialHeld: number | null;
}
const states = new WeakMap<Runtime, ToolState>();

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return l === 0 ? [1, 0, 0] : scale(a, 1 / l);
};
const Z: V3 = [0, 0, 1];

/** point_vec_up: the unit vector pt1 → pt2, flipped to point up (or right when level). */
function pointVecUp(p1: V3, p2: V3): V3 {
  const v = unit(sub(p2, p1));
  if (dot(v, [1, 0, 0]) < 0) {
    if (v[1] < -1e-6) return scale(v, -1);
  } else if (v[1] < 0) return scale(v, -1);
  return v;
}

const pos = (rt: Runtime, o: CutObject, v: number): V3 => {
  const g = rt.world(o);
  return [g.x(v), g.y(v), g.z(v)];
};

/** setvfe: puts a vertex at a world position. */
function setVertex(rt: Runtime, o: CutObject, v: number, p: V3): void {
  const m = o.invXform;
  const [x, y, z] = p;
  o.brep.setVertexPos(
    v,
    x * m[0]! + y * m[4]! + z * m[8]! + m[12]!,
    x * m[1]! + y * m[5]! + z * m[9]! + m[13]!,
    x * m[2]! + y * m[6]! + z * m[10]! + m[14]!,
  );
  rt.changed(o);
}

const centerOf = (rt: Runtime, t: RotateTool): V3 => rt.firstVertex(t.inner)!;
const ends = (bar: CutObject): [number, number] => bar.brep.edgeVertices(bar.brep.edges()[0]!);

/** create_rotatetool: the tool's objects, in the environment at the dock. */
export function createRotateTool(rt: Runtime): RotateTool {
  const env = rt.environment;
  const flat = ['Nonmanifold', 'Noshadow'];
  const inner = rt.makeObj(env, [0, 0, 0], 'Rotatetool_Innercircle', flat, {
    selectTechnique: 'set_rotate_innercircle_selectable',
    drawTechnique: 'draw_rotate_innercircle',
  });
  rt.adopt(rt.cutplane, inner, true);
  const bar = (name: string, a: V3, b: V3) => {
    const o = rt.makeObj(env, a, name, flat, {
      selectTechnique: 'set_rotatexbar_selectable',
      drawTechnique: 'draw_rotatexbar',
    });
    rt.addVertexEdge(o, o.brep.vertices()[0]!, b);
    rt.addProp(rt.features.edge(o, o.brep.edges()[0]!), 'Visible');
    rt.adopt(inner, o, false);
    return o;
  };
  const R = ROTATE_RADIUS;
  const hbar = bar('Horizontal_Crossbar', [-R, 0, 0], [R, 0, 0]);
  const vbar = bar('Vertical_Crossbar', [0, -R, 0], [0, R, 0]);
  const outer = rt.makeObj(env, [0, 0, 0], 'Rotatetool_Outercircle', flat, {
    selectTechnique: 'set_rotate_outercircle_selectable',
    drawTechnique: 'draw_rotate_outercircle',
  });
  rt.adopt(inner, outer, false);
  const tool = { inner, outer, hbar, vbar };
  states.set(rt, {
    tool,
    snapFace: null,
    otherAxis: null,
    placePt: [0, 0, 0],
    held: null,
    dialHeld: null,
  });
  resetTool(rt, tool);
  rt.translate(inner, [ROTATE_DOCK[0], ROTATE_DOCK[1], rt.cursor()[2]]);
  for (const o of [inner, hbar, vbar, outer])
    for (const p of ['Alwaysdraw', 'Selectinvisible', 'Pickedinvisible']) rt.addProp(o, p);
  return tool;
}

/** attach_rotatetool_CPLcode. */
export function attachRotateToolCode(
  rt: Runtime,
  tool: RotateTool,
  source: (f: string) => string,
): void {
  const load = (f: Parameters<VM['loadPrivateCode']>[0], file: string) =>
    rt.vm.loadPrivateCode(f, source(file), file);
  load(tool.inner, 'rotatecircle.cpl');
  load(tool.outer, 'rotatecircle.cpl');
  for (const bar of [tool.hbar, tool.vbar]) {
    for (const v of ends(bar)) load(rt.features.vertex(bar, v), 'rotatebauble.cpl');
    load(rt.features.edge(bar, bar.brep.edges()[0]!), 'rotatexbar.cpl');
  }
  rt.vm.resolveObjectRefs();
}

/** The whole tool: objects, code, C routines and selectechniques. */
export function installRotateTool(rt: Runtime, source: (f: string) => string): RotateTool {
  const tool = createRotateTool(rt);
  attachRotateToolCode(rt, tool, source);
  rt.registerCrtns(ROTATE_CRTNS);
  rt.selectTechniques['set_rotate_innercircle_selectable'] = (o) => innerSelectable(rt, o);
  rt.selectTechniques['set_rotatexbar_selectable'] = (o) => xbarSelectable(rt, o);
  // select.c never makes the outer circle selectable (its body is #if 0).
  rt.selectTechniques['set_rotate_outercircle_selectable'] = (o) =>
    rt.applySelectable(o, { feature: null, kind: SelectKind.Nothing, at: [0, 0, 0] });
  return tool;
}

export const rotateToolOf = (rt: Runtime): RotateTool | undefined => states.get(rt)?.tool;

// ---- showing and placing the bars ----

function showBar(rt: Runtime, bar: CutObject, bar_: boolean, baubles: boolean): void {
  const set = (f: Sub, on: boolean) => {
    if (on) rt.addProp(f, 'Visible');
    else if (rt.vm.props.has(f, P.Visible)) rt.vm.props.del(f, P.Visible);
  };
  set(rt.features.edge(bar, bar.brep.edges()[0]!), bar_);
  for (const v of ends(bar)) set(rt.features.vertex(bar, v), baubles);
  rt.changed(bar);
}

/** reset_rotatetool: the bars square to the room, both shown. */
function resetTool(rt: Runtime, t: RotateTool): void {
  const c = centerOf(rt, t);
  const st = states.get(rt)!;
  st.placePt = c;
  placeBars(rt, t, c, [1, 0, 0]);
  showBar(rt, t.hbar, true, true);
  showBar(rt, t.vbar, true, true);
}

/** The horizontal bar along `h`, the vertical one a quarter turn from it, through `c`. */
function placeBars(rt: Runtime, t: RotateTool, c: V3, h: V3): void {
  const R = ROTATE_RADIUS;
  const v: V3 = [-h[1], h[0], 0];
  const [h1, h2] = ends(t.hbar);
  setVertex(rt, t.hbar, h1, add(c, scale(h, R)));
  setVertex(rt, t.hbar, h2, add(c, scale(h, -R)));
  const [v1, v2] = ends(t.vbar);
  setVertex(rt, t.vbar, v1, add(c, scale(v, R)));
  setVertex(rt, t.vbar, v2, add(c, scale(v, -R)));
}

/** orient_rotatetool: the vertical bar along the section line p1–p2 (hidden), the other across it. */
function orientTool(rt: Runtime, t: RotateTool, p1: V3, p2: V3, at: V3): void {
  const s = pointVecUp(p1, p2);
  const st = states.get(rt)!;
  st.placePt = at;
  placeBars(rt, t, centerOf(rt, t), [s[1], -s[0], 0]);
  showBar(rt, t.hbar, true, true);
  showBar(rt, t.vbar, false, false);
}

/** The section line a face of `o` makes in the plane at z: its direction, n × ẑ. */
function sectionLine(rt: Runtime, face: Sub): [V3, V3] {
  const n = rt.world(face.object).faceNormal(face.id);
  const d = unit([n[1], -n[0], 0]);
  return [[0, 0, 0], d];
}

// ---- selectechniques ----

const NOTHING = { feature: null, kind: SelectKind.Nothing, at: [0, 0, 0] as V3 };

/** set_rotate_innercircle_selectable: within Rotateiconctrsize of the centre. */
function innerSelectable(rt: Runtime, inner: CutObject): void {
  if (!rt.vm.props.has(inner, P.Visible)) return;
  const c = rt.firstVertex(inner)!;
  const d = sub(rt.cursor(), c);
  if (dot(d, d) <= CENTER_SIZE * CENTER_SIZE)
    rt.applySelectable(inner, { feature: inner, kind: SelectKind.Obj, at: c });
  else rt.applySelectable(inner, NOTHING);
}

/** set_rotatexbar_selectable: a shown bauble within Baublesize, else the shown bar within Dragbaublesize. */
function xbarSelectable(rt: Runtime, bar: CutObject): void {
  const cur = rt.cursor();
  const [a, b] = ends(bar);
  const pa = pos(rt, bar, a);
  const pb = pos(rt, bar, b);
  const shown = (f: Sub) => rt.vm.props.has(f, P.Visible);
  for (const [v, p] of [
    [a, pa],
    [b, pb],
  ] as const) {
    const h = rt.features.vertex(bar, v);
    if (Math.hypot(...sub(cur, p)) <= BAUBLE_SIZE && shown(h)) {
      rt.applySelectable(bar, { feature: h, kind: SelectKind.Vert, at: p });
      return;
    }
  }
  const e = rt.features.edge(bar, bar.brep.edges()[0]!);
  const ab = sub(pb, pa);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(cur, pa), ab) / l2));
  const near = add(pa, scale(ab, t));
  if (Math.hypot(...sub(cur, near)) <= DRAG_BAUBLE_SIZE && shown(e)) {
    rt.applySelectable(bar, { feature: e, kind: SelectKind.Edge, at: near });
    return;
  }
  rt.applySelectable(bar, NOTHING);
}

/**
 * Is the tool held at one of its stops (new)? The baubles and the crosshair's ring
 * are drawn half as big again there, so the stop can be seen as well as felt.
 */
export function rotateToolHeld(rt: Runtime): boolean {
  const st = states.get(rt);
  return !!st && (st.held !== null || st.dialHeld !== null);
}

// ---- the C routines ----

/** A rotate record: (axis, point, tenths of a degree). */
function rotateWord(axis: V3, point: V3, tenths: number): Word {
  const w = new Word();
  setupAux(w, Aux.Rotate);
  w.vec = [...axis, ...point, tenths];
  return w;
}

/** snap_face_to_plane: tenths of a degree that lay the face in the plane (0 unless nearly there). */
function snapFaceToPlane(rotaxis: V3, n: V3): number {
  if (Math.abs(n[2]) <= TOLZNORM) return 0;
  let a = 10 * DEG * Math.acos(Math.min(1, Math.max(-1, n[2])));
  if (n[2] < 0) a -= 1800;
  if (rotaxis[0] * n[1] + rotaxis[1] * -n[0] < 0) a = -a;
  return a;
}

/** snap_face_to_plane_perp: tenths of a degree that stand the face across the plane. */
function snapFaceToPlanePerp(rotaxis: V3, n: V3): number {
  if (n[2] === 0) return 0;
  let p = cross(rotaxis, Z);
  if (dot(p, n) < 0) p = scale(p, -1);
  p = unit(p);
  let a = 10 * DEG * Math.acos(Math.min(1, Math.max(-1, dot(unit(n), p))));
  if (dot(cross(n, p), rotaxis) < 0) a = -a;
  return a;
}

interface XbarRot {
  axis: V3;
  point: V3;
  tenths: number;
  trans: V3;
  snapped: boolean;
  paused: boolean;
}

/** create_xbar_rotrec: a drag along a bar becomes a roll about the in-plane axis across it. */
function xbarRotation(rt: Runtime, bar: CutObject, trans: V3): XbarRot {
  const st = states.get(rt)!;
  const [a, b] = ends(bar);
  const p1 = pos(rt, bar, a);
  const p2 = pos(rt, bar, b);
  const point = scale(add(p1, p2), 0.5);
  const xv = pointVecUp(p1, p2);
  const axis = cross(Z, xv);
  const along = dot(xv, trans);
  let t = scale(xv, along);
  // Stop at the baubles.
  const cursor = rt.cursor();
  const total = sub(p2, p1);
  const to = add(cursor, t);
  const c1 = sub(to, p1);
  const c2 = sub(to, p2);
  if (Math.sign(dot(c1, total)) === Math.sign(dot(c2, total)))
    t = Math.abs(dot(t, c1)) < Math.abs(dot(t, c2)) ? sub(p1, cursor) : sub(p2, cursor);
  let tenths = along * 10;
  let snapped = false;
  let paused = false;
  const f = st.snapFace;
  st.dialHeld = null; // rolling, not at a dial stop
  if (st.held !== null) {
    // Stood across the plane: hold until pushed PERP_HOLD along the bar, either way.
    const n = f && rt.features.alive(f) ? rt.world(f.object).faceNormal(f.id) : null;
    if (n && Math.abs(n[2]) < 1e-6 && Math.abs(st.held + along) < PERP_HOLD) {
      st.held += along;
      return { axis, point, tenths: 0, trans: [0, 0, 0], snapped, paused: false };
    }
    st.held = null;
  }
  if (f && rt.features.alive(f) && Math.abs(tenths) < 75) {
    const n = rt.world(f.object).faceNormal(f.id);
    const takes = (s: number) =>
      s * tenths > 0 && (Math.abs(s) < Math.abs(tenths) || Math.abs(s) < 50);
    const s = snapFaceToPlane(axis, n);
    if (takes(s)) {
      snapped = true;
      tenths = s;
    } else {
      const sp = snapFaceToPlanePerp(axis, n);
      // (Not again as it leaves the stop, a hair off by rounding.)
      if (Math.abs(sp) > 0.01 && takes(sp)) {
        paused = true;
        tenths = sp;
        st.held = 0;
      }
    }
  }
  return { axis, point, tenths, trans: t, snapped, paused };
}

export const ROTATE_CRTNS: Partial<Record<string, (rt: Runtime, vm: VM) => void>> = {
  /** CPL_xbar_rotate: (filler, xbar, translation) → (snapped, paused, rotation, translation). */
  xbar_rotate(rt, vm) {
    const tr = vm.pop();
    const barRec = vm.pop();
    vm.pop();
    const e = first(barRec);
    const t: V3 = [tr.offset[0] ?? 0, tr.offset[1] ?? 0, tr.offset[2] ?? 0];
    if (!isSub(e) || !states.has(rt)) {
      vm.push(boolWord(false));
      vm.push(boolWord(false));
      vm.push(rotateWord(Z, [0, 0, 0], 0));
      vm.push(offsetWord(t));
      return;
    }
    const r = xbarRotation(rt, e.object, t);
    vm.push(boolWord(r.snapped));
    vm.push(boolWord(r.paused));
    vm.push(rotateWord(r.axis, r.point, r.tenths));
    vm.push(offsetWord(r.trans));
  },

  /**
   * CPL_bauble_rotate: (filler, filler, bauble, translation) → (back-to-bar xbar or Nil,
   * snapped (unused), paused, object rotation, tool rotation, translation).
   */
  bauble_rotate(rt, vm) {
    const tr = vm.pop();
    const baubleRec = vm.pop();
    vm.pop();
    vm.pop();
    const t: V3 = [tr.offset[0] ?? 0, tr.offset[1] ?? 0, tr.offset[2] ?? 0];
    const bauble = first(baubleRec);
    const st = states.get(rt);
    const out = (back: Sub | null, paused: boolean, obj: Word, tool: Word, trans: V3) => {
      vm.push(featuresWord(back));
      vm.push(boolWord(false));
      vm.push(boolWord(paused));
      vm.push(obj);
      vm.push(tool);
      vm.push(offsetWord(trans));
    };
    if (!isSub(bauble) || bauble.type !== T.Vfe || !st) {
      out(null, false, rotateWord(Z, [0, 0, 0], 0), rotateWord(Z, [0, 0, 0], 0), t);
      return;
    }
    const bar = bauble.object;
    const xbar = rt.features.edge(bar, bar.brep.edges()[0]!);
    const [a, b] = ends(bar);
    const p1 = pos(rt, bar, a);
    const p2 = pos(rt, bar, b);
    const xv = pointVecUp(p1, p2);
    const center = scale(add(p1, p2), 0.5);
    const bp = pos(rt, bar, bauble.id);
    const other = cross(xv, Z);
    const out_ = unit(sub(bp, center));
    const escaped = dot(t, out_);
    if (
      Math.abs(dot(t, other)) < Math.abs(dot(t, xv)) &&
      escaped < -BAUBLE_SIZE / 2 &&
      rt.vm.props.has(xbar, P.Visible)
    ) {
      // Pulled in toward the centre: back to rolling along the bar.
      const r = xbarRotation(rt, bar, t);
      const w = rotateWord(r.axis, r.point, r.tenths);
      out(xbar, r.paused, w, w, r.trans);
      return;
    }
    // The dial. Not at the bar's stop (turning about z keeps the face across the plane).
    st.held = null;
    const cursor = rt.cursor();
    const n1 = unit(sub(bp, center));
    const to = add(cursor, t);
    const v2 = sub(to, center);
    v2[2] = 0;
    if (Math.hypot(...v2) < 1e-9) {
      out(null, false, rotateWord(Z, center, 0), rotateWord(Z, center, 0), sub(bp, cursor));
      return;
    }
    // Held at a stop: the bauble stays until pushed PERP_HOLD along the circle, either way.
    const a1 = Math.atan2(n1[1], n1[0]) * DEG;
    const offStop = (a: number) => Math.abs(a - Math.round(a / DIAL_STEP) * DIAL_STEP);
    if (st.dialHeld !== null) {
      const push = dot(t, unit(cross(Z, n1)));
      if (offStop(a1) < STOP_TOL && Math.abs(st.dialHeld + push) < PERP_HOLD) {
        st.dialHeld += push;
        const none = rotateWord(Z, center, 0);
        out(null, false, none, none, sub(bp, cursor));
        return;
      }
      st.dialHeld = null;
    }
    let n2 = unit(v2);
    let deg = Math.atan2(cross(n1, n2)[2], dot(n1, n2)) * DEG;
    let paused = false;
    // compute_snapped_rotangle: a small turn that reaches an eighth of a turn (the bars
    // level, upright or diagonal) stops there, as the original meant: its rounding left
    // only horizontal (new: every 45°, held as the bar's stop is).
    if (Math.abs(deg) <= 10) {
      const a2 = a1 + deg;
      const stop = (deg > 0 ? Math.ceil(a1 / DIAL_STEP) : Math.floor(a1 / DIAL_STEP)) * DIAL_STEP;
      // Reaching it counts (to the tolerance); starting on it doesn't.
      if ((a2 - stop) * Math.sign(deg) > -STOP_TOL && Math.abs(stop - a1) > STOP_TOL) {
        deg = stop - a1;
        const r = stop / DEG;
        const c = Math.cos(r);
        const s = Math.sin(r);
        n2 = [Math.abs(c) < 1e-12 ? 0 : c, Math.abs(s) < 1e-12 ? 0 : s, 0];
        paused = true;
        st.dialHeld = 0;
      }
    }
    let axis = Z;
    if (st.otherAxis) axis = st.otherAxis[2] < 0 ? scale(st.otherAxis, -1) : st.otherAxis;
    const truePos = add(center, scale(n2, ROTATE_RADIUS));
    out(
      null,
      paused,
      rotateWord(axis, center, deg * 10),
      rotateWord(Z, center, deg * 10),
      sub(truePos, cursor),
    );
  },

  /** CPL_snap_rotatetool: the centre goes to rotatetool_placept. */
  snap_rotatetool(rt) {
    const st = states.get(rt);
    if (!st) return;
    const d = sub(st.placePt, centerOf(rt, st.tool));
    if (d.some((x) => x !== 0)) rt.translate(st.tool.inner, d);
  },

  /** CPL_setup_rotatetool: (selectables) — the bars line up with the first. */
  setup_rotatetool(rt, vm) {
    const rec = vm.pop();
    const st = states.get(rt);
    if (!st) return;
    const t = st.tool;
    st.snapFace = null;
    st.held = null;
    st.dialHeld = null;
    st.otherAxis = null;
    const f = first(rec);
    if (!f) {
      showBar(rt, t.hbar, true, true);
      showBar(rt, t.vbar, true, true);
      return;
    }
    const mother = isObject(f) ? f : isSub(f) ? f.object : null;
    if (!mother) return;
    const inPrimary = rt.worldOf(mother) === rt.primary;
    const at = inPrimary ? rt.selectableOf(mother).at : null;
    const place = () => {
      // Deliberate: the tool comes to a vertex or in-plane face too (the original stayed put).
      if (at) st.placePt = [at[0], at[1], centerOf(rt, t)[2]];
    };
    if (f.type === T.Vfe || f.type === T.Obj) {
      resetTool(rt, t);
      if (f.type === T.Vfe) place();
    } else if (f.type === T.Evf) {
      if (rt.vm.props.has(mother, P.Scalebbox)) return; // "HACK BIG BIG BIG HACK!!!GAG GAG GAG"
      const e = f as Sub;
      const [a, b] = e.object.brep.edgeVertices(e.id);
      const pa = pos(rt, e.object, a);
      const pb = pos(rt, e.object, b);
      const z = rt.cursor()[2];
      if (Math.abs(pa[2] - z) < 0.5 && Math.abs(pb[2] - z) < 0.5)
        orientTool(rt, t, pa, pb, at ?? centerOf(rt, t));
      else {
        // setup_other_zaxis: only the dial, about the edge itself.
        st.otherAxis = unit(sub(pa, pb));
        showBar(rt, t.hbar, false, false);
        showBar(rt, t.vbar, false, true);
        st.placePt = at ?? centerOf(rt, t);
      }
    } else if (f.type === T.Fve) {
      const s = rt.selectableOf(mother);
      if (s.kind === SelectKind.Face) {
        // A face crossing the plane: line up with its section line, and let it snap.
        st.snapFace = f as Sub;
        const [p1, p2] = sectionLine(rt, f as Sub);
        orientTool(rt, t, p1, p2, at ?? centerOf(rt, t));
      } else {
        resetTool(rt, t);
        place();
      }
    }
  },
};
