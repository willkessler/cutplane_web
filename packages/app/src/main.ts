import * as THREE from 'three';
import { readCut } from '@cutplane/formats';
import { ROOM, createCube, createObject, mat4, type CutObject } from '@cutplane/kernel';
import type { CutDocument } from '@cutplane/formats';
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
import { Editor, type V3 } from './edit/editor.ts';
import { ColorControl } from './edit/colorcontrol.ts';
import { RotateTool } from './edit/rotatetool.ts';
import { ScaleBoxes } from './edit/scalebox.ts';
import { Controller } from './input/controller.ts';
import { WorkMode } from './input/workmode.ts';
import { Crosshair } from './render/crosshair.ts';
import { Highlights } from './render/highlights.ts';
import { RotateToolView } from './render/rotatetool.ts';
import { ScaleBoxView } from './render/scalebox.ts';
import { setLineResolution } from './render/lines.ts';
import { ModelView } from './render/models.ts';
import { Cutplane, createRoom, type PlaneStyle } from './render/room.ts';
import { SectionLines } from './render/sectionlines.ts';
import { createCamera, deeperOnScreen, fitFov, orbitCamera, unitsPerPixel } from './scene.ts';
import { CLASSIC, rgb } from './viewer/palette.ts';

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
scene.add(
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
/** The world being edited: its top-level objects. */
const roots: CutObject[] = [];
const editor = new Editor({
  get models() {
    return models.models;
  },
  roots,
  structureChanged() {
    models.sync(roots);
    dirty = true;
  },
  section: (m) => section.sections.get(m),
  changed(objects) {
    models.rebuild(objects);
    dirty = true;
  },
  committed() {
    control.plane.setDepths(models.depths());
  },
});
const cursor = (): V3 => [control.x, control.y, control.z];
const rotateTool = new RotateTool(editor);
const scaleBoxes = new ScaleBoxes(editor, () => models.models);
let envDirty = true;
const colorControl = new ColorControl(editor, {
  models: () => envView.models,
  section: (m) => envSection.sections.get(m),
  changed(objects) {
    envView.rebuild(objects);
    envDirty = true;
  },
  structureChanged() {
    envView.sync(colorControl.roots);
    envDirty = true;
  },
});
envView.sync(colorControl.roots);

/** The Pick button: the rotate tool takes it when it is under the crosshair, else the editor. */
function pressPick(shift: boolean): void {
  control.resetConstrain();
  rotateTool.updateHover(cursor());
  if (rotateTool.hover) rotateTool.press(cursor());
  else if (scaleBoxes.handleAt(cursor())) scaleBoxes.press(cursor());
  else if (colorControl.partAt(cursor())) colorControl.press(cursor());
  else editor.press(cursor(), shift);
}
function releasePick(): void {
  rotateTool.release(cursor());
  scaleBoxes.release();
  colorControl.release(cursor());
  editor.release(cursor());
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
const base = import.meta.env.BASE_URL;

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
  editor.reset();
  rotateTool.putAway();
  scaleBoxes.reset();
  let doc: CutDocument;
  if (src === NEW_CUBE) doc = newCube();
  else {
    const res = await fetch(`${base}${src}`);
    if (!res.ok) throw new Error(`${src}: ${res.status}`);
    doc = readCut(await res.text()).doc;
  }
  roots.splice(0, roots.length, ...doc.roots);
  models.load(doc);
  control.plane.setDepths(models.depths());
  control.plane.set(ROOM.max[2]);
  dirty = true;
}

modelSelect.addEventListener('change', () => {
  store('model', modelSelect.value);
  void loadModel(modelSelect.value);
  modelSelect.blur();
});

// ---- view ----
let dirty = true;
let lastKey = '';
let lastHighlights = '';
let lastHover = '';
let lastTool = '';
let lastBoxes = '';

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
  for (; demoKeys < p.rotateKeys; demoKeys++) rotateTool.snap(cursor());
  const down = editor.pressed || rotateTool.pressed || scaleBoxes.pressed || colorControl.pressed;
  if (p.pressed && !down) pressPick(false);
  else if (!p.pressed && down) releasePick();
}

const readout = $<HTMLDivElement>('readout');
function render(): void {
  orbitCamera(camera, control.yaw, control.pitch);
  control.planeAxis = deeperOnScreen(camera);
  plane.z = control.z;
  if (rotateTool.pressed) {
    const [x, y] = rotateTool.move(cursor());
    if (x !== control.x || y !== control.y) placeCrosshair(x, y);
  } else if (scaleBoxes.pressed) scaleBoxes.move(cursor(), held.ctrl);
  else if (colorControl.pressed) colorControl.move(cursor());
  else editor.move(cursor());
  scaleBoxes.sync();
  crosshair.place(control.x, control.y, control.z);
  const key = `${control.z}|${control.yaw}|${control.pitch}`;
  if (envDirty || key !== lastKey) {
    envSection.update(envView.models, control.z, camera.position);
    envDirty = false;
  }
  if (dirty || key !== lastKey) {
    section.update(models.models, control.z, camera.position);
    lastKey = key;
    dirty = false;
    const s = section.stats;
    readout.innerHTML =
      `plane <b>${control.z.toFixed(1)}</b>${control.plane.isSnapped ? ' (on a vertex depth)' : ''} · ` +
      `room <b>${control.yaw.toFixed(0)}°</b> / <b>${control.pitch.toFixed(0)}°</b> · ` +
      `section <b>${s.loops}</b> loop${s.loops === 1 ? '' : 's'} in <b>${s.objects}</b> object${s.objects === 1 ? '' : 's'}`;
  }
  const hoverKey = `${control.x}|${control.y}|${control.z}|${section.version}|${envSection.version}`;
  if (hoverKey !== lastHover) {
    // The tool lies over the models and wins the crosshair (its CPL ran first and ate the pick).
    rotateTool.updateHover(cursor());
    scaleBoxes.updateHover(cursor());
    colorControl.updateHover(cursor());
    const chip = colorControl.pressed && !colorControl.hover; // carrying the chip to a target
    if (rotateTool.carrying) {
      /* the tool looks for a feature to land on itself */
    } else if (
      !chip &&
      (rotateTool.busy ||
        scaleBoxes.hover ||
        scaleBoxes.pressed ||
        colorControl.hover ||
        colorControl.pressed)
    )
      editor.clearHover();
    else editor.updateHover(cursor());
    lastHover = hoverKey;
  }
  const hkey = `${editor.version}|${section.version}|${key}|${colorControl.version}`;
  if (hkey !== lastHighlights) {
    const part = colorControl.hover;
    // The part under the crosshair is outlined; on the base, the whole control (it moves as one).
    const outlined = !part
      ? []
      : envView.models.filter((m) =>
          part.kind === 'base'
            ? m.object === colorControl.base || m.object.parent === colorControl.base
            : m.object ===
              (part.kind === 'chip' ? colorControl.chip : colorControl.bars[part.index]),
        );
    highlights.update(editor, models.models, camera.position, outlined);
    lastHighlights = hkey;
  }
  // The tool only follows the crosshair while it shows the grab ring there (over a bar or bauble).
  const ring = rotateTool.hover && rotateTool.hover.kind !== 'center';
  const tkey = `${rotateTool.version}|${control.z}|${ring ? `${control.x}|${control.y}` : ''}`;
  if (tkey !== lastTool) {
    toolView.update(rotateTool, control.z, [control.x, control.y]);
    lastTool = tkey;
  }
  const bkey = `${scaleBoxes.version}|${editor.version}|${control.z}`;
  if (bkey !== lastBoxes) {
    boxView.update(scaleBoxes, control.z);
    lastBoxes = bkey;
  }
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
  if (!editor.pressed && !rotateTool.pressed && !scaleBoxes.pressed && !colorControl.pressed)
    resync = true;
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
    control.wheel(e.deltaY * scale);
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  syncHeld(e);
  if (demo || e.target instanceof HTMLSelectElement) return;
  const c = commandFor(e.code, held);
  if (!c) return;
  e.preventDefault();
  if (c === 'workMode') {
    if (work.state === 'off') void work.enter();
    else if (e.code === 'KeyF') work.exit(); // F toggles, like a video player's full screen
  } else if (c === 'undo') editor.undo();
  else if (c === 'redo') editor.redo();
  else if (c === 'duplicate') editor.duplicate();
  else if (c === 'rotateTool') rotateTool.snap(cursor());
  else if (c === 'delete') editor.deletePicked();
  else control.command(c);
});
window.addEventListener('keyup', syncHeld);
// Modifier releases are lost while the window is unfocused; never leave a quasimode stuck.
window.addEventListener('blur', () => Object.assign(held, NOTHING_HELD));

$<HTMLButtonElement>('work').addEventListener('click', () => void work.enter());
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
    state: () => ({
      x: control.x,
      y: control.y,
      z: control.z,
      yaw: control.yaw,
      pitch: control.pitch,
      motion: control.motion,
    }),
    set(s) {
      if (s.x !== undefined || s.y !== undefined)
        control.setCursor(s.x ?? control.x, s.y ?? control.y);
      if (s.z !== undefined) control.plane.set(s.z);
      if (s.yaw !== undefined || s.pitch !== undefined) {
        control.yaw = s.yaw ?? control.yaw;
        control.pitch = s.pitch ?? control.pitch;
      }
      render();
    },
    stats: () => section.stats,
    press(shift = false) {
      render();
      pressPick(shift);
      render();
    },
    release() {
      releasePick();
      render();
    },
    color: () => ({
      rgb: [...colorControl.rgb],
      hover: colorControl.hover?.kind ?? null,
      base: [...colorControl.base.xform.slice(12, 15)],
    }),
    tool: () => ({
      center: [...rotateTool.center],
      hover: rotateTool.hover?.kind ?? null,
      rotating: rotateTool.rotating,
    }),
    undo() {
      editor.undo();
      render();
    },
    redo() {
      editor.redo();
      render();
    },
    edit() {
      const h = editor.hover;
      let faces = 0;
      let vertices = 0;
      for (const m of models.models) {
        faces += m.object.brep.numFaces;
        vertices += m.object.brep.numVertices;
      }
      return {
        hover: h ? `${h.pick.kind}` : null,
        picked: editor.picked.map((p) => p.kind),
        faces,
        vertices,
        marquee: editor.marquee !== undefined,
        colors: roots.map((r) => [...r.color]),
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
