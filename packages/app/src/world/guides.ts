import { DEPTH_MERGE, FINE, ROOM, type CutObject } from '@cutplane/kernel';
import { P } from '@cutplane/cpl';
import {
  depthGuide,
  depthStop,
  flatGuides,
  guideLines,
  guideStop,
  isObject,
  isScaleBox,
  levelGuides,
  type GuideLine,
  type Level,
  type Runtime,
  type V3,
} from '@cutplane/behaviors';
import { Lines } from '../render/lines.ts';

/** How many of the things nearest what is dragged give it guides. */
export const GUIDING = 8;

/**
 * New here (to try): which drags hold at levels, the heights of faces lying flat and the
 * places of faces standing square across: none, a face, edge or corner stretched or
 * pulled out (a column pulled up to the walls' tops), or whole things moved too.
 */
export type LevelHold = 'off' | 'stretches' | 'all';

/** How squarely a face must lie along an axis to give a level (about 8°, as the plane's). */
const SQUARE = 0.99;

/**
 * New here: guide lines while something is dragged. Through the middles of the things
 * nearest it in the world run lines along the world's axes (the plane's too) and each
 * thing's own, if it's turned, carried into the dragged thing's plane (flatGuides: as
 * seen from in front, whatever the depths); its middle, coming near one, holds on
 * it, and it's drawn across the room, with a tick from the thing's middle to it. Near where two cross (one thing's, or two
 * things'), or where one crosses the plane, it holds there. With Ctrl (the axis lock)
 * only those square across the axis it locks to hold.
 */
export class DragGuides {
  /** The guides held on now. */
  on: GuideLine[] = [];
  /** The depth guide held on now (new: carried in depth, lining up with another). */
  deep: GuideLine | null = null;
  readonly view = new Lines({
    color: [255, 214, 40],
    width: 1.5,
    dashed: true,
    dash: 8,
    depthTest: false,
    renderOrder: 5,
  });
  private shown = '';
  levelHold: LevelHold = 'all';
  /** The levels for this drag, gathered once it is moving something. */
  private levels: Level[] | null = null;

  /** (The world comes after the scene is set up, so it's asked for when needed.) */
  constructor(private readonly world: () => Runtime) {}

  private get rt(): Runtime {
    return this.world();
  }

  /**
   * Each frame of a drag of what is picked: where the crosshair goes, given where
   * the user has it (`free`) and where it is (`at`): the same, or held on a guide.
   */
  hold(free: V3, at: V3, along?: 0 | 1): [number, number] {
    this.on = [];
    const stop = this.stop(free, at, along);
    if (stop) this.on = stop.on;
    this.draw();
    return stop ? [free[0] + stop.move[0], free[1] + stop.move[1]] : [free[0], free[1]];
  }

  /**
   * Each frame of a drag of what is picked: the depth the plane goes to (what is picked
   * going with it), given where the user has it (`free`) and where it is (`at`): the
   * same, or held where the dragged thing's back, middle or front meets another's.
   */
  holdDepth(free: number, at: V3): number {
    this.deep = null;
    const picked = this.rt.picked();
    const whole = picked.length === 1 && isObject(picked[0]!) ? (picked[0] as CutObject) : null;
    const box = whole ? this.rt.branchBox(whole) : this.rt.draggedBox();
    if (box) {
      const dz = free - at[2];
      const own: [number, number, number] = [box[0][2] + dz, (box[0][2] + box[1][2]) / 2 + dz, box[1][2] + dz]; // prettier-ignore
      const p = mid(box);
      const except = whole ? branch(whole) : new Set(this.rt.dragging());
      const marks = this.nearest(except, p).map(({ b, at: c }) => ({
        depths: [b[0][2], c[2], b[1][2]] as const,
        at: c,
      }));
      const stop = depthStop(own, marks);
      if (stop) {
        this.deep = depthGuide(stop.mark.at, p, stop.z);
        this.draw();
        return free + stop.dz;
      }
    }
    this.draw();
    return free;
  }

  /** No drag across: no guides across. */
  clear(): void {
    this.on = [];
    this.draw();
  }

  /** Nothing carried in depth: no depth guide. */
  clearDepth(): void {
    this.deep = null;
    this.draw();
  }

  /** A drag is over: the next gathers its own levels. */
  done(): void {
    this.levels = null;
  }

  /** `along`: Ctrl's axis lock; then only lines square across it hold, so it stays on it. */
  private stop(free: V3, at: V3, along?: 0 | 1) {
    // One thing picked whole (an object, or a group's root), or features dragged.
    const picked = this.rt.picked();
    const whole = picked.length === 1 && isObject(picked[0]!) ? (picked[0] as CutObject) : null;
    const box = whole ? this.rt.branchBox(whole) : this.rt.draggedBox();
    if (!box) return null;
    // Where its middle would be with the crosshair where the user has it.
    const p = mid(box).map((c, k) => c + free[k]! - at[k]!) as V3;
    const lines = whole ? this.middles(whole, p) : [];
    if (this.levelHold === 'all' || (!whole && this.levelHold === 'stretches')) {
      this.levels ??= this.gather(whole ? branch(whole) : new Set(this.rt.dragging()), mid(box));
      const half: [number, number] = [(box[1][0] - box[0][0]) / 2, (box[1][1] - box[0][1]) / 2];
      lines.push(...levelGuides(this.levels, p, half));
    }
    const across = along === undefined ? lines : lines.filter((l) => Math.abs(l.dir[along]) < 1e-6 && Math.abs(l.dir[2]) < 1e-6); // prettier-ignore
    return guideStop(p, across);
  }

  /**
   * The things nearest `p` in the world being made but those in `except` (not the boxes'
   * goodies, which stand in the room): each a group's root or an object on its own.
   */
  private nearest(except: Set<CutObject>, p: V3) {
    const near: { o: CutObject; b: [V3, V3]; at: V3; d: number }[] = [];
    for (const o of this.rt.primary.root.children) {
      if (except.has(o) || isScaleBox(this.rt, o) || !this.rt.vm.props.has(o, P.Visible)) continue;
      const b = this.rt.branchBox(o);
      if (!b) continue;
      const c = mid(b);
      near.push({ o, b, at: c, d: Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) });
    }
    return near.sort((a, b) => a.d - b.d).slice(0, GUIDING);
  }

  /** The lines through the middles of the things nearest `root`, its middle about to be at `p`. */
  private middles(root: CutObject, p: V3): GuideLine[] {
    const lines = this.nearest(new Set([root]), p).flatMap(({ o, at }) => {
      const x = o.xform;
      return guideLines(at, [
        [x[0]!, x[1]!, x[2]!],
        [x[4]!, x[5]!, x[6]!],
        [x[8]!, x[9]!, x[10]!],
      ]);
    });
    return flatGuides(lines, p[2]);
  }

  /**
   * The levels of the faces of everything in the world being made but `except` (what is
   * dragged): one for each height or place across, given by the face nearest `near`.
   */
  private gather(except: Set<CutObject>, near: V3): Level[] {
    const kept = new Map<string, Level & { d: number }>();
    const walk = (o: CutObject) => {
      if (isScaleBox(this.rt, o)) return;
      o.children.forEach(walk);
      if (except.has(o) || !this.rt.vm.props.has(o, P.Visible)) return;
      const b = o.brep;
      if (b.numVertices > FINE) return;
      const g = this.rt.world(o);
      for (const f of b.faces()) {
        const n = g.faceNormal(f);
        const axis = Math.abs(n[1]) >= SQUARE ? 1 : Math.abs(n[0]) >= SQUARE ? 0 : null;
        if (axis === null) continue;
        const vs = b.loopHalfEdges(b.faceLoop(f)).map((h) => b.heVertex(h));
        const from: V3 = [0, 0, 0];
        for (const v of vs) {
          from[0] += g.x(v) / vs.length;
          from[1] += g.y(v) / vs.length;
          from[2] += g.z(v) / vs.length;
        }
        const at = from[axis];
        const key = `${axis}:${Math.round(at / DEPTH_MERGE)}`;
        const d = Math.hypot(from[0] - near[0], from[1] - near[1], from[2] - near[2]);
        const had = kept.get(key);
        if (!had || d < had.d) kept.set(key, { axis, at, from, d });
      }
    };
    this.rt.primary.root.children.forEach(walk);
    return [...kept.values()].map(({ axis, at, from }) => ({ axis, at, from }));
  }

  /** Each guide held on, across the room. */
  private draw(): void {
    const all = this.deep ? [...this.on, this.deep] : this.on;
    const key = JSON.stringify(all);
    if (key === this.shown) return;
    this.shown = key;
    const out: number[] = [];
    for (const { at: through, dir, show } of all) {
      const at = show ?? through;
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
    // From each thing's middle at another depth, straight to the plane: which it is.
    const ticks = new Set<V3>();
    for (const { at: through, from, show } of all) {
      const at = show ?? through;
      if (from && Math.abs(from[2] - at[2]) > 1 && !ticks.has(from)) {
        ticks.add(from);
        out.push(...from, from[0], from[1], at[2]);
      }
    }
    this.view.set(out);
  }
}

/** An object and all under it. */
function branch(root: CutObject): Set<CutObject> {
  const out = new Set<CutObject>();
  const walk = (o: CutObject) => {
    out.add(o);
    o.children.forEach(walk);
  };
  walk(root);
  return out;
}

const mid = (b: [V3, V3]): V3 => [
  (b[0][0] + b[1][0]) / 2,
  (b[0][1] + b[1][1]) / 2,
  (b[0][2] + b[1][2]) / 2,
];
