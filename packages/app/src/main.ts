import * as THREE from 'three';
import { readCut } from '@cutplane/formats';
import { ROOM } from '@cutplane/kernel';
import { createCamera, createScene, orbitCamera } from './scene.ts';
import { documentGroup } from './viewer/objects.ts';

const found = document.querySelector<HTMLCanvasElement>('#viewport');
if (!found) throw new Error('missing #viewport canvas');
const canvas = found;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const room = createScene();
const camera = createCamera(1);
const params = new URLSearchParams(location.search);
const sample = params.get('sample') ?? 'discovery';

function resize(): void {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/**
 * The M1 preview tour: the room swings left and right while the cutplane
 * sweeps front to back. `t` is seconds; the loop repeats every 8 s.
 */
function pose(t: number): void {
  const u = (t % 8) / 8;
  orbitCamera(camera, 32 * Math.sin(2 * Math.PI * u), 11 + 5 * Math.sin(4 * Math.PI * u));
  room.setPlaneZ(
    ROOM.max[2] - (ROOM.max[2] - ROOM.min[2]) * (0.5 - 0.5 * Math.cos(2 * Math.PI * u)),
  );
}

function renderFrame(t: number): void {
  pose(t);
  renderer.render(room.scene, camera);
}

declare global {
  interface Window {
    __cutplane?: { renderFrame(t: number): void; readPixels(): string };
  }
}

async function start(): Promise<void> {
  resize();
  window.addEventListener('resize', resize);
  const res = await fetch(`${import.meta.env.BASE_URL}samples/${encodeURIComponent(sample)}.cut`);
  if (res.ok) room.scene.add(documentGroup(readCut(await res.text()).doc));

  // Recording hooks (see scripts/record-demo): render a given time, read the frame back.
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
  };
  let lastT = 0;
  const animate = params.get('still') === null;
  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    if (animate) lastT = (performance.now() - t0) / 1000;
    renderFrame(lastT);
  });
  const hook = window.__cutplane;
  hook.renderFrame = (t) => {
    lastT = t;
    renderFrame(t);
  };
  document.documentElement.dataset['ready'] = 'true';
}

void start();
