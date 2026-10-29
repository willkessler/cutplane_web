import { initBooleans } from '@cutplane/booleans';
import manifoldWasm from 'manifold-3d/manifold.wasm?url';
import * as THREE from 'three';
import { readCut, writeCut } from '@cutplane/formats';
import {
  ROOM,
  WorldGeometry,
  createCube,
  createObject,
  groupRoot,
  mat4,
  preorder,
  subtree,
  type CutObject,
  type Pick,
} from '@cutplane/kernel';
import type { CutDocument } from '@cutplane/formats';
import { P, PROPERTY_FILES, T, type Feature } from '@cutplane/cpl';
import {
  COLOR_CRTNS,
  Controls,
  Runtime,
  type FaceDrag,
  type GroupPick,
  installRotateTool,
  installToolboxes,
  bulbLightOf,
  cameraViewOf,
  installLettering,
  letteringPlateOf,
  installStoragePad,
  installHelpPad,
  installHintPlates,
  keysPlateOf,
  showKeysPlate,
  installMeasurePad,
  installToolbars,
  isPad,
  isObject,
  isSub,
  historyOrder,
  loadHistory,
  saveHistory,
  scaleBoxes as scaleBoxesIn,
  markRoom,
  restoreRoom,
  snapshotRoom,
  type RoomSnapshot,
  type SavedHistory,
  type V3,
} from '@cutplane/behaviors';
import { DEMO_SECONDS, demoPose } from './demo.ts';
import { Direct, letterer } from './direct.ts';
import {
  NOTHING_HELD,
  keyLines,
  hintLines,
  commandFor,
  type HintContext,
  type Held,
} from './input/bindings.ts';
import { Controller, PLANE_STICK, isMouseWheel } from './input/controller.ts';
import { WorkMode } from './input/workmode.ts';
import { Crosshair } from './render/crosshair.ts';
import { Highlights } from './render/highlights.ts';
import { RotateToolView } from './render/rotatetool.ts';
import { ScaleBoxView } from './render/scalebox.ts';
import { setLineResolution } from './render/lines.ts';
import { ModelView, type DrawStyle, type Model } from './render/models.ts';
import { CameraSlide } from './render/cameraslide.ts';
import { ScribbleView } from './render/scribbles.ts';
import { DragGuides, carried, type LevelHold } from './world/guides.ts';
import { LabelView } from './render/labels.ts';
import { PadView } from './render/pads.ts';
import { Cutplane, createRoom, type PlaneStyle } from './render/room.ts';
import { SectionLines } from './render/sectionlines.ts';
import { Falls, type Caught } from './world/gravity.ts';
import { Dangle } from './world/dangle.ts';
import { Magnet } from './world/magnet.ts';
import { createCamera, deeperOnScreen, fitFov, orbitCamera, unitsPerPixel } from './scene.ts';
import { CLASSIC, rgb } from './viewer/palette.ts';
import { CodePanel } from './ui/codepanel.ts';
import { idbGet, idbSet } from './ui/idb.ts';
import {
  ACCEPT,
  EXPORTS,
  exportWorld,
  fileName,
  kindOf,
  MESH_KINDS,
  saveFile,
  FACE_BUDGET,
  type ExportFormat,
} from './ui/files.ts';
import { droppedFiles } from './ui/drop.ts';
import { Cancelled, readInBackground } from './ui/importer.ts';
import { LoadingRing } from './render/loadingring.ts';
import { AppStage } from './world/stage.ts';
import {
  boxDrawing,
  colorState,
  highlightState,
  outlinedParts,
  toolActive,
  toolDrawing,
} from './world/views.ts';

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};
const app = $<HTMLDivElement>('app');
const canvas = $<HTMLCanvasElement>('viewport');
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const still = params.has('still');
if (demo) document.documentElement.classList.add('demo');

// The original wrote 8-bit colours straight to the framebuffer; so do we.
THREE.ColorManagement.enabled = false;
// (A stencil: a fine mesh is outlined only off itself.)
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, preserveDrawingBuffer: demo }); // prettier-ignore
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(rgb(CLASSIC.background));
const camera = createCamera(1);
const models = new ModelView();
const plane = new Cutplane();
const section = new SectionLines();
const crosshair = new Crosshair();
const highlights = new Highlights();
const toolView = new RotateToolView();
const boxView = new ScaleBoxView();
/** The environment: goodies that stand in the room but aren't part of the world being edited. */
const envView = new ModelView();
const envSection = new SectionLines();
const padView = new PadView();
const labelView = new LabelView();
// The camera sees the world being made, in its room: not the plane, the tools or itself.
const cameraSlide = new CameraSlide(() => [
  loading.object,
  scribbles.object,
  padView.object,
  labelView.object,
  envView.object,
  envSection.object,
  toolView.object,
  boxView.object,
  plane.object,
  section.object,
  highlights.object,
  guides.view.object,
  crosshair.object,
]);
const scribbles = new ScribbleView();
const guides = new DragGuides(() => rt);
/** The ring that turns in the room while a file is read. */
const loading = new LoadingRing();
scene.add(
  loading.object,
  scribbles.object,
  cameraSlide.object,
  padView.object,
  labelView.object,
  envView.object,
  envSection.object,
  toolView.object,
  boxView.object,
  createRoom(),
  models.object,
  plane.object,
  section.object,
  highlights.object,
  guides.view.object,
  crosshair.object,
);

// ---- settings (remembered per browser) ----
const stored = (k: string) => {
  try {
    return localStorage.getItem(`cutplane.${k}`);
  } catch {
    return null;
  }
};
const store = (k: string, v: string) => {
  try {
    localStorage.setItem(`cutplane.${k}`, v);
  } catch {
    /* private mode */
  }
};
const styleSelect = $<HTMLSelectElement>('planeStyle');
styleSelect.value = (stored('planeStyle') as PlaneStyle | null) ?? 'classic';
const faceDragSelect = $<HTMLSelectElement>('faceDrag');
faceDragSelect.value = (stored('faceDrag') as FaceDrag | null) ?? 'stretch';
const groupPickSelect = $<HTMLSelectElement>('groupPick');
groupPickSelect.value = (stored('groupPick') as GroupPick | null) ?? 'whole';
const stickSelect = $<HTMLSelectElement>('planeStick');
stickSelect.value = stored('planeStick') ?? String(PLANE_STICK);
if (stickSelect.selectedIndex < 0) stickSelect.value = String(PLANE_STICK);
const levelSelect = $<HTMLSelectElement>('levelHold');
levelSelect.value = stored('levelHold') ?? 'all';
if (levelSelect.selectedIndex < 0) levelSelect.value = 'all';
guides.levelHold = levelSelect.value as LevelHold;
plane.style = styleSelect.value as PlaneStyle;
/** Nothing kept from a visit before: the keys plate is shown, to start with. */
const firstVisit = stored('model') === null && stored('session') === null;

const held: Held = { ...NOTHING_HELD };
const MAC = /mac/i.test(navigator.platform);
const control = new Controller(held);
control.plane.stick = Number(stickSelect.value);
const work = new WorkMode(app, canvas);
const base = import.meta.env.BASE_URL;

/** The CPL the world runs: rom.cpl, the property files, the crosshair's and the rotate tool's. */
const CPL_FILES = [
  'rom.cpl',
  'cursor.cpl',
  'rotatecircle.cpl',
  'rotatexbar.cpl',
  'rotatebauble.cpl',
  'nikon.cpl',
  'lens.cpl',
  'save.cpl',
  'load.cpl',
  // The T chip's and its lettering plate's fields' (new).
  'letter.cpl',
  'lettering.cpl',
  // The measure pad's, and its plates' and fields'.
  'measurepad.cpl',
  'cubeplate.cpl',
  'distanceplate.cpl',
  'sizer.cpl',
  'namer.cpl',
  ...PROPERTY_FILES.map((p) => `${p.toLowerCase()}.cpl`),
  // Read when a tool with the property is read (read_feature_props' read_CPL_propfile).
  'grabber.cpl',
  'magnetic.cpl',
  'pan.cpl',
  'union.cpl',
  'gravity.cpl',
];
const cpl = new Map<string, string>();
const source = (f: string): string => {
  const text = cpl.get(f);
  if (text === undefined) throw new Error(`${f}: not loaded`);
  return text;
};
/**
 * The resources the environment is built from (rsc/ and icons/, by file name):
 * cutplane_web's own (assets/rsc, assets/icons: the rails with the union pad) first,
 * else the original's.
 */
const TOOLBARS = ['toolpads.rsc', 'arrangepads.rsc'];
/** The measure pad's plates (create_measure_pad). */
const MEASURE_PLATES = ['nameplate.rsc', 'cubeplate.rsc', 'lengthplate.rsc', 'distanceplate.rsc'];
const resources = new Map<string, string>();
const resource = (f: string): string => {
  const text = resources.get(f);
  if (text === undefined) throw new Error(`${f}: not loaded`);
  return text;
};
async function loadResources(): Promise<void> {
  const latin1 = new TextDecoder('latin1');
  const get = async (f: string) => {
    for (const dir of ['rsc', 'icons', 'original/rsc', 'original/icons']) {
      const res = await fetch(`${base}${dir}/${f}`);
      if (res.ok && !res.headers.get('content-type')?.includes('text/html')) {
        resources.set(f, latin1.decode(await res.arrayBuffer()));
        return;
      }
    }
    throw new Error(`${f}: not found`);
  };
  await Promise.all(
    [
      ...TOOLBARS,
      'padhandle.dcl',
      'toolpad.dcl',
      'toolbar.dcl',
      'storageplate.rsc',
      ...MEASURE_PLATES,
    ].map(get),
  );
  // Each toolbar names its icons (and the tools they become).
  const icons = TOOLBARS.flatMap((f) => {
    const lines = resource(f).split(/\r?\n/);
    const head = lines
      .find((l) => l.startsWith('Headpad Icon File:'))!
      .split(':')[1]!
      .trim();
    const n = Number(lines.find((l) => l.startsWith('Number of Toolpads:'))!.split(':')[1]);
    const at = lines.findIndex((l) => l.startsWith('Number of Toolpads:'));
    const pads = lines
      .slice(at + 1)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    return [head, ...pads.slice(0, n)];
  });
  await Promise.all([...new Set(icons)].map(get));
}

async function loadCpl(): Promise<void> {
  // The originals are Latin-1 (and plain ASCII where it matters).
  const latin1 = new TextDecoder('latin1');
  // cutplane_web's own versions (assets/cpl) first, else the originals.
  const ours = new Set([
    'rom.cpl',
    'cursor.cpl',
    'tool.cpl',
    'toolpad.cpl',
    'headpad.cpl',
    'toolbox.cpl',
    'stamp.cpl',
    'union.cpl',
    'drill.cpl',
    'gravity.cpl',
    'pencil.cpl',
    'measurepad.cpl',
    'textinput.cpl',
    'slice.cpl',
    'group.cpl',
    'magnetic.cpl',
    'rotatexbar.cpl',
    'scalebbox.cpl',
    'goodies.cpl',
    'colorbar.cpl',
    'letter.cpl',
    'lettering.cpl',
  ]);
  await Promise.all(
    CPL_FILES.map(async (f) => {
      const res = await fetch(`${base}${ours.has(f) ? 'cpl' : 'original/cpl'}/${f}`);
      if (!res.ok) throw new Error(`${f}: ${res.status}`);
      cpl.set(f, latin1.decode(await res.arrayBuffer()));
    }),
  );
}

// Made in start(), once the CPL has loaded.
let stage!: AppStage;
let rt!: Runtime;
let controls!: Controls;
let direct!: Direct;
let rotateTool!: ReturnType<typeof installRotateTool>;
let falls!: Falls;
let magnet!: Magnet;
let colorControl!: ReturnType<typeof installToolboxes>['colorControl'];
let toolboxes!: ReturnType<typeof installToolboxes>;
let ready = false;

function makeWorld(): void {
  stage = new AppStage(control);
  stage.z = control.z;
  rt = new Runtime({ stage, source });
  rt.faceDrag = faceDragSelect.value as FaceDrag;
  rt.groupPick = groupPickSelect.value as GroupPick;
  falls = new Falls(rt, models);
  magnet = new Magnet(rt);
  rt.magnetSnap = magnet.snap;
  rt.dropper = (roots) =>
    void falls.drop(roots).catch((e: Error) => notify(`Couldn't drop it: ${e.message}`, true));
  rt.loadCode(source);
  rotateTool = installRotateTool(rt, source);
  rt.registerCrtns(COLOR_CRTNS);
  installToolbars(rt, resource, TOOLBARS);
  toolboxes = installToolboxes(rt, source);
  colorControl = toolboxes.colorControl;
  installStoragePad(rt, resource, source, {
    // "Save to:" keeps the world in this browser; "Load from:" looks there, then in the samples.
    async read(name) {
      const kept = stored(`world.${name}`);
      if (kept !== null) return kept;
      const res = await fetch(`${base}samples/${name.replace(/\.cut$/, '')}.cut`);
      return res.ok && !res.headers.get('content-type')?.includes('text/html') ? res.text() : null;
    },
    write(name, text) {
      keep(name, text);
    },
  });
  installMeasurePad(rt, resource, source);
  installLettering(rt, source);
  rt.letterer = letterer(rt);
  keysPlate = keysPlateOf(installHelpPad(rt, keyLines(MAC)));
  markRoom(rt); // the room as built: what a session left is put back on it
  // (After it: which one shows follows what is picked, nothing for a session to keep.)
  hintPlates = installHintPlates(rt, hintLines(MAC));
  controls = new Controls(rt);
  direct = new Direct({
    rt,
    controls,
    tops: worldTops,
    settle,
    frame: () => (document.hidden ? Promise.resolve() : nextFrame()),
  });
  ready = true;
}

/** The help pad's keys plate, on the plane's side: put away until ? or the pad shows it. */
let keysPlate: CutObject | null = null;
const keysShown = (): boolean => keysPlate !== null && rt.vm.props.has(keysPlate, P.Visible);
function showKeys(shown: boolean): void {
  if (keysPlate) showKeysPlate(rt, keysPlate, shown);
}

/** New here: the hints plates, one for each kind of thing picked (bindings' hintLines). */
let hintPlates = new Map<string, CutObject>();
/** What D last picked (its copies): while that is what is picked, the copy's hints show. */
let copiedPick: Feature[] | null = null;
let hintShown: HintContext | null = null;

/** Which hints fit what is picked now: none with nothing picked, or with ? showing all. */
function hintContext(): HintContext | null {
  const picked = rt.picked();
  if (picked.length === 0 || keysShown()) return null;
  if (
    copiedPick &&
    copiedPick.length === picked.length &&
    picked.every((f) => copiedPick!.includes(f))
  )
    return 'copy';
  if (picked.some((f) => !isObject(f))) return 'part';
  return rt.pickedObjects().length > 1 ? 'many' : 'one';
}

/** Each frame: the hints plate that fits shown, the others put away. */
function showHints(): void {
  const want = hintContext();
  if (want === hintShown) return;
  hintShown = want;
  for (const [name, plate] of hintPlates) showKeysPlate(rt, plate, name === want);
}

function pressPick(shift: boolean): void {
  if (!ready) return;
  // Anything falling stops where it is, so it can be taken hold of (not by the globe,
  // which would only drop it again); what isn't taken falls on after the pick.
  if (falls.active && toolInHand() !== 'Globe') {
    caught = falls.catchAll();
    rt.commit();
  }
  control.resetConstrain();
  // A scale box's handle under the crosshair: Ctrl scales evenly, without the axis lock.
  const handle = rt.vm.props.features(rt.primary, P.Selectable).find((f) => !isObject(f));
  const of = (handle as { object?: CutObject } | undefined)?.object;
  control.unlocked = !!of && rt.vm.props.has(of, P.Scalebbox);
  controls.pressPick(shift);
  // Taken by a face, the magnet's drag shows where it would snap by that face.
  if (magnetInHand()) magnet.grab(rt.vm.props.features(rt.primary, P.Selectable));
  // Where an object picked whole is taken hold of (it dangles from there: permanent gravity).
  const part = rt.vm.props.features(rt.primary, P.Selectable).find(isObject);
  const pick = part && rt.wholePicks.get(part);
  hold = part && pick ? { part, pick: { ...pick, at: [...pick.at] } } : null;
  dangle = null;
}
function releasePick(): void {
  if (!ready) return;
  // A magnet drag with a ghost showing: what it dragged goes there.
  magnet.release();
  controls.releasePick();
  control.unlocked = false;
  hold = dangle = null;
}

const magnetInHand = () => [...subtree(rt.cursorObj)].some((o) => rt.hasProp(o, 'Magnetic'));

/** Caught mid-fall by the last press: those it didn't pick fall on, as they were. */
let caught: Caught[] = [];
function fallOn(): void {
  if (caught.length === 0) return;
  const taken = new Set<CutObject>();
  for (const f of rt.picked()) {
    const o = isObject(f) ? f : (f as { object?: CutObject }).object;
    if (o) taken.add(o);
  }
  const left = caught.filter((c) => ![...subtree(c.root)].some((o) => taken.has(o)));
  caught = [];
  if (left.length === 0) return;
  const motions = new Map(left.map((c) => [c.root, c.motion]));
  void falls
    .drop(
      left.map((c) => c.root),
      { motions },
    )
    .catch((e: Error) => notify(`Couldn't drop it: ${e.message}`, true));
}

// ---- double clicks (new here) ----
/** Two clicks this close in time (ms) and place (room units) are a double click. */
const DOUBLE_MS = 400;
const DOUBLE_NEAR = 8;
interface Click {
  t: number;
  x: number;
  y: number;
  /** The tool in hand as it was clicked. */
  tool: 'Magnifier' | 'Globe' | null;
  /** The goodie it was on, if it was on one that goes back in its box. */
  goodie: CutObject | null;
  /** It turned into a drag. */
  dragged: boolean;
}
let lastClick: Click | null = null;
/** The second click of a double click was taken: its release is too. */
let swallowRelease = false;

/** Which of the tools that know double clicks the crosshair holds. */
function toolInHand(): Click['tool'] {
  for (const name of ['Magnifier', 'Globe'] as const) {
    const t = rt.findObject(name);
    if (t && heldBy(t, rt.cursorObj)) return name;
  }
  return null;
}

/** The colour control or the camera, if the crosshair is on its base (the camera's body, not its lens). */
function goodieUnder(): CutObject | null {
  rt.setSelectables();
  for (const f of rt.vm.props.features(rt.environment, P.Selectable)) {
    const o = isObject(f) ? f : (f as { object?: CutObject }).object;
    if (!o) continue;
    if (o.name === 'Colorcontrol' || o.name === 'Nikon') return o;
    // The camera's winder and viewfinder are its body too (its lens has its cap on it).
    if (o.parent?.name === 'Nikon' && o.children.length === 0) return o.parent;
  }
  return null;
}

/** A press of the pick button by hand: the second of a double click may be taken for one. */
function clickPress(shift: boolean, t = performance.now()): void {
  if (!ready) return;
  const c = lastClick;
  lastClick = null;
  if (
    c &&
    !c.dragged &&
    !shift &&
    t - c.t < DOUBLE_MS &&
    Math.hypot(control.x - c.x, control.y - c.y) < DOUBLE_NEAR &&
    doubleClick(c)
  ) {
    // prettier-ignore
    swallowRelease = true;
    settle();
    return;
  }
  lastClick = { t, x: control.x, y: control.y, tool: toolInHand(), goodie: goodieUnder(), dragged: false }; // prettier-ignore
  pressPick(shift);
}
function clickRelease(): void {
  if (swallowRelease) {
    swallowRelease = false;
    return;
  }
  if (lastClick && controls.pickHeld && !controls.pressedStill) lastClick.dragged = true;
  releasePick();
}

/** What a double click does, by what was in hand or under the crosshair. False: nothing. */
function doubleClick(c: Click): boolean {
  if (c.tool === 'Magnifier') {
    // Everything, fitted into the room at once.
    rt.fitWorld(rt.primary);
    rt.commit();
    return true;
  }
  if (c.tool === 'Globe') {
    setPermanentGravity(!permanentGravity);
    if (toolInHand() === 'Globe') controls.putToolAway('Globe');
    return true;
  }
  if (c.goodie) {
    controls.putGoodieAway(c.goodie.name!);
    return true;
  }
  return false;
}

// ---- permanent gravity (new here: a double click with the globe) ----
/** Everything falls, all the time, unless it's being dragged. */
let permanentGravity = false;
/** The edits gravity has seen to (nothing new since: nothing to drop). */
let gravitySeen = -1;
/** Where the object being picked whole was taken hold of, until it's dragged. */
let hold: { part: CutObject; pick: Pick } | null = null;
/** The object dangling from the crosshair, swinging. */
let dangle: Dangle | null = null;
let lastSwing = 0;

function setPermanentGravity(on: boolean): void {
  permanentGravity = on;
  rt.dangling = on;
  gravitySeen = -1; // everything falls now
  notify(
    on
      ? 'Gravity always: everything falls, and what you drag dangles (double-click with the globe again to stop)'
      : 'Gravity only where the globe drops it',
  );
}

/** The world's objects at its top (looking through scale boxes to what they hold). */
function worldTops(): CutObject[] {
  const boxes = new Set(scaleBoxesIn(rt, rt.primary.root));
  return rt.primary.root.children.flatMap((o) => (boxes.has(o) ? o.children : [o]));
}

/** Each frame: with permanent gravity, anything changed since it last looked falls. */
function gravityTick(): void {
  if (!permanentGravity || controls.pickHeld || falls.settling) return;
  if (rt.journal.edits === gravitySeen) return;
  gravitySeen = rt.journal.edits;
  const roots = worldTops().filter((o) => !rt.hasProp(o, 'Grouper') || o.children.length > 0);
  if (roots.length)
    void falls
      .drop(roots, { quietly: true })
      .catch((e: Error) => notify(`Couldn't drop it: ${e.message}`, true));
}

/** Each frame: what is held whole, once dragged, dangles (permanent gravity, groups picked whole). */
function swingTick(): void {
  const now = performance.now();
  const dt = (now - lastSwing) / 1000;
  lastSwing = now;
  if (!permanentGravity || rt.groupPick !== 'whole' || !controls.pickHeld) {
    hold = dangle = null;
    return;
  }
  if (!dangle && hold && !controls.pressedStill) {
    // What was picked for the click: the part, or the group it's in.
    const { part, pick } = hold;
    const picked = rt.picked().find((f) => {
      for (let o: CutObject | null = part; o; o = o.parent) if (o === f) return true;
      return false;
    }) as CutObject | undefined;
    if (picked) dangle = Dangle.hold(rt, groupRoot(picked), part, pick);
    hold = null;
  }
  dangle?.step(dt);
}

/** Undo and redo: what they put back stays put, even with permanent gravity. */
function undo(): void {
  const was = rt.journal.edits;
  rt.undo();
  if (gravitySeen === was) gravitySeen = rt.journal.edits;
}
function redo(): void {
  const was = rt.journal.edits;
  rt.redo();
  if (gravitySeen === was) gravitySeen = rt.journal.edits;
}

// ---- the 1 key (new here) ----
/**
 * How the rest is drawn. With something picked: all else as wire (the edges of the
 * faces turned towards you), then out of sight, then as it was. With nothing picked:
 * everything as wire with every edge, then as it was.
 */
let display: { step: 0 | 1 | 2; picked: boolean; keep: Set<CutObject> } = {
  step: 0,
  picked: false,
  keep: new Set(),
};
function styleOf(o: CutObject): DrawStyle {
  const { step, picked, keep } = display;
  if (step === 0 || keep.has(o)) return 'solid';
  if (step === 1) return picked ? 'frontWire' : 'wire';
  return 'hidden';
}
function stepDisplay(): void {
  const picked = rt.pickedObjects().filter((o) => rt.worldOf(o) === rt.primary);
  // Begun with nothing picked, there's no second step: wire, then back.
  const step = (display.step === 0 ? 1 : display.step === 1 && display.picked ? 2 : 0) as 0 | 1 | 2;
  const keep = new Set(picked.flatMap((o) => [...subtree(o)]));
  display = {
    step,
    picked: step === 1 ? picked.length > 0 : display.picked,
    // (Unpicked meanwhile: what was kept still is.)
    keep: step === 0 ? new Set() : keep.size > 0 ? keep : display.keep,
  };
  applyDisplay();
}
/** Draws everything as `display` says; what is out of sight can't be picked. */
function applyDisplay(): void {
  models.setStyle(styleOf);
  rt.unseen.clear();
  if (display.step !== 0)
    for (const m of models.models) if (styleOf(m.object) === 'hidden') rt.unseen.add(m.object);
  dirty = true;
  lastHighlights = '';
}

styleSelect.addEventListener('change', () => {
  plane.style = styleSelect.value as PlaneStyle;
  store('planeStyle', styleSelect.value);
  styleSelect.blur();
});
faceDragSelect.addEventListener('change', () => {
  rt.faceDrag = faceDragSelect.value as FaceDrag;
  store('faceDrag', faceDragSelect.value);
  faceDragSelect.blur();
});
groupPickSelect.addEventListener('change', () => {
  rt.groupPick = groupPickSelect.value as GroupPick;
  store('groupPick', groupPickSelect.value);
  groupPickSelect.blur();
});
levelSelect.addEventListener('change', () => {
  guides.levelHold = levelSelect.value as LevelHold;
  store('levelHold', levelSelect.value);
  levelSelect.blur();
});
stickSelect.addEventListener('change', () => {
  control.plane.stick = Number(stickSelect.value);
  store('planeStick', stickSelect.value);
  stickSelect.blur();
});

/** The plane's stops: every vertex depth, and (sticky) the depths of faces parallel to it. */
function setStops(): void {
  control.plane.setDepths(models.depths());
  control.plane.setStickyDepths(models.flatDepths());
}

// ---- models ----
interface Entry {
  file: string;
  title: string;
}
const modelSelect = $<HTMLSelectElement>('model');
const NEW_CUBE = 'new:cube';
const EXTRA: Entry[] = [{ file: 'original/rsc/hand6.rsc', title: 'Flying hand (rsc/hand6.rsc)' }];

/** A fresh cube in the middle of the room, to shape from scratch. */
function newCube(): CutDocument {
  const object = createObject(createCube(200, 200, 200), {
    name: 'cube',
    color: [120, 160, 210],
    xform: mat4.translation(-100, -100, -100),
  });
  return { title: 'New cube', contains: 'World', name: null, roots: [object] };
}

/** Worlds kept in this browser (Save, and the storage pad's "Save to:"), by name. */
const SAVED = 'saved:';
function savedNames(): string[] {
  const names: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('cutplane.world.')) names.push(k.slice('cutplane.world.'.length));
    }
  } catch {
    /* private mode */
  }
  return names.sort();
}
/** Keeps a world in this browser and lists it in the model menu. */
function keep(name: string, text: string): void {
  store(`world.${name}`, text);
  listSaved();
}
/** The model menu's "Saved in this browser" group, rebuilt from what is kept. */
function listSaved(): void {
  const value = modelSelect.value;
  modelSelect.querySelector('optgroup.saved')?.remove();
  const names = savedNames();
  if (names.length > 0) {
    const group = document.createElement('optgroup');
    group.className = 'saved';
    group.label = 'Saved in this browser';
    for (const n of names)
      group.append(new Option(`${n.replace(/\.cut$/, '')} (saved here)`, `${SAVED}${n}`));
    modelSelect.append(group);
  }
  if (value) modelSelect.value = value;
}

async function loadModel(src: string): Promise<void> {
  let doc: CutDocument;
  if (src === NEW_CUBE) doc = newCube();
  else if (src === AUTOSAVE) {
    const a = await autosavedWorld();
    if (!a) throw new Error('nothing autosaved');
    doc = readCut(a.text).doc;
    loadDocument(doc);
    // Undo carries on where the last session left off.
    if (a.history) loadHistory(rt.journal, a.history, rt.primary.root, historyOrder(doc.roots));
    return;
  } else if (src.startsWith(SAVED)) {
    const text = stored(`world.${src.slice(SAVED.length)}`);
    if (text === null) throw new Error(`${src}: not kept in this browser`);
    doc = readCut(text).doc;
  } else {
    const res = await fetch(`${base}${src}`);
    if (!res.ok) throw new Error(`${src}: ${res.status}`);
    doc = readCut(await res.text()).doc;
  }
  loadDocument(doc);
}

/** Puts a document's objects into the world being edited (their CPL comes with them). */
function loadDocument(doc: CutDocument): void {
  if (controls.pickHeld) controls.releasePick();
  rt.clearWorld(rt.primary);
  rt.journal.clear();
  direct?.forget();
  rt.importObjects(rt.primary, doc.roots);
  display = { step: 0, picked: false, keep: new Set() }; // a new world is drawn as it is
  // A fall used to make its objects Nonselectable while it lasted, and an autosave in
  // the meantime kept them so: nothing in the world being edited is meant to be.
  for (const o of preorder(rt.primary.root.children))
    if (rt.vm.props.has(o, P.Nonselectable)) rt.vm.props.del(o, P.Nonselectable);
  models.load(doc);
  applyDisplay();
  setStops();
  control.plane.set(ROOM.max[2]);
  dirty = true;
  editsSaved = rt.journal.edits; // a world just loaded has nothing to autosave yet
}

modelSelect.addEventListener('change', () => {
  if (modelSelect.value.startsWith('file:')) return; // an opened file: it's loaded already
  store('model', modelSelect.value);
  void loadModel(modelSelect.value);
  modelSelect.blur();
});

// ---- view ----
let dirty = true;
let envDirty = true;
let lastKey = '';
let lastHighlights = '';
let lastTool = '';
let lastBoxes = '';
let lastWorld = -1;
let planeHeld = false;
/** The world's models changed since the plane's stops were last taken from them. */
let depthsStale = true;

function resize(): void {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = fitFov(camera.aspect);
  camera.updateProjectionMatrix();
  setLineResolution(w, h);
  plane.pixelRatio = renderer.getPixelRatio();
  dirty = true;
}

function zRange(): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of models.models) {
    lo = Math.min(lo, m.world.zMin);
    hi = Math.max(hi, m.world.zMax);
  }
  return Number.isFinite(lo) ? [lo, hi] : [ROOM.min[2], ROOM.max[2]];
}

/** The plane through the toolboxes by the back wall, for the demo. */
const DEMO_BOXES_Z = -480;
let demoKeys = 0;
let demoUndos = 0;
function applyDemo(t: number): void {
  const p = demoPose(t);
  const [lo, hi] = zRange();
  const front = Math.min(ROOM.max[2], hi + 15);
  const back = Math.max(ROOM.min[2], lo - 15);
  control.setCursor(p.x, p.y);
  const at = front + (back - front) * p.depth;
  control.plane.set(at + (DEMO_BOXES_Z - at) * p.back);
  control.yaw = p.yaw;
  control.pitch = p.pitch;
  if (p.rotateKeys < demoKeys) demoKeys = 0; // looped
  for (; demoKeys < p.rotateKeys; demoKeys++) controls.snapRotateTool();
  if (p.undoKeys < demoUndos) demoUndos = 0;
  for (; demoUndos < p.undoKeys; demoUndos++) rt.undo();
  if (p.pressed && !controls.pickHeld) pressPick(false);
  else if (!p.pressed && controls.pickHeld) releasePick();
}

/**
 * One frame of the world (update.c's new_update_state): the steering since the last
 * frame goes to CPL as crosshair motion, CPL runs, and the crosshair and plane end up
 * wherever it left them.
 */
function step(): void {
  if (!magnetInHand()) magnet.forget();
  const plane = control.motion === 'plane';
  if (plane !== planeHeld) {
    planeHeld = plane;
    if (plane) controls.pressPlane();
    else controls.releasePlane();
  }
  controls.setConstrain(held.ctrl);
  controls.glide(performance.now()); // a plane jump under way
  holdDepth();
  const d: V3 = [control.x - stage.x, control.y - stage.y, control.z - stage.z];
  // New here: a copy dragged holds on its guides (the crosshair stays where the user has
  // it, so it comes off again); let go, the crosshair is where the copy held.
  if (guiding()) {
    const [x, y] = guides.hold([control.x, control.y, control.z], [stage.x, stage.y, stage.z], control.lockedAxis); // prettier-ignore
    d[0] = x - stage.x;
    d[1] = y - stage.y;
  } else if (guides.on.length > 0) {
    guides.clear();
    placeCrosshair(stage.x, stage.y);
    d[0] = d[1] = 0;
  }
  if (!controls.pickHeld) guides.done();
  controls.moveCrosshair(d, (dd) => stage.preview(...dd));
  controls.frame();
  // The magnet's drag: the face it would snap to, and its ghost there.
  if (controls.pickHeld && magnetInHand()) magnet.update();
  if (!messagesWaiting()) fallOn(); // (once the pick has been made)
  // CPL may have held the crosshair back or put it somewhere else (a tool's bar, a dial).
  if ((stage.x !== control.x || stage.y !== control.y) && guides.on.length === 0)
    placeCrosshair(stage.x, stage.y);
  if (stage.z !== control.z) control.plane.set(stage.z);
  if (rt.quitRequested) rt.quitRequested = false;
  swingTick();
}

/** Catches the drawn models up with the world: new and gone objects, changed geometry. */
function syncModels(): void {
  if (rt.version !== lastWorld) {
    lastWorld = rt.version;
    // (A redraw counts as a version too: the cursor asks for one each move.)
    if (models.sync(rt.primary.root.children)) {
      depthsStale = true;
      if (display.step !== 0) applyDisplay();
    }
    envView.sync(rt.environment.root.children, (o) => !isPad(o));
    dirty = envDirty = true;
  }
  const changed = rt.takeChanged();
  if (changed.size) {
    // The plane's stops are the world's vertex depths: only its models change them.
    if (models.rebuild(changed)) depthsStale = true;
    envView.rebuild(changed);
    dirty = envDirty = true;
  }
  // Fine meshes moved or turned are built where they now are once let go, or held still
  // a while; then they can be picked again.
  if (models.settle(controls.pickHeld).length) dirty = depthsStale = true;
  for (const o of rt.moving) if (!models.isMoving(o)) rt.moving.delete(o);
  // (Not while things fall: they come to rest as one change, then the stops are taken.)
  if (depthsStale && !controls.pickHeld && !falls.active) {
    setStops();
    depthsStale = false;
  }
  // The light bulb lights the room while it's out (set_light).
  const bulb = bulbLightOf(rt);
  const bulbObj = rt.findObject('Lightbulb');
  const light = bulb && bulbObj && rt.vm.props.has(bulbObj, P.Visible) ? bulb : undefined;
  const lightKey = light ? JSON.stringify(light) : '';
  if (lightKey !== lastLight) {
    lastLight = lightKey;
    models.relight(light);
    envView.relight(light);
    dirty = envDirty = true;
  }
}
let lastLight = '';

/** Is `o` carried by the crosshair (a tool in hand, tool.cpl's ADOPT to Crosshair_part)? */
/**
 * A drag of what is picked, by hand (no tool, or one carrying the drill's cutter; not the
 * plane): the guides' to hold. With Ctrl, once its axis lock has chosen an axis, only the
 * guides square across it.
 */
/**
 * New here: what is picked, carried in depth, holds where its back, middle or front meets
 * another's (DragGuides.holdDepth); the user's own depth goes on underneath (`deep.free`),
 * so pushing on takes it off again, as a guide across does. Only once the drag has gone
 * in depth: a drag across stays at its depth.
 */
let deep: { start: number; free: number; held: number } | null = null;
function holdDepth(): void {
  const carrying =
    controls.pickHeld &&
    !controls.pressedRoom &&
    (rt.picked().length > 0 || !!carried(rt)) &&
    toolFree();
  control.carrying = carrying;
  if (!carrying) {
    deep = null;
    if (guides.deep) guides.clearDepth();
    return;
  }
  deep ??= { start: stage.z, free: stage.z, held: stage.z };
  deep.free += control.z - deep.held;
  const z =
    Math.abs(deep.free - deep.start) > 1e-9
      ? guides.holdDepth(deep.free, [stage.x, stage.y, stage.z])
      : deep.free;
  if (Math.abs(deep.free - deep.start) <= 1e-9 && guides.deep) guides.clearDepth();
  if (z !== control.z) control.plane.set(z);
  deep.held = z;
}

function guiding(): boolean {
  return (
    controls.pickHeld &&
    !controls.pressedStill &&
    !controls.pressedRoom && // the rotate tool's bar or dial: it puts the crosshair itself
    (!held.ctrl || control.lockedAxis !== undefined) &&
    control.motion !== 'plane' &&
    toolFree()
  );
}

/** No tool in hand, or one carrying something (the drill's cutter): its drag is guided too. */
function toolFree(): boolean {
  return !rt.cursorObj.children.some((c) => rt.hasProp(c, 'Tool')) || !!carried(rt);
}

function heldBy(o: CutObject, crosshair: CutObject): boolean {
  for (let p = o.parent; p; p = p.parent) if (p === crosshair) return true;
  return false;
}

/**
 * Renders until no CPL message is waiting. A command sent as a message (Jumplane,
 * Snaprotatetool, Delete) is queued by its RAM sentence and read by its feature's
 * code on the next frame; key commands and the test hooks shouldn't wait for it.
 */
function settle(): void {
  render();
  for (let i = 0; i < 8 && messagesWaiting(); i++) render();
}
const messagesWaiting = () =>
  rt.worlds.some((w) => rt.vm.props.features(w, P.Msgpending).length > 0);

/** Settles only if the world is behind the steering or has messages waiting (for reads). */
function catchUp(): void {
  if (control.x !== stage.x || control.y !== stage.y || control.z !== stage.z || messagesWaiting())
    settle();
}

/** The models not falling: a falling one isn't hovered or picked (it isn't where the world has it). */
function stillModels(): Model[] {
  const shown = display.step === 0 ? models.models : models.models.filter((m) => models.shows(m.object)); // prettier-ignore
  // (Nor a moving stand-in: its world is where it was built.)
  const steady = shown.some((m) => m.moving !== undefined) ? shown.filter((m) => m.moving === undefined) : shown; // prettier-ignore
  return falls.busy ? steady.filter((m) => !falls.has(m.object)) : steady;
}

function render(): void {
  step();
  // Falling objects are drawn where their fall has got to; those that land are moved there.
  const falling = falls.active;
  const edits = rt.journal.edits;
  falls.tick();
  // A landing is gravity's own edit: nothing for it to see to again.
  if (gravitySeen === edits) gravitySeen = rt.journal.edits;
  gravityTick();
  syncModels();
  showHints();
  autosaveTick();
  sessionTick();
  orbitCamera(camera, control.yaw, control.pitch);
  control.planeAxis = deeperOnScreen(camera);
  plane.z = stage.z;
  crosshair.place(stage.x, stage.y, stage.z);
  loading.update(camera);
  const key = `${stage.z}|${control.yaw}|${control.pitch}`;
  if (envDirty || key !== lastKey) {
    envSection.update(envView.models, stage.z, camera.position);
    envDirty = false;
  }
  if (dirty || key !== lastKey || falling) {
    // A falling object is cut where its fall has got to.
    const shown = display.step === 0 ? models.models : models.models.filter((m) => models.shows(m.object)); // prettier-ignore
    const drawn = falling
      ? shown.map((m) => {
          const pose = falls.poseOf(m.object);
          if (!pose) return m;
          const world = new WorldGeometry(m.object.brep, mat4.multiply(m.object.xform, pose));
          return { object: m.object, world };
        })
      : shown;
    section.update(drawn, stage.z, camera.position);
    lastKey = key;
    dirty = false;
  }
  // Highlights follow the VM's Selectable and Picked properties.
  const hkey = `${rt.vm.props.version}|${rt.version}|${section.version}|${key}|${stage.x}|${stage.y}|${falls.busy}|${magnet.key()}`;
  if (hkey !== lastHighlights) {
    const steady = stillModels();
    highlights.update(
      highlightState(rt, steady, magnet),
      steady,
      camera.position,
      outlinedParts(rt, envView.models),
      envView.models.filter((m) => heldBy(m.object, rt.cursorObj)),
    );
    lastHighlights = hkey;
    scribbles.update(rt);
    padView.update(rt);
    labelView.update(rt);
    codePanel.show();
    const t = toolDrawing(rt, rotateTool);
    const ring = t.hover && t.hover.kind !== 'center';
    const tkey = `${JSON.stringify(t)}|${stage.z}|${ring ? `${stage.x}|${stage.y}` : ''}`;
    if (tkey !== lastTool) {
      toolView.update(t, stage.z, [stage.x, stage.y]);
      lastTool = tkey;
    }
    const b = boxDrawing(rt);
    const bkey = `${hkey}|${b.boxes.length}`;
    if (bkey !== lastBoxes) {
      boxView.update(b, stage.z);
      lastBoxes = bkey;
    }
  }
  // The camera's view: a screen in the room above the camera, while it's out and turned on.
  const view = cameraViewOf(rt);
  const out = view?.shown && rt.vm.props.has(view.camera, P.Visible) ? view.camera : undefined;
  cameraSlide.update(rt, out, renderer, scene);
  renderer.render(scene, camera);
}

// ---- input ----
const pointerNdc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const planeHit = new THREE.Vector3();

function syncHeld(e: MouseEvent | KeyboardEvent): void {
  held.alt = e.altKey;
  held.meta = e.metaKey;
  held.ctrl = e.ctrlKey;
  held.shift = e.shiftKey;
  if ('buttons' in e) held.buttons = e.buttons;
}

function planeUnder(clientX: number, clientY: number): THREE.Vector3 | null {
  const r = canvas.getBoundingClientRect();
  pointerNdc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointerNdc, camera);
  return raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -control.z),
    planeHit,
  );
}

/**
 * Windowed mode: the crosshair follows the (hidden) pointer, on the plane. The pointer can
 * drift from the crosshair: it keeps moving while ⌘ turns the room or ⌥ pushes the plane,
 * and the point under it changes as the view does. Rather than let the crosshair (and
 * anything it holds) leap to it, the pointer takes hold of the crosshair again at an
 * offset. Coming back into the canvas from outside puts the crosshair under it again.
 */
let aim: [number, number] = [0, 0];
let grip: [number, number] = [0, 0];
let regrip = false;
let resync = true;
let lastView = '';
/** Where the pointer last met the plane (windowed mode). */
let lastHit: [number, number] | undefined;

/** Puts the crosshair somewhere else (a tool holds it to a bar or a circle). */
function placeCrosshair(x: number, y: number): void {
  control.setCursor(x, y);
  // The pointer keeps hold of it there: the next move carries on from here.
  aim = [control.x, control.y];
  if (lastHit) grip = [aim[0] - lastHit[0], aim[1] - lastHit[1]];
}

function pointAt(e: PointerEvent): void {
  orbitCamera(camera, control.yaw, control.pitch);
  camera.updateMatrixWorld(); // the room may have turned since the last frame
  const hit = planeUnder(e.clientX, e.clientY);
  const view = `${control.yaw}|${control.pitch}|${control.z}`;
  if (resync) grip = [0, 0];
  else if (hit && (regrip || view !== lastView)) grip = [aim[0] - hit.x, aim[1] - hit.y];
  regrip = resync = false;
  lastView = view;
  if (!hit) return;
  lastHit = [hit.x, hit.y];
  aim = [hit.x + grip[0], hit.y + grip[1]];
  control.pointTo(...aim);
}

/**
 * Where the pointer last was (windowed mode). Its motion is taken from that, not
 * movementX/Y: WebKit leaves those 0 without pointer lock, so ⌘ and ⌥ moved nothing.
 */
let lastClient: [number, number] | undefined;
canvas.addEventListener('pointermove', (e) => {
  if (demo || work.state === 'paused') return;
  syncHeld(e);
  const upp = unitsPerPixel(camera, canvas.clientHeight, control.z);
  const [dx, dy] = lastClient ? [e.clientX - lastClient[0], e.clientY - lastClient[1]] : [0, 0];
  lastClient = [e.clientX, e.clientY];
  if (work.state === 'on') {
    if (work.accept(e.movementX, e.movementY)) control.move(e.movementX, e.movementY, upp);
  } else if (control.motion === 'point') pointAt(e);
  else {
    regrip = true;
    control.move(dx, dy, upp);
  }
});
canvas.addEventListener('pointerleave', () => (lastClient = undefined));
canvas.addEventListener('pointerenter', () => {
  if (ready && !controls.pickHeld) resync = true;
});
canvas.addEventListener('pointerdown', (e) => {
  syncHeld(e);
  $<HTMLDetailsElement>('settings').open = false; // a click in the room closes the settings menu
  if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
  if (work.state === 'paused') {
    void work.resume();
    return;
  }
  if (demo || e.button !== 0) return;
  if (work.state === 'off') canvas.setPointerCapture(e.pointerId); // keep dragging past the edge
  aim = [control.x, control.y];
  clickPress(e.shiftKey);
});
canvas.addEventListener('pointerup', (e) => {
  syncHeld(e);
  if (e.button === 0) clickRelease();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/**
 * New: hands off (?mcp). While an agent works the app, the person's own mouse, wheel and
 * keys are set aside (a pointer resting on the room would otherwise steer the crosshair
 * from under it); the agent's input, made by the page, still goes through. The banner's
 * button takes the app back.
 */
let handsOff = false;
const handsOffBanner = $<HTMLDivElement>('handsoff');
function setHandsOff(on: boolean): void {
  if (on === handsOff) return;
  handsOff = on;
  handsOffBanner.classList.toggle('shown', on);
  if (on) return;
  // The pointer takes hold of the crosshair again where it is, at an offset (no leap).
  Object.assign(held, NOTHING_HELD);
  lastClient = undefined;
  regrip = true;
}
for (const type of [
  'pointermove',
  'pointerdown',
  'pointerup',
  'pointerenter',
  'pointerleave',
  'wheel',
  'keydown',
  'keyup',
  'contextmenu',
])
  // prettier-ignore
  window.addEventListener(
    type,
    (e) => {
      if (!handsOff || !e.isTrusted) return;
      if (e.target instanceof Node && handsOffBanner.contains(e.target)) return;
      e.stopImmediatePropagation();
      if (e.cancelable) e.preventDefault();
    },
    { capture: true, passive: false },
  );
/** New: what the agent is doing (?mcp), each step's goal, under the banner. */
const agentGoal = $<HTMLDivElement>('goal');
$<HTMLButtonElement>('takeover').addEventListener('click', () => setHandsOff(false));
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault(); // also stops pinch-zooming the page
    if (demo) return;
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
    // A wheel's notches or a trackpad's swipe, told apart per event (no setting for it).
    const mouse = isMouseWheel(e as WheelEvent & { wheelDeltaY?: number });
    const upp = unitsPerPixel(camera, canvas.clientHeight, control.z);
    control.wheel(e.deltaY * scale, e.deltaX * scale, mouse, upp);
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  syncHeld(e);
  if (reading && e.key === 'Escape') {
    e.preventDefault();
    reading.cancel();
    return;
  }
  if (
    demo ||
    !ready ||
    e.target instanceof HTMLSelectElement ||
    e.target instanceof HTMLTextAreaElement ||
    e.target instanceof HTMLInputElement
  )
    return;
  // A text input is listening (textinput.cpl): keys are typed, not commands.
  if (controls.typing && !e.metaKey && !e.ctrlKey) {
    const special: Record<string, number> = {
      Backspace: 0x08,
      ArrowLeft: 0x02,
      ArrowRight: 0x06,
      Enter: 0x0d,
      Escape: 0x1b,
    };
    const code = special[e.key] ?? (e.key.length === 1 ? e.key.charCodeAt(0) : undefined);
    if (code !== undefined) {
      e.preventDefault();
      controls.typeChar(code);
      settle();
    }
    return;
  }
  // Esc puts the tool in hand away (in full screen the browser keeps Esc to leave it).
  if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (controls.putToolInHandAway()) {
      e.preventDefault();
      settle();
    }
    return;
  }
  const c = commandFor(e.code, held);
  if (!c) return;
  e.preventDefault();
  if (c === 'workMode') {
    if (work.state === 'off') void work.enter();
    else if (e.code === 'KeyF') work.exit(); // F toggles, like a video player's full screen
  } else if (c === 'undo') undo();
  else if (c === 'redo') redo();
  else if (c === 'duplicate') {
    controls.duplicate();
    settle();
    copiedPick = rt.picked().slice();
  } else if (c === 'rotateTool') controls.snapRotateTool();
  else if (c === 'group') controls.group();
  else if (c === 'slice') controls.slice();
  else if (c === 'union') controls.union();
  else if (c === 'align') controls.align();
  else if (c === 'distribute') controls.distribute();
  else if (c === 'zoomTool') controls.takeTool('Magnifier');
  else if (c === 'panTool') controls.takeTool('Pantool');
  else if (c === 'pencilTool') controls.takeTool('Pencil');
  else if (c === 'measureTool') controls.takeTool('Ruler');
  else if (c === 'gravityTool') controls.takeTool('Globe');
  else if (c === 'display') stepDisplay();
  else if (c === 'help') showKeys(!keysShown());
  else if (c === 'delete') controls.delete();
  else if (c === 'selectAll') controls.selectAll();
  else if (c === 'planeJump')
    controls.planeJump(); // cursor.cpl's Jumplane
  else control.command(c);
  settle(); // the command takes effect now, not a frame or two later
});
window.addEventListener('keyup', syncHeld);
// Modifier releases are lost while the window is unfocused; never leave a quasimode stuck.
window.addEventListener('blur', () => Object.assign(held, NOTHING_HELD));

$<HTMLButtonElement>('work').addEventListener('click', () => void work.enter());

// ---- files and code ----
const codePanel = new CodePanel(() => rt, $<HTMLDivElement>('code'));
$<HTMLButtonElement>('codeButton').addEventListener('click', (e) => {
  codePanel.toggle();
  (e.target as HTMLButtonElement).blur();
});

const worldTitle = () =>
  (modelSelect.value === AUTOSAVE
    ? autosaved()?.title
    : modelSelect.selectedOptions[0]?.text.replace(/\s*\(.*$/, '')) || 'world';
/** The world being edited as a .cut file, with its objects' private code inline. */
const worldText = () =>
  writeCut({ title: worldTitle(), contains: 'World', name: null, roots: rt.documentRoots() });

/**
 * Saves the world being edited (File System Access where there is one, else a
 * download), and keeps a copy in this browser, listed in the model menu.
 */
async function saveWorld(): Promise<void> {
  const title = worldTitle();
  const text = worldText();
  const name = fileName(title, 'cut');
  keep(name, text);
  modelSelect.value = `${SAVED}${name}`;
  store('model', modelSelect.value);
  await saveFile(name, new Blob([text], { type: 'text/plain' }), 'Cutplane world');
}
$<HTMLButtonElement>('save').addEventListener('click', (e) => {
  void saveWorld();
  (e.target as HTMLButtonElement).blur();
});
const fileInput = $<HTMLInputElement>('file');
$<HTMLButtonElement>('open').addEventListener('click', (e) => {
  fileInput.click();
  (e.target as HTMLButtonElement).blur();
});
fileInput.accept = ACCEPT;
fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files ?? [])];
  fileInput.value = '';
  void openFiles(files);
});

/** What an import did, or why it couldn't: to the console (nothing flat is laid over the room). */
let lastNotice = { text: '', error: false };
function notify(text: string, error = false): void {
  lastNotice = { text, error };
  if (error) console.warn(text);
  else console.info(text);
}

/**
 * Opened or dropped files: a .cut becomes the world being edited (as Open
 * always did); OBJ, STL and glTF models are added to it, fitted into the room,
 * as one undoable step.
 */
async function openFiles(files: File[]): Promise<void> {
  const cut = files.find((f) => kindOf(f.name) === 'cut');
  const meshes = files.filter((f) => MESH_KINDS.includes(kindOf(f.name)));
  if (!cut && meshes.length === 0) {
    if (files.length) notify(`Cutplane can't open ${files.map((f) => f.name).join(', ')}`, true);
    return;
  }
  try {
    if (cut) {
      loadDocument(readCut(new TextDecoder('latin1').decode(await cut.arrayBuffer())).doc);
      if (![...modelSelect.options].some((o) => o.value === `file:${cut.name}`))
        modelSelect.add(new Option(cut.name, `file:${cut.name}`));
      modelSelect.value = `file:${cut.name}`;
    }
    if (meshes.length === 0) return;
    if (reading) {
      notify(`Still reading ${reading.names} (Esc stops it)`);
      return;
    }
    // Read in the background, the ring showing how far it has got: a big file takes a while.
    const names = meshes.map((f) => f.name).join(', ');
    loading.start(`Reading ${names}...`); // (the stroke font has no …)
    const r = readInBackground(files, { progress: (f) => loading.progress(f), budget });
    reading = { names, cancel: r.cancel };
    let got;
    try {
      got = await r.result;
    } catch (err) {
      loading.stop();
      throw err;
    } finally {
      reading = null;
    }
    if (loading.shown) {
      // Building what's drawn takes a moment more, on this thread: say so before it starts.
      loading.finishing(`Adding ${names} to the world...`);
      await nextFrame();
      await nextFrame();
    } else loading.stop(); // quick: it never came up
    if (controls.pickHeld) controls.releasePick();
    rt.addObjects(got.objects);
    // The frame that draws them is the next: the ring goes once it has.
    void nextFrame().then(() => loading.stop());
    const n = got.objects.length;
    const scaled =
      got.scale === 1 ? '' : `, scaled ×${Number(got.scale.toPrecision(3))} to fit the room`;
    const holes = got.holes ? `, ${got.holes} hole${got.holes === 1 ? '' : 's'} closed to make solids` : ''; // prettier-ignore
    const fewer = got.simplified ? `, simplified from ${count(got.simplified.from)} faces to ${count(got.simplified.to)}` : ''; // prettier-ignore
    const flat = got.laidFlat ? ', laid flat (its up was Z)' : '';
    const plan = got.plan
      ? `, a plan: ${got.plan.regions} region${got.plan.regions === 1 ? '' : 's'} its lines close, laid flat (pull one up with Faces extrude)` +
        (got.plan.loose
          ? `; ${got.plan.loose} line${got.plan.loose === 1 ? '' : 's'} closing nothing left out`
          : '')
      : '';
    const bare = got.missing.length ? `, uncoloured: drop ${got.missing.join(', ')} with it for its colours` : ''; // prettier-ignore
    const one = got.objects[0]!;
    const what =
      n === 1 && one.attrs.props.includes('Grouper')
        ? `a group of ${one.children.length}` // G ungroups it
        : `${n} object${n === 1 ? '' : 's'}`;
    notify(
      `Added ${what} from ${got.names.join(', ')}${scaled}${flat}${plan}${fewer}${holes}${bare} (undo takes ${n === 1 ? 'it' : 'them'} out)`,
    );
  } catch (err) {
    if (err instanceof Cancelled) {
      notify('Stopped reading');
      return;
    }
    console.warn(err);
    notify(`Couldn't open ${(err as Error).message}`, true);
  }
}

/**
 * The most faces an import comes in as: ?faces=all keeps every one,
 * ?faces=N sets another budget.
 */
const budget = ((t) => (t === 'all' ? Infinity : Number(t) > 0 ? Number(t) : FACE_BUDGET))(
  params.get('faces'),
);
const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
/** A read of model files under way, if one is. */
let reading: { names: string; cancel(): void } | null = null;
/** A count to read: 2.4 million, 380 thousand. */
const count = (n: number) =>
  n >= 1e6 ? `${Number((n / 1e6).toPrecision(2))} million` : n >= 1e4 ? `${Math.round(n / 1e3)} thousand` : `${n}`; // prettier-ignore

// Drag and drop: files (or folders of them) dropped anywhere on the page open as Open does.
let dragDepth = 0;
const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  app.classList.add('dropping');
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    app.classList.remove('dropping');
  }
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  app.classList.remove('dropping');
  // A folder dropped opens as all its files would.
  void droppedFiles(e.dataTransfer).then(openFiles);
});

// Export: the world's objects as glTF, OBJ or STL.
const exportSelect = $<HTMLSelectElement>('export');
for (const [k, v] of Object.entries(EXPORTS)) exportSelect.add(new Option(v.label, k));
exportSelect.addEventListener('change', async () => {
  const format = exportSelect.value as ExportFormat;
  exportSelect.value = '';
  exportSelect.blur();
  if (!format) return;
  const title = worldTitle();
  const blob = await exportWorld(format, rt.documentRoots(), title);
  await saveFile(fileName(title, format), blob, EXPORTS[format].description);
});

// ---- autosave ----
/**
 * Every edit (and undo and redo) is kept in this browser a moment later, with
 * the undo history, so closing the tab or a crash loses nothing: the next
 * visit opens it where it was left, and undo carries on from there. The model
 * menu's "Unsaved changes" brings it back too. The world and its history go in
 * IndexedDB; localStorage holds what the menu shows (and the world alone, if
 * IndexedDB can't be had).
 */
const AUTOSAVE = 'autosave:';
/** How long the mouse and keys are left alone before an edit is autosaved (ms). */
const AUTOSAVE_IDLE = 5000;
interface Autosave {
  title: string;
  at: number;
  /** The world, when it couldn't go in IndexedDB. */
  text?: string;
}
interface AutosaveRecord {
  at: number;
  text: string;
  history: SavedHistory;
}
function autosaved(): Autosave | null {
  try {
    const a = JSON.parse(stored('autosave') ?? 'null') as Autosave | null;
    return a && typeof a.at === 'number' ? a : null;
  } catch {
    return null;
  }
}
let editsSaved = 0;
/** An edit not yet autosaved. */
let unsaved = false;
function listAutosave(): void {
  modelSelect.querySelector(`option[value="${AUTOSAVE}"]`)?.remove();
  const a = autosaved();
  if (!a) return;
  const time = new Date(a.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  const o = new Option(`Unsaved changes: ${a.title} (autosaved ${time})`, AUTOSAVE);
  modelSelect.insertBefore(o, modelSelect.firstChild);
}
function autosave(): void {
  unsaved = false;
  const value = modelSelect.value;
  const title = worldTitle();
  const roots = rt.documentRoots();
  const text = writeCut({ title, contains: 'World', name: null, roots });
  const history = saveHistory(rt.journal, rt.primary.root, historyOrder(roots));
  const at = Date.now();
  const record: AutosaveRecord = { at, text, history };
  void idbSet('autosave', record).then((ok) => {
    store('autosave', JSON.stringify(ok ? { title, at } : { title, at, text }));
    listAutosave();
  });
  // The next visit opens it, whatever the menu says now.
  store('model', AUTOSAVE);
  modelSelect.value = value;
}
/** The autosaved world and, if it was kept, its undo history. */
async function autosavedWorld(): Promise<{ text: string; history: SavedHistory | null } | null> {
  const a = autosaved();
  if (!a) return null;
  const r = await idbGet<AutosaveRecord>('autosave');
  if (r && r.at === a.at) return { text: r.text, history: r.history };
  return a.text !== undefined ? { text: a.text, history: null } : null;
}
/**
 * Called every frame: an edit since the last autosave is kept once the hands have
 * been still a while. (Writing out a big world takes a moment: not mid-work.)
 */
function autosaveTick(): void {
  if (rt.journal.edits !== editsSaved) {
    editsSaved = rt.journal.edits;
    unsaved = true;
  }
  if (unsaved && performance.now() - lastInput >= AUTOSAVE_IDLE && !controls.pickHeld) autosave();
}
let lastInput = 0;
for (const type of ['pointermove', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'wheel'])
  window.addEventListener(type, () => (lastInput = performance.now()), {
    capture: true,
    passive: true,
  });
// Leaving the page with an edit not yet kept keeps it now.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && unsaved) autosave();
});
window.addEventListener('pagehide', () => {
  if (unsaved) autosave();
  saveSession();
});

// ---- the session (new here) ----
/**
 * How the room was left, for the next visit: where the plane and crosshair were,
 * how the room was turned, permanent gravity, and the room itself (the rails open
 * or shut, the toolboxes, the goodies out, the rotate tool, the keys plate). The
 * world being edited comes back by the autosave; the menus' choices by their own.
 */
interface Session {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  gravity: boolean;
  room: RoomSnapshot | null;
}
/** How the room is seen with no session to go on: turned a little, so it reads as a room. */
const START_VIEW = { yaw: -20, pitch: 5 };
/** How long the hands are still before the session is kept (ms). */
const SESSION_IDLE = 1000;
/** Tests and recordings start from nothing, and keep nothing. */
const sessions = !still && !demo;
let sessionKept = '';
/** The room is being reset: nothing more is kept before the page reloads. */
let resetting = false;
function saveSession(): void {
  if (!sessions || !ready || resetting) return;
  const s: Session = {
    x: stage.x,
    y: stage.y,
    z: stage.z,
    yaw: control.yaw,
    pitch: control.pitch,
    gravity: permanentGravity,
    room: snapshotRoom(rt),
  };
  store('session', JSON.stringify(s));
}
/** Called every frame: a change, once the hands have been still a moment, is kept. */
function sessionTick(): void {
  const key = `${stage.x}|${stage.y}|${stage.z}|${control.yaw}|${control.pitch}|${rt.version}|${permanentGravity}`;
  if (key === sessionKept || controls.pickHeld || performance.now() - lastInput < SESSION_IDLE)
    return;
  sessionKept = key;
  saveSession();
}
/** The last visit's session put back, or a first look at the room. */
function startSession(): void {
  if (!sessions) return;
  let s: Session | null = null;
  try {
    s = JSON.parse(stored('session') ?? 'null') as Session | null;
  } catch {
    /* kept by another version: start afresh */
  }
  if (!s || typeof s.z !== 'number') {
    control.yaw = START_VIEW.yaw;
    control.pitch = START_VIEW.pitch;
    if (firstVisit) showKeys(true);
    return;
  }
  control.setCursor(s.x, s.y);
  control.plane.set(s.z);
  control.yaw = s.yaw;
  control.pitch = s.pitch;
  // The room as it was, crosshair and plane with it; else they get there by CPL, as when steered.
  if (s.room && restoreRoom(rt, s.room)) {
    stage.x = control.x;
    stage.y = control.y;
    stage.z = control.z;
  }
  if (s.gravity) setPermanentGravity(true);
  aim = [control.x, control.y];
  regrip = true;
}

// The room as built: the next visit's session is dropped, and the page reloads without
// keeping this one (leaving keeps it, which would put it straight back).
$<HTMLButtonElement>('resetRoom').addEventListener('click', () => {
  resetting = true;
  try {
    localStorage.removeItem('cutplane.session');
  } catch {
    /* private mode */
  }
  location.reload();
});

$<HTMLButtonElement>('resume').addEventListener('click', () => void work.resume());
$<HTMLButtonElement>('leave').addEventListener('click', () => work.exit());
if (work.unsupported) $<HTMLButtonElement>('work').disabled = true;
work.onChange((s) => {
  // Losing the pointer mid-drag finishes the drag where it is, never half-applied.
  if (s !== 'on') releasePick();
  // The crosshair moved by relative motion meanwhile; the windowed pointer takes it from there.
  aim = [control.x, control.y];
  regrip = true;
  app.classList.toggle('working', s !== 'off');
  $<HTMLDivElement>('pause').classList.toggle('shown', s === 'paused');
  Object.assign(held, NOTHING_HELD);
});

// ---- test and recording hooks ----
/** An object's shape, for an agent to check its work by (see inspect). */
interface Shape {
  name?: string | undefined;
  color: number[];
  /** Its box: least corner, greatest. */
  box: number[][];
  counts: { vertices: number; faces: number };
  /** Its corners and faces, if it has few enough (INSPECT_MAX_VERTICES). */
  vertices?: number[][];
  /** Each face: its corners (indices into vertices, the outer loop), its normal, its holes. */
  faces?: { v: number[]; n: number[]; holes?: number[][] }[];
}
/** A part of a room tool or a scale box, by its feature type (for `takes`). */
const PART_NAMES: Record<number, string> = { [T.Vfe]: 'corner', [T.Evf]: 'edge', [T.Fve]: 'face' };
const COLOR_NAMES = ['red', 'green', 'blue'];
/** More corners than this, and an object is inspected as its box and counts alone. */
const INSPECT_MAX_VERTICES = 48;
type PickedPart =
  | { kind: 'object'; object: number }
  | { kind: 'vertex'; object: number; vertex: number; at: number[] }
  | { kind: 'face'; object: number; face: number; n: number[]; corners: number[][] }
  | { kind: 'edge'; object: number; ends: number[]; at: number[][] };
interface Inspected {
  objects: Shape[];
  /** What is picked, by index into objects (and into its vertices and faces). */
  picked: PickedPart[];
}

declare global {
  interface Window {
    __cutplane?: {
      renderFrame(t: number): void;
      readPixels(): string;
      state(): {
        x: number;
        y: number;
        z: number;
        yaw: number;
        pitch: number;
        motion: string;
        /** Where the hand has the crosshair: ahead of it while guides hold it, else on it. */
        hand: [number, number, number];
      };
      set(s: Partial<{ x: number; y: number; z: number; yaw: number; pitch: number }>): void;
      stats(): typeof section.stats;
      press(shift?: boolean): void;
      release(): void;
      /** Two clicks, quickly, where the crosshair is (as by hand: a double click). */
      doubleClick(): void;
      /** How many objects are drawn each way (the 1 key), and how many can't be picked for it. */
      display(): { solid: number; frontWire: number; wire: number; hidden: number; unseen: number };
      /** Whether gravity is always on, and whether something dangles from the crosshair. */
      gravity(): { always: boolean; dangling: boolean };
      /** The rotate tool: its centre, the part under the crosshair, and the bars' ends and baubles shown. */
      tool(): {
        center: number[];
        hover: string | null;
        rotating: boolean;
        held: boolean;
        bars: number[][][];
        baubles: number[][];
      };
      /**
       * What a press here takes ahead of the world's part (new, for an agent): a tool or
       * goodie of the room (its code runs first and eats the press), or a scale box's handle.
       */
      takes(): string | null;
      /** Sets the person's own mouse and keys aside (an agent at work) or not; whether they are. */
      handsOff(on?: boolean): boolean;
      /** Shows what the agent is doing, and why, at the top of the room ('' hides it). */
      goal(text: string): void;
      /**
       * The shapes of what is picked (or of every object in the world, `all`): each one's
       * box, corners and faces (corners in order, the outer loop first; normal), in room
       * coordinates; and the picked parts, by those indices.
       */
      inspect(all?: boolean): Inspected;
      /** New, for an agent: a direct call (list, add, move, rotate, scale, copy…; direct.ts). */
      direct(op: string, args: Record<string, unknown>): Promise<unknown>;
      color(): { rgb: number[]; hover: string | null; base: number[] };
      locate(what: string): unknown;
      scribble(): { segments: number; start: number[]; line: boolean };
      saveText(): string;
      /** Saves the world as the Save button does, under this title: the file's name and text. */
      saveAs(title: string): { file: string; text: string };
      /** Picks a world from the model menu (new:cube, samples/…, saved:…), once it's loaded. */
      open(src: string): Promise<void>;
      /**
       * The toolbar's choices kept in this browser (planeStyle, faceDrag, groupPick,
       * levelHold, planeStick), each set first as asked, as a person picks it.
       */
      settings(set?: Record<string, string>): Record<string, string>;
      /**
       * The room as the user sees it: a JPEG this many pixels wide, as a data URL. With
       * `at`, a closer look (new, for an agent): the camera aimed at that point from the
       * way it looks now, `zoom` times nearer (the person's own view is left as it was).
       */
      snapshot(width: number, at?: [number, number, number], zoom?: number): string;
      /** Every colour a drawn face has, as "r,g,b". */
      palette(): string[];
      openText(text: string): void;
      undo(): void;
      redo(): void;
      edit(): {
        hover: string | null;
        picked: string[];
        faces: number;
        vertices: number;
        marquee: boolean;
        colors: number[][];
        /** Objects at the top of the world (a group counts once). */
        objects: number;
        /** Scale boxes in the world (one round what is picked). */
        boxes: number;
      };
      /** The ring that turns while a file is read: up or not, and how far round it has turned. */
      loading(): { shown: boolean; turn: number };
      /** The last notice: what an import did, or why it couldn't. */
      notice(): { text: string; error: boolean };
      /** Shows the keys plate or not; whether it is shown. */
      keysPlate(show?: boolean): boolean;
      /** Which hints plate shows (what is picked), if any. */
      hints(): string | null;
      /** Keeps the session now; how long it is (characters). */
      saveSession(): number;
      /** Whether the magnet is in hand; a magnet drag's face to snap to (its object's name), and its ghost's box middle. */
      magnet(): { held: boolean; target: string | null; ghost: number[] | null };
      /** The drag's guide lines held on now, the depth one last (each a point and direction). */
      guides(): { at: number[]; dir: number[] }[];
      /** Whether anything is falling (the globe), and how far above the floor the world's lowest point is (and each object's). */
      falls(): {
        active: boolean;
        aboveFloor: number;
        lows: number[];
        mids: number[][];
        spans: number[][];
      };
      /** Whether the camera's view shows, on its screen in the room. */
      cameraView(): boolean;
      demoSeconds: number;
    };
  }
}

async function start(): Promise<void> {
  resize();
  window.addEventListener('resize', resize);
  // The booleans' WebAssembly (manifold-3d) loads alongside the CPL and resources.
  await Promise.all([loadCpl(), loadResources(), initBooleans(manifoldWasm)]);
  makeWorld();

  const index: Entry[] = await fetch(`${base}samples/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Entry[]>) : []))
    .catch(() => []);
  const entries = [
    { file: NEW_CUBE, title: 'New cube (shape it from scratch)' },
    ...index.map((e) => ({ file: `samples/${e.file}`, title: e.title })),
    ...EXTRA,
  ];
  for (const e of entries) modelSelect.add(new Option(e.title, e.file));
  listSaved();
  listAutosave();
  const sample = params.get('sample');
  const src =
    params.get('src') ??
    (sample === 'cube'
      ? NEW_CUBE
      : sample
        ? `samples/${sample}.cut`
        : (stored('model') ?? 'samples/discovery.cut'));
  if (![...modelSelect.options].some((o) => o.value === src)) modelSelect.add(new Option(src, src));
  modelSelect.value = src;
  try {
    await loadModel(src);
  } catch (err) {
    console.warn(err);
    if (src !== 'samples/discovery.cut')
      await loadModel((modelSelect.value = 'samples/discovery.cut'));
  }
  startSession();

  let lastT = 0;
  const renderFrame = (t: number) => {
    lastT = t;
    if (demo) applyDemo(t);
    render();
  };
  window.__cutplane = {
    renderFrame,
    readPixels() {
      renderFrame(lastT);
      const gl = renderer.getContext();
      const { width: w, height: h } = gl.canvas;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = '';
      for (let i = 0; i < px.length; i += 0x8000)
        s += String.fromCharCode(...px.subarray(i, i + 0x8000));
      return `${w}x${h}:${btoa(s)}`;
    },
    state() {
      catchUp(); // the world catches up with the pointer first
      return {
        x: stage.x,
        y: stage.y,
        z: stage.z,
        yaw: control.yaw,
        pitch: control.pitch,
        motion: control.motion,
        hand: [control.x, control.y, control.z],
      };
    },
    set(s) {
      if (s.x !== undefined || s.y !== undefined) {
        control.setCursor(s.x ?? control.x, s.y ?? control.y);
        aim = [control.x, control.y];
      }
      if (s.z !== undefined) control.plane.set(s.z);
      if (s.yaw !== undefined || s.pitch !== undefined) {
        control.yaw = s.yaw ?? control.yaw;
        control.pitch = s.pitch ?? control.pitch;
      }
      settle();
    },
    stats: () => section.stats,
    press(shift = false) {
      render();
      pressPick(shift);
      settle();
    },
    release() {
      releasePick();
      settle();
    },
    doubleClick() {
      // (A slow software-rendered frame mustn't part the clicks: they're timed as by hand.)
      const t = performance.now();
      for (let i = 0; i < 2; i++) {
        render();
        clickPress(false, t + i * 150);
        settle();
        clickRelease();
        settle();
      }
    },
    display() {
      const out = { solid: 0, frontWire: 0, wire: 0, hidden: 0, unseen: rt.unseen.size };
      for (const m of models.models) out[styleOf(m.object)]++;
      return out;
    },
    gravity: () => ({ always: permanentGravity, dangling: dangle !== null }),
    color: () => colorState(rt, colorControl),
    saveText: () => worldText(),
    saveAs(title) {
      const text = writeCut({ title, contains: 'World', name: null, roots: rt.documentRoots() });
      const file = fileName(title, 'cut');
      keep(file, text);
      modelSelect.value = `${SAVED}${file}`;
      store('model', modelSelect.value);
      return { file, text };
    },
    settings(set = {}) {
      const selects = {
        planeStyle: styleSelect,
        faceDrag: faceDragSelect,
        groupPick: groupPickSelect,
        levelHold: levelSelect,
        planeStick: stickSelect,
      };
      for (const [k, sel] of Object.entries(selects)) {
        const v = set[k];
        if (v === undefined || v === sel.value) continue;
        sel.value = v;
        sel.dispatchEvent(new Event('change'));
      }
      return Object.fromEntries(Object.entries(selects).map(([k, sel]) => [k, sel.value]));
    },
    async open(src) {
      if (![...modelSelect.options].some((o) => o.value === src))
        modelSelect.add(new Option(src, src));
      modelSelect.value = src;
      store('model', src);
      await loadModel(src);
      settle();
    },
    snapshot(width, at, zoom = 1) {
      render();
      if (at) {
        // From the way the camera looks, nearer the point by the zoom (never inside the
        // near plane), aimed at it; the next frame puts the camera back.
        const from = camera.position.clone();
        const dir = from.clone().normalize();
        const dist = Math.max(from.length() / Math.max(zoom, 1), 250);
        camera.position.set(at[0], at[1], at[2]).addScaledVector(dir, dist);
        camera.lookAt(at[0], at[1], at[2]);
        renderer.render(scene, camera);
      }
      const out = document.createElement('canvas');
      out.width = Math.min(width, canvas.width);
      out.height = Math.round((out.width * canvas.height) / canvas.width);
      out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height);
      if (at) render();
      return out.toDataURL('image/jpeg', 0.85);
    },
    palette() {
      const out = new Set<string>();
      for (const m of models.models)
        for (const f of m.object.brep.faces())
          out.add((m.object.brep.faceColors.get(f) ?? m.object.color).join(','));
      return [...out].sort();
    },
    openText(text) {
      loadDocument(readCut(text).doc);
      settle();
    },
    locate(what) {
      // Centres of the environment's things, for scripted runs (tests, the README animation).
      const box = (o: CutObject | undefined) => {
        const b = o ? rt.bbox(o) : null;
        return b ? [0, 1, 2].map((k) => (b[0][k]! + b[1][k]!) / 2) : null;
      };
      const cc = colorControl;
      const padsOf = (head: string) =>
        (rt.findObject(head)?.children[0]?.children ?? []).map((h) => box(h.children[0]));
      const parts: Record<string, () => unknown> = {
        prims: () => box(toolboxes.prims),
        goodies: () => box(toolboxes.goodies),
        stamps: () => toolboxes.prims.children.filter((c) => rt.hasProp(c, 'Stamp')).map(box),
        base: () => box(cc.base),
        chip: () => box(cc.chip),
        glass: () => box(cc.glass),
        letter: () => box(cc.letter),
        lettering: () => box(letteringPlateOf(rt)?.plate),
        bars: () => cc.bars.map((b) => ({ center: box(b), top: rt.bbox(b)![1][1] })),
        picked: () => box(rt.pickedObjects()[0]),
        bulb: () => box(rt.findObject('Lightbulb') ?? undefined),
        camera: () => box(rt.findObject('Nikon') ?? undefined),
        // A rail's headpad, and its pads in order (toolpads: pencil, saw, drill).
        toolpads: () => box(rt.findObject('Toolpads') ?? undefined),
        arrangepads: () => box(rt.findObject('Arrangepads') ?? undefined),
        // Which rails are open (their bars shown).
        rails: () =>
          ['Toolpads', 'Arrangepads'].filter((h) => {
            const bar = rt.findObject(h)?.children[0];
            return !!bar && rt.vm.props.has(bar, P.Visible);
          }),
        // The tools the crosshair holds, by name.
        inHand: () => rt.cursorObj.children.filter((c) => rt.hasProp(c, 'Tool')).map((c) => c.name),
        pads: () => padsOf('Toolpads'),
        arrangers: () => padsOf('Arrangepads'),
        // The measure pad: which of its plates show, and what its fields say.
        measure: () => {
          const pad = rt.findObject('MeasurePad');
          const plates = pad?.children ?? [];
          return {
            pad: box(pad ?? undefined),
            shown: plates.filter((p) => rt.vm.props.has(p, P.Visible)).map((p) => p.name),
            fields: Object.fromEntries(
              plates.flatMap((p) => p.children).map((f) => [f.name, rt.label(f, 1)]),
            ),
          };
        },
        // The help pad, and whether its plate is open.
        help: () => {
          const plate = rt.findObject('Keys_Plate');
          return {
            pad: box(rt.findObject('HelpPad') ?? undefined),
            open: !!plate && rt.vm.props.has(plate, P.Visible),
          };
        },
      };
      // Whether a thing in the room is out (drawn), by name ("shown:Colorcontrol").
      if (what.startsWith('shown:')) {
        const o = rt.findObject(what.slice(6));
        return !!o && rt.vm.props.has(o, P.Visible);
      }
      // A measure pad field's centre, by name ("measurefield:Cube_height").
      if (what.startsWith('measurefield:')) return box(rt.findObject(what.slice(13)) ?? undefined);
      return parts[what]?.() ?? null;
    },
    scribble: () => ({
      segments: scribbles.segments,
      start: scribbles.start,
      line: scribbles.lineShown,
    }),
    tool: () => {
      const t = toolDrawing(rt, rotateTool);
      return {
        center: [...t.center],
        hover: t.hover?.kind ?? null,
        rotating: toolActive(rt, rotateTool),
        held: t.held,
        // (A bar runs between its baubles; set on an edge across the plane, only the dial's show.)
        bars: (['h', 'v'] as const)
          .filter((b) => t.show[`${b}bar`])
          .map((b) => [[...t.bauble(b, 1)], [...t.bauble(b, -1)]]),
        baubles: (['h', 'v'] as const)
          .filter((b) => t.show[`${b}baubles`])
          .flatMap((b) => [[...t.bauble(b, 1)], [...t.bauble(b, -1)]]),
      };
    },
    takes() {
      catchUp();
      const env = rt.selected(rt.environment)[0];
      const o = env && (isObject(env) ? env : isSub(env) ? env.object : null);
      if (env && o) {
        let named: CutObject | null = o;
        while (named && !named.name) named = named.parent;
        // The colour control's bars have no names of their own.
        const bar = rt.hasProp(o, 'Colorbar') ? ` ${COLOR_NAMES[colorControl.bars.indexOf(o)]} bar` : ''; // prettier-ignore
        return `${named?.name ?? 'room'}${bar}${isObject(env) ? '' : ` ${PART_NAMES[env.type]}`}`;
      }
      const handle = rt.selected(rt.primary).find((f) => isSub(f) && rt.vm.props.has(f.object, P.Scalebbox)); // prettier-ignore
      return handle ? `scale box ${PART_NAMES[handle.type]}` : null;
    },
    handsOff(on) {
      if (on !== undefined) setHandsOff(on);
      return handsOff;
    },
    goal(text) {
      agentGoal.textContent = text;
      agentGoal.classList.toggle('shown', text !== '');
    },
    inspect(all) {
      catchUp();
      const r = (v: number) => Math.round(v * 10) / 10;
      // (A scale box is passed over, and what it holds is taken in.)
      const roots = all ? rt.primary.root.children : rt.pickedObjects();
      const parts = [...new Set(roots.flatMap((o) => [...subtree(o)]))].filter(
        (o) => isObject(o) && o.brep.numFaces > 0 && !rt.vm.props.has(o, P.Scalebbox),
      );
      // (Each one's ids to indices, for the picked parts below.)
      const ids: { v: Map<number, number>; f: Map<number, number> }[] = [];
      const point = (o: CutObject, v: number) => {
        const g = rt.world(o);
        return [r(g.x(v)), r(g.y(v)), r(g.z(v))];
      };
      const normal = (o: CutObject, f: number) =>
        rt
          .world(o)
          .faceNormal(f)
          .map((c) => Math.round(c * 1000) / 1000);
      const objects = parts.map((o): Shape => {
        const verts = o.brep.vertices();
        const index = new Map(verts.map((v, i) => [v, i]));
        const loop = (l: number) =>
          o.brep.loopHalfEdges(l).map((h) => index.get(o.brep.heVertex(h))!);
        const box = rt.bbox(o)!;
        ids.push({ v: index, f: new Map(o.brep.faces().map((f, i) => [f, i])) });
        const shape: Shape = {
          name: o.name ?? undefined,
          color: [...o.color],
          box: box.map((p) => p.map(r)),
          counts: { vertices: verts.length, faces: o.brep.numFaces },
        };
        // A curved thing (a cylinder's 144 corners) is its box and counts alone: its
        // picked parts below still say where they are.
        if (verts.length > INSPECT_MAX_VERTICES) return shape;
        shape.vertices = verts.map((v) => point(o, v));
        shape.faces = o.brep.faces().map((f) => {
          const [outer, ...holes] = o.brep.faceLoops(f).map(loop);
          const n = normal(o, f);
          return holes.length ? { v: outer!, n, holes } : { v: outer!, n };
        });
        return shape;
      });
      const at = new Map(parts.map((o, i) => [o, i]));
      const picked = rt.picked(rt.primary).flatMap((f): PickedPart[] => {
        if (isObject(f)) return at.has(f) ? [{ kind: 'object', object: at.get(f)! }] : [];
        if (!isSub(f) || !at.has(f.object)) return [];
        const i = at.get(f.object)!;
        const { v, f: faces } = ids[i]!;
        const o = f.object;
        if (f.type === T.Vfe)
          return [{ kind: 'vertex', object: i, vertex: v.get(f.id)!, at: point(o, f.id) }];
        if (f.type === T.Fve) {
          const corners = o.brep.loopHalfEdges(o.brep.faceLoop(f.id)).map((h) => point(o, o.brep.heVertex(h))); // prettier-ignore
          return [{ kind: 'face', object: i, face: faces.get(f.id)!, n: normal(o, f.id), corners }];
        }
        if (f.type === T.Evf) {
          const ends = o.brep.edgeVertices(f.id);
          return [{ kind: 'edge', object: i, ends: ends.map((u) => v.get(u)!), at: ends.map((u) => point(o, u)) }]; // prettier-ignore
        }
        return [];
      });
      return { objects, picked };
    },
    async direct(op, args) {
      catchUp();
      const d = direct;
      const calls: Record<string, () => unknown> = {
        list: () => d.list(),
        add: () => d.add(args),
        move: () => d.move(args),
        rotate: () => d.rotate(args),
        scale: () => d.scale(args),
        copy: () => d.copy(args),
        remove: () => d.remove(args),
        paint: () => d.paint(args),
        decal: () => d.decal(args),
        undecal: () => d.undecal(args),
        edit_decal: () => d.editDecal(args),
        name: () => d.name(args),
        pick: () => d.pick(args),
        group: () => d.group(args, false),
        ungroup: () => d.group(args, true),
        arrange: () => d.arrange(args),
        boolean: () => d.boolean(args),
        slice: () => d.slice(args),
        face: () => d.moveFace(args),
        ray: () => d.ray(args),
        clearance: () => d.clearance(args),
      };
      const f = calls[op];
      if (!f) throw new Error(`no such call: ${op}`);
      if (controls.pickHeld) throw new Error('the button is held: release first');
      return await f();
    },
    undo() {
      undo();
      render();
    },
    redo() {
      redo();
      render();
    },
    edit() {
      catchUp(); // the world catches up with the pointer first
      const h = highlightState(rt, stillModels());
      let faces = 0;
      let vertices = 0;
      for (const m of models.models) {
        faces += m.object.brep.numFaces;
        vertices += m.object.brep.numVertices;
      }
      // The world's objects, looking through scale boxes to what they hold.
      const boxes = new Set(scaleBoxesIn(rt, rt.primary.root));
      const tops = rt.primary.root.children.flatMap((o) => (boxes.has(o) ? o.children : [o]));
      return {
        hover: h.hover ? `${h.hover.pick.kind}` : null,
        picked: h.picked.map((p) => p.kind),
        faces,
        vertices,
        marquee: h.marquee !== undefined,
        colors: tops.filter(isObject).map((r) => [...r.color]),
        objects: tops.length,
        boxes: boxes.size,
      };
    },
    loading: () => ({ shown: loading.shown, turn: loading.turn }),
    notice: () => lastNotice,
    saveSession() {
      saveSession();
      return stored('session')?.length ?? 0;
    },
    hints() {
      render();
      return hintShown;
    },
    keysPlate(show) {
      if (show !== undefined) showKeys(show);
      render();
      return keysPlate !== null && rt.vm.props.has(keysPlate, P.Visible);
    },
    guides: () =>
      [...guides.on, ...(guides.deep ? [guides.deep] : [])].map((g) => ({ at: [...(g.show ?? g.at)], dir: [...g.dir] })), // prettier-ignore
    magnet: () => {
      const root = magnet.dragged();
      const m = magnet.ghost;
      const held = magnetInHand();
      if (!root || !m) return { held, target: null, ghost: null };
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const o of subtree(root)) {
        const g = rt.world(o);
        for (const v of o.brep.vertices()) {
          const p = mat4.transformPoint(m, g.x(v), g.y(v), g.z(v));
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k]!, p[k]!);
            hi[k] = Math.max(hi[k]!, p[k]!);
          }
        }
      }
      return {
        held,
        target: magnet.target?.face.object.name ?? '',
        ghost: lo.map((l, k) => (l + hi[k]!) / 2),
      };
    },
    falls: () => {
      const lows = models.models.map((m) => {
        let low = Infinity;
        for (const v of m.object.brep.vertices()) low = Math.min(low, m.world.y(v));
        return low - ROOM.min[1];
      });
      // Each top-level object's box (looking into scale boxes), where the world has it.
      const tops = worldTops();
      const top = new Set(tops);
      const boxes = tops.map((o) => {
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (const m of models.models) {
          let p: CutObject | null = m.object;
          while (p && !top.has(p)) p = p.parent;
          if (p !== o) continue;
          for (const v of m.object.brep.vertices()) {
            const q = [m.world.x(v), m.world.y(v), m.world.z(v)];
            for (let k = 0; k < 3; k++) {
              lo[k] = Math.min(lo[k]!, q[k]!);
              hi[k] = Math.max(hi[k]!, q[k]!);
            }
          }
        }
        return [lo, hi];
      });
      const mids = boxes.map(([lo, hi]) => lo!.map((a, k) => (a + hi![k]!) / 2));
      const spans = boxes.map(([lo, hi]) => lo!.map((a, k) => hi![k]! - a));
      return { active: falls.active, aboveFloor: Math.min(...lows), lows, mids, spans };
    },
    cameraView: () => cameraSlide.shown,
    demoSeconds: DEMO_SECONDS,
  };
  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    if (!still) renderFrame((performance.now() - t0) / 1000);
    else render();
  });
  document.documentElement.dataset['ready'] = 'true';
  // New: ?mcp lets an agent work the app by hand, through the MCP server (packages/mcp).
  if (params.has('mcp'))
    void import('./mcp.ts').then((m) => m.connectMcp(params.get('mcp') || defaultMcp(), window.__cutplane!)); // prettier-ignore
}

/** Where the MCP server listens for the app (compose.yaml's mcp service). */
const defaultMcp = () => `ws://${location.hostname || 'localhost'}:5174/bridge`;

void start();
