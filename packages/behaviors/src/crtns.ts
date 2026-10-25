import { P, boolWord, first, type VM } from '@cutplane/cpl';
import type { CutObject } from '@cutplane/kernel';
import { isObject, type WorldFeature } from './features.ts';
import type { Runtime } from './runtime.ts';

/**
 * The C routines CPL calls (cplib.c's Croutines) that belong to the core:
 * arguments come off the CPL stack and results go back on it, as there. The
 * environment's tools (rotate tool, scale box, colour control, plates...)
 * register their own.
 */
export const BUILTIN_CRTNS: Partial<Record<string, (rt: Runtime, vm: VM) => void>> = {
  /** select.c: during a drag, find selectables every frame. */
  always_set_select(rt, vm) {
    rt.alwaysSetSelectable = vm.pop().bool;
  },

  /**
   * CPL_start_marquee: a marquee object (two vertices, one edge) at the crosshair
   * object's position, in the working world; its second vertex is the Hotspot corner
   * the drag pulls.
   */
  start_marquee(rt, vm) {
    const cursor = first(vm.pop());
    if (!isObject(cursor)) {
      vm.pushFeatures([]);
      return;
    }
    const pos = rt.firstVertex(cursor) ?? rt.cursor();
    const marquee = rt.makeObj(vm.working as WorldFeature, pos, null, ['Nonmanifold'], {
      drawTechnique: 'draw_marquee_technique',
      selectTechnique: 'set_always_selectable',
    });
    const v0 = marquee.brep.vertices()[0]!;
    const v1 = rt.addVertexEdge(marquee, v0, pos);
    vm.props.add(rt.features.vertex(marquee, v1), P.Hotspot);
    vm.pushFeatures([marquee]);
  },

  /** New here (controls' D): each copy goes where Runtime.placeCopy puts it. */
  place_copies(rt, vm) {
    for (const f of vm.pop().list ?? []) if (isObject(f)) rt.placeCopy(f);
  },

  /**
   * New here (controls' ⌘A): () → (things): every visible thing in the world being
   * edited, whole: an object on its own or a group's root; one picked already, the
   * thing, not the scale box it sits in (ANCEST would give the box).
   */
  world_things(rt, vm) {
    const out = new Set<CutObject>();
    for (const f of vm.props.features(rt.primary, P.Visible)) {
      if (!isObject(f) || rt.hasProp(f, 'Scalebbox')) continue;
      let r = f;
      while (r.parent && !(r.linked ?? false) && !rt.hasProp(r.parent, 'Scalebbox')) r = r.parent;
      if (r !== rt.primary.root) out.add(r);
    }
    vm.pushFeatures([...out]);
  },

  /** cursor.cpl's escape hatch (picking on the plane's border, a demo hack): never. */
  cursor_on_border(_rt, vm) {
    vm.push(boolWord(false));
  },

  /** CPL_normal_constrain: Ctrl's axis lock is applied before CPL sees the motion (Controller). */
  normal_constrain(_rt, vm) {
    vm.push(vm.pop());
  },

  /** set_hiddenedge: how hidden edges draw while the plane or room moves (drawing only). */
  set_hiddenedge(rt, vm) {
    rt.hiddenEdges = vm.pop().bool;
  },

  turnon_arrowcursor() {},

  set_picksize(rt, vm) {
    rt.picksize = vm.pop().float;
  },

  reset_picksize(rt) {
    rt.picksize = 10;
  },
};
