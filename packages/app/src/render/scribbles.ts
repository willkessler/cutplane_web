import * as THREE from 'three';
import { ROOM, preorder } from '@cutplane/kernel';
import { isScribble, type Runtime } from '@cutplane/behaviors';
import { CLASSIC } from '../viewer/palette.ts';
import { Lines } from './lines.ts';

/**
 * A pencil stroke being drawn (grafx.c's draw_scribble_technique): a line through
 * its vertices in the object's colour, 3 wide, and its shadow on the floor.
 */
export class ScribbleView {
  readonly object = new THREE.Group();
  private stroke: Lines | undefined;
  private strokeColor = '';
  private readonly shadow = new Lines({ color: CLASSIC.black, width: 1, renderOrder: 5 });
  /** Segments drawn last time, and the first point (for tests). */
  segments = 0;
  start: number[] = [];

  constructor() {
    this.object.add(this.shadow.object);
  }

  update(rt: Runtime): void {
    const pts: number[] = [];
    const floor: number[] = [];
    let color: readonly number[] = CLASSIC.black;
    for (const o of preorder(rt.primary.root.children)) {
      if (!isScribble(o)) continue;
      color = o.color;
      const g = rt.world(o);
      const vs = o.brep.vertices();
      for (let i = 0; i + 1 < vs.length; i++) {
        const a = vs[i]!;
        const b = vs[i + 1]!;
        pts.push(g.x(a), g.y(a), g.z(a), g.x(b), g.y(b), g.z(b));
        floor.push(g.x(a), ROOM.min[1], g.z(a), g.x(b), ROOM.min[1], g.z(b));
      }
    }
    const key = color.join(',');
    if (key !== this.strokeColor) {
      if (this.stroke) {
        this.object.remove(this.stroke.object);
        this.stroke.object.geometry.dispose();
        this.stroke.material.dispose();
      }
      this.stroke = new Lines({ color, width: 3, renderOrder: 40, depthWrite: true });
      this.object.add(this.stroke.object);
      this.strokeColor = key;
    }
    this.stroke!.set(pts);
    this.segments = pts.length / 6;
    this.start = pts.slice(0, 3);
    this.shadow.set(floor);
  }
}
