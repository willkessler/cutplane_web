import * as THREE from 'three';
import { readCut } from '@cutplane/formats';
import { ROOM } from '@cutplane/kernel';
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
scene.add(createRoom(), models.object, plane.object, section.object, crosshair.object);

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
const EXTRA: Entry[] = [{ file: 'original/rsc/hand6.rsc', title: 'Flying hand (rsc/hand6.rsc)' }];
const base = import.meta.env.BASE_URL;

async function loadModel(src: string): Promise<void> {
  const res = await fetch(`${base}${src}`);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  models.load(readCut(await res.text()).doc);
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

function applyDemo(t: number): void {
  const p = demoPose(t);
  const [lo, hi] = zRange();
  const front = Math.min(ROOM.max[2], hi + 15);
  const back = Math.max(ROOM.min[2], lo - 15);
  control.setCursor(p.x, p.y);
  control.plane.set(front + (back - front) * p.depth);
  control.yaw = p.yaw;
  control.pitch = p.pitch;
}

const readout = $<HTMLDivElement>('readout');
function render(): void {
  orbitCamera(camera, control.yaw, control.pitch);
  control.planeAxis = deeperOnScreen(camera);
  plane.z = control.z;
  crosshair.place(control.x, control.y, control.z);
  const key = `${control.z}|${control.yaw}|${control.pitch}`;
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

/** Windowed mode: the crosshair sits exactly under the pointer, on the plane. */
function pointAt(e: PointerEvent): void {
  const r = canvas.getBoundingClientRect();
  pointerNdc.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNdc, camera);
  const hit = raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -control.z),
    planeHit,
  );
  if (hit) control.setCursor(hit.x, hit.y);
}

canvas.addEventListener('pointermove', (e) => {
  if (demo || work.state === 'paused') return;
  syncHeld(e);
  const upp = unitsPerPixel(camera, canvas.clientHeight, control.z);
  if (work.state === 'on') {
    if (work.accept(e.movementX, e.movementY)) control.move(e.movementX, e.movementY, upp);
  } else if (control.motion === 'point') pointAt(e);
  else control.move(e.movementX, e.movementY, upp);
});
canvas.addEventListener('pointerdown', (e) => {
  syncHeld(e);
  if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
  if (work.state === 'paused') void work.resume();
});
canvas.addEventListener('pointerup', syncHeld);
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
  } else control.command(c);
});
window.addEventListener('keyup', syncHeld);
// Modifier releases are lost while the window is unfocused; never leave a quasimode stuck.
window.addEventListener('blur', () => Object.assign(held, NOTHING_HELD));

$<HTMLButtonElement>('work').addEventListener('click', () => void work.enter());
$<HTMLButtonElement>('resume').addEventListener('click', () => void work.resume());
$<HTMLButtonElement>('leave').addEventListener('click', () => work.exit());
if (work.unsupported) $<HTMLButtonElement>('work').disabled = true;
work.onChange((s) => {
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
  const entries = [...index.map((e) => ({ file: `samples/${e.file}`, title: e.title })), ...EXTRA];
  for (const e of entries) modelSelect.add(new Option(e.title, e.file));
  const sample = params.get('sample');
  const src =
    params.get('src') ??
    (sample ? `samples/${sample}.cut` : (stored('model') ?? 'samples/discovery.cut'));
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
