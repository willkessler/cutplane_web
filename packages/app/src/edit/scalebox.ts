import { mat4, subtree, type CutObject, type Mat4 } from '@cutplane/kernel';
import type { Model } from '../render/models.ts';
import type { Editor, V3 } from './editor.ts';

/**
 * Scale boxes (rom.cpl's _Create_scaler, scalebbox.cpl, cplib.c's
 * CPL_setup_scalebbox and CPL_scalebbox_trans, scale.c).
 *
 * Every picked whole object gets a box: its bounding box grown by 20 on every
 * side. The box isn't drawn, only its handles: one at each corner (when the
 * plane is near it) and one wherever a box edge pierces the plane.
 *
 * - A corner scales the object about the opposite corner, each axis on its
 *   own, the corner following the crosshair (moving the plane while holding
 *   it scales in depth). With Ctrl, the scale is uniform about the centre.
 * - An edge handle scales the two axes across the edge, about the opposite
 *   edge. Moving the plane while holding it slides it along the edge, and
 *   once it reaches a corner, that corner takes over.
 *
 * The box belongs to its object (the original made it the object's parent),
 * so it turns and scales with it.
 *
 * Deliberate fix: the original had no minimum, so dragging past the opposite
 * side turned a solid inside out; here no side gets shorter than 1 unit.
 */

/** BBoxoutdent = 2 · Pkboxsize. */
export const BOX_OUTDENT = 20;
/** Handle pick box half-width (Pkboxsize). */
export const HANDLE_SIZE = 10;
/** A corner shows when the plane is this near it. */
export const CORNER_SHOW = 5;
/** Smallest side a scale can leave. */
const MIN_SIDE = 1;

export interface ScaleBox {
  root: CutObject;
  /** Box corners in the box's own frame. */
  lo: V3;
  hi: V3;
  /** The root's xform when the box was made: the box follows the root from there. */
  rootXform: Mat4;
}

export type Handle =
  | { kind: 'corner'; box: ScaleBox; corner: number }
  | { kind: 'edge'; box: ScaleBox; corner: number; axis: 0 | 1 | 2; at: V3 };

interface Drag {
  handle: Handle;
  /** Box frame (local → world) at the start of this stretch of the drag. */
  frame: Mat4;
  inv: Mat4;
  /** The scale applied before this stretch (an edge handle that became a corner). */
  before: Mat4;
  /** Crosshair at the start of this stretch. */
  from: V3;
  /** The handle's place in the box frame at the start. */
  start: V3;
}

/** Corner i of a box: bit k set means the high side on axis k. */
const cornerOf = (b: ScaleBox, i: number): V3 => [0, 1, 2].map((k) => (i & (1 << k) ? b.hi[k]! : b.lo[k]!)) as V3; // prettier-ignore

/** The box's frame now: box coordinates → world. */
export function frameOf(b: ScaleBox): Mat4 {
  const inv = mat4.invert(b.rootXform) ?? mat4.identity();
  return mat4.multiply(inv, b.root.xform);
}

const apply = (m: Mat4, p: readonly number[]): V3 => mat4.transformPoint(m, p[0]!, p[1]!, p[2]!);
/** A direction (no translation) through m. */
const along = (m: Mat4, d: readonly number[]): V3 => {
  const a = apply(m, d);
  const o = apply(m, [0, 0, 0]);
  return [a[0] - o[0], a[1] - o[1], a[2] - o[2]];
};

export class ScaleBoxes {
  boxes: ScaleBox[] = [];
  hover: Handle | undefined;
  /** Bumped on every change worth redrawing. */
  version = 0;
  private drag: Drag | undefined;

  constructor(
    private readonly editor: Editor,
    private readonly models: () => readonly Model[],
  ) {}

  get pressed(): boolean {
    return this.drag !== undefined;
  }

  get dragged(): Handle | undefined {
    return this.drag?.handle;
  }

  /** Keeps one box per picked whole object (made on pick, gone on unpick). */
  sync(): void {
    const want = new Set<CutObject>();
    for (const p of this.editor.picked)
      if (p.kind === 'object' && !p.object.attrs.props.includes('Lockedgeometry'))
        want.add(p.object);
    const had = new Map(this.boxes.map((b) => [b.root, b]));
    const next = [...want].map((root) => had.get(root) ?? this.make(root));
    if (next.length !== this.boxes.length || next.some((b, i) => b !== this.boxes[i])) {
      this.boxes = next;
      if (this.hover && !next.includes(this.hover.box)) this.hover = undefined;
      this.version++;
    }
  }

  private make(root: CutObject): ScaleBox {
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    const inTree = new Set(subtree(root));
    for (const m of this.models()) {
      if (!inTree.has(m.object)) continue;
      const g = m.world;
      for (const v of m.object.brep.vertices()) {
        const p = [g.x(v), g.y(v), g.z(v)];
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, p[k]!);
          hi[k] = Math.max(hi[k]!, p[k]!);
        }
      }
    }
    if (!Number.isFinite(lo[0])) {
      lo.fill(0);
      hi.fill(0);
    }
    for (let k = 0; k < 3; k++) {
      lo[k] = lo[k]! - BOX_OUTDENT;
      hi[k] = hi[k]! + BOX_OUTDENT;
    }
    return { root, lo, hi, rootXform: root.xform.slice() };
  }

  /** World positions of a box's corners. */
  corners(b: ScaleBox): V3[] {
    const f = frameOf(b);
    return Array.from({ length: 8 }, (_, i) => apply(f, cornerOf(b, i)));
  }

  /** Where the box's edges pierce the plane at depth z. */
  piercings(b: ScaleBox, z: number): Extract<Handle, { kind: 'edge' }>[] {
    const c = this.corners(b);
    const out: Extract<Handle, { kind: 'edge' }>[] = [];
    for (let i = 0; i < 8; i++)
      for (const axis of [0, 1, 2] as const) {
        if (i & (1 << axis)) continue;
        const j = i | (1 << axis);
        const p = c[i]!;
        const q = c[j]!;
        if ((p[2] - z) * (q[2] - z) >= 0 || p[2] === q[2]) continue;
        const t = (z - p[2]) / (q[2] - p[2]);
        out.push({
          kind: 'edge',
          box: b,
          corner: i,
          axis,
          at: [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), z],
        });
      }
    return out;
  }

  /** The handle under the crosshair (select.c's set_scalebbox_selectable): corners, then edges. */
  handleAt(cursor: V3): Handle | undefined {
    const near = (p: V3, dz: number) =>
      Math.abs(p[0] - cursor[0]) <= HANDLE_SIZE &&
      Math.abs(p[1] - cursor[1]) <= HANDLE_SIZE &&
      Math.abs(p[2] - cursor[2]) <= dz;
    for (const b of this.boxes) {
      const c = this.corners(b);
      for (let i = 0; i < 8; i++)
        if (near(c[i]!, HANDLE_SIZE)) return { kind: 'corner', box: b, corner: i };
    }
    for (const b of this.boxes)
      for (const h of this.piercings(b, cursor[2])) if (near(h.at, 0)) return h;
    return undefined;
  }

  updateHover(cursor: V3): void {
    if (this.drag) return;
    const h = this.handleAt(cursor);
    const key = (x: Handle | undefined) =>
      x
        ? `${this.boxes.indexOf(x.box)}|${x.kind}|${x.corner}|${x.kind === 'edge' ? x.axis : ''}`
        : '';
    if (key(h) !== key(this.hover)) this.version++;
    this.hover = h;
  }

  press(cursor: V3): void {
    const h = this.handleAt(cursor);
    if (!h) return;
    this.hover = h;
    this.editor.beginTransform([h.box.root]);
    this.begin(h, cursor, mat4.identity());
    this.version++;
  }

  private begin(handle: Handle, from: V3, before: Mat4): void {
    const b = handle.box;
    const frame = frameOf(b);
    const inv = mat4.invert(frame) ?? mat4.identity();
    const start = handle.kind === 'corner' ? cornerOf(b, handle.corner) : apply(inv, handle.at);
    this.drag = { handle, frame, inv, before, from: [...from], start };
  }

  move(cursor: V3, ctrl: boolean): void {
    const d = this.drag;
    if (!d) return;
    const b = d.handle.box;
    const delta = along(d.inv, [
      cursor[0] - d.from[0],
      cursor[1] - d.from[1],
      cursor[2] - d.from[2],
    ]);
    const q: V3 = [d.start[0] + delta[0], d.start[1] + delta[1], d.start[2] + delta[2]];
    const center: V3 = [0, 1, 2].map((k) => (b.lo[k]! + b.hi[k]!) / 2) as V3;
    if (d.handle.kind === 'edge') {
      const axis = d.handle.axis;
      // Moved along the edge as far as one of its ends: that corner takes over.
      const end =
        q[axis]! >= b.hi[axis]! - HANDLE_SIZE ? 1 : q[axis]! <= b.lo[axis]! + HANDLE_SIZE ? 0 : -1;
      if (end >= 0 && cursor[2] !== d.from[2]) {
        const corner = end ? d.handle.corner | (1 << axis) : d.handle.corner & ~(1 << axis);
        const now = this.current(d, ctrl, q, center);
        this.editor.setTransform(now);
        this.begin({ kind: 'corner', box: b, corner }, cursor, now);
        this.version++;
        return;
      }
    }
    this.editor.setTransform(this.current(d, ctrl, q, center));
    this.version++;
  }

  /** The whole transform so far: what came before, then this stretch's scale in the box frame. */
  private current(d: Drag, ctrl: boolean, q: V3, center: V3): Mat4 {
    const { origin, f } = this.factors(d, ctrl, q, center);
    const scale = mat4.multiply(mat4.multiply(d.inv, mat4.scaleAbout(origin, f)), d.frame);
    return mat4.multiply(d.before, scale);
  }

  private factors(d: Drag, ctrl: boolean, q: V3, center: V3): { origin: V3; f: V3 } {
    const b = d.handle.box;
    const h = d.handle;
    const k0 = d.start;
    if (ctrl) {
      // Uniform about the centre: the push along the centre-to-handle diagonal.
      const diag = [0, 1, 2].map((k) => k0[k]! - center[k]!);
      const len2 = diag.reduce((s, x) => s + x * x, 0);
      let s = len2 === 0 ? 1 : diag.reduce((acc, x, k) => acc + (q[k]! - center[k]!) * x, 0) / len2;
      const side = Math.min(...[0, 1, 2].map((k) => b.hi[k]! - b.lo[k]!));
      s = Math.max(s, MIN_SIDE / side);
      return { origin: center, f: [s, s, s] };
    }
    const origin: V3 = [0, 1, 2].map((k) => (k0[k]! > center[k]! ? b.lo[k]! : b.hi[k]!)) as V3;
    const f = [0, 1, 2].map((k) => {
      if (h.kind === 'edge' && k === h.axis) return 1;
      const was = k0[k]! - origin[k]!;
      if (was === 0) return 1;
      const r = (q[k]! - origin[k]!) / was;
      return Math.max(r, MIN_SIDE / Math.abs(was));
    }) as V3;
    if (h.kind === 'edge') origin[h.axis] = k0[h.axis]!;
    return { origin, f };
  }

  release(): void {
    if (!this.drag) return;
    this.drag = undefined;
    this.editor.endTransform();
    this.version++;
  }

  reset(): void {
    this.boxes = [];
    this.hover = undefined;
    this.drag = undefined;
    this.version++;
  }
}
