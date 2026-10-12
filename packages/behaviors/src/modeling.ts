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
import type { Brep, CutObject } from '@cutplane/kernel';
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
    rt.killNow(a);
    return [];
  }
  rt.reshape(a, breps[0]!);
  return [a, ...breps.slice(1).map((x) => rt.spawnBeside(a, x))];
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
   */
  slice_object(rt, vm) {
    const set = vm.pop();
    const seen = new Set<CutObject>();
    const back: CutObject[] = [];
    const front: CutObject[] = [];
    const z = rt.cursor()[2];
    for (const f of set.list ?? []) {
      const o = objectOf(f);
      if (!o || seen.has(o) || rt.worldOf(o) !== rt.primary) continue;
      seen.add(o);
      const r = sliceObject(rt, o, z);
      back.push(...r.back);
      front.push(...r.front);
    }
    vm.push(featuresWord(...front));
    vm.push(featuresWord(...back));
  },
};
