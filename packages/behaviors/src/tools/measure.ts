import {
  Aux,
  P,
  T,
  W,
  featuresWord,
  first,
  floatWord,
  setupWord,
  Word,
  type Feature,
  messageWord as msgWord,
  type VM,
} from '@cutplane/cpl';
import { createCube, createObject, preorder, subtree, type CutObject } from '@cutplane/kernel';
import { isObject, isSub } from '../features.ts';
import type { Runtime, V3 } from '../runtime.ts';
import { TEXT_CRTNS, leaveCharstream, parsePlateRsc, readPlate } from './plates.ts';
import { fitScaleBox, isScaleBox } from './scalebox.ts';
import { DECAL_GAP, DECAL_THICKNESS, applyFrontDecal, registerPadTechniques } from './toolbar.ts';

/**
 * The measure pad (tools.c's create_measure_pad), run by the original
 * measurepad.cpl (cutplane_web's version), cubeplate.cpl, distanceplate.cpl,
 * sizer.cpl and namer.cpl, with the C routines they call (cplib.c's
 * world_2_inch, inch_2_world, get_plate_by_name, generate_info_rec,
 * breakup_info_rec, remake_prim, get_feature_size, get_feature_dist,
 * set_feature_dist).
 *
 * New here: the pad is the ruler's (the ruler tool on the arrange rail, or M).
 * While the ruler is held the pad shows, bottom left in the plane; put it away
 * and the pad and its plates go. (The original's pad was always there, and a
 * click on it opened or shut all its plates at once.)
 *
 * An orange pad with a ruler on it. Picking an
 * object shows its length, width and height on the cube plate above it, in
 * inches (10 room units to the inch, as world_2_inch had it), and its name on
 * the name plate beside it; type a new size and Return resizes it. Two things
 * picked show the distance from the first to the second, and typing one moves the second.
 * Picking an edge shows its length.
 *
 * Deviations: any object is measured (the original only primitives with a
 * record, though generate_info_rec already measured others by their box); a
 * new size scales the object in place, its parts and links kept, where
 * remake_prim rebuilt cubes only; distances between whole objects (centre to
 * centre) and between any two features are given in full, where the original
 * gave zero for objects and only the length for most pairs.
 */

const STORAGE_SQUARE = 60;
const MIN_X = -511;
const MIN_Y = -382;
/** world_2_inch: ten room units to the inch. */
const UNITS_PER_INCH = 10;

/** A primitive's record (primitives.h's cube info): its sizes along z, x and y. */
export interface InfoRec {
  length: number;
  width: number;
  height: number;
}

const PLATES = ['nameplate.rsc', 'cubeplate.rsc', 'lengthplate.rsc', 'distanceplate.rsc'];

/** create_ruler: the pad's picture, a yellow rule with black notches. */
function createRuler(rt: Runtime): CutObject {
  const part = (w: number, h: number, d: number, at: V3, color: [number, number, number]) => {
    const o = createObject(createCube(w, h, d), { color, attrs: { props: ['Visible'] } });
    rt.importObjects(rt.environment, [o]);
    rt.translate(o, at);
    return o;
  };
  const body = part(120, 20, 10, [0, 0, 0], [205, 175, 0]);
  for (let i = 0; i < 8; i++) {
    const tall = i % 2 === 0 ? 9 : 5;
    rt.adopt(body, part(2, tall, 2, [8 + i * 14.5, 20 - tall, 10], [0, 0, 0]), false);
  }
  return body;
}

/** The measure pad and its plates, with the routines they need. */
export function installMeasurePad(
  rt: Runtime,
  read: (f: string) => string,
  source: (f: string) => string,
): CutObject {
  rt.registerCrtns(TEXT_CRTNS);
  rt.registerCrtns(MEASURE_CRTNS);
  registerPadTechniques(rt);
  const pad = rt.makeObj(rt.environment, [0, 0, 0], 'MeasurePad', ['Nonmanifold', 'Noshadow'], {
    selectTechnique: 'set_normalpad_selectable',
    drawTechnique: 'draw_plate_technique',
  });
  rt.addVertexEdge(pad, pad.brep.vertices()[0]!, [STORAGE_SQUARE * 2, STORAGE_SQUARE * 0.6, 0]);
  pad.color = [255, 110, 10];
  rt.translate(pad, [0, 0, 10]); // so it lies over the input area
  const ruler = createRuler(rt);
  applyFrontDecal(rt, ruler, pad, DECAL_THICKNESS, DECAL_GAP, STORAGE_SQUARE / 8);
  rt.discard(ruler);
  for (const f of PLATES) readPlate(rt, pad, parsePlateRsc(read(f)), source);
  rt.adopt(rt.cutplane, pad, true);
  rt.translate(pad, [MIN_X + 150, MIN_Y + 30, rt.cutplane.xform[14]!]);
  rt.setPrivateCode(pad, source('measurepad.cpl'), 'measurepad.cpl');
  // A Dialog, as the original's was: its property code, not ROM's CPnormal (which
  // takes unread messages off), runs on it, so the plates' messages wait for it.
  rt.addProp(pad, 'Dialog');
  // Not clicked: it opens with the ruler, its plates with what is picked.
  rt.addProp(pad, 'Nonselectable');
  for (const o of subtree(pad)) rt.addProp(o, 'Lockedgeometry');
  rt.vm.resolveObjectRefs();
  let held = false;
  hide(rt, pad);
  rt.frameHooks.push(() => {
    const ruler = rt.findObject('Ruler');
    const now = !!ruler && ruler.parent === rt.cursorObj;
    if (now && !held) {
      rt.vm.props.add(pad, P.Visible);
      // What is picked already is measured at once.
      const picked = rt.picked().find((f) => isObject(f) && !isScaleBox(rt, f));
      if (picked) {
        rt.vm.enterMessage(messageWord(rt.vm, 'Incominginfo'));
        rt.vm.enterMessage(featuresWord(picked));
        rt.vm.enterMessage(new Word());
        rt.vm.queueMessage(pad, true);
        rt.vm.messageBlockReset();
      }
      rt.changed(pad);
    } else if (!now) hide(rt, pad);
    held = now;
    if (!now || !ruler) return;
    // The ruler itself isn't shown on the crosshair: the pad is what it brings.
    for (const o of subtree(ruler))
      if (rt.vm.props.has(o, P.Visible)) {
        rt.vm.props.del(o, P.Visible);
        rt.changed(o);
      }
    showMarquee(rt);
  });
  return pad;
}

/**
 * A marquee being dragged out is measured as it grows: its box's length (z),
 * width (x) and height (y) on the cube plate, so a 3D marquee has a length too.
 */
function showMarquee(rt: Runtime): void {
  const marquee = rt.worlds
    .flatMap((w) => [...preorder(w.root.children)])
    .find((o) => o.drawTechnique === 'draw_marquee_technique');
  if (!marquee) return;
  const box = rt.bbox(marquee);
  const plate = rt.findObject('Cube_Plate');
  if (!box || !plate) return;
  const inches = (v: number) => (v / rt.totalZoom / UNITS_PER_INCH).toFixed(2);
  const sizes: Record<string, number> = {
    Cube_length: box[1][2] - box[0][2],
    Cube_width: box[1][0] - box[0][0],
    Cube_height: box[1][1] - box[0][1],
  };
  for (const p of rt.findObject('MeasurePad')?.children ?? []) {
    const show = p === plate || p.name === 'Name_Plate';
    for (const o of subtree(p))
      if (rt.vm.props.has(o, P.Visible) !== show) {
        if (show) rt.vm.props.add(o, P.Visible);
        else rt.vm.props.del(o, P.Visible);
        rt.changed(o);
      }
  }
  for (const f of plate.children) {
    const item = rt.labelItems(f)[0];
    const v = f.name ? sizes[f.name] : undefined;
    if (item && v !== undefined && item.text !== inches(v)) {
      item.text = inches(v);
      rt.version++;
    }
  }
  const name = rt.findObject('Name_Field');
  const item = name ? rt.labelItems(name)[0] : undefined;
  if (item && item.text !== 'Marquee') {
    item.text = 'Marquee';
    rt.version++;
  }
}

/** The pad and everything on it out of sight, its fields no longer listening. */
function hide(rt: Runtime, pad: CutObject): void {
  for (const o of subtree(pad)) {
    if (rt.vm.props.has(o, P.Visible)) {
      rt.vm.props.del(o, P.Visible);
      rt.changed(o);
    }
    if (rt.vm.props.has(o, P.Active)) rt.vm.props.del(o, P.Active);
    leaveCharstream(rt, o);
  }
}

const messageWord = (vm: VM, name: string): Word => {
  let i = vm.messages.indexOf(name);
  if (i < 0) i = vm.messages.push(name) - 1;
  return msgWord(i);
};

// ---- what is measured ----

const objectOf = (f: Feature | null): CutObject | null =>
  isObject(f) ? f : isSub(f) ? f.object : null;

/** What a pick measures: the object, or the group it is picked as part of. */
function measured(rt: Runtime, f: Feature | null): CutObject | null {
  let o = objectOf(f);
  while (o?.parent && rt.vm.props.has(o.parent, P.Picked)) o = o.parent;
  return o;
}

/** A branch's world box, over what is drawn in it (not its group placeholders). */
function branchBox(rt: Runtime, root: CutObject): [V3, V3] | null {
  let box: [V3, V3] | null = null;
  for (const o of preorder([root])) {
    if (o.attrs.props.includes('Grouper') || o.brep.numFaces === 0) continue;
    const b = rt.bbox(o);
    if (!b) continue;
    box = box
      ? [b[0].map((v, k) => Math.min(v, box![0][k]!)) as V3, b[1].map((v, k) => Math.max(v, box![1][k]!)) as V3] // prettier-ignore
      : b;
  }
  return box;
}

/** generate_info_rec for an object with no record: its box, as width (x), height (y), length (z). */
function boxRec(rt: Runtime, o: CutObject | null): InfoRec | null {
  const b = o ? branchBox(rt, o) : null;
  if (!b) return null;
  return { width: b[1][0] - b[0][0], height: b[1][1] - b[0][1], length: b[1][2] - b[0][2] };
}

/** Where a feature is, to measure from: a vertex; an edge's or face's middle; an object's box centre. */
function placeOf(rt: Runtime, f: Feature | null): V3 | null {
  if (isSub(f)) {
    const g = rt.world(f.object);
    const b = f.object.brep;
    const at = (vs: number[]): V3 => {
      const s = vs.reduce((a, v) => [a[0] + g.x(v), a[1] + g.y(v), a[2] + g.z(v)] as V3, [0, 0, 0] as V3); // prettier-ignore
      return s.map((x) => x / Math.max(1, vs.length)) as V3;
    };
    if (f.type === T.Vfe) return at([f.id]);
    if (f.type === T.Evf) return at(b.edgeVertices(f.id));
    if (f.type === T.Fve) return at(b.loopHalfEdges(b.faceLoop(f.id)).map((h) => b.heVertex(h)));
  }
  const o = measured(rt, f);
  const box = o ? branchBox(rt, o) : null;
  return box ? (box[0].map((v, k) => (v + box[1][k]!) / 2) as V3) : null;
}

/** A picked object's scale box follows it when it is resized or moved here. */
function refit(rt: Runtime, o: CutObject): void {
  if (o.parent && isScaleBox(rt, o.parent)) fitScaleBox(rt, o.parent, o);
}

// ---- words ----

const recWord = (rec: InfoRec | null): Word => {
  const w = new Word();
  if (!rec) return w;
  setupWord(w, W.Aux);
  w.aux = Aux.Address;
  w.ref = rec;
  return w;
};
const recOf = (w: Word): InfoRec | null => {
  const r = w.ref as InfoRec | null;
  return r && typeof r === 'object' && 'length' in r ? r : null;
};
/** A number word's value, whichever kind it is. */
const num = (w: Word): number =>
  w.aux === Aux.Float ? w.float : w.aux === Aux.Long ? w.long : w.aux === Aux.Int ? w.int : 0;

export const MEASURE_CRTNS: Partial<Record<string, (rt: Runtime, vm: VM) => void>> = {
  /** CPL_world_2_inch: room units to inches, as unzoomed (unzoom_unit). */
  world_2_inch(rt, vm) {
    vm.push(floatWord(num(vm.pop()) / rt.totalZoom / UNITS_PER_INCH));
  },
  /** CPL_inch_2_world. */
  inch_2_world(rt, vm) {
    vm.push(floatWord(num(vm.pop()) * UNITS_PER_INCH * rt.totalZoom));
  },

  /** CPL_get_plate_by_name: (info rec) → the plate showing it. Only the cube's plate exists. */
  get_plate_by_name(rt, vm) {
    vm.pop();
    vm.push(featuresWord(rt.findObject('Cube_Plate')));
  },

  /** cutplane_web: (object) → a record of its box, for an object without one (generate_info_rec's fallback). */
  measure_info_rec(rt, vm) {
    vm.push(recWord(boxRec(rt, measured(rt, first(vm.pop())))));
  },

  /** CPL_generate_info_rec: (length, width, height, old prim) → a new record of those sizes. */
  generate_info_rec(_rt, vm) {
    vm.pop(); // the old primitive
    const height = num(vm.pop());
    const width = num(vm.pop());
    const length = num(vm.pop());
    vm.push(recWord({ length, width, height }));
  },

  /** CPL_breakup_info_rec: (record) → its sizes, put straight into the message being built. */
  breakup_info_rec(_rt, vm) {
    const rec = recOf(vm.pop());
    for (const v of rec ? [rec.length, rec.width, rec.height] : [0, 0, 0])
      vm.enterMessage(floatWord(v));
  },

  /**
   * CPL_remake_prim: (old prim, new record) → the prim at the new sizes. Here it is
   * scaled in place about its box's low corner (the corner a cube grows from).
   */
  remake_prim(rt, vm) {
    const rec = recOf(vm.pop());
    const o = measured(rt, first(vm.pop()));
    const box = o ? branchBox(rt, o) : null;
    if (!o || !rec || !box) {
      vm.push(featuresWord(o));
      return;
    }
    const now = [box[1][0] - box[0][0], box[1][1] - box[0][1], box[1][2] - box[0][2]];
    const want = [rec.width, rec.height, rec.length];
    // A size of nothing (a flat object's depth) can't be scaled to; one asked to be nothing is refused.
    const s = now.map((n, k) => (n > 1e-6 && want[k]! > 1e-6 ? want[k]! / n : 1)) as V3;
    if (s.some((f) => Math.abs(f - 1) > 1e-6)) {
      rt.scaleBranch(o, box[0], s);
      refit(rt, o);
    }
    vm.push(featuresWord(o));
  },

  /** CPL_get_feature_size: (edge) → its length. */
  get_feature_size(rt, vm) {
    const f = first(vm.pop());
    if (!isSub(f) || f.type !== T.Evf) {
      vm.push(floatWord(0));
      return;
    }
    const g = rt.world(f.object);
    const [p, q] = f.object.brep.edgeVertices(f.id);
    vm.push(floatWord(Math.hypot(g.x(q) - g.x(p), g.y(q) - g.y(p), g.z(q) - g.z(p))));
  },

  /**
   * CPL_get_feature_dist: (feature 1, feature 2) → (z, y, x, length) from 2 to 1.
   * measurepad.cpl passes the last picked as 1, so it reads from the first pick to the last.
   */
  get_feature_dist(rt, vm) {
    const p1 = placeOf(rt, first(vm.pop()));
    const p2 = placeOf(rt, first(vm.pop()));
    const d = p1 && p2 ? [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]] : [0, 0, 0];
    vm.push(floatWord(d[2]!));
    vm.push(floatWord(d[1]!));
    vm.push(floatWord(d[0]!));
    vm.push(floatWord(Math.hypot(d[0]!, d[1]!, d[2]!)));
  },

  /**
   * CPL_set_feature_dist: (length, x, y, z, feature 2, feature 1): feature 1's object
   * (the last picked) moves to be that far from 2. A new length alone keeps the direction.
   */
  set_feature_dist(rt, vm) {
    const f1 = first(vm.pop());
    const f2 = first(vm.pop());
    const z = num(vm.pop());
    const y = num(vm.pop());
    const x = num(vm.pop());
    const hyp = num(vm.pop());
    const p1 = placeOf(rt, f1);
    const p2 = placeOf(rt, f2);
    const o = measured(rt, f1);
    if (!p1 || !p2 || !o || o === measured(rt, f2)) return;
    const d: V3 = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
    const len = Math.hypot(...d);
    // Typed values come back through two-decimal labels (in inches): near enough is the same.
    const near = 0.05 * UNITS_PER_INCH * rt.totalZoom;
    let want: V3 = [x, y, z];
    const same = want.every((v, k) => Math.abs(v - d[k]!) < near);
    if (same && Math.abs(hyp - len) >= near && len > 1e-6)
      want = d.map((v) => (v * hyp) / len) as V3;
    else if (same) return;
    rt.moveBranch(o, [want[0] - d[0], want[1] - d[1], want[2] - d[2]]);
    refit(rt, o);
  },
};
