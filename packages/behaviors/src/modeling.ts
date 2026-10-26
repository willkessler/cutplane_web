import { BOOL_OP, featuresWord, type Feature, type VM } from '@cutplane/cpl';
import {
  booleanSolids,
  booleansReady,
  shellsToBrep,
  sliceSolid,
  solidsOf,
  type BoolOp,
  type ResultShell,
} from '@cutplane/booleans';
import { joinRegions, type P2 } from '@cutplane/formats';
import { Brep, buildShell, groupRoot, mat4, subtree, type CutObject } from '@cutplane/kernel';
import { isObject, isSub, type WorldFeature } from './features.ts';
import type { Runtime } from './runtime.ts';

/**
 * Modeling operations (boolean.c's do_boolean, slice.c's slice_object), done
 * by manifold-3d through @cutplane/booleans. Each is one undoable change; one
 * that wouldn't leave sound solids is refused and changes nothing.
 */

const objectOf = (f: Feature | null | undefined): CutObject | null =>
  isObject(f) ? f : isSub(f) ? f.object : null;

/** A result solid as a B-rep, its faces keeping the colours they were painted. */
function brepOf(shells: readonly ResultShell[], operands: readonly CutObject[]): Brep {
  const { brep, sources } = shellsToBrep(shells);
  for (const [face, src] of sources) {
    if (!src) continue;
    const c = operands[src.operand]?.brep.faceColors.get(src.face);
    if (c) brep.faceColors.set(face, [...c]);
  }
  return brep;
}

const OPS: Record<number, BoolOp> = {
  [BOOL_OP.Union]: 'union',
  [BOOL_OP.Subtraction]: 'subtract',
  [BOOL_OP.Intersection]: 'intersect',
};

/**
 * do_boolean(A, B, op): A becomes the result. A subtraction that leaves several
 * solids keeps the first in A and makes the rest objects beside it; B is gone
 * afterwards (the original's "dup obj hack" killed it). Returns the results.
 *
 * New here: a subtraction that would leave nothing (the drill pressed and released
 * on the same object, its cutter an exact copy) leaves A as it was; the original
 * deleted A wholesale.
 */
export function booleanObjects(
  rt: Runtime,
  a: CutObject,
  b: CutObject,
  op: number,
  keepB = false,
): CutObject[] {
  const kind = OPS[op];
  if (!kind || !isObject(a) || !isObject(b) || a === b || !booleansReady()) return [];
  rt.unpick(a);
  rt.unpick(b);
  const shells = booleanSolids({ brep: a.brep, xform: a.xform }, { brep: b.brep, xform: b.xform }, kind); // prettier-ignore
  if (!shells) {
    if (kind === 'subtract' && !keepB) rt.killNow(b);
    return [];
  }
  const breps = solidsOf(shells).map((g) => brepOf(g, [a, b]));
  if (!keepB) rt.killNow(b);
  if (breps.length === 0) {
    if (kind !== 'subtract') rt.killNow(a);
    return [];
  }
  rt.reshape(a, breps[0]!);
  return [a, ...breps.slice(1).map((x) => rt.spawnBeside(a, x))];
}

/**
 * do_boolean of several objects with one (new here: the drill, or the union
 * tool, let go on all that what it carries overlaps). A subtraction takes `b`
 * out of each; a union fuses each into one. `b` is gone afterwards.
 */
export function booleanAll(rt: Runtime, as: CutObject[], b: CutObject, op: number): CutObject[] {
  if (as.length <= 1) return as[0] ? booleanObjects(rt, as[0], b, op) : [];
  if (OPS[op] !== 'subtract') {
    let out = booleanObjects(rt, as[0]!, b, op);
    for (const a of as.slice(1)) {
      if (out.length === 0) break;
      const r = booleanObjects(rt, out[0]!, a, op);
      if (r.length > 0) out = [...r, ...out.slice(1)];
    }
    return out;
  }
  const out: CutObject[] = [];
  for (const a of as) out.push(...booleanObjects(rt, a, b, op, true));
  rt.killNow(b);
  return out;
}

/**
 * The B key (new here; the original's BOOLEANBUTTON was a test hook that
 * subtracted): every picked object is unioned into one, which stays picked. Each
 * keeps its faces' colours. Fewer than two objects picked does nothing. Laminas
 * lying in one plane (a plan's rooms and walls) are joined as faces: see joinLaminas.
 */
export function unionPicked(rt: Runtime): CutObject[] {
  const objs = [...new Set(rt.picked().map(objectOf))].filter(
    (o): o is CutObject => !!o && rt.worldOf(o) === rt.primary,
  );
  if (objs.length < 2) return [];
  const flat = joinLaminas(rt, objs);
  if (flat) return flat;
  // Laminas have nothing inside to union: as solids they would come to nothing.
  if (objs.some((o) => laminaFaces(o))) return [];
  let out = [objs[0]!];
  for (const b of objs.slice(1)) {
    const r = booleanObjects(rt, out[0]!, b, BOOL_OP.Union);
    if (r.length > 0) out = r;
  }
  for (const o of out) rt.pick(o);
  return out;
}

type V3 = [number, number, number];

/** Its shells' faces (two each, lying on each other) in the world, if it is laminas only. */
function laminaFaces(o: CutObject): V3[][][] | null {
  const b = o.brep;
  const shells = b.shells();
  if (shells.length === 0) return null;
  const faces: V3[][][] = [];
  for (const s of shells) {
    const fs = b.faces(s);
    if (fs.length !== 2) return null;
    for (const f of fs)
      faces.push(
        b.faceLoops(f).map((l) =>
          b.loopHalfEdges(l).map((h) => {
            const [x, y, z] = b.vertexPos(b.heVertex(h));
            return [...mat4.transformPoint(o.xform, x, y, z)] as V3;
          }),
        ),
      );
  }
  return faces;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Newell's normal of a loop (twice its area long). */
function newell(l: readonly V3[]): V3 {
  const n: V3 = [0, 0, 0];
  l.forEach((a, i) => {
    const b = l[(i + 1) % l.length]!;
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  });
  return n;
}

/**
 * New: B on laminas all lying in one plane (a plan's pieces, say a room and the
 * floor of its doorway) joins them as faces, not solids: the lines between them go,
 * and the first picked becomes the joined lamina (or laminas, side by side in it, for
 * what doesn't touch), in its colour; the rest go. Null when they aren't such laminas.
 */
export function joinLaminas(rt: Runtime, objs: readonly CutObject[]): CutObject[] | null {
  const all = objs.map(laminaFaces);
  if (all.some((f) => f === null)) return null;
  const faces = all.flat() as V3[][][];
  // The plane: the first face's, its front the way it faces.
  const first = faces[0]!;
  const n = unit(newell(first[0]!));
  const o = first[0]![0]!;
  let size = 0;
  for (const f of faces) for (const l of f) for (const p of l) size = Math.max(size, Math.hypot(...sub(p, o))); // prettier-ignore
  const tol = Math.max(1e-6, size * 1e-6);
  if (!faces.every((f) => f.every((l) => l.every((p) => Math.abs(dot(sub(p, o), n)) <= tol))))
    return null;
  const u = unit(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]));
  const v = cross(n, u);
  const flat = (p: V3): P2 => [dot(sub(p, o), u), dot(sub(p, o), v)];
  // Each lamina by its face that looks the plane's way: its outline counter-clockwise in it.
  const parts = faces
    .filter((f) => dot(newell(f[0]!), n) > 0)
    .map((f) => ({ outer: f[0]!.map(flat), holes: f.slice(1).map((l) => l.map(flat)) }));
  const regions = joinRegions(parts);
  if (regions.length === 0) return null;
  const keep = objs[0]!;
  const brep = new Brep();
  const toLocal = keep.invXform;
  for (const r of regions) {
    const positions: V3[] = [];
    const loop = (l: readonly P2[]) =>
      l.map(([x, y]) => {
        const p: V3 = [o[0] + x * u[0] + y * v[0], o[1] + x * u[1] + y * v[1], o[2] + x * u[2] + y * v[2]]; // prettier-ignore
        return positions.push([...mat4.transformPoint(toLocal, ...p)] as V3) - 1;
      });
    const front = [r.outer, ...r.holes].map(loop);
    buildShell(brep, { positions, faces: [front, front.map((l) => [...l].reverse())] });
  }
  for (const x of objs) rt.unpick(x);
  for (const x of objs.slice(1)) rt.killNow(x);
  rt.reshape(keep, brep);
  rt.pick(keep);
  return [keep];
}

/**
 * slice_object at the plane: every piece behind it and in front of it becomes
 * an object of its own (the first behind keeps the original). A plane that
 * misses, or a slice that would break the solid, leaves it as it was.
 */
export function sliceObject(
  rt: Runtime,
  o: CutObject,
  z: number,
): { back: CutObject[]; front: CutObject[] } {
  const none = { back: [], front: [] };
  if (!booleansReady()) return none;
  const r = sliceSolid({ brep: o.brep, xform: o.xform }, z);
  if (!r || r.back.length === 0 || r.front.length === 0) return none;
  const backs = solidsOf(r.back).map((g) => brepOf(g, [o]));
  const fronts = solidsOf(r.front).map((g) => brepOf(g, [o]));
  if (backs.length === 0 || fronts.length === 0) return none;
  rt.unpick(o);
  rt.reshape(o, backs[0]!);
  const back = [o, ...backs.slice(1).map((x) => rt.spawnBeside(o, x))];
  const front = fronts.map((x) => rt.spawnBeside(o, x));
  return { back, front };
}

/** How far slice.cpl moves each half off the plane. */
const SAW_GAP = 10;

export const MODELING_CRTNS: Partial<Record<string, (rt: Runtime, vm: VM) => void>> = {
  /**
   * CPL_do_zoom: (crosshair move) → (the same): the world being edited zooms about
   * the crosshair by 1.01 for each unit the crosshair moved up (zoom.cpl).
   */
  do_zoom(rt, vm) {
    const w = vm.pop();
    const dy = w.offset[1] ?? 0;
    rt.zoomWorld(vm.working as WorldFeature, rt.cursor(), 1.01 ** dy);
    vm.push(w);
  },

  /**
   * CPL_slice_object: (objects) → (front pieces, rear pieces): each object (or a
   * vertex, edge or face's object) sliced at the plane. slice.cpl pops the rear
   * pieces first and sends them back 10, then the front ones forward 10.
   *
   * New here (a later Cutplane did this too): a TRANS of a part of a group moves the
   * whole group, so the ±10 moves cancelled and a grouped part's halves stayed
   * together. Every piece is moved apart here instead, each on its own (a group's
   * root without its parts), and none is left for slice.cpl to move.
   */
  slice_object(rt, vm) {
    const set = vm.pop();
    const seen = new Set<CutObject>();
    const z = rt.cursor()[2];
    for (const f of set.list ?? []) {
      const o = objectOf(f);
      if (!o || seen.has(o) || rt.worldOf(o) !== rt.primary) continue;
      seen.add(o);
      const group = o.children.length > 0;
      const r = sliceObject(rt, o, z);
      // A group's root cut: its new pieces stay in the group, as parts.
      if (group) for (const p of [...r.back, ...r.front]) if (p !== o) rt.adopt(o, p, false);
      for (const p of r.front) rt.moveOne(p, [0, 0, SAW_GAP]);
      for (const p of r.back) rt.moveOne(p, [0, 0, -SAW_GAP]);
    }
    vm.push(featuresWord());
    vm.push(featuresWord());
  },

  /**
   * CPL_saw_targets (new): (what is under the saw) → (what it cuts). On something
   * picked, or a part of a picked group, everything picked, groups and all (so a
   * group picked whole is cut whole); otherwise just what is under it.
   */
  saw_targets(rt, vm) {
    const under = (vm.pop().list ?? []).map(objectOf).filter((o) => o !== null);
    const picked = rt
      .picked()
      .map(objectOf)
      .filter((o) => o !== null);
    const branches = new Set(picked.flatMap((o) => [...subtree(o)]));
    const onPicked = under.some((o) => branches.has(o) || branches.has(groupRoot(o)));
    vm.push(featuresWord(...(onPicked ? [...branches] : under)));
  },

  /**
   * CPL_group_targets (new): (what is under the group tool) → (what it groups). On
   * something picked, or a part of a picked group, everything picked; otherwise
   * nothing (the click picks as usual).
   */
  group_targets(rt, vm) {
    const under = (vm.pop().list ?? []).map(objectOf).filter((o) => o !== null);
    const picked = rt
      .picked()
      .map(objectOf)
      .filter((o) => o !== null);
    const branches = new Set(picked.flatMap((o) => [...subtree(o)]));
    const onPicked = under.some((o) => branches.has(o) || branches.has(groupRoot(o)));
    vm.push(featuresWord(...(onPicked ? picked : [])));
  },

  /**
   * CPL_touching_marquee (new): (marquee, objects) → those of the objects the
   * marquee's box takes in at least partly (the group tool's marquee; WITHIN wants
   * them wholly inside).
   */
  touching_marquee(rt, vm) {
    const objects = (vm.pop().list ?? []).map(objectOf).filter((o) => o !== null);
    const marquee = objectOf((vm.pop().list ?? [])[0]);
    const box = marquee ? rt.bbox(marquee) : null;
    if (!marquee || !box) {
      vm.push(featuresWord());
      return;
    }
    const lo = [box[0][0], box[0][1], box[0][2] - 1];
    const hi = [box[1][0], box[1][1], box[1][2] + 1];
    const touching = objects.filter((o) => {
      if (o === marquee || o.brep.numFaces === 0 || rt.hasProp(o, 'Scalebbox')) return false;
      const b = rt.bbox(o);
      return b !== null && [0, 1, 2].every((k) => b[0][k]! <= hi[k]! && b[1][k]! >= lo[k]!);
    });
    vm.push(featuresWord(...touching));
  },

  /**
   * CPL_drop_objects (new): (objects) → (): each one's group, whole, falls to the
   * floor (the app's physics: rt.dropper). Only what is in the world being edited;
   * what is picked sits in its scale box for now, and the group under the box falls.
   */
  drop_objects(rt, vm) {
    const roots = new Set<CutObject>();
    for (const f of vm.pop().list ?? []) {
      const o = objectOf(f);
      if (!o || rt.worldOf(o) !== rt.primary || rt.hasProp(o, 'Scalebbox')) continue;
      let r = o;
      while (r.parent && !(r.linked ?? false) && !rt.hasProp(r.parent, 'Scalebbox')) r = r.parent;
      roots.add(r);
    }
    if (roots.size > 0) rt.dropper?.([...roots]);
  },
};
