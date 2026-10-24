import { P, T, boolWord, featuresWord, first, offsetWord, type VM } from '@cutplane/cpl';
import {
  createCube,
  createObject,
  mat4,
  subtree,
  type CutObject,
  type Mat4,
} from '@cutplane/kernel';
import { isObject, isSub, type Sub } from '../features.ts';
import { SelectKind, movingVertices, type Runtime, type V3 } from '../runtime.ts';

/**
 * Scale boxes (scale.c's create_scalebbox, rom.cpl's _Create_scaler,
 * scalebbox.cpl, cplib.c's CPL_setup_scalebbox and CPL_scalebbox_trans,
 * select.c's set_scalebbox_selectable).
 *
 * The environment keeps one template box, "Scalebbox", never drawn. Picking
 * a whole object makes rom.cpl copy it into the primary world, size it to the
 * object's branch (grown by BBoxoutdent on every side) and make the object its
 * unlinked child, so moving or turning the object moves the box. Its corners
 * (near the plane) and the points where its edges pierce the plane are
 * handles, and scalebbox.cpl hands their drags to scalebbox_trans:
 *
 * - a corner scales the branch about the opposite corner, each axis on its
 *   own (Ctrl: uniformly, about the centre);
 * - an edge handle scales the two axes across the edge, about the opposite
 *   edge; moving the plane while holding it slides the handle along the edge,
 *   and at a corner the corner takes over (the Activate message).
 *
 * Deliberate fixes (as in M4): the original scaled along the world axes, so a
 * turned box sheared what it held; here the scale is in the box's own frame,
 * which is how the original's commented-out "new scaling method" meant it.
 * And no side gets shorter than 1 unit (the original could turn a solid
 * inside out).
 *
 * New here: faces picked in the plane get a box too, flat in the plane (see
 * syncFaceBox). Its corners scale the faces' vertices, not a branch, so a
 * cylinder's end can be drawn in to make a truncated cone.
 */

/** grafx.h's BBoxoutdent (2 · Pkboxsize) and Pkboxsize. */
export const BOX_OUTDENT = 20;
const PK = 10;
const MIN_SIDE = 1;
const TEMPLATE_SIZE = 100;

/** create_scalebbox: the template the scalers are copied from. */
export function createScaleBoxTemplate(rt: Runtime): CutObject {
  const box = createObject(createCube(TEMPLATE_SIZE, TEMPLATE_SIZE, TEMPLATE_SIZE), {
    name: 'Scalebbox',
    drawTechnique: 'draw_scalebbox_technique',
    selectTechnique: 'set_scalebbox_selectable',
    attrs: {
      props: [
        'Transparent',
        'Noshadow',
        'Sectioninvisible',
        'Selectinvisible',
        'Pickedinvisible',
        'Scalebbox',
      ],
    },
  });
  rt.importObjects(rt.environment, [box]);
  const b = box.brep;
  for (const v of b.vertices()) rt.addProp(rt.features.vertex(box, v), 'Scalebbox');
  for (const e of b.edges()) rt.addProp(rt.features.edge(box, e), 'Scalebbox');
  for (const f of b.faces()) rt.addProp(rt.features.face(box, f), 'Scalebbox');
  return box;
}

export const isScaleBox = (rt: Runtime, o: CutObject): boolean => rt.vm.props.has(o, P.Scalebbox);

// ---- the box's frame ----

const apply = (m: Mat4, p: readonly number[]): V3 => mat4.transformPoint(m, p[0]!, p[1]!, p[2]!);
const along = (m: Mat4, d: readonly number[]): V3 => {
  const a = apply(m, d);
  const o = apply(m, [0, 0, 0]);
  return [a[0] - o[0], a[1] - o[1], a[2] - o[2]];
};
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(...a);

/** The box's corners in its own frame (its Brep's bounding box). */
function localBox(box: CutObject): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const v of box.brep.vertices()) {
    const p = box.brep.vertexPos(v);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[k]!);
      hi[k] = Math.max(hi[k]!, p[k]!);
    }
  }
  return [lo, hi];
}

/** Where an edge of the box pierces the plane at depth z (evf->cutpt), if it does. */
function cutPoint(rt: Runtime, box: CutObject, e: number, z: number): V3 | null {
  const [a, b] = box.brep.edgeVertices(e);
  const g = rt.world(box);
  const p: V3 = [g.x(a), g.y(a), g.z(a)];
  const q: V3 = [g.x(b), g.y(b), g.z(b)];
  if ((p[2] - z) * (q[2] - z) > 0 || p[2] === q[2]) return null;
  const t = (z - p[2]) / (q[2] - p[2]);
  return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), z];
}

const worldPos = (rt: Runtime, o: CutObject, v: number): V3 => {
  const g = rt.world(o);
  return [g.x(v), g.y(v), g.z(v)];
};

/**
 * Scales the box's branch by `f` about `origin`, both in the box's frame, keeping
 * every side at least MIN_SIDE long. Returns how far `handle` (a box-frame point)
 * moved in the world.
 */
function scaleBranch(rt: Runtime, box: CutObject, origin: V3, f: V3, handle: V3): V3 {
  const [lo, hi] = localBox(box);
  const X = box.xform;
  // Each side's world length along the box's own axes.
  for (let k = 0; k < 3; k++) {
    const axis: V3 = [0, 0, 0];
    axis[k] = hi[k]! - lo[k]!;
    const side = len(along(X, axis));
    if (side > 0) {
      const s = f[k]!;
      if (Math.abs(s) * side < MIN_SIDE || s < 0) f[k] = MIN_SIDE / side;
    }
  }
  const inv = mat4.invert(X) ?? mat4.identity();
  const m = mat4.multiply(mat4.multiply(inv, mat4.scaleAbout(origin, f)), X);
  const before = apply(X, handle);
  for (const o of subtree(box)) {
    if (rt.worldOf(o) === rt.primary) rt.journal.touch(o);
    o.xform = mat4.multiply(o.xform, m);
    o.invXform = mat4.invert(o.xform) ?? o.invXform;
    rt.changed(o);
  }
  return sub(apply(box.xform, handle), before);
}

/** Scales what the box holds: its branch, or, a face box, its faces. */
const scale3 = (rt: Runtime, box: CutObject, origin: V3, f: V3, handle: V3): V3 =>
  isFaceBox(box) ? scaleFaces(rt, box, origin, f, handle) : scaleBranch(rt, box, origin, f, handle);

/** The corner diagonally opposite `c` (find_other_bboxcorner), in the box's frame. */
const otherCorner = (lo: V3, hi: V3, c: V3): V3 =>
  [0, 1, 2].map((k) => (Math.abs(c[k]! - lo[k]!) < 1e-9 ? hi[k]! : lo[k]!)) as V3;

/** setup_scalebbox's work: `box` fits the branch at `root`, outdented (again, after a resize). */
export function fitScaleBox(rt: Runtime, box: CutObject, root: CutObject): void {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const o of subtree(root)) {
    if (o === box) continue;
    const g = rt.world(o);
    for (const v of o.brep.vertices()) grow(lo, hi, [g.x(v), g.y(v), g.z(v)]);
  }
  if (!Number.isFinite(lo[0])) return;
  for (let k = 0; k < 3; k++) {
    lo[k] = lo[k]! - BOX_OUTDENT;
    hi[k] = hi[k]! + BOX_OUTDENT;
  }
  fitBox(rt, box, lo, hi);
}

function grow(lo: V3, hi: V3, p: readonly number[]): void {
  for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k]!, p[k]!);
    hi[k] = Math.max(hi[k]!, p[k]!);
  }
}

/** The box's Brep becomes the box lo–hi (world), its frame the world's at `lo`. */
function fitBox(rt: Runtime, box: CutObject, lo: V3, hi: V3): void {
  const [blo, bhi] = localBox(box);
  const b = box.brep;
  for (const v of b.vertices()) {
    const p = b.vertexPos(v);
    const q = [0, 1, 2].map((k) => {
      const span = bhi[k]! - blo[k]!;
      // (A flat box stays flat; one made flat takes its corners from the template's.)
      const t = span === 0 ? 0 : (p[k]! - blo[k]!) / span;
      return t * (hi[k]! - lo[k]!);
    });
    b.setVertexPos(v, q[0]!, q[1]!, q[2]!);
  }
  box.xform = mat4.translation(...lo);
  box.invXform = mat4.translation(-lo[0], -lo[1], -lo[2]);
  rt.changed(box);
}

// ---- boxes round faces in the plane (new here) ----

/** The face boxes made (copies of the template, like the others, but holding nothing). */
const faceBoxes = new WeakSet<CutObject>();

export const isFaceBox = (o: CutObject): boolean => faceBoxes.has(o);

/** How near the plane a face's vertices must all be for it to be "in" it. */
const IN_PLANE = 1e-3;

/**
 * The faces a face box scales: the picks in the primary world (its own handle
 * aside), when every one is a face lying in the plane, of an object whose
 * geometry isn't locked. Otherwise none.
 */
export function facesInPlane(rt: Runtime): Sub[] {
  const z = rt.stage.z;
  const out: Sub[] = [];
  for (const f of rt.picked(rt.primary)) {
    if (isSub(f) && isScaleBox(rt, f.object)) continue;
    if (!isSub(f) || f.type !== T.Fve || !f.object.brep.isFace(f.id)) return [];
    if (rt.vm.props.has(f.object, P.Lockedgeometry)) return [];
    const g = rt.world(f.object);
    const b = f.object.brep;
    for (const l of b.faceLoops(f.id))
      for (const h of b.loopHalfEdges(l))
        if (Math.abs(g.z(b.heVertex(h)) - z) > IN_PLANE) return [];
    out.push(f);
  }
  return out;
}

/** The vertices the faces move, by object (a face of a surface moves the surface, as in a drag). */
function facesVertices(faces: readonly Sub[]): Map<CutObject, number[]> {
  const by = new Map<CutObject, Set<number>>();
  for (const f of faces) {
    let s = by.get(f.object);
    if (!s) by.set(f.object, (s = new Set()));
    for (const v of movingVertices(f.object.brep, T.Fve, f.id)) s.add(v);
  }
  return new Map([...by].map(([o, s]) => [o, [...s]]));
}

/** The faces' extent in the world. */
function facesBounds(rt: Runtime, faces: readonly Sub[]): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const [o, vs] of facesVertices(faces)) {
    const g = rt.world(o);
    for (const v of vs) grow(lo, hi, [g.x(v), g.y(v), g.z(v)]);
  }
  return [lo, hi];
}

/**
 * Each frame: faces picked in the plane have a flat box round them, outdented in
 * the plane, its corners handles (as rom.cpl's _Create_scaler gives a picked
 * object one); it follows them until a handle is taken, and goes when they do.
 */
export function syncFaceBox(rt: Runtime): void {
  const boxes = scaleBoxes(rt, rt.primary.root).filter(isFaceBox);
  const faces = facesInPlane(rt);
  if (faces.length === 0) {
    for (const b of boxes) rt.discard(b);
    return;
  }
  let box = boxes[0];
  for (const b of boxes.slice(1)) rt.discard(b);
  if (!box) {
    box = rt.duplicate(rt.scaleBoxTemplate);
    faceBoxes.add(box);
    rt.adopt(rt.primary.root, box, true);
    rt.vm.props.add(box, P.Visible);
    rt.vm.props.add(box, P.Noshadow);
    rt.vm.props.del(box, P.Dragonly);
  } else if (rt.picked(rt.primary).some((f) => isSub(f) && f.object === box)) return;
  const [lo, hi] = facesBounds(rt, faces);
  const z = rt.stage.z;
  for (let k = 0; k < 2; k++) {
    lo[k] = lo[k]! - BOX_OUTDENT;
    hi[k] = hi[k]! + BOX_OUTDENT;
  }
  lo[2] = hi[2] = z;
  const [blo, bhi] = localBox(box);
  const at = apply(box.xform, [0, 0, 0]);
  const same = [0, 1, 2].every(
    (k) =>
      Math.abs(at[k]! - lo[k]!) < 1e-9 && Math.abs(bhi[k]! - blo[k]! - (hi[k]! - lo[k]!)) < 1e-9,
  );
  if (!same) fitBox(rt, box, lo, hi);
}

/**
 * A face box's scaleBranch: the faces' vertices are scaled by `f` about `origin`
 * (box frame) in the plane, no face side below MIN_SIDE, and the box with them.
 * Returns how far `handle` moved.
 */
function scaleFaces(rt: Runtime, box: CutObject, origin: V3, f: V3, handle: V3): V3 {
  const faces = facesInPlane(rt);
  if (faces.length === 0) return [0, 0, 0];
  const [lo, hi] = facesBounds(rt, faces);
  f[2] = 1;
  for (let k = 0; k < 2; k++) {
    const side = hi[k]! - lo[k]!;
    if (side > 0 && (f[k]! * side < MIN_SIDE || f[k]! < 0)) f[k] = MIN_SIDE / side;
  }
  const X = box.xform;
  const s = mat4.scaleAbout(origin, f);
  const inv = mat4.invert(X) ?? mat4.identity();
  const m = mat4.multiply(mat4.multiply(inv, s), X);
  for (const [o, vs] of facesVertices(faces)) rt.transformVertices(o, vs, m);
  const b = box.brep;
  for (const v of b.vertices()) {
    const p = apply(s, b.vertexPos(v));
    b.setVertexPos(v, p[0], p[1], p[2]);
  }
  rt.changed(box);
  return sub(apply(s, handle), handle);
}

/** CPL_scalebbox_trans's memory: the edge a corner drag started on. */
let storedEdge: V3 | null = null;

export const SCALEBOX_CRTNS: Partial<Record<string, (rt: Runtime, vm: VM) => void>> = {
  /** CPL_setup_scalebbox: (scalebbox, group root) — the box fits the branch, outdented. */
  setup_scalebbox(rt, vm) {
    const root = first(vm.pop());
    const box = first(vm.pop());
    if (!isObject(root) || !isObject(box) || !isScaleBox(rt, box)) return;
    fitScaleBox(rt, box, root);
  },

  /**
   * CPL_scalebbox_trans: (handle, translation, constraining, switched) →
   * (translation the crosshair should make, corner to activate or Nil, switched).
   */
  scalebbox_trans(rt, vm) {
    const switchedRec = vm.pop();
    const constrainRec = vm.pop();
    const transRec = vm.pop();
    const handleRec = vm.pop();
    const h = first(handleRec);
    let switched = switchedRec.bool;
    const out = (t: V3, snapped: Sub | null) => {
      vm.push(offsetWord(t));
      vm.push(featuresWord(snapped)); // [Nil] when nothing snapped, as in C
      vm.push(boolWord(switched));
    };
    const t: V3 = [transRec.offset[0] ?? 0, transRec.offset[1] ?? 0, transRec.offset[2] ?? 0];
    if (!isSub(h) || !isScaleBox(rt, h.object)) {
      out(t, null);
      return;
    }
    const constraining = constrainRec.bool;
    const box = h.object;
    const inv = mat4.invert(box.xform) ?? mat4.identity();
    const [lo, hi] = localBox(box);
    const center = scale(add(lo, hi), 0.5);

    if (h.type === T.Vfe) {
      const corner = box.brep.vertexPos(h.id);
      let tw = t;
      // A face box keeps to the plane: its faces are in it.
      if (isFaceBox(box)) tw = [t[0], t[1], 0];
      else if (!constraining && switched && storedEdge && t[2] !== 0) {
        // Keep following the edge the drag came along (rotated boxes).
        const e: V3 = storedEdge[2] * t[2] < 0 ? scale(storedEdge, -1) : storedEdge;
        tw = scale(e, len(t) / Math.abs(e[2]));
      }
      const tl = along(inv, tw);
      if (constraining) {
        const diag = sub(corner, center);
        const d2 = dot(diag, diag);
        const s = d2 === 0 ? 1 : 1 + dot(tl, diag) / d2;
        out(scale3(rt, box, center, [s, s, s], corner), null);
      } else {
        const origin = otherCorner(lo, hi, corner);
        const f = [0, 1, 2].map((k) => {
          const was = corner[k]! - origin[k]!;
          return was === 0 ? 1 : (was + tl[k]!) / was;
        }) as V3;
        out(scale3(rt, box, origin, f, corner), null);
      }
      return;
    }

    if (h.type !== T.Evf) {
      out(t, null);
      return;
    }
    const cut = cutPoint(rt, box, h.id, rt.stage.z);
    if (!cut) {
      out([0, 0, 0], null);
      return;
    }
    const [va, vb] = box.brep.edgeVertices(h.id);
    const pa = worldPos(rt, box, va);
    const pb = worldPos(rt, box, vb);
    if (t[2] !== 0) {
      // Moving in depth: the handle slides along the edge, and a corner takes over.
      let e = sub(pa, pb);
      if (e[2] * t[2] < 0) e = scale(e, -1);
      e = scale(e, 1 / len(e));
      const tr = scale(e, len(t) / Math.abs(e[2]));
      const to = add(cut, tr);
      const cursor = rt.cursor();
      for (const [v, p] of [
        [va, pa],
        [vb, pb],
      ] as const) {
        if (nearSegment(cut, to, p, PK)) {
          switched = true;
          storedEdge = e;
          out(sub(p, cursor), rt.features.vertex(box, v));
          return;
        }
      }
      out(tr, null);
      return;
    }
    // In the plane: the two axes across the edge scale.
    const la = box.brep.vertexPos(va);
    const lb = box.brep.vertexPos(vb);
    const axis = [0, 1, 2].reduce((m, k) =>
      Math.abs(la[k]! - lb[k]!) > Math.abs(la[m]! - lb[m]!) ? k : m,
    );
    const p = apply(inv, cut);
    const tl = along(inv, t);
    tl[axis] = 0;
    let f: V3;
    let origin: V3;
    if (constraining) {
      const diag = sub(p, center);
      diag[axis] = 0;
      const d2 = dot(diag, diag);
      const s = d2 === 0 ? 1 : 1 + dot(tl, diag) / d2;
      f = [s, s, s];
      origin = center;
    } else {
      origin = otherCorner(lo, hi, la);
      origin[axis] = p[axis]!;
      f = [0, 1, 2].map((k) => {
        if (k === axis) return 1;
        const was = p[k]! - origin[k]!;
        return was === 0 ? 1 : (was + tl[k]!) / was;
      }) as V3;
    }
    const moved = scaleBranch(rt, box, origin, f, p);
    out([moved[0], moved[1], 0], null);
  },
};

/** pt_near_lineseg_3d: is `p` within `tol` of the segment a–b? */
function nearSegment(a: V3, b: V3, p: V3, tol: number): boolean {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
  return len(sub(p, add(a, scale(ab, t)))) <= tol;
}

/**
 * set_scalebbox_selectable: a corner within Pkboxsize of the crosshair, or else
 * a point where an edge pierces the plane.
 */
export function setScaleBoxSelectable(rt: Runtime, box: CutObject): void {
  const c = rt.cursor();
  const near = (p: V3, dz: number) =>
    Math.abs(p[0] - c[0]) <= PK && Math.abs(p[1] - c[1]) <= PK && Math.abs(p[2] - c[2]) <= dz;
  for (const v of box.brep.vertices()) {
    const p = worldPos(rt, box, v);
    if (near(p, PK)) {
      rt.applySelectable(box, {
        feature: rt.features.vertex(box, v),
        kind: SelectKind.Vert,
        at: p,
      });
      return;
    }
  }
  for (const e of box.brep.edges()) {
    const p = cutPoint(rt, box, e, c[2]);
    if (p && near(p, 1e-6)) {
      rt.applySelectable(box, { feature: rt.features.edge(box, e), kind: SelectKind.Edge, at: p });
      return;
    }
  }
  rt.applySelectable(box, { feature: null, kind: SelectKind.Nothing, at: [0, 0, 0] });
}

/** The scale boxes in a world. */
export function scaleBoxes(rt: Runtime, root: CutObject): CutObject[] {
  return [...subtree(root)].filter((o) => o !== root && isScaleBox(rt, o));
}
