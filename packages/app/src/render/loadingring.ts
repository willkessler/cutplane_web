import * as THREE from 'three';
import { textStrokes } from './labels.ts';

/** Shown only if a read takes longer than this: a quick one would just flicker. */
const DELAY = 250;
/** How far in front of the eye the ring floats, and its size there (of the view's half height). */
const AWAY = 400;
const SIZE = 0.16;
const ACCENT = 0x00e5e5;

/**
 * Lit by a light fixed to the eye (the room's own materials carry their shading
 * baked in, so there is no light in the scene to use): the ring's turning shows.
 */
function shaded(color: number, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: opacity } },
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      varying vec3 vNormal;
      void main() {
        vec3 n = normalize(vNormal);
        float lit = 0.3 + 0.7 * max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
        float shine = pow(max(dot(n, normalize(vec3(-0.2, 0.4, 1.0))), 0.0), 24.0);
        gl_FragColor = vec4(color * lit + vec3(shine * 0.6), opacity);
      }`,
    // Drawn in the last pass (see the constructor), so whatever stands nearer can't hide it.
    transparent: true,
  });
}

/**
 * The ring that floats in the room while a file is read: it tumbles as it
 * spins, and its bright arc fills as the read goes, the file's name and how
 * far it has got under it in the room's stroke font. It stays in front of the
 * eye wherever the room is turned, in work mode too.
 */
export class LoadingRing {
  readonly object = new THREE.Group();
  private readonly ring = new THREE.Group();
  private readonly arc: THREE.Mesh;
  private readonly label: THREE.LineSegments;
  private readonly arcMaterial = shaded(ACCENT, 1);
  private timer = 0;
  private text = '';
  private fraction = -1;
  private shownAt = 0;

  constructor() {
    const track = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 16, 96), shaded(0x4a4c55, 0.85));
    this.arc = new THREE.Mesh(new THREE.BufferGeometry(), this.arcMaterial);
    this.arc.scale.setScalar(1.001); // over the track where they meet
    // Last of all, on a cleared depth buffer: over everything, yet in depth with itself.
    track.renderOrder = 1000;
    this.arc.renderOrder = 1001;
    track.onBeforeRender = (renderer) => renderer.clearDepth();
    this.ring.add(track, this.arc);
    this.label = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }),
    );
    this.label.renderOrder = 1002;
    this.object.add(this.ring, this.label);
    this.object.visible = false;
    this.object.frustumCulled = false;
  }

  get shown(): boolean {
    return this.object.visible;
  }

  /** How far round it has turned (radians). */
  get turn(): number {
    return this.ring.rotation.y;
  }

  /** A read begins: the ring comes up if it's still going a moment from now. */
  start(text: string): void {
    this.text = text;
    this.progress(0);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.object.visible = true;
      this.shownAt = performance.now();
    }, DELAY);
  }

  /** How far it has got, 0 to 1. */
  progress(fraction: number): void {
    const f = Math.min(1, Math.max(0, fraction));
    if (Math.floor(f * 100) === Math.floor(this.fraction * 100)) return;
    this.fraction = f;
    this.setArc(f);
    this.setLabel(`${this.text} ${Math.floor(f * 100)}%`);
  }

  /** A last step with no measure of its own (adding what was read to the world). */
  finishing(text: string): void {
    this.text = text;
    this.setArc(1);
    this.setLabel(text);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.object.visible = false;
    this.fraction = -1;
  }

  /** Each frame: in front of the eye, facing it, the ring turning. */
  update(camera: THREE.PerspectiveCamera, now = performance.now()): void {
    if (!this.object.visible) return;
    const forward = camera.getWorldDirection(new THREE.Vector3());
    this.object.position.copy(camera.position).addScaledVector(forward, AWAY);
    this.object.quaternion.copy(camera.quaternion);
    const r = AWAY * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * SIZE;
    this.object.scale.setScalar(r);
    const t = (now - this.shownAt) / 1000;
    // Spun about its upright, and rocked back and forth: it tumbles.
    this.ring.rotation.set(0.55 * Math.sin(t * 1.3), t * 2.2, 0.25 * Math.sin(t * 0.9));
    // Fading in over its first fifth of a second.
    const fade = Math.min(1, t / 0.2);
    this.arcMaterial.uniforms['opacity']!.value = fade;
    (this.label.material as THREE.LineBasicMaterial).opacity = fade;
  }

  /** The bright arc, from the top round clockwise, `f` of the way. */
  private setArc(f: number): void {
    this.arc.geometry.dispose();
    this.arc.geometry =
      f > 0.005
        ? new THREE.TorusGeometry(1, 0.075, 16, Math.max(8, Math.round(96 * f)), Math.PI * 2 * f)
        : new THREE.BufferGeometry();
    // A torus's arc starts on +x and runs anticlockwise: turn it to start at the top, clockwise.
    this.arc.rotation.set(0, Math.PI, Math.PI / 2);
  }

  /** The text under the ring, centred, in lines (its scale is the ring's, radius 1). */
  private setLabel(text: string): void {
    const lines = [text, 'Esc stops it'];
    const scale = 0.016;
    const pos: number[] = [];
    const col: number[] = [];
    lines.forEach((line, i) => {
      // A long name is made smaller, to stay within a few rings' width.
      const wide = textStrokes(line, 1).width;
      const s = Math.min(i === 0 ? scale : scale * 0.8, 7 / wide);
      const { pos: p, width } = textStrokes(line, s);
      const y = -1.55 - i * 0.5;
      // A dark copy behind, down and to the right (as a Shadow label is), then the text.
      for (const [d, c] of [
        [0.035, 0],
        [0, i === 0 ? 0.95 : 0.8],
      ] as const)
        for (let k = 0; k < p.length; k += 3) {
          pos.push(p[k]! - width / 2 + d, p[k + 1]! + y - d, 0);
          col.push(c, c, c);
        }
    });
    this.label.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.label.geometry = g;
  }
}
