import * as THREE from 'three';
import { CLASSIC } from '../viewer/palette.ts';
import { Lines, circle, group } from './lines.ts';

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

  constructor() {
    this.object = group(this.hidden, this.shadow, this.core);
    this.hidden.set(plus(0, 0, -5));
    this.shadow.set(plus(2, -2, 0));
    this.core.set(plus(0, 0, 1));
  }

  /** Crosshair position in room coordinates; it always lies in the plane. */
  place(x: number, y: number, z: number): void {
    this.object.position.set(x, y, z);
  }
}
