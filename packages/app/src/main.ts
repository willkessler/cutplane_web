import * as THREE from 'three';
import { readCut, writeCut } from '@cutplane/formats';
import { ROOM, createCube, createObject, mat4, type CutObject } from '@cutplane/kernel';
import type { CutDocument } from '@cutplane/formats';
import { P, PROPERTY_FILES } from '@cutplane/cpl';
import {
  COLOR_CRTNS,
  Controls,
  Runtime,
  installRotateTool,
  installToolboxes,
  bulbLightOf,
  cameraViewOf,
  installStoragePad,
  installToolbars,
  isPad,
  isObject,
  scaleBoxes as scaleBoxesIn,
  type V3,
} from '@cutplane/behaviors';
import { DEMO_SECONDS, demoPose } from './demo.ts';
import {
  NOTHING_HELD,
  PROFILES,
  bindingHints,
  commandFor,
  defaultProfile,
  type Held,
  type Profile,
} from './input/bindings.ts';
import { Controller } from './input/controller.ts';
import { WorkMode } from './input/workmode.ts';
import { Crosshair } from './render/crosshair.ts';
import { Highlights } from './render/highlights.ts';
import { RotateToolView } from './render/rotatetool.ts';
import { ScaleBoxView } from './render/scalebox.ts';
import { setLineResolution } from './render/lines.ts';
import { ModelView } from './render/models.ts';
import { CameraSlide } from './render/cameraslide.ts';
import { LabelView } from './render/labels.ts';
import { PadView } from './render/pads.ts';
import { Cutplane, createRoom, type PlaneStyle } from './render/room.ts';
import { SectionLines } from './render/sectionlines.ts';
import { createCamera, deeperOnScreen, fitFov, orbitCamera, unitsPerPixel } from './scene.ts';
import { CLASSIC, rgb } from './viewer/palette.ts';
import { CodePanel } from './ui/codepanel.ts';
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: demo });
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
const cameraSlide = new CameraSlide();
scene.add(
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
const profileSelect = $<HTMLSelectElement>('profile');
for (const p of PROFILES) profileSelect.add(new Option(p.label, p.id));
const initialProfile = (stored('profile') as Profile | null) ?? defaultProfile(navigator.platform);
profileSelect.value = initialProfile;
const styleSelect = $<HTMLSelectElement>('planeStyle');
styleSelect.value = (stored('planeStyle') as PlaneStyle | null) ?? 'classic';
plane.style = styleSelect.value as PlaneStyle;

const held: Held = { ...NOTHING_HELD };
const control = new Controller(profileSelect.value as Profile, held);
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
  ...PROPERTY_FILES.map((p) => `${p.toLowerCase()}.cpl`),
];
const cpl = new Map<string, string>();
const source = (f: string): string => {
  const text = cpl.get(f);
  if (text === undefined) throw new Error(`${f}: not loaded`);
  return text;
};
/** The original's resources the environment is built from (rsc/ and icons/, by file name). */
const TOOLBARS = ['toolpads.rsc', 'arrangepads.rsc'];
const resources = new Map<string, string>();
const resource = (f: string): string => {
  const text = resources.get(f);
  if (text === undefined) throw new Error(`${f}: not loaded`);
  return text;
};
async function loadResources(): Promise<void> {
  const latin1 = new TextDecoder('latin1');
  const get = async (f: string) => {
    for (const dir of ['rsc', 'icons']) {
      const res = await fetch(`${base}original/${dir}/${f}`);
      if (res.ok && !res.headers.get('content-type')?.includes('text/html')) {
        resources.set(f, latin1.decode(await res.arrayBuffer()));
        return;
      }
    }
    throw new Error(`${f}: not found`);
  };
  await Promise.all(
    [...TOOLBARS, 'padhandle.dcl', 'toolpad.dcl', 'toolbar.dcl', 'storageplate.rsc'].map(get),
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
  // cutplane_web's own versions (assets/cpl: rom.cpl, cursor.cpl) first, else the originals.
  const ours = new Set(['rom.cpl', 'cursor.cpl']);
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
let rotateTool!: ReturnType<typeof installRotateTool>;
let colorControl!: ReturnType<typeof installToolboxes>['colorControl'];
let toolboxes!: ReturnType<typeof installToolboxes>;
let ready = false;

function makeWorld(): void {
  stage = new AppStage(control);
  stage.z = control.z;
  rt = new Runtime({ stage, source });
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
      store(`world.${name}`, text);
    },
  });
  controls = new Controls(rt);
  ready = true;
}

function pressPick(shift: boolean): void {
  if (!ready) return;
  control.resetConstrain();
  controls.pressPick(shift);
}
function releasePick(): void {
  if (!ready) return;
  controls.releasePick();
}

profileSelect.addEventListener('change', () => {
  control.profile = profileSelect.value as Profile;
  store('profile', control.profile);
  showHints();
  profileSelect.blur();
});
styleSelect.addEventListener('change', () => {
  plane.style = styleSelect.value as PlaneStyle;
  store('planeStyle', styleSelect.value);
  styleSelect.blur();
});

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

async function loadModel(src: string): Promise<void> {
  let doc: CutDocument;
  if (src === NEW_CUBE) doc = newCube();
  else {
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
  rt.importObjects(rt.primary, doc.roots);
  models.load(doc);
  control.plane.setDepths(models.depths());
  control.plane.set(ROOM.max[2]);
  dirty = true;
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

let demoKeys = 0;
function applyDemo(t: number): void {
  const p = demoPose(t);
  const [lo, hi] = zRange();
  const front = Math.min(ROOM.max[2], hi + 15);
  const back = Math.max(ROOM.min[2], lo - 15);
  control.setCursor(p.x, p.y);
  control.plane.set(front + (back - front) * p.depth);
  control.yaw = p.yaw;
  control.pitch = p.pitch;
  if (p.rotateKeys < demoKeys) demoKeys = 0; // looped
  for (; demoKeys < p.rotateKeys; demoKeys++) controls.snapRotateTool();
  if (p.pressed && !controls.pickHeld) pressPick(false);
  else if (!p.pressed && controls.pickHeld) releasePick();
}

/**
 * One frame of the world (update.c's new_update_state): the steering since the last
 * frame goes to CPL as crosshair motion, CPL runs, and the crosshair and plane end up
 * wherever it left them.
 */
function step(): void {
  const plane = control.motion === 'plane';
  if (plane !== planeHeld) {
    planeHeld = plane;
    if (plane) controls.pressPlane();
    else controls.releasePlane();
  }
  controls.setConstrain(held.ctrl);
  controls.glide(performance.now()); // a plane jump under way
  const d: V3 = [control.x - stage.x, control.y - stage.y, control.z - stage.z];
  controls.moveCrosshair(d, (dd) => stage.preview(...dd));
  controls.frame();
  // CPL may have held the crosshair back or put it somewhere else (a tool's bar, a dial).
  if (stage.x !== control.x || stage.y !== control.y) placeCrosshair(stage.x, stage.y);
  if (stage.z !== control.z) control.plane.set(stage.z);
  if (rt.quitRequested) rt.quitRequested = false;
}

/** Catches the drawn models up with the world: new and gone objects, changed geometry. */
function syncModels(): void {
  if (rt.version !== lastWorld) {
    lastWorld = rt.version;
    models.sync(rt.primary.root.children);
    envView.sync(rt.environment.root.children, (o) => !isPad(o));
    dirty = envDirty = true;
  }
  const changed = rt.takeChanged();
  if (changed.size) {
    models.rebuild(changed);
    envView.rebuild(changed);
    dirty = envDirty = true;
  }
  if ((dirty || envDirty) && !controls.pickHeld) control.plane.setDepths(models.depths());
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

const readout = $<HTMLDivElement>('readout');
function render(): void {
  step();
  syncModels();
  orbitCamera(camera, control.yaw, control.pitch);
  control.planeAxis = deeperOnScreen(camera);
  plane.z = stage.z;
  crosshair.place(stage.x, stage.y, stage.z);
  const key = `${stage.z}|${control.yaw}|${control.pitch}`;
  if (envDirty || key !== lastKey) {
    envSection.update(envView.models, stage.z, camera.position);
    envDirty = false;
  }
  if (dirty || key !== lastKey) {
    section.update(models.models, stage.z, camera.position);
    lastKey = key;
    dirty = false;
    const s = section.stats;
    readout.innerHTML =
      `plane <b>${stage.z.toFixed(1)}</b>${control.plane.isSnapped ? ' (on a vertex depth)' : ''} · ` +
      `room <b>${control.yaw.toFixed(0)}°</b> / <b>${control.pitch.toFixed(0)}°</b> · ` +
      `section <b>${s.loops}</b> loop${s.loops === 1 ? '' : 's'} in <b>${s.objects}</b> object${s.objects === 1 ? '' : 's'}`;
  }
  // Highlights follow the VM's Selectable and Picked properties.
  const hkey = `${rt.vm.props.version}|${rt.version}|${section.version}|${key}|${stage.x}|${stage.y}`;
  if (hkey !== lastHighlights) {
    highlights.update(
      highlightState(rt, models.models),
      models.models,
      camera.position,
      outlinedParts(rt, envView.models),
    );
    lastHighlights = hkey;
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
  const view = cameraViewOf(rt);
  const shown = view?.shown && rt.vm.props.has(view.camera, P.Visible) ? view.camera : undefined;
  cameraSlide.update(rt, shown, renderer, scene);
  renderer.render(scene, camera);
}

function showHints(): void {
  $<HTMLDivElement>('hints').innerHTML = bindingHints(control.profile)
    .map((h) => `<span>${h}</span>`)
    .join('');
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

canvas.addEventListener('pointermove', (e) => {
  if (demo || work.state === 'paused') return;
  syncHeld(e);
  const upp = unitsPerPixel(camera, canvas.clientHeight, control.z);
  if (work.state === 'on') {
    if (work.accept(e.movementX, e.movementY)) control.move(e.movementX, e.movementY, upp);
  } else if (control.motion === 'point') pointAt(e);
  else {
    regrip = true;
    control.move(e.movementX, e.movementY, upp);
  }
});
canvas.addEventListener('pointerenter', () => {
  if (ready && !controls.pickHeld) resync = true;
});
canvas.addEventListener('pointerdown', (e) => {
  syncHeld(e);
  if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
  if (work.state === 'paused') {
    void work.resume();
    return;
  }
  if (demo || e.button !== 0) return;
  if (work.state === 'off') canvas.setPointerCapture(e.pointerId); // keep dragging past the edge
  aim = [control.x, control.y];
  pressPick(e.shiftKey);
});
canvas.addEventListener('pointerup', (e) => {
  syncHeld(e);
  if (e.button === 0) releasePick();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault(); // also stops pinch-zooming the page
    if (demo) return;
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
    control.wheel(e.deltaY * scale, e.deltaX * scale);
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  syncHeld(e);
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
  const c = commandFor(e.code, held);
  if (!c) return;
  e.preventDefault();
  if (c === 'workMode') {
    if (work.state === 'off') void work.enter();
    else if (e.code === 'KeyF') work.exit(); // F toggles, like a video player's full screen
  } else if (c === 'undo') rt.undo();
  else if (c === 'redo') rt.redo();
  else if (c === 'duplicate') controls.duplicate();
  else if (c === 'rotateTool') controls.snapRotateTool();
  else if (c === 'delete') controls.delete();
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

const worldTitle = () => modelSelect.selectedOptions[0]?.text.replace(/\s*\(.*$/, '') || 'world';
/** The world being edited as a .cut file, with its objects' private code inline. */
const worldText = () =>
  writeCut({ title: worldTitle(), contains: 'World', name: null, roots: rt.documentRoots() });

/** Saves the world being edited (File System Access where there is one, else a download). */
async function saveWorld(): Promise<void> {
  const title = worldTitle();
  const text = worldText();
  const name = `${title.replace(/[^\w-]+/g, '_').toLowerCase()}.cut`;
  const picker = (window as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> })
    .showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description: 'Cutplane world', accept: { 'text/plain': ['.cut'] } }],
      });
      const out = await handle.createWritable();
      await out.write(text);
      await out.close();
      return;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
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
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (!f) return;
  const latin1 = new TextDecoder('latin1');
  loadDocument(readCut(latin1.decode(await f.arrayBuffer())).doc);
  if (![...modelSelect.options].some((o) => o.value === `file:${f.name}`))
    modelSelect.add(new Option(f.name, `file:${f.name}`));
  modelSelect.value = `file:${f.name}`;
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
  showHints();
});

// ---- test and recording hooks ----
declare global {
  interface Window {
    __cutplane?: {
      renderFrame(t: number): void;
      readPixels(): string;
      state(): { x: number; y: number; z: number; yaw: number; pitch: number; motion: string };
      set(s: Partial<{ x: number; y: number; z: number; yaw: number; pitch: number }>): void;
      stats(): typeof section.stats;
      press(shift?: boolean): void;
      release(): void;
      tool(): { center: number[]; hover: string | null; rotating: boolean };
      color(): { rgb: number[]; hover: string | null; base: number[] };
      locate(what: string): unknown;
      saveText(): string;
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
      };
      demoSeconds: number;
    };
  }
}

async function start(): Promise<void> {
  resize();
  window.addEventListener('resize', resize);
  showHints();
  await Promise.all([loadCpl(), loadResources()]);
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
  const sample = params.get('sample');
  const src =
    params.get('src') ??
    (sample === 'cube'
      ? NEW_CUBE
      : sample
        ? `samples/${sample}.cut`
        : (stored('model') ?? 'samples/discovery.cut'));
  if (!entries.some((e) => e.file === src)) modelSelect.add(new Option(src, src));
  modelSelect.value = src;
  try {
    await loadModel(src);
  } catch (err) {
    console.warn(err);
    if (src !== 'samples/discovery.cut')
      await loadModel((modelSelect.value = 'samples/discovery.cut'));
  }

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
    color: () => colorState(rt, colorControl),
    saveText: () => worldText(),
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
      const parts: Record<string, () => unknown> = {
        prims: () => box(toolboxes.prims),
        goodies: () => box(toolboxes.goodies),
        stamps: () => toolboxes.prims.children.filter((c) => rt.hasProp(c, 'Stamp')).map(box),
        base: () => box(cc.base),
        chip: () => box(cc.chip),
        bars: () => cc.bars.map((b) => ({ center: box(b), top: rt.bbox(b)![1][1] })),
        picked: () => box(rt.pickedObjects()[0]),
        bulb: () => box(rt.findObject('Lightbulb') ?? undefined),
        camera: () => box(rt.findObject('Nikon') ?? undefined),
      };
      return parts[what]?.() ?? null;
    },
    tool: () => {
      const t = toolDrawing(rt, rotateTool);
      return {
        center: [...t.center],
        hover: t.hover?.kind ?? null,
        rotating: toolActive(rt, rotateTool),
      };
    },
    undo() {
      rt.undo();
      render();
    },
    redo() {
      rt.redo();
      render();
    },
    edit() {
      catchUp(); // the world catches up with the pointer first
      const h = highlightState(rt, models.models);
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
      };
    },
    demoSeconds: DEMO_SECONDS,
  };
  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    if (!still) renderFrame((performance.now() - t0) / 1000);
    else render();
  });
  document.documentElement.dataset['ready'] = 'true';
}

void start();
