import { mat4, type Mat4 } from '@cutplane/kernel';
import type { Editor, Hover, V3 } from './editor.ts';

/**
 * The rotate tool (rotatetool.c, rotateobj.c and the CPL scripts
 * rotatecircle.cpl, rotatexbar.cpl, rotatebauble.cpl): a gadget that always
 * lies in the cutplane. A centre ring, two crossbars through it and a
 * "bauble" at each bar end; a larger circle shows the dial.
 *
 * - R over a vertex, edge or face moves the tool there and lines it up with
 *   the feature, then picks that feature alone; R elsewhere brings the tool
 *   to the crosshair, squared up; R over the tool's centre puts it away.
 *   The centre can also be dragged and dropped on a feature.
 * - Dragging along a bar rolls what is picked about the in-plane axis
 *   perpendicular to the bar, through the centre, 1° per unit of travel; the
 *   crosshair slides along the bar. Off a bar's end the drag becomes a dial.
 * - Dragging a bauble turns the dial: what is picked spins about the plane's
 *   normal through the centre (or about a piercing edge the tool was set on),
 *   with the crosshair riding the circle and the bars turning along.
 * - Set on a face's section line, the bar rolls the face: within 5° of lying
 *   in the plane it snaps exactly into it and the rotation ends (everything
 *   unpicked); within 5° of standing perpendicular it stops there briefly.
 *   The dial stops briefly at horizontal.
 *
 * Rotation always turns whole objects (each picked feature's group root).
 *
 * Deliberate fixes: the in-plane snap's 7.5° input test uses |angle| (the
 * original let any negative angle through); the dial keeps fractional
 * degrees (the original truncated each event to whole degrees, losing slow
 * motion); R over a vertex or an in-plane face brings the tool there (the
 * original left it where it was); the brief stops last a distance or angle
 * rather than a count of mouse events, which browsers send many more of.
 */

/** rotatetool.h, in room units. */
export const ROTATE_RADIUS = 130; // Rotatetoolradius
export const ROTATE_CENTER = 20; // Rotateiconctrsize = 2 · Pkboxsize
export const BAUBLE_SIZE = 10; // Baublesize
export const BAR_PICK = 13; // Dragbaublesize
export const ROTATE_DOCK: readonly [number, number] = [
  510 - ROTATE_RADIUS - ROTATE_RADIUS / 4,
  383 - ROTATE_RADIUS - ROTATE_RADIUS / 4,
]; // Rotatetool_dockx/y = (347.5, 220.5)
/** The face snap's magnet, and the largest single move that can snap (rotateobj.c). */
const SNAP_MAGNET = 5;
const SNAP_MAX_INPUT = 7.5;
/** tolznorm: the face normal must be this close to ±z for the in-plane snap (≈ 5.1°). */
const SNAP_CONE = 0.996;
/** How long the perpendicular stop lasts (units along the bar; the original: 5 events). */
const PERP_PAUSE = 5;
/** How long the dial's horizontal stop lasts (degrees; the original: 3 events). */
const DIAL_PAUSE = 3;
/** compute_snapped_rotangle's maxsnaprange: no horizontal stop for faster turns. */
const DIAL_SNAP_RANGE = 10;
const DEG = Math.PI / 180;

type V2 = [number, number];
export type Bar = 'h' | 'v';
export type ToolPart =
  { kind: 'center' } | { kind: 'bar'; bar: Bar } | { kind: 'bauble'; bar: Bar; end: 1 | -1 };

const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const unit = (a: V2): V2 => {
  const l = Math.hypot(a[0], a[1]);
  return l === 0 ? [1, 0] : [a[0] / l, a[1] / l];
};
const rot2 = (a: V2, deg: number): V2 => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};
/** point_vec_up: a bar direction pointing up (or right when level). */
const up = (a: V2): V2 =>
  a[1] < -1e-12 || (Math.abs(a[1]) <= 1e-12 && a[0] < 0) ? [-a[0], -a[1]] : a;

/** Signed angle (degrees) turning 3D vector n into t about the unit axis a, both taken ⟂ a. */
function angleAbout(n: V3, t: V3, a: V3): number {
  const k = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
  const p: V3 = [n[0] - k * a[0], n[1] - k * a[1], n[2] - k * a[2]];
  const c: V3 = [p[1] * t[2] - p[2] * t[1], p[2] * t[0] - p[0] * t[2], p[0] * t[1] - p[1] * t[0]];
  return Math.atan2(c[0] * a[0] + c[1] * a[1] + c[2] * a[2], p[0] * t[0] + p[1] * t[1] + p[2] * t[2]) / DEG; // prettier-ignore
}

interface Active {
  part: ToolPart;
  /** The rotation so far, as a world transform. */
  total: Mat4;
  /** Brief stop: units (bar) or degrees (dial) left to wait. */
  pause: number;
}

export class RotateTool {
  /** Centre, in the plane. */
  center: V2 = [...ROTATE_DOCK];
  /** The horizontal bar's direction; the vertical bar is a quarter turn from it. */
  hdir: V2 = [1, 0];
  show = { hbar: true, vbar: true, hbaubles: true, vbaubles: true };
  /** A piercing edge's direction: the dial turns about it instead of the plane normal. */
  otherAxis: V3 | undefined;
  /** Set on a face's section line: the face that can snap into the plane. */
  snapFace: Hover | undefined;
  hover: ToolPart | undefined;
  /** The centre is being carried to a new spot. */
  carrying = false;
  /** Bumped on every change worth redrawing. */
  version = 0;
  private active: Active | undefined;
  /** Pressed on the tool; stays true after a face snap ended the rotation, until release. */
  private held = false;
  /** The crosshair's last place on the tool, during a drag. */
  private last: V2 | undefined;

  constructor(private readonly editor: Editor) {}

  get vdir(): V2 {
    return [-this.hdir[1], this.hdir[0]];
  }

  /** The tool has the crosshair: it is pressed, or under the crosshair. */
  get busy(): boolean {
    return this.held || this.hover !== undefined;
  }

  /** The Pick button went down on the tool and hasn't come up. */
  get pressed(): boolean {
    return this.held;
  }

  get rotating(): boolean {
    return this.active !== undefined;
  }

  barDir(bar: Bar): V2 {
    return bar === 'h' ? this.hdir : this.vdir;
  }

  bauble(bar: Bar, end: 1 | -1): V2 {
    const d = this.barDir(bar);
    return [
      this.center[0] + end * ROTATE_RADIUS * d[0],
      this.center[1] + end * ROTATE_RADIUS * d[1],
    ];
  }

  private visible(bar: Bar, what: 'bar' | 'baubles'): boolean {
    return this.show[`${bar}${what === 'bar' ? 'bar' : 'baubles'}` as keyof RotateTool['show']];
  }

  /** What part of the tool the crosshair is over (select.c's Euclidean tests). */
  partAt(x: number, y: number): ToolPart | undefined {
    const c = this.center;
    if (Math.hypot(x - c[0], y - c[1]) <= ROTATE_CENTER) return { kind: 'center' };
    for (const bar of ['h', 'v'] as const) {
      if (!this.visible(bar, 'baubles')) continue;
      for (const end of [1, -1] as const) {
        const p = this.bauble(bar, end);
        if (Math.hypot(x - p[0], y - p[1]) < BAUBLE_SIZE) return { kind: 'bauble', bar, end };
      }
    }
    for (const bar of ['h', 'v'] as const) {
      if (!this.visible(bar, 'bar')) continue;
      const d = this.barDir(bar);
      const rel: V2 = [x - c[0], y - c[1]];
      const t = dot(rel, d);
      if (Math.abs(t) <= ROTATE_RADIUS && Math.abs(cross(d, rel)) <= BAR_PICK)
        return { kind: 'bar', bar };
    }
    return undefined;
  }

  updateHover(cursor: V3): void {
    if (this.held) return;
    const p = this.partAt(cursor[0], cursor[1]);
    if (JSON.stringify(p) !== JSON.stringify(this.hover)) {
      this.hover = p;
      this.version++;
    }
  }

  private reset(): void {
    this.hdir = [1, 0];
    this.show = { hbar: true, vbar: true, hbaubles: true, vbaubles: true };
    this.otherAxis = undefined;
    this.snapFace = undefined;
  }

  /**
   * CPL_setup_rotatetool: lines the bars up with a feature; returns where the
   * centre goes (rotatetool_placept).
   */
  setup(h: Hover | undefined, z: number): V2 | undefined {
    if (!h) return undefined;
    this.reset();
    this.version++;
    const { model, pick } = h;
    const at: V2 = [pick.at[0], pick.at[1]];
    const g = model.world;
    if (pick.kind === 'edge') {
      const [p, q] = model.object.brep.edgeVertices(pick.id);
      const onPlane = (v: number) => Math.abs(g.z(v) - z) < 0.5;
      if (onPlane(p) && onPlane(q)) {
        // orient_rotatetool: the vertical bar along the edge (hidden), the other across it.
        const along = up(unit([g.x(q) - g.x(p), g.y(q) - g.y(p)]));
        this.hdir = [along[1], -along[0]];
        this.show = { hbar: true, vbar: false, hbaubles: true, vbaubles: false };
      } else {
        // setup_other_zaxis: only the dial, about the edge itself.
        const d: V3 = [g.x(q) - g.x(p), g.y(q) - g.y(p), g.z(q) - g.z(p)];
        const l = Math.hypot(...d);
        this.otherAxis = [d[0] / l, d[1] / l, d[2] / l];
        this.show = { hbar: false, vbar: false, hbaubles: false, vbaubles: true };
      }
    } else if (pick.kind === 'face') {
      // A face crossing the plane: line up with its section line, and let it snap.
      const n = g.faceNormal(pick.id);
      const along = up(unit([n[1], -n[0]]));
      this.hdir = [along[1], -along[0]];
      this.show = { hbar: true, vbar: false, hbaubles: true, vbaubles: false };
      this.snapFace = h;
    } else if (pick.kind === 'object') return undefined;
    return at;
  }

  /** The R key (rotatecircle.cpl's _Snapmsg). */
  snap(cursor: V3): void {
    if (this.held) return;
    if (this.partAt(cursor[0], cursor[1])?.kind === 'center') {
      this.center = [...ROTATE_DOCK]; // _Putawayrot
      this.version++;
      return;
    }
    this.editor.updateHover(cursor);
    const at = this.setup(this.editor.hover, cursor[2]);
    if (at) this.center = at;
    else {
      this.reset();
      this.center = [cursor[0], cursor[1]];
    }
    this.editor.pickHover();
    this.version++;
  }

  /** The Pick button went down with the tool under the crosshair. */
  press(cursor: V3): void {
    const part = this.partAt(cursor[0], cursor[1]);
    if (!part) return;
    this.held = true;
    this.hover = part;
    if (part.kind === 'center') {
      this.carrying = true;
      this.center = [cursor[0], cursor[1]];
    } else {
      this.start(part);
      if (part.kind === 'bauble') this.last = this.bauble(part.bar, part.end);
      else {
        const b = this.barDir(part.bar);
        const t = dot([cursor[0] - this.center[0], cursor[1] - this.center[1]], b);
        this.last = [this.center[0] + t * b[0], this.center[1] + t * b[1]];
      }
    }
    this.version++;
  }

  private start(part: ToolPart): void {
    this.active = { part, total: mat4.identity(), pause: 0 };
    if (!this.editor.transforming) this.editor.beginTransform();
  }

  /**
   * The crosshair moved to `cursor` (where the user pushed it). Returns where the
   * crosshair should be: on the bar, on the dial, or unchanged.
   */
  move(cursor: V3): V2 {
    const free: V2 = [cursor[0], cursor[1]];
    if (this.carrying) {
      // _Setuptosel: the bars line up with whatever is under the centre as it travels.
      this.center = free;
      this.editor.updateHover(cursor, ROTATE_CENTER);
      if (this.editor.hover) {
        const c = this.center;
        this.setup(this.editor.hover, cursor[2]);
        this.center = c;
      }
      this.version++;
      return free;
    }
    const a = this.active;
    if (!a) return free;
    const z = cursor[2];
    return a.part.kind === 'bar' ? this.moveBar(a, a.part.bar, free, z) : this.moveDial(a, free, z);
  }

  private here(part: ToolPart): V2 {
    if (part.kind === 'bauble') return this.bauble(part.bar, part.end);
    return this.center;
  }

  private moveBar(a: Active, bar: Bar, free: V2, z: number): V2 {
    const c = this.center;
    const b = up(this.barDir(bar));
    const from = this.last ?? free;
    const s = dot([free[0] - from[0], free[1] - from[1]], b);
    let t = dot([from[0] - c[0], from[1] - c[1]], b) + s;
    if (a.pause > 0) {
      a.pause -= Math.abs(s);
      return (this.last = from);
    }
    let angle = s; // 1° per unit along the bar
    const axis: V3 = [-b[1], b[0], 0]; // ẑ × bar
    let ended = false;
    if (this.snapFace && Math.abs(angle) < SNAP_MAX_INPUT && angle !== 0) {
      const n = this.snapFace.model.world.faceNormal(this.snapFace.pick.id);
      if (Math.abs(n[2]) > SNAP_CONE) {
        // snap_face_to_plane: lay the face exactly in the plane, and stop.
        const phi = angleAbout(n, [0, 0, Math.sign(n[2])], axis);
        if (phi * angle > 0 && (Math.abs(phi) < Math.abs(angle) || Math.abs(phi) < SNAP_MAGNET)) {
          angle = phi;
          ended = true;
        }
      } else {
        // snap_face_to_plane_perp: stand it exactly across the plane, and wait a moment.
        const side = Math.sign(n[0] * b[0] + n[1] * b[1]) || 1;
        const phi = angleAbout(n, [side * b[0], side * b[1], 0], axis);
        if (phi * angle > 0 && (Math.abs(phi) < Math.abs(angle) || Math.abs(phi) < SNAP_MAGNET)) {
          angle = phi;
          a.pause = PERP_PAUSE;
        }
      }
    }
    this.turn(a, [c[0], c[1], z], axis, angle);
    if (ended) {
      this.editor.endTransform();
      this.editor.unpickAll();
      this.active = undefined;
    }
    if (Math.abs(t) >= ROTATE_RADIUS) {
      // Off the end of the bar: carry on as a dial from that bauble.
      t = Math.sign(t) * ROTATE_RADIUS;
      const d = this.barDir(bar);
      const end = (Math.sign(t) * Math.sign(dot(b, d)) || 1) as 1 | -1;
      if (this.active && this.visible(bar, 'baubles')) {
        this.active.part = { kind: 'bauble', bar, end };
        this.hover = this.active.part;
      }
    }
    return (this.last = [c[0] + t * b[0], c[1] + t * b[1]]);
  }

  private moveDial(a: Active, free: V2, z: number): V2 {
    const part = a.part as Extract<ToolPart, { kind: 'bauble' }>;
    const c = this.center;
    const p = this.here(part);
    const n1 = unit([p[0] - c[0], p[1] - c[1]]);
    const d: V2 = [free[0] - p[0], free[1] - p[1]];
    const radial = dot(d, n1);
    const tangential = cross(n1, d);
    if (
      Math.abs(tangential) < Math.abs(radial) &&
      -radial > BAUBLE_SIZE / 2 &&
      this.visible(part.bar, 'bar')
    ) {
      // Pulled in toward the centre: back to sliding along the bar.
      a.part = { kind: 'bar', bar: part.bar };
      this.hover = a.part;
      this.last = p;
      return this.moveBar(a, part.bar, free, z);
    }
    if (Math.hypot(free[0] - c[0], free[1] - c[1]) < 1e-9) return (this.last = p);
    let n2 = unit([free[0] - c[0], free[1] - c[1]]);
    let angle = Math.atan2(cross(n1, n2), dot(n1, n2)) / DEG;
    if (a.pause > 0) {
      a.pause -= Math.abs(angle);
      return (this.last = p);
    }
    // compute_snapped_rotangle: stop at horizontal when the bauble crosses it.
    if (
      Math.abs(angle) <= DIAL_SNAP_RANGE &&
      Math.sign(n1[1]) !== Math.sign(n2[1]) &&
      n1[1] !== 0
    ) {
      const level: V2 = [Math.sign(n1[0] + n2[0]) || 1, 0];
      angle = Math.atan2(cross(n1, level), dot(n1, level)) / DEG;
      n2 = level;
      a.pause = DIAL_PAUSE;
    }
    let axis: V3 = [0, 0, 1];
    if (this.otherAxis) {
      const o = this.otherAxis;
      axis = o[2] < 0 ? [-o[0], -o[1], -o[2]] : o;
    }
    this.turn(a, [c[0], c[1], z], axis, angle);
    // _Rotateowner: the tool turns with the dial.
    this.hdir = rot2(this.hdir, angle);
    this.version++;
    return (this.last = [c[0] + ROTATE_RADIUS * n2[0], c[1] + ROTATE_RADIUS * n2[1]]);
  }

  private turn(a: Active, at: V3, axis: V3, deg: number): void {
    if (deg === 0) return;
    a.total = mat4.multiply(a.total, mat4.rotationAbout(at, axis, deg * DEG));
    this.editor.setTransform(a.total);
  }

  /** The Pick button came up. */
  release(cursor: V3): void {
    if (!this.held) return;
    if (this.carrying) {
      // _Deactiv_circle: dropped on a feature, it settles there and picks it alone.
      this.editor.updateHover(cursor, ROTATE_CENTER);
      const c = this.center;
      const at = this.setup(this.editor.hover, cursor[2]);
      if (this.editor.hover) {
        this.center = at ?? c;
        this.editor.pickHover();
      } else this.center = c;
    }
    if (this.active) this.editor.endTransform();
    this.active = undefined;
    this.carrying = false;
    this.held = false;
    this.last = undefined;
    this.hover = this.partAt(cursor[0], cursor[1]);
    this.version++;
  }

  /** A new world: back to the dock, squared up. */
  putAway(): void {
    this.reset();
    this.center = [...ROTATE_DOCK];
    this.active = undefined;
    this.held = this.carrying = false;
    this.last = undefined;
    this.version++;
  }
}
