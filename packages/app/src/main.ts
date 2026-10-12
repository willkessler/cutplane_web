import * as THREE from 'three';
import { createCamera, createScene } from './scene.ts';

const found = document.querySelector<HTMLCanvasElement>('#viewport');
if (!found) throw new Error('missing #viewport canvas');
const canvas = found;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = createScene();
const camera = createCamera(1);

function resize(): void {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

resize();
window.addEventListener('resize', resize);
renderer.setAnimationLoop(() => renderer.render(scene, camera));
document.documentElement.dataset['ready'] = 'true';
