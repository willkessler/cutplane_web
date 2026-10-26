import { Aux, P, Word, boolWord, first, setupAux, type Feature, type VM } from '@cutplane/cpl';
import {
  createCube,
  createIsoscelesPrism,
  createLBeam,
  createObject,
  createOvalCone,
  createOvalCylinder,
  createPyramid,
  createSphere,
  createSquare,
  extrudeFace,
  makeLamina,
  mat4,
  revolve,
  subtree,
  ROOM,
  Brep,
  type CutObject,
  type Rgb,
} from '@cutplane/kernel';
import { isObject, isSub } from '../features.ts';
import type { Runtime, V3 } from '../runtime.ts';
import { createColorControl, type ColorControl } from './colorcontrol.ts';
import { DECAL_GAP, DECAL_THICKNESS, applyFrontDecal } from './toolbar.ts';

/**
 * Toolboxes (tools.c's create_toolbox, setup_prims_toolbox,
 * setup_goodies_toolbox, create_nikon, create_lightbulb; cplib.c's
 * arrange_prims, set_light), run by the original toolbox.cpl, stamp.cpl,
 * goodies.cpl, lightbulb.cpl and the camera's nikon.cpl and lens.cpl.
 *
 * Two blue boxes stand on the floor by the back wall. Clicking one (the plane
 * has to reach it) opens it: its flaps and what it holds appear, stacked up
 * above it. The primitives box holds Stamp objects: picking one stamps a copy
 * of it into the world being edited, picked. The goodies box holds the
 * camera, the light bulb and the colour control, which come out when dragged
 * and go back when dropped on the box.
 */

/** tools.h. */
const TOOLBOX_WIDTH = 85;
const TOOLBOX_HEIGHT = 85;
const TOOLBOX_DEPTH = 50;
const TOOLBOX_LEAF = 0.5;
const TOOLBOX_MARGIN = TOOLBOX_HEIGHT;
const TOOLBOX_LEAFROT = 350;
const PRIMS_W = TOOLBOX_WIDTH;
const PRIMS_H = TOOLBOX_HEIGHT;
const PRIMS_D = TOOLBOX_DEPTH;
const PRIMS_MARGIN = PRIMS_H / 5;
const PRIMS_RES = 72; // 14 in 1991, when polygons were dear
/**
 * New here: how big something dropped in the primitives box is shown there at most (its
 * longest side), so a good few fit above it. Stamped out, a copy is its own size again.
 */
const ADDED_FIT = PRIMS_H / 2;
/** New here: a copy over the box that would take its primitive out of it is shown in red. */
const UNSTOCK_RED: Rgb = [255, 0, 0];
/** Maxcrossx, Mincrossy, Minplanez. */
const MAX_X = 510;
const MIN_Y = -382;
const MIN_Z = -499;

/** globals.c's colours. */
const C = {
  orange: [255, 110, 10],
  green: [0, 255, 0],
  yellow: [255, 255, 0],
  magenta: [255, 0, 255],
  lightgrey: [150, 150, 150],
  darkyellow: [100, 100, 0],
  box: [50, 50, 200],
} satisfies Record<string, Rgb>;

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];
const Z: V3 = [0, 0, 1];

/** An object of the environment, at the top (as create_cube and friends made them). */
function make(
  rt: Runtime,
  brep: Brep,
  color: readonly number[],
  name: string | null = null,
): CutObject {
  const o = createObject(brep, { name, color: [...color] as Rgb, attrs: { props: ['Visible'] } });
  rt.importObjects(rt.environment, [o]);
  return o;
}

/** axis_rot_obj about the origin, in tenths of a degree. */
function turn(rt: Runtime, o: CutObject, axis: V3, tenths: number): void {
  const m = mat4.rotationAbout([0, 0, 0], axis, (tenths / 10) * (Math.PI / 180));
  for (const x of subtree(o)) {
    x.xform = mat4.multiply(x.xform, m);
    x.invXform = mat4.invert(x.xform) ?? x.invXform;
    rt.changed(x);
  }
}

const hide = (rt: Runtime, o: CutObject) => {
  for (const x of subtree(o)) if (rt.vm.props.has(x, P.Visible)) rt.vm.props.del(x, P.Visible);
};

/** create_toolbox: a blue box with `decal`'s picture on the front and four flaps on top. */
export function createToolbox(
  rt: Runtime,
  decal: CutObject,
  leafRatio: number,
  w: number,
  h: number,
  d: number,
): CutObject {
  const toolbox = make(rt, createCube(w, h, d), C.box);
  applyFrontDecal(rt, decal, toolbox, DECAL_THICKNESS * 2, DECAL_GAP, w / 10);
  const at: V3[] = [
    [0, h - 1, 0],
    [0, h - 1, d],
    [0, h - 1, d],
    [w, h - 1, d],
  ];
  const widths = [w, w, d, d];
  for (let i = 0; i < 4; i++) {
    const leaf = make(rt, createSquare(widths[i]!, h * leafRatio), C.box, `Leaf${i}`);
    if (i === 0) turn(rt, leaf, X, -TOOLBOX_LEAFROT);
    else if (i === 1) turn(rt, leaf, X, TOOLBOX_LEAFROT);
    else {
      turn(rt, leaf, Y, 900);
      turn(rt, leaf, Z, i === 2 ? TOOLBOX_LEAFROT : -TOOLBOX_LEAFROT);
    }
    rt.translate(leaf, at[i]!);
    for (const p of ['Nonmanifold', 'Hideable']) rt.addProp(leaf, p);
    hide(rt, leaf);
    rt.adopt(toolbox, leaf, false);
  }
  rt.addProp(toolbox, 'Lockedgeometry');
  rt.addProp(toolbox, 'Toolbox');
  return toolbox;
}

/** setup_prims_toolbox: the box of primitives to stamp from. */
export function setupPrimsToolbox(rt: Runtime): CutObject {
  const w = TOOLBOX_WIDTH;
  const h = TOOLBOX_HEIGHT;
  const d = TOOLBOX_DEPTH;
  const cube = make(rt, createCube(w, h, d), C.orange);
  const tri = make(rt, createIsoscelesPrism(w / 2, d), C.green);
  rt.translate(tri, [(3 * w) / 4, (3 * h) / 4, w]);
  rt.adopt(cube, tri, false);
  const beam = make(rt, createLBeam(w, h, w / 2, d), C.yellow);
  rt.translate(beam, [w, h, w * 2]);
  rt.adopt(cube, beam, false);
  const toolbox = createToolbox(rt, cube, TOOLBOX_LEAF, w, h, d);
  rt.setName(toolbox, 'Primsbox');
  rt.discard(cube);

  const prims = [
    createCube(PRIMS_W, PRIMS_H * 0.75, PRIMS_D),
    createOvalCylinder(PRIMS_W / 2, PRIMS_H / 2, PRIMS_D, PRIMS_RES),
    createOvalCone(PRIMS_W / 2, PRIMS_H / 2, PRIMS_D, PRIMS_RES),
    createSphere(PRIMS_W / 2, PRIMS_RES),
    createPyramid(PRIMS_W * 1.5, PRIMS_H * 1.5, PRIMS_D * 1.5),
  ];
  for (const b of prims) {
    const o = make(rt, b, [100, 100, 100]);
    hide(rt, o);
    for (const p of ['Stamp', 'Hideable', 'Lockedgeometry']) rt.addProp(o, p);
    rt.adopt(toolbox, o, true);
  }
  rt.translate(toolbox, [
    MAX_X - TOOLBOX_MARGIN * 4.5,
    MIN_Y + TOOLBOX_MARGIN / 3,
    MIN_Z - TOOLBOX_MARGIN / 4,
  ]);
  return toolbox;
}

/** create_nikon: the camera goodie (body, lens and cap, winder, viewfinder). */
export function createNikon(
  rt: Runtime,
  source: (f: string) => string,
  width = 110,
  height = 70,
  depth = 45,
  lensRadius = 50,
  res = 13,
): CutObject {
  const lensLength = depth * 1.25;
  const bevel = width / 20;
  const ring: V3[] = [
    [width / 2 - bevel, 0, -depth],
    [width / 2, 0, -depth + bevel],
    [width / 2, 0, -bevel],
    [width / 2 - bevel, 0, 0],
    [-width / 2 + bevel, 0, 0],
    [-width / 2, 0, -bevel],
    [-width / 2, 0, -depth + bevel],
    [-width / 2 + bevel, 0, -depth],
  ];
  const b = new Brep();
  const { front, back } = makeLamina(b, ring);
  // extrude_face: whichever side faces up goes up.
  const up = b.faceNormal(front)[1] > 0 ? front : back;
  extrudeFace(b, up, 0, height, 0);
  const nikon = make(rt, b, C.magenta, 'Nikon');

  const lens = make(
    rt,
    createOvalCylinder(lensRadius / 2, lensRadius / 2, lensLength, res),
    C.lightgrey,
  );
  rt.translate(lens, [0, height / 2, 0]);
  rt.adopt(nikon, lens, true);

  const winderRadius = depth / 4;
  const winderDepth = depth / 3;
  const winder = make(
    rt,
    createOvalCylinder(winderRadius, winderRadius, winderDepth, Math.floor(res / 2)),
    C.orange,
  );
  turn(rt, winder, X, 900);
  rt.addProp(winder, 'Nonmanifold');
  rt.translate(winder, [-width / 2 + winderRadius * 1.5, height + winderDepth, -depth / 2]);
  rt.adopt(nikon, winder, false);

  // The viewfinder (the original also tipped its top edge down; left square here).
  const finder = make(rt, createCube(width / 4, height / 4, depth), C.magenta);
  rt.translate(finder, [-width / 8, height, -depth]);
  rt.adopt(nikon, finder, false);

  const cap = make(
    rt,
    createOvalCylinder(lensRadius / 2, lensRadius / 2, lensLength / 8, res),
    C.yellow,
  );
  rt.translate(cap, [0, height / 2, lensLength]);
  rt.adopt(lens, cap, true);

  for (const o of subtree(nikon)) rt.addProp(o, 'Lockedgeometry');
  rt.addProp(nikon, 'Goodies');
  rt.vm.loadPrivateCode(nikon, source('nikon.cpl'), 'nikon.cpl');
  rt.vm.loadPrivateCode(lens, source('lens.cpl'), 'lens.cpl');
  return nikon;
}

/** create_lightbulb: a turned glass bulb on a threaded base. */
export function createLightbulb(rt: Runtime, bulbColor: Rgb, baseColor: Rgb): CutObject {
  const k = 1.5;
  const pts: [number, number][] = [[-2, 0], [-15, -4], [-20, -9], [-22, -18], [-20, -25], [-10, -38], [-8, -52]]; // prettier-ignore
  const b = new Brep();
  revolve(
    b,
    pts.map(([x, y]) => [x * k, y * k, 0] as V3),
    'y',
    11,
  );
  const bulb = make(rt, b, bulbColor, 'Lightbulb');
  const last = pts[pts.length - 1]!;
  const thread: V3[] = [[last[0] * k, 0, 0]];
  for (let i = 1; i < 8; i++) thread.push([last[0] * k - (i % 2 === 0 ? 2 * k : 0), -i * 2 * k, 0]);
  const bb = new Brep();
  revolve(bb, thread, 'y', 11);
  const base = make(rt, bb, baseColor);
  rt.translate(base, [0, last[1] * k, 0]);
  rt.adopt(bulb, base, false);
  rt.addProp(bulb, 'Lightbulb');
  for (const o of subtree(bulb)) rt.addProp(o, 'Lockedgeometry');
  return bulb;
}

/** setup_goodies_toolbox: the camera (also the box's picture), the light bulb, the colour control. */
export function setupGoodiesToolbox(
  rt: Runtime,
  source: (f: string) => string,
): { toolbox: CutObject; colorControl: ColorControl } {
  const camera = createNikon(rt, source);
  hide(rt, camera);
  for (const o of subtree(camera)) rt.addProp(o, 'Hideable');
  const toolbox = createToolbox(
    rt,
    camera,
    TOOLBOX_LEAF,
    TOOLBOX_WIDTH,
    TOOLBOX_HEIGHT,
    TOOLBOX_DEPTH,
  );
  rt.setName(toolbox, 'Goodiesbox');
  rt.adopt(toolbox, camera, true);

  const bulb = createLightbulb(rt, C.darkyellow, C.lightgrey);
  hide(rt, bulb);
  for (const o of subtree(bulb)) rt.addProp(o, 'Hideable');
  rt.adopt(toolbox, bulb, true);

  const cc = createColorControl(rt, [0, 0, 0]);
  hide(rt, cc.base);
  for (const o of subtree(cc.base)) rt.addProp(o, 'Hideable');
  rt.adopt(toolbox, cc.base, true);

  rt.translate(toolbox, [MAX_X - TOOLBOX_MARGIN * 2.5, MIN_Y + TOOLBOX_MARGIN / 3, MIN_Z]);
  return { toolbox, colorControl: cc };
}

// ---- the C routines ----

/** The second light the bulb sets (setup_light_source(2, ...)), for the renderer. */
export interface BulbLight {
  at: V3;
  color: Rgb;
}
const lights = new WeakMap<Runtime, BulbLight>();
export const bulbLightOf = (rt: Runtime): BulbLight | undefined => lights.get(rt);
/** Puts back the bulb's light as it was (a room restored). */
export function setBulbLight(rt: Runtime, light: BulbLight): void {
  lights.set(rt, { at: [...light.at], color: [...light.color] as Rgb });
  rt.version++;
}

/** The camera's view and whether its slide shows (set_camera, toggle_slide). */
export interface CameraView {
  camera: CutObject;
  shown: boolean;
}
const cameras = new WeakMap<Runtime, CameraView>();
export const cameraViewOf = (rt: Runtime): CameraView | undefined => cameras.get(rt);
const objectOf = (f: Feature | null): CutObject | null =>
  isObject(f) ? f : isSub(f) ? f.object : null;

const unit = (v: V3): V3 => {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

/** compute_obj_centroid: the mean of an object's vertices, in the room. */
function centroid(rt: Runtime, o: CutObject): V3 {
  const g = rt.world(o);
  const c: V3 = [0, 0, 0];
  const vs = o.brep.vertices();
  for (const v of vs) {
    c[0] += g.x(v);
    c[1] += g.y(v);
    c[2] += g.z(v);
  }
  const n = vs.length || 1;
  return [c[0] / n, c[1] / n, c[2] / n];
}

/** A branch's box, its visible parts only (grow_group_bbox over what is drawn). */
function groupBox(rt: Runtime, o: CutObject): [V3, V3] | null {
  let out: [V3, V3] | null = null;
  for (const x of subtree(o)) {
    const b = rt.bbox(x);
    if (!b) continue;
    out = out
      ? [
          out[0].map((v, k) => Math.min(v, b[0][k]!)) as V3,
          out[1].map((v, k) => Math.max(v, b[1][k]!)) as V3,
        ]
      : b;
  }
  return out;
}

/**
 * New here: what was dropped in the primitives box, by how much it was made smaller there
 * (1: not at all). The 1991 primitives aren't in it: they can't be taken out.
 */
const added = new WeakMap<CutObject, number>();

/** The thing `o` is part of: its group, or itself (not the scale box it's picked in). */
function thingOf(rt: Runtime, o: CutObject): CutObject {
  while (!o.linked && o.parent && !rt.vm.props.has(o.parent, P.Scalebbox)) o = o.parent;
  return o;
}

/**
 * Whether `thing` is a copy of `prim` (in the box, made `scale` times smaller there):
 * the same parts, each the same shape, put together the same way. Where it is doesn't
 * matter; turned or reshaped, it is something else.
 */
function sameShape(rt: Runtime, thing: CutObject, prim: CutObject, scale: number): boolean {
  const a = [...subtree(thing)];
  const b = [...subtree(prim)];
  if (a.length !== b.length || a.some((x, i) => x.brep.numVertices !== b[i]!.brep.numVertices))
    return false;
  const ba = rt.branchBox(thing);
  const bb = rt.branchBox(prim);
  if (!ba || !bb) return false;
  const tol = 1e-3 * Math.max(1, ...[0, 1, 2].map((k) => bb[1][k]! - bb[0][k]!));
  return a.every((x, i) => {
    const ga = rt.world(x);
    const gb = rt.world(b[i]!);
    const vb = b[i]!.brep.vertices();
    return x.brep.vertices().every((v, j) => {
      const w = vb[j]!;
      const d = [ga.x(v) - ba[0][0], ga.y(v) - ba[0][1], ga.z(v) - ba[0][2]];
      const e = [gb.x(w) - bb[0][0], gb.y(w) - bb[0][1], gb.z(w) - bb[0][2]];
      return d.every((c, k) => Math.abs(c * scale - e[k]!) <= tol);
    });
  });
}

/** The primitive dropped in `box` that `thing` is a copy of, if any. */
function stockedAs(rt: Runtime, box: CutObject, thing: CutObject): CutObject | null {
  for (const prim of box.children) {
    const scale = added.get(prim);
    if (scale !== undefined && sameShape(rt, thing, prim, scale)) return prim;
  }
  return null;
}

/** Things tinted red over the box, with their own colours. */
const tinted = new WeakMap<Runtime, Map<CutObject, Rgb>>();

/**
 * Each frame: a copy of a dropped-in primitive held over the primitives box shows red
 * (let go there, it takes that primitive out of the box); anything else its own colour.
 */
function tintUnstocking(rt: Runtime, box: CutObject): void {
  let was = tinted.get(rt);
  if (!was) tinted.set(rt, (was = new Map()));
  const red = new Set<CutObject>();
  if (rt.vm.props.has(box, P.Selectable))
    for (const f of rt.picked()) {
      if (!isObject(f)) continue;
      const thing = thingOf(rt, f);
      if (stockedAs(rt, box, thing)) for (const x of subtree(thing)) red.add(x);
    }
  for (const [o, c] of was)
    if (!red.has(o)) {
      was.delete(o);
      o.color = c;
      rt.changed(o);
    }
  for (const o of red)
    if (!was.has(o)) {
      was.set(o, [...o.color] as Rgb);
      o.color = [...UNSTOCK_RED] as Rgb;
      rt.changed(o);
    }
}

/** A primitive dropped in the box, for the room kept from one visit to the next. */
export interface AddedPrim {
  prim: CutObject;
  scale: number;
}

/** What was dropped in the primitives box, in its order there. */
export function addedPrims(rt: Runtime): AddedPrim[] {
  const box = rt.findObject('Primsbox');
  if (!box) return [];
  return box.children.flatMap((prim) => {
    const scale = added.get(prim);
    return scale === undefined ? [] : [{ prim, scale }];
  });
}

/** Puts `prims` in the primitives box, in place of what was dropped in it. */
export function restockPrims(rt: Runtime, prims: readonly AddedPrim[]): void {
  const box = rt.findObject('Primsbox');
  if (!box) return;
  for (const { prim } of addedPrims(rt)) rt.discard(prim);
  rt.importObjects(
    rt.environment,
    prims.map((p) => p.prim),
    box,
  );
  for (const { prim, scale } of prims) added.set(prim, scale);
}

export const TOOLBOX_CRTNS: Partial<Record<string, (rt: Runtime, vm: VM) => void>> = {
  /**
   * New here, CPL_shrink_prim: (things) — each dropped in the primitives box (toolbox.cpl's
   * Dunk_prim) made small enough to stack up with the others there.
   */
  shrink_prim(rt, vm) {
    const things = new Set(
      (vm.pop().list ?? []).flatMap((f) => {
        const o = objectOf(f);
        return o ? [thingOf(rt, o)] : [];
      }),
    );
    for (const thing of things) {
      if (added.has(thing)) continue;
      const b = rt.branchBox(thing);
      const size = b ? Math.max(...[0, 1, 2].map((k) => b[1][k]! - b[0][k]!)) : 0;
      const scale = size > ADDED_FIT ? ADDED_FIT / size : 1;
      if (b && scale < 1) {
        const mid = [0, 1, 2].map((k) => (b[0][k]! + b[1][k]!) / 2) as V3;
        rt.scaleBranch(thing, mid, [scale, scale, scale]);
      }
      added.set(thing, scale);
    }
  },

  /**
   * New here, CPL_grow_stamp: (primitive, copy) — a copy stamped from something dropped in
   * the box (stamp.cpl's Stamp_sub) made its own size again, about the crosshair.
   */
  grow_stamp(rt, vm) {
    const copy = objectOf(first(vm.pop()));
    const prim = objectOf(first(vm.pop()));
    const scale = prim ? added.get(prim) : undefined;
    const b = copy && rt.branchBox(copy);
    if (!copy || !b || scale === undefined || scale === 1) return;
    // About the crosshair, which picked it, so it stays in hand there; else its middle.
    const at = rt.cursor();
    const on = [0, 1, 2].every((k) => at[k]! >= b[0][k]! && at[k]! <= b[1][k]!);
    const about = on ? at : ([0, 1, 2].map((k) => (b[0][k]! + b[1][k]!) / 2) as V3);
    rt.scaleBranch(copy, about, [1 / scale, 1 / scale, 1 / scale]);
    // Kept in the room (grown at the top of the stack, by the back wall, it went through them).
    const g = rt.branchBox(copy);
    if (!g) return;
    const d = [0, 1, 2].map((k) => {
      const lo = ROOM.min[k]! - g[0][k]!;
      const hi = ROOM.max[k]! - g[1][k]!;
      return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(0, hi));
    }) as V3;
    if (d.some((c) => c !== 0)) rt.moveBranch(copy, d);
  },

  /**
   * New here, CPL_unstock_prim: (thing let go on the primitives box) → (taken out?). A
   * copy of something dropped in the box takes that out of it and goes back to where it
   * was picked up (rom.cpl); anything else is dunked as before.
   */
  unstock_prim(rt, vm) {
    const o = objectOf(first(vm.pop()));
    const box = rt.findObject('Primsbox');
    const thing = o && thingOf(rt, o);
    const prim = box && thing && stockedAs(rt, box, thing);
    if (prim && thing) {
      rt.discard(prim);
      const was = tinted.get(rt);
      for (const x of subtree(thing)) {
        was?.delete(x);
        const s = rt.journal.before(x);
        if (!s) continue;
        x.xform = s.xform.slice();
        x.invXform = s.invXform.slice();
        x.color = [...s.color] as Rgb;
        rt.changed(x);
      }
      rt.version++;
    }
    vm.push(boolWord(!!prim));
  },

  /** CPL_arrange_prims: (toolboxes) → (toolboxes), what each holds stacked up above it. */
  arrange_prims(rt, vm) {
    const rec = vm.pop();
    for (const f of rec.list ?? []) {
      const box = objectOf(f);
      const bb = box ? rt.bbox(box) : null;
      if (!box || !bb) continue;
      const top: V3 = [
        (bb[0][0] + bb[1][0]) / 2,
        bb[1][1] + PRIMS_MARGIN,
        (bb[0][2] + bb[1][2]) / 2,
      ];
      // New here: stacked up to the ceiling, then on in another stack beside, to the left
      // (dropped-in primitives make the stack taller than the room).
      const floor = top[1];
      let width = 0;
      for (const prim of box.children) {
        // (Not its flaps; a group made a primitive is stacked, though its root is nonmanifold.)
        if (rt.vm.props.has(prim, P.Nonmanifold) && !rt.hasProp(prim, 'Stamp')) continue;
        const pb = groupBox(rt, prim);
        if (!pb) continue;
        const h = pb[1][1] - pb[0][1];
        const w = pb[1][0] - pb[0][0];
        if (top[1] > floor && top[1] + h + PRIMS_MARGIN > ROOM.max[1]) {
          top[0] -= width / 2 + PRIMS_MARGIN + w / 2;
          top[1] = floor;
          width = 0;
        }
        width = Math.max(width, w);
        top[1] += h + PRIMS_MARGIN;
        const primTop: V3 = [(pb[0][0] + pb[1][0]) / 2, pb[1][1], (pb[0][2] + pb[1][2]) / 2];
        rt.translate(prim, [top[0] - primTop[0], top[1] - primTop[1], top[2] - primTop[2]]);
      }
    }
    vm.push(rec);
  },

  /** CPL_set_light: (bulb) — the second light shines from the bulb, in its colour. */
  set_light(rt, vm) {
    const bulb = objectOf(first(vm.pop()));
    const bb = bulb ? rt.bbox(bulb) : null;
    if (!bulb || !bb) return;
    lights.set(rt, {
      at: [0, 1, 2].map((k) => (bb[0][k]! + bb[1][k]!) / 2) as V3,
      color: [...bulb.color] as Rgb,
    });
    rt.version++;
  },

  /** CPL_set_camera: (camera) — the slide shows what the camera sees. */
  set_camera(rt, vm) {
    const camera = objectOf(first(vm.pop()));
    if (!camera) return;
    const view = cameras.get(rt);
    cameras.set(rt, { camera, shown: view?.shown ?? false });
    rt.version++;
  },

  /**
   * CPL_rotate_camera: (lens, camera, translation) → the rotation that turns the
   * camera about its centroid so the lens follows the crosshair (lens.cpl).
   */
  rotate_camera(rt, vm) {
    const tr = vm.pop();
    const camera = objectOf(first(vm.pop()));
    const lens = objectOf(first(vm.pop()));
    const w = new Word();
    setupAux(w, Aux.Rotate);
    w.vec = [0, 0, 1, 0, 0, 0, 0];
    if (camera && lens) {
      const c = centroid(rt, camera);
      const at = rt.cursor();
      const t: V3 = [tr.offset[0] ?? 0, tr.offset[1] ?? 0, tr.offset[2] ?? 0];
      const v1 = unit([at[0] - c[0], at[1] - c[1], at[2] - c[2]]);
      const v2 = unit([at[0] + t[0] - c[0], at[1] + t[1] - c[1], at[2] + t[2] - c[2]]);
      const axis: V3 = [
        v1[1] * v2[2] - v1[2] * v2[1],
        v1[2] * v2[0] - v1[0] * v2[2],
        v1[0] * v2[1] - v1[1] * v2[0],
      ];
      const dot = Math.min(1, Math.max(-1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
      // The C cut this to whole degrees; at 60 frames a second a slow drag moves less
      // than a degree a frame, so here the fraction is kept and the camera still turns.
      const tenths = (Math.acos(dot) * 1800) / Math.PI;
      if (tenths > 1e-6 && Math.hypot(...axis) > 1e-9) w.vec = [...axis, ...c, tenths];
    }
    vm.push(w);
  },

  /** CPL_toggle_slide: the camera's slide on or off. */
  toggle_slide(rt) {
    const view = cameras.get(rt);
    const camera = view?.camera ?? rt.findObject('Nikon');
    if (!camera) return;
    cameras.set(rt, { camera, shown: !(view?.shown ?? false) });
    rt.version++;
  },
};

/** Both toolboxes, with their C routines. */
export function installToolboxes(
  rt: Runtime,
  source: (f: string) => string,
): { prims: CutObject; goodies: CutObject; colorControl: ColorControl } {
  rt.registerCrtns(TOOLBOX_CRTNS);
  const prims = setupPrimsToolbox(rt);
  rt.frameHooks.push(() => tintUnstocking(rt, prims));
  const { toolbox: goodies, colorControl } = setupGoodiesToolbox(rt, source);
  rt.vm.resolveObjectRefs();
  return { prims, goodies, colorControl };
}
