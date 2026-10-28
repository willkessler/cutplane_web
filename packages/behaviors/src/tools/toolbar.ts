import { P, featuresWord, first, offsetWord, type Feature, type VM } from '@cutplane/cpl';
import { readCut, readDecal } from '@cutplane/formats';
import {
  Brep,
  WorldGeometry,
  makeLamina,
  mat4,
  subtree,
  type CutObject,
  type Mat4,
  type Rgb,
} from '@cutplane/kernel';
import { isObject, isSub } from '../features.ts';
import { SelectKind, type Runtime, type V3 } from '../runtime.ts';

/**
 * Toolbars (tools.c's create_toolbar, adjust_toolbar, apply_front_decal and
 * read_decal_file; select.c's pad selectechniques; cplib.c's
 * arrange_toolpads, near_toolbar, tool_off_plane and make_decal), run by the
 * original headpad.cpl, padhandle.cpl, toolpad.cpl and tool.cpl.
 *
 * A toolbar rides in the plane: a headpad (its icon on the front), and under
 * it a rail holding padhandles, each with a toolpad whose tool sits on it,
 * invisible, its picture painted on the pad as a decal. The headpad opens and
 * closes the rail; a padhandle can be pulled off a rail, left floating, put
 * on another rail or dunked into a headpad; a toolpad hands you its tool,
 * which then rides on the crosshair, and takes back the one you hold.
 */

/** tools.h. */
export const HEADPAD_SQUARE = 30;
export const HEADPAD_CORNER = HEADPAD_SQUARE / 8;
export const NORMALPAD_SQUARE = 60;
export const DECAL_THICKNESS = 10;
export const TOOLPAD_ZOFFSET = 7;
export const HEADPAD_ZOFFSET = 3;
/**
 * How far a decal stands off its pad's face. The original's Decalzoffset
 * (Toolpadzoffset × 4, measured to the decal's middle) only ever showed head on;
 * with the room turned it left the pictures floating well off their pads.
 */
export const DECAL_GAP = 1;

export interface ToolbarConfig {
  name: string;
  headColor: Rgb;
  position: V3;
  iconFile: string;
  padColor: Rgb;
  handleColor: Rgb;
  barColor: Rgb;
  icons: string[];
}

/** A toolbar resource (toolpads.rsc, arrangepads.rsc). */
export function parseToolbarRsc(text: string): ToolbarConfig {
  const lines = text.split(/\r?\n/);
  const field = (name: string) => {
    const l = lines.find((x) => x.startsWith(`${name}:`));
    if (l === undefined) throw new Error(`toolbar resource: no ${name}`);
    return l.slice(name.length + 1).trim();
  };
  const rgb = (s: string) => s.split(/\s+/).map(Number) as Rgb;
  const n = Number(field('Number of Toolpads'));
  const at = lines.findIndex((x) => x.startsWith('Number of Toolpads:'));
  const pos = field('Headpad Position').replace(/[[\]]/g, '').split(',').map(Number);
  return {
    name: field('Headpad Name'),
    headColor: rgb(field('Headpad Color')),
    position: [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0],
    iconFile: field('Headpad Icon File'),
    padColor: rgb(field('Toolpad Color')),
    handleColor: rgb(field('Padhandle Color')),
    barColor: rgb(field('Toolbar Color')),
    icons: lines
      .slice(at + 1)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .slice(0, n),
  };
}

// ---- decals ----

/** One piece of a decal: an icon object's geometry, placed in its pad's frame. */
export interface DecalPiece {
  brep: Brep;
  /** Piece → pad frame (row vectors); the pad's xform then places it. */
  matrix: Mat4;
  color: Rgb;
}

/** Each pad's decal (its Hasdecal property says whether it shows). */
const decals = new WeakMap<Runtime, Map<CutObject, DecalPiece[]>>();
const decalsOf = (rt: Runtime) => {
  let m = decals.get(rt);
  if (!m) decals.set(rt, (m = new Map()));
  return m;
};

/** The decal drawn on a pad, if it shows. */
export function decalOf(rt: Runtime, pad: CutObject): DecalPiece[] | undefined {
  if (!rt.vm.props.has(pad, P.Hasdecal)) return undefined;
  return decalsOf(rt).get(pad);
}

/** Every pad with a decal showing (for the renderer). */
export function decaledPads(rt: Runtime): CutObject[] {
  return [...decalsOf(rt).keys()].filter((p) => rt.vm.props.has(p, P.Hasdecal));
}

function bboxOf(objects: Iterable<{ brep: Brep; xform: Mat4 }>): [V3, V3] | null {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const o of objects) {
    const g = new WorldGeometry(o.brep, o.xform);
    for (const v of o.brep.vertices()) {
      const p = [g.x(v), g.y(v), g.z(v)];
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, p[k]!);
        hi[k] = Math.max(hi[k]!, p[k]!);
      }
    }
  }
  return Number.isFinite(lo[0]) ? [lo, hi] : null;
}

/**
 * apply_front_decal: the branch `decal`'s picture, shrunk to fit the front of `pad`
 * (less `margin` around it) and `thickness` deep, its back `gap` in front of the pad.
 */
export function applyFrontDecal(
  rt: Runtime,
  decal: CutObject,
  pad: CutObject,
  thickness: number,
  gap: number,
  margin: number,
): void {
  const branch = [...subtree(decal)];
  const db = bboxOf(branch);
  const pb = rt.bbox(pad);
  if (!db || !pb) return;
  const size = [0, 1, 2].map((k) => db[1][k]! - db[0][k]!);
  const lo: V3 = [pb[0][0] + margin, pb[0][1] + margin, pb[1][2]];
  const hi: V3 = [pb[1][0] - margin, pb[1][1] - margin, pb[1][2]];
  const dest = [0, 1, 2].map((k) => hi[k]! - lo[k]!);
  const s = [
    dest[0]! / (size[0]! > 0 ? size[0]! : 1),
    dest[1]! / (size[1]! > 0 ? size[1]! : 1),
    thickness / (size[2]! > 0 ? size[2]! : 1),
  ];
  // Keep the picture's proportions.
  s[0] = s[1] = Math.min(s[0]!, s[1]!);
  const toOrigin = [0, 1, 2].map((k) => -(db[0][k]! + db[1][k]!) / 2);
  const center = mat4.transformPoint(pad.invXform, (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]);
  const m = mat4.multiply(
    mat4.multiply(
      mat4.translation(toOrigin[0]!, toOrigin[1]!, toOrigin[2]!),
      mat4.scaleAbout([0, 0, 0], [s[0]!, s[1]!, s[2]!]),
    ),
    mat4.translation(center[0], center[1], center[2] + gap + thickness / 2),
  );
  const pieces = branch.map((o) => ({
    brep: o.brep.clone(),
    matrix: mat4.multiply(o.xform, m),
    color: [...o.color] as Rgb,
  }));
  decalsOf(rt).set(pad, pieces);
  rt.vm.props.set(pad, P.Hasdecal, 1);
  rt.changed(pad);
}

// ---- building ----

/** read_decal_file: a .dcl's polygons as laminae under `parent` (the first carries the rest). */
function readDecalFile(rt: Runtime, parent: CutObject, text: string): CutObject {
  const { decal } = readDecal(text);
  let firstObj: CutObject | null = null;
  for (const poly of decal.polygons) {
    const pts = poly.points.map(
      (p) => [0, 1, 2].map((k) => p[k]! * decal.scale + decal.origin[k]!) as V3,
    );
    const o = rt.makeObj(rt.environment, null, null);
    makeLamina(o.brep, pts);
    o.color = [...poly.color];
    if (!firstObj) {
      rt.adopt(parent, o, parent.parent === null);
      firstObj = o;
    } else rt.adopt(firstObj, o, false);
  }
  return firstObj!;
}

/** read_data_file: a .cut/.icon/.rsc's objects as children of `parent`; returns the first. */
function readDataFile(rt: Runtime, parent: CutObject, text: string): CutObject | null {
  const { doc } = readCut(text);
  rt.importObjects(rt.environment, doc.roots, parent);
  for (const r of doc.roots) r.linked = false;
  return doc.roots[0] ?? null;
}

/** create_toolbar: builds a toolbar in the plane. `read` gives a resource file's text. */
export function createToolbar(
  rt: Runtime,
  cfg: ToolbarConfig,
  read: (file: string) => string,
): CutObject {
  const env = rt.environment;
  const headpad = rt.makeObj(env, [0, 0, 0], cfg.name, ['Headpad', 'Nonmanifold', 'Noshadow'], {
    selectTechnique: 'set_headpad_selectable',
    drawTechnique: 'draw_headpad_technique',
  });
  headpad.color = [...cfg.headColor];
  const v0 = headpad.brep.vertices()[0]!;
  const v1 = rt.addVertexEdge(headpad, v0, [HEADPAD_SQUARE, HEADPAD_SQUARE, 0]);
  rt.addVertexEdge(headpad, v1, [-HEADPAD_SQUARE, -HEADPAD_SQUARE, 0]);
  rt.translate(headpad, [HEADPAD_SQUARE, HEADPAD_SQUARE + 4 * HEADPAD_CORNER, 0]);
  rt.adopt(rt.cutplane, headpad, true);

  const icon = readDataFile(rt, headpad, read(cfg.iconFile));
  if (icon) {
    // A margin (new): at no margin and twice the depth, the picture overhung the pad's
    // edges in perspective.
    applyFrontDecal(rt, icon, headpad, DECAL_THICKNESS * 2, DECAL_GAP, HEADPAD_SQUARE / 5);
    rt.discard(icon);
  }

  const handleOrig = readDecalFile(rt, headpad, read('padhandle.dcl'));
  rt.adopt(env.root, handleOrig, true);
  const padOrig = readDecalFile(rt, headpad, read('toolpad.dcl'));
  rt.adopt(env.root, padOrig, true);
  const toolbar = readDecalFile(rt, headpad, read('toolbar.dcl'));
  toolbar.selectTechnique = 'set_normalpad_selectable';
  toolbar.drawTechnique = 'draw_pad_technique';
  rt.addProp(toolbar, 'Dragonly');
  rt.addProp(toolbar, 'Toolbar');

  const flat = (o: CutObject, prop: string) => {
    o.selectTechnique = 'set_normalpad_selectable';
    o.drawTechnique = 'draw_pad_technique';
    for (const p of [prop, 'Nonmanifold', 'Noshadow']) rt.addProp(o, p);
    if (rt.vm.props.has(o, P.Visible)) rt.vm.props.del(o, P.Visible);
  };
  for (const file of cfg.icons) {
    const handle = rt.duplicate(handleOrig);
    flat(handle, 'Padhandle');
    rt.adopt(toolbar, handle, true);
    const pad = rt.duplicate(padOrig);
    flat(pad, 'Toolpad');
    rt.adopt(handle, pad, false);
    const tool = readDataFile(rt, pad, read(file));
    if (tool) {
      applyFrontDecal(rt, tool, pad, DECAL_THICKNESS, DECAL_GAP, 0);
      fitInHand(rt, tool);
      for (const o of subtree(tool))
        if (rt.vm.props.has(o, P.Visible)) rt.vm.props.del(o, P.Visible);
    }
  }
  adjustToolbar(rt, toolbar);

  for (const o of subtree(headpad)) rt.addProp(o, 'Lockedgeometry');
  rt.addProp(headpad, 'Visible');
  // Into the plane, wherever it is now (the original built everything with it at 0).
  rt.translate(headpad, [
    cfg.position[0],
    cfg.position[1],
    cfg.position[2] + rt.cutplane.xform[14]!,
  ]);
  if (rt.vm.props.has(toolbar, P.Visible)) rt.vm.props.del(toolbar, P.Visible);
  rt.discard(handleOrig);
  rt.discard(padOrig);
  return headpad;
}

/**
 * New here: in hand, no tool is more than this across. The original's ran from the globe's
 * 50 to the pencil's, saw's and drill's 150 (and the magnifier's 136): they are made as small
 * as the little ones. (Where a tool sits on the crosshair is its Hotspot, wherever that is.)
 */
export const TOOL_MOST = 60;

/**
 * New here: how big a tool is in hand, by its shape on its pad. A long, thin tool (the pencil,
 * saw, drill, ruler) is HAND_LONG long; any other HAND_WIDE across, as a bulky tool that long
 * looks far bigger than a thin one.
 */
export const HAND_LONG = 120;
export const HAND_WIDE = 75;
/** Thin: its second size no more than this much of its first. */
const THIN = 0.45;
/** The property a tool in hand keeps its scale in, so putting it away undoes it exactly. */
const HANDSCALE = 'Handscale';

function handScale(rt: Runtime, tool: CutObject): number {
  const b = groupBox(rt, tool);
  if (!b) return 1;
  const [most, next] = [0, 1, 2].map((k) => b[1][k]! - b[0][k]!).sort((x, y) => y - x) as V3;
  if (!(most > 0)) return 1;
  return (next / most <= THIN ? HAND_LONG : HAND_WIDE) / most;
}

function fitInHand(rt: Runtime, tool: CutObject): void {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const o of subtree(tool)) {
    const b = rt.bbox(o);
    if (!b) continue;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, b[0][k]!);
      hi[k] = Math.max(hi[k]!, b[1][k]!);
    }
  }
  const most = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!(most > TOOL_MOST)) return;
  const s = TOOL_MOST / most;
  rt.scaleBranch(tool, lo, [s, s, s]);
}

/** adjust_toolbar: the rail is stretched (from its top) to hold its pads. */
function adjustToolbar(rt: Runtime, toolbar: CutObject): void {
  const handle = toolbar.children[0];
  let total = 50;
  if (handle) {
    const pad = handle.children[0];
    const hb = rt.bbox(handle);
    const pb = pad ? rt.bbox(pad) : null;
    if (hb) {
      const h = hb[1][1] - hb[0][1] + (pb ? pb[1][1] - pb[0][1] : 0);
      total = h * 1.5 * toolbar.children.length + h / 4;
    }
  }
  const bb = rt.bbox(toolbar);
  if (!bb) return;
  const height = bb[1][1] - bb[0][1];
  if (height === 0 || Math.abs(height - total) < 1e-9) return;
  const k = total / height;
  const top = bb[1][1];
  const g = rt.world(toolbar);
  for (const v of toolbar.brep.vertices()) {
    const y = top + (g.y(v) - top) * k;
    const p = mat4.transformPoint(toolbar.invXform, g.x(v), y, g.z(v));
    toolbar.brep.setVertexPos(v, p[0], p[1], p[2]);
  }
  rt.changed(toolbar);
}

// ---- selectechniques ----

const inBox = (p: V3, lo: V3, hi: V3) => [0, 1, 2].every((k) => p[k]! >= lo[k]! && p[k]! <= hi[k]!);

/** set_headpad_selectable: its box, widened left and down for the tab and deep in z. */
function headpadSelectable(rt: Runtime, pad: CutObject): void {
  const bb = rt.bbox(pad);
  if (!bb) return;
  const lo: V3 = [
    bb[0][0] - HEADPAD_CORNER * 4,
    bb[0][1] - 4 * HEADPAD_CORNER,
    bb[0][2] - HEADPAD_SQUARE,
  ];
  const hi: V3 = [bb[1][0], bb[1][1], bb[1][2] + HEADPAD_SQUARE];
  const c = rt.cursor();
  rt.applySelectable(
    pad,
    inBox(c, lo, hi)
      ? { feature: pad, kind: SelectKind.Obj, at: c }
      : { feature: null, kind: SelectKind.Nothing, at: [0, 0, 0] },
  );
}

/** set_normalpad_selectable: its box, deep in z. */
function normalpadSelectable(rt: Runtime, pad: CutObject): void {
  const bb = rt.bbox(pad);
  if (!bb) return;
  const lo: V3 = [bb[0][0], bb[0][1], bb[0][2] - NORMALPAD_SQUARE];
  const hi: V3 = [bb[1][0], bb[1][1], bb[1][2] + NORMALPAD_SQUARE];
  const c = rt.cursor();
  rt.applySelectable(
    pad,
    inBox(c, lo, hi)
      ? { feature: pad, kind: SelectKind.Obj, at: c }
      : { feature: null, kind: SelectKind.Nothing, at: [0, 0, 0] },
  );
}

/** A branch's box (grow_group_bbox), leaving out what isn't drawn (a pad's resting tool). */
function groupBox(rt: Runtime, o: CutObject, visibleOnly = false): [V3, V3] | null {
  let out: [V3, V3] | null = null;
  for (const x of subtree(o)) {
    if (visibleOnly && !rt.vm.props.has(x, P.Visible) && x !== o) continue;
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

const objectOf = (f: Feature | null): CutObject | null =>
  isObject(f) ? f : isSub(f) ? f.object : null;

export const TOOLBAR_CRTNS: Partial<Record<string, (rt: Runtime, vm: VM) => void>> = {
  /** CPL_arrange_toolpads: (toolbars) — each rail's padhandles stack down it from the top. */
  arrange_toolpads(rt, vm) {
    const rec = vm.pop();
    if (!rec.list) {
      vm.push(rec);
      return;
    }
    for (const f of rec.list) {
      const toolbar = objectOf(f);
      if (!toolbar) continue;
      const bb = rt.bbox(toolbar);
      const first = toolbar.children[0];
      if (!bb || !first) continue;
      const fb = groupBox(rt, first, true);
      if (!fb) continue;
      const width = fb[1][0] - fb[0][0];
      const height = fb[1][1] - fb[0][1];
      // New here: in the order they hang down it, so a handle let go where it was (a click)
      // keeps its slot, and one dropped part-way down goes in there (ADOPT appends it).
      const top = (h: CutObject) => groupBox(rt, h, true)?.[1][1] ?? -Infinity;
      toolbar.children.sort((a, b) => top(b) - top(a));
      toolbar.children.forEach((handle, i) => {
        const hb = groupBox(rt, handle, true);
        if (!hb) return;
        const to: V3 = [
          bb[0][0] + (bb[1][0] - bb[0][0]) / 2 + width,
          bb[1][1] - (height * 1.5 * i + height / 4),
          hb[1][2],
        ];
        rt.translate(handle, [to[0] - hb[1][0], to[1] - hb[1][1], to[2] - hb[1][2]]);
      });
      adjustToolbar(rt, toolbar);
    }
  },

  /** CPL_near_toolbar: (padhandle, toolbars) → the first rail the handle touches, or Nil. */
  near_toolbar(rt, vm) {
    const bars = vm.pop();
    const handle = objectOf(first(vm.pop()));
    let found: CutObject | null = null;
    const hb = handle ? groupBox(rt, handle, true) : null;
    if (hb)
      for (const f of bars.list ?? []) {
        const bar = objectOf(f);
        const bb = bar ? rt.bbox(bar) : null;
        if (!bar || !bb) continue;
        // The rail is flat (no depth of its own); its handles stand in front of it.
        const d = Math.max(bb[1][2] - bb[0][2], NORMALPAD_SQUARE);
        const lo: V3 = [bb[0][0], bb[0][1], bb[0][2] - d];
        const hi: V3 = [bb[1][0], bb[1][1], bb[1][2] + d];
        if ([0, 1, 2].every((k) => lo[k]! <= hb[1][k]! && hi[k]! >= hb[0][k]!)) {
          found = bar;
          break;
        }
      }
    vm.push(featuresWord(found));
  },

  /** New, CPL_tool_to_hand: (tool) → (tool), at its size in hand (taken on its pad). */
  tool_to_hand(rt, vm) {
    const rec = vm.pop();
    const tool = objectOf(first(rec));
    if (tool && !rt.hasProp(tool, HANDSCALE)) {
      const f = handScale(rt, tool);
      rt.scaleObject(tool, f);
      let p = rt.vm.props.find(HANDSCALE);
      if (p < 0) p = rt.vm.props.defineNew(HANDSCALE);
      rt.vm.props.add(tool, p, f);
    }
    vm.push(rec);
  },

  /** New, CPL_tool_to_pad: (tool) → (tool), back at its pad size. */
  tool_to_pad(rt, vm) {
    const rec = vm.pop();
    const tool = objectOf(first(rec));
    const p = rt.vm.props.find(HANDSCALE);
    if (tool && p >= 0 && rt.vm.props.has(tool, p)) {
      const f = Number(rt.vm.props.get(tool, p));
      if (f > 0) rt.scaleObject(tool, 1 / f);
      rt.vm.props.del(tool, p);
    }
    vm.push(rec);
  },

  /** CPL_tool_off_plane: (tool) → the move that puts the tool just in front of the plane. */
  tool_off_plane(rt, vm) {
    const tool = objectOf(first(vm.pop()));
    const bb = tool ? groupBox(rt, tool) : null;
    if (!bb) {
      vm.push(offsetWord([0, 0, 0]));
      return;
    }
    vm.push(offsetWord([0, 0, rt.cursor()[2] - bb[0][2] + 10]));
  },

  /** CPL_make_decal: (pad) → (pad), its tool's picture painted on it again. */
  make_decal(rt, vm) {
    const rec = vm.pop();
    const pad = objectOf(first(rec));
    const tool = pad?.children[0];
    if (pad && tool) applyFrontDecal(rt, tool, pad, DECAL_THICKNESS, DECAL_GAP, 0);
    vm.push(rec);
  },
};

/** The pad selectechniques (headpads; toolpads, rails, plates, dialogs and text inputs). */
export function registerPadTechniques(rt: Runtime): void {
  rt.selectTechniques['set_headpad_selectable'] = (o) => headpadSelectable(rt, o);
  rt.selectTechniques['set_normalpad_selectable'] = (o) => normalpadSelectable(rt, o);
}

/** The toolbars from their resources, with their C routines and selectechniques. */
export function installToolbars(
  rt: Runtime,
  read: (file: string) => string,
  rscFiles: string[],
): CutObject[] {
  rt.registerCrtns(TOOLBAR_CRTNS);
  registerPadTechniques(rt);
  const pads = rscFiles.map((f) => createToolbar(rt, parseToolbarRsc(read(f)), read));
  rt.vm.resolveObjectRefs();
  return pads;
}

export const isPad = (o: CutObject) =>
  o.drawTechnique === 'draw_pad_technique' ||
  o.drawTechnique === 'draw_headpad_technique' ||
  o.drawTechnique === 'draw_plate_technique';
