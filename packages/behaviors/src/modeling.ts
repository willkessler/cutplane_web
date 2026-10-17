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
import { groupRoot, subtree, type Brep, type CutObject } from '@cutplane/kernel';
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
export function booleanObjects(rt: Runtime, a: CutObject, b: CutObject, op: number): CutObject[] {
  const kind = OPS[op];
  if (!kind || !isObject(a) || !isObject(b) || a === b || !booleansReady()) return [];
  rt.unpick(a);
  rt.unpick(b);
  const shells = booleanSolids({ brep: a.brep, xform: a.xform }, { brep: b.brep, xform: b.xform }, kind); // prettier-ignore
  if (!shells) {
    if (kind === 'subtract') rt.killNow(b);
    return [];
  }
  const breps = solidsOf(shells).map((g) => brepOf(g, [a, b]));
  rt.killNow(b);
  if (breps.length === 0) {
    if (kind !== 'subtract') rt.killNow(a);
    return [];
  }
  rt.reshape(a, breps[0]!);
  return [a, ...breps.slice(1).map((x) => rt.spawnBeside(a, x))];
}

/**
 * The B key (new here; the original's BOOLEANBUTTON was a test hook that
 * subtracted): every picked object is unioned into one, which stays picked. Each
 * keeps its faces' colours. Fewer than two objects picked does nothing.
 */
export function unionPicked(rt: Runtime): CutObject[] {
  const objs = [...new Set(rt.picked().map(objectOf))].filter(
    (o): o is CutObject => !!o && rt.worldOf(o) === rt.primary,
  );
  if (objs.length < 2) return [];
  let out = [objs[0]!];
  for (const b of objs.slice(1)) {
    const r = booleanObjects(rt, out[0]!, b, BOOL_OP.Union);
    if (r.length > 0) out = r;
  }
  for (const o of out) rt.pick(o);
  return out;
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
