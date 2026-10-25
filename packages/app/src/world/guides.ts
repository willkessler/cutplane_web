import { ROOM, type CutObject } from '@cutplane/kernel';
import { P } from '@cutplane/cpl';
import {
  guideLines,
  guideStop,
  isObject,
  isScaleBox,
  type GuideLine,
  type Runtime,
  type V3,
} from '@cutplane/behaviors';
import { Lines } from '../render/lines.ts';

/** How many of the things nearest what is dragged give it guides. */
export const GUIDING = 8;

/**
 * New here: guide lines while something is dragged. Through the middles of the things
 * nearest it in the world run lines along the world's axes (the plane's too) and each
 * thing's own, if it's turned; the dragged thing's middle, coming near one, holds on
 * it, and it's drawn across the room. Near where two cross (one thing's, or two
 * things'), or where one crosses the plane, it holds there. Ctrl (the axis lock)
 * turns them off.
 */
export class DragGuides {
  /** The guides held on now. */
  on: GuideLine[] = [];
  readonly view = new Lines({
    color: [255, 214, 40],
    width: 1.5,
    dashed: true,
    dash: 8,
    depthTest: false,
    renderOrder: 5,
  });
  private shown = '';

  /** (The world comes after the scene is set up, so it's asked for when needed.) */
  constructor(private readonly world: () => Runtime) {}

  private get rt(): Runtime {
    return this.world();
  }

  /**
   * Each frame of a drag of what is picked whole: where the crosshair goes, given where
   * the user has it (`free`) and where it is (`at`): the same, or held on a guide.
   */
  hold(free: V3, at: V3): [number, number] {
    this.on = [];
    const stop = this.stop(free, at);
    if (stop) this.on = stop.on;
    this.draw();
    return stop ? [free[0] + stop.move[0], free[1] + stop.move[1]] : [free[0], free[1]];
  }

  /** No drag: no guides. */
  clear(): void {
    this.on = [];
    this.draw();
  }

  private stop(free: V3, at: V3) {
    // One thing picked whole (an object, or a group's root).
    const picked = this.rt.picked();
    if (picked.length !== 1 || !isObject(picked[0]!)) return null;
    const root = picked[0] as CutObject;
    const box = this.rt.branchBox(root);
    if (!box) return null;
    // Where its middle would be with the crosshair where the user has it.
    const p = mid(box).map((c, k) => c + free[k]! - at[k]!) as V3;
    // The things nearest it in the world being made (not the boxes' goodies, which
    // stand in the room): each a group's root or an object on its own.
    const near: { o: CutObject; at: V3; d: number }[] = [];
    for (const o of this.rt.primary.root.children) {
      if (o === root || isScaleBox(this.rt, o) || !this.rt.vm.props.has(o, P.Visible)) continue;
      const b = this.rt.branchBox(o);
      if (!b) continue;
      const c = mid(b);
      near.push({ o, at: c, d: Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) });
    }
    near.sort((a, b) => a.d - b.d);
    const lines = near.slice(0, GUIDING).flatMap(({ o, at }) => {
      const x = o.xform;
      return guideLines(at, [
        [x[0]!, x[1]!, x[2]!],
        [x[4]!, x[5]!, x[6]!],
        [x[8]!, x[9]!, x[10]!],
      ]);
    });
    return guideStop(p, lines);
  }

  /** Each guide held on, across the room. */
  private draw(): void {
    const key = JSON.stringify(this.on);
    if (key === this.shown) return;
    this.shown = key;
    const out: number[] = [];
    for (const { at, dir } of this.on) {
      // Where the line enters and leaves the room's box.
      let lo = -Infinity;
      let hi = Infinity;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(dir[k]!) < 1e-9) continue;
        const a = (ROOM.min[k]! - at[k]!) / dir[k]!;
        const b = (ROOM.max[k]! - at[k]!) / dir[k]!;
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
      }
      if (!(hi > lo)) continue;
      for (const t of [lo, hi])
        out.push(at[0] + dir[0] * t, at[1] + dir[1] * t, at[2] + dir[2] * t);
    }
    this.view.set(out);
  }
}

const mid = (b: [V3, V3]): V3 => [
  (b[0][0] + b[1][0]) / 2,
  (b[0][1] + b[1][1]) / 2,
  (b[0][2] + b[1][2]) / 2,
];
