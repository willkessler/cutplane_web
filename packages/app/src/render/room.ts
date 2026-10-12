import * as THREE from 'three';
import { ROOM } from '@cutplane/kernel';
import { CLASSIC, rgb } from '../viewer/palette.ts';
import { Lines, closedPolyline, group } from './lines.ts';

const [X0, Y0, Z0] = ROOM.min;
const [X1, Y1, Z1] = ROOM.max;

/**
 * The room's wireframe, as grafx.c's draw_room draws it: black edges, each
 * laid over a slightly wider background-coloured line "to heighten
 * contrast" where they cross geometry. The floor edges are heavier.
 */
export function createRoom(): THREE.Group {
  const front = closedPolyline([X0, Y1, Z1, X1, Y1, Z1, X1, Y0, Z1, X0, Y0, Z1]);
  const back = closedPolyline([X0, Y1, Z0, X1, Y1, Z0, X1, Y0, Z0, X0, Y0, Z0]);
  const top = [X1, Y1, Z1, X1, Y1, Z0, X0, Y1, Z1, X0, Y1, Z0];
  const bottom = [X1, Y0, Z1, X1, Y0, Z0, X0, Y0, Z1, X0, Y0, Z0];
  const halo = (w: number, p: number[]) =>
    new Lines({ color: CLASSIC.background, width: w, renderOrder: -2 }, p);
  const edge = (w: number, p: number[]) =>
    new Lines({ color: CLASSIC.roomEdges, width: w, renderOrder: -1 }, p);
  return group(
    halo(2, front),
    edge(1, front),
    edge(2, back),
    halo(2, top),
    edge(1, top),
    halo(3, bottom),
    edge(2, bottom),
  );
}

export type PlaneStyle = 'classic' | 'modern';

/**
 * The cutplane: the room's cross-section rectangle at z = planeZ.
 *
 * Classic is the SGI's 50% polygon stipple (0xAAAA / 0x5555 rows) as a
 * screen-space checkerboard, so whatever lies behind the plane shows
 * through every other pixel and reads as "behind"; anything in front is
 * untouched. Modern is the same colour alpha-blended. draw_cutplane pushed
 * the fill 2 units back and the border 5 forward so the SGI's z-buffer kept
 * them apart, which in perspective leaves the fill visibly off its border;
 * here both sit exactly in the plane, and draw order (the fill writes no
 * depth, the section lines come after it) keeps the section on top.
 */
export class Cutplane {
  readonly object = new THREE.Group();
  private readonly fill: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly border: Lines;

  constructor() {
    const w = X1 - X0;
    const h = Y1 - Y0;
    const c = new THREE.Color(rgb(CLASSIC.cutplane));
    this.fill = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.ShaderMaterial({
        uniforms: {
          color: { value: new THREE.Vector3(c.r, c.g, c.b) },
          cell: { value: 1 },
          stipple: { value: 1 },
          opacity: { value: 0.5 },
        },
        vertexShader: /* glsl */ `
          void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 color;
          uniform float cell;
          uniform float stipple;
          uniform float opacity;
          void main() {
            if (stipple > 0.5) {
              vec2 p = floor(gl_FragCoord.xy / cell);
              if (mod(p.x + p.y, 2.0) < 0.5) discard;
              gl_FragColor = vec4(color, 1.0);
            } else {
              gl_FragColor = vec4(color, opacity);
            }
          }`,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.fill.position.set((X0 + X1) / 2, (Y0 + Y1) / 2, 0);
    this.fill.renderOrder = 10;
    this.border = new Lines(
      { color: CLASSIC.black, width: 2, renderOrder: 11 },
      closedPolyline([X0, Y0, 0, X1, Y0, 0, X1, Y1, 0, X0, Y1, 0]),
    );
    this.object.add(this.fill, this.border.object);
  }

  set z(z: number) {
    this.object.position.z = z;
  }

  set style(s: PlaneStyle) {
    this.fill.material.uniforms['stipple']!.value = s === 'classic' ? 1 : 0;
  }

  /** One stipple cell per CSS pixel, so HiDPI screens get the SGI's texture rather than a grey wash. */
  set pixelRatio(r: number) {
    this.fill.material.uniforms['cell']!.value = Math.max(1, Math.round(r));
  }
}
