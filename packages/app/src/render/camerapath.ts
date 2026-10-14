import * as THREE from 'three';
import { Flyover, type Shot } from '../camera/flyover.ts';
import { Lines } from './lines.ts';

/** The camera body's magenta (toolbox.ts create_nikon). */
const MAGENTA = [255, 0, 255] as const;
/** Half the size of a shot's mark, in room units. */
const MARK = 8;

/**
 * The fly-over's path in the room: a dashed line through the shots, each shot
 * marked with a small cross and a tick the way its lens looks, and, while it
 * plays, a mark that travels along it.
 */
export class CameraPathView {
  readonly object = new THREE.Group();
  private readonly path = new Lines({ color: MAGENTA, width: 2, dashed: true, dash: 8 });
  private readonly marks = new Lines({ color: MAGENTA, width: 2 });
  private readonly flying = new Lines({ color: [255, 255, 255], width: 3, renderOrder: 5 });
  private key = '';

  constructor() {
    this.object.add(this.path.object, this.marks.object, this.flying.object);
  }

  update(shots: readonly Shot[], perShot: number, flying: Shot | null, shown: boolean): void {
    const key = shown ? JSON.stringify([shots, perShot, flying]) : '';
    if (key === this.key) return;
    this.key = key;
    this.object.visible = shown && shots.length > 0;
    if (!this.object.visible) return;
    const pts = new Flyover(shots, perShot).points();
    const segs: number[] = [];
    for (let i = 1; i < pts.length; i++) segs.push(...pts[i - 1]!, ...pts[i]!);
    this.path.set(segs);
    const marks: number[] = [];
    for (const s of shots) mark(s, marks);
    this.marks.set(marks);
    const f: number[] = [];
    if (flying) mark(flying, f, 1.6);
    this.flying.set(f);
  }
}

function mark({ eye: [x, y, z], dir: [dx, dy, dz] }: Shot, out: number[], size = 1): void {
  const m = MARK * size;
  out.push(x - m, y, z, x + m, y, z, x, y - m, z, x, y + m, z, x, y, z - m, x, y, z + m);
  out.push(x, y, z, x + dx * m * 3, y + dy * m * 3, z + dz * m * 3);
}
