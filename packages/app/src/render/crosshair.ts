import * as THREE from 'three';
import { CLASSIC } from '../viewer/palette.ts';
import { Lines, circle, group } from './lines.ts';

export type Quasimode = 'point' | 'plane' | 'rotate';

/** cursor.c's draw_plus_cursor: four prongs from the ring (radius 10) out to 27. */
const RING = 10;
const PRONG = 27;

function plus(x: number, y: number, z: number): number[] {
  const p = [
    x - PRONG, y, z, x - RING, y, z,
    x + RING, y, z, x + PRONG, y, z,
    x, y - PRONG, z, x, y - RING, z,
    x, y + RING, z, x, y + PRONG, z,
  ]; // prettier-ignore
  return circle(x, y, z, RING, 32, p);
}

/** Small glyphs beside the crosshair naming the active quasimode (the paper's visible-mode principle). */
function glyph(mode: Quasimode): number[] {
  const x = 40;
  const y = 22;
  if (mode === 'plane')
    // ⇕: in and out of the screen, drawn as a double-headed arrow.
    return [
      x, y - 14, 0, x, y + 14, 0,
      x - 5, y + 9, 0, x, y + 14, 0, x, y + 14, 0, x + 5, y + 9, 0,
      x - 5, y - 9, 0, x, y - 14, 0, x, y - 14, 0, x + 5, y - 9, 0,
    ]; // prettier-ignore
  if (mode === 'rotate') {
    // ↻: three quarters of a circle with an arrowhead.
    const out: number[] = [];
    const r = 11;
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (1.5 * Math.PI * i) / n;
      const b = (1.5 * Math.PI * (i + 1)) / n;
      out.push(
        x + r * Math.cos(a),
        y + r * Math.sin(a),
        0,
        x + r * Math.cos(b),
        y + r * Math.sin(b),
        0,
      );
    }
    out.push(x, y - r, 0, x - 6, y - r + 5, 0, x, y - r, 0, x - 6, y - r - 5, 0);
    return out;
  }
  return [];
}

/**
 * The 3Form plus cursor, drawn in the plane in three passes as the original
 * does: white dots through everything (so it is never lost behind an
 * object), a black drop shadow offset (2, -2), and the cyan cursor on top.
 */
export class Crosshair {
  readonly object: THREE.Group;
  private readonly hidden = new Lines({
    color: CLASSIC.white,
    width: 2,
    dashed: true,
    dash: 2,
    depthTest: false,
    renderOrder: 40,
  });
  private readonly shadow = new Lines({ color: CLASSIC.black, width: 2, renderOrder: 41 });
  private readonly core = new Lines({ color: CLASSIC.crosshair, width: 2, renderOrder: 42 });
  private readonly modeShadow = new Lines({
    color: CLASSIC.black,
    width: 3,
    renderOrder: 43,
    depthTest: false,
  });
  private readonly mode = new Lines({
    color: CLASSIC.white,
    width: 2,
    renderOrder: 44,
    depthTest: false,
  });
  private shown: Quasimode = 'point';

  constructor() {
    this.object = group(this.hidden, this.shadow, this.core, this.modeShadow, this.mode);
    this.hidden.set(plus(0, 0, -5));
    this.shadow.set(plus(2, -2, 0));
    this.core.set(plus(0, 0, 1));
    this.setMode('point');
  }

  /** Crosshair position in room coordinates; it always lies in the plane. */
  place(x: number, y: number, z: number): void {
    this.object.position.set(x, y, z);
  }

  setMode(mode: Quasimode): void {
    if (mode === this.shown && this.mode.object.visible === (mode !== 'point')) return;
    this.shown = mode;
    const g = glyph(mode);
    this.mode.set(g);
    this.modeShadow.set(g.map((v, i) => v + (i % 3 === 0 ? 1.5 : i % 3 === 1 ? -1.5 : 0)));
  }
}
