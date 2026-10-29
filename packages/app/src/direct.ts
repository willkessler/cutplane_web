import { BOOL_OP } from '@cutplane/cpl';
import {
  Brep,
  ROOM,
  createCube,
  createDonut,
  createObject,
  createOvalCone,
  createOvalCylinder,
  createPyramid,
  createSphere,
  mat4,
  subtree,
  type CutObject,
} from '@cutplane/kernel';
import {
  booleanObjects,
  isObject,
  isSub,
  sliceObject,
  type Controls,
  type Runtime,
  type V3,
} from '@cutplane/behaviors';
import { clearance, crossings, worldVolume } from './probe.ts';

/**
 * New: an agent's direct calls (?mcp). Where the hand (mcp.ts) works the app as a person
 * does, a step at a time, these do in one call what a gesture would: a primitive put in
 * at a size, things moved, turned or scaled by numbers, copied in a row, painted, cut,
 * sliced, grouped. Each is one step of the undo history, and the room shows it happen
 * (a move, turn or scale glides over `ms`). They use the app's own operations: the
 * kernel's primitives, the booleans and slicing the drill and saw use, G and A by picking
 * what they act on as a marquee would.
 *
 * Things are named by number (`id`): each object in the world is numbered the first time
 * the agent sees it, in the world's order, a group before its parts, and keeps its number
 * while the world is open (a picked object moves into its scale box, so its place in the
 * world's list is no guide). Opening a world starts the numbers again.
 */

export interface DirectHost {
  rt: Runtime;
  controls: Controls;
  /** The world's objects at the top, looking through scale boxes. */
  tops(): CutObject[];
  /** The world caught up (CPL's messages read). */
  settle(): void;
  /** The next frame drawn. */
  frame(): Promise<void>;
}

type Args = Record<string, unknown>;
type Ref = number | string;

const SIDES: Record<string, V3> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};
/** How finely a curved primitive is made unless asked (the primitives box's 72). */
const SEGMENTS = 72;

const r1 = (v: number) => Math.round(v * 10) / 10;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
function vec(v: unknown, what: string): V3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((c) => num(c) !== undefined))
    throw new Error(`${what}: three numbers, [x, y, z]`);
  return v as V3;
}
/** An axis: "x", "-y"…, or a direction [x, y, z]; made a unit long. */
function axisOf(v: unknown): V3 {
  const a = typeof v === 'string' ? SIDES[v.length === 1 ? `+${v}` : v] : vec(v, 'axis');
  if (!a) throw new Error(`axis: "x", "y", "z" (or "-x"…), or [x, y, z]`);
  const l = Math.hypot(...a);
  if (l === 0) throw new Error('axis: not [0, 0, 0]');
  return a.map((c) => c / l) as V3;
}

/** Whether a ray from o along unit d meets the box [lo, hi] before max. */
function rayMeetsBox(o: V3, d: V3, lo: V3, hi: V3, max: number): boolean {
  let t0 = 0;
  let t1 = max;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]!) < 1e-12) {
      if (o[k]! < lo[k]! - 1e-3 || o[k]! > hi[k]! + 1e-3) return false;
      continue;
    }
    let p = (lo[k]! - o[k]!) / d[k]!;
    let q = (hi[k]! - o[k]!) / d[k]!;
    if (p > q) [p, q] = [q, p];
    t0 = Math.max(t0, p - 1e-3);
    t1 = Math.min(t1, q + 1e-3);
    if (t0 > t1) return false;
  }
  return true;
}

export class Direct {
  private ids = new WeakMap<CutObject, number>();
  private next = 1;

  constructor(private readonly h: DirectHost) {}

  /** A new world: numbers start again. */
  forget(): void {
    this.ids = new WeakMap();
    this.next = 1;
  }

  private get rt(): Runtime {
    return this.h.rt;
  }

  private idOf(o: CutObject): number {
    let i = this.ids.get(o);
    if (i === undefined) this.ids.set(o, (i = this.next++));
    return i;
  }

  /** Every object in the world, numbered in order (a group, then its parts). */
  private everything(): CutObject[] {
    const out: CutObject[] = [];
    for (const t of this.h.tops())
      for (const o of subtree(t))
        if (isObject(o)) {
          this.idOf(o);
          out.push(o);
        }
    return out;
  }

  /** What `o` is part of, whole: a group's root, or the object itself. */
  private thingOf(o: CutObject): CutObject {
    let r = o;
    while (r.parent && !(r.linked ?? false) && !this.rt.hasProp(r.parent, 'Scalebbox'))
      r = r.parent;
    return r;
  }

  /** The things asked for: ids, names, or "picked". */
  private resolve(refs: unknown, what = 'objects'): CutObject[] {
    const all = this.everything();
    if (refs === 'picked') {
      const out = new Set<CutObject>();
      for (const f of this.rt.picked()) {
        const o = isObject(f) ? f : isSub(f) ? f.object : null;
        if (o && all.includes(o)) out.add(this.thingOf(o));
      }
      if (out.size === 0) throw new Error(`${what}: nothing is picked`);
      return [...out];
    }
    const list = (Array.isArray(refs) ? refs : [refs]) as Ref[];
    if (list.length === 0) throw new Error(`${what}: name at least one`);
    const out = list.map((ref) => {
      const o =
        typeof ref === 'number'
          ? all.find((x) => this.ids.get(x) === ref)
          : typeof ref === 'string'
            ? all.find((x) => x.name === ref)
            : undefined;
      if (!o) throw new Error(`${what}: no object ${JSON.stringify(ref)} (list_objects gives ids)`); // prettier-ignore
      return o;
    });
    // A part and its group both named: the group takes it along.
    return [...new Set(out)].filter(
      (o) => !out.some((p) => p !== o && [...subtree(p)].includes(o)),
    );
  }

  private one(ref: unknown, what: string): CutObject {
    if (Array.isArray(ref)) throw new Error(`${what}: one object`);
    return this.resolve(ref, what)[0]!;
  }

  /** Nothing picked (scale boxes gone), so the world's objects are plain to act on. */
  private unpickAll(): void {
    if (this.rt.picked().length === 0) return;
    this.h.controls.pickOnly([]);
    this.h.settle();
  }

  private box(os: readonly CutObject[]): [V3, V3] {
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const o of os) {
      const b = this.rt.branchBox(o);
      if (!b) continue;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, b[0][k]!);
        hi[k] = Math.max(hi[k]!, b[1][k]!);
      }
    }
    if (!Number.isFinite(lo[0])) throw new Error('nothing there to measure');
    return [lo, hi];
  }

  private middle(os: readonly CutObject[]): V3 {
    const [lo, hi] = this.box(os);
    return lo.map((l, k) => (l + hi[k]!) / 2) as V3;
  }

  /** What the agent is told of an object: its id, name, colour, box, middle and size. */
  info(o: CutObject): Args {
    const b = this.rt.branchBox(o);
    const parts = o.children.filter(isObject);
    return {
      id: this.idOf(o),
      ...(o.name ? { name: o.name } : {}),
      color: [...o.color],
      ...(b
        ? {
            box: b.map((p) => p.map(r1)),
            center: b[0].map((l, k) => r1((l + b[1][k]!) / 2)),
            size: b[0].map((l, k) => r1(b[1][k]! - l)),
          }
        : {}),
      ...(parts.length ? { parts: parts.map((p) => this.idOf(p)) } : {}),
    };
  }

  /**
   * A change spread over `ms` (eased, as a hand glides), as one step of the undo
   * history: `apply(a, b)` does the share of it from a to b (0..1).
   */
  private async over(ms: number, apply: (a: number, b: number) => void): Promise<void> {
    const rt = this.rt;
    if (ms <= 0) apply(0, 1);
    else {
      rt.journal.hold = true;
      try {
        const t0 = performance.now();
        for (let done = 0; done < 1;) {
          await this.h.frame();
          const e = ease(Math.min(1, (performance.now() - t0) / ms));
          apply(done, e);
          done = e;
        }
      } finally {
        rt.journal.hold = false;
      }
    }
    rt.commit();
    this.h.settle();
  }

  // ---- the calls ----

  list(): Args {
    const tops = this.h.tops().filter(isObject);
    this.everything();
    const parts = (o: CutObject): Args[] =>
      o.children.filter(isObject).map((c) => ({ ...this.info(c), ...(c.children.length ? { parts: parts(c) } : {}) })); // prettier-ignore
    return {
      objects: tops.map((o) => ({ ...this.info(o), ...(o.children.length ? { parts: parts(o) } : {}) })), // prettier-ignore
    };
  }

  /** A primitive made to a size, where asked (as one stamped from the box and scaled). */
  add(a: Args): Args {
    const kind = String(a['kind'] ?? 'box');
    const size = vec(a['size'] ?? [100, 100, 100], 'size');
    if (size.some((s) => s <= 0)) throw new Error('size: each more than 0');
    // By default at the crosshair, kept in the room (the plane starts at its front wall).
    const center =
      a['center'] === undefined
        ? (this.rt.cursor().map((c, k) => {
            const lo = ROOM.min[k]! + size[k]! / 2;
            const hi = ROOM.max[k]! - size[k]! / 2;
            return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, c));
          }) as V3)
        : vec(a['center'], 'center');
    const seg = Math.max(3, Math.min(144, Math.round(num(a['segments']) ?? SEGMENTS)));
    // Each made about its own axis (the one it points along), then turned to the one asked.
    const made: Record<string, () => [Brep, V3]> = {
      box: () => [createCube(1, 1, 1), [0, 0, 1]],
      cylinder: () => [createOvalCylinder(1, 1, 1, seg), [0, 0, 1]],
      cone: () => [createOvalCone(1, 1, 1, seg), [0, 0, 1]],
      sphere: () => [createSphere(1, seg), [1, 0, 0]],
      pyramid: () => [createPyramid(1, 1, 1), [0, 1, 0]],
      torus: () => [createDonut(1, seg), [0, 1, 0]],
    };
    const make = made[kind];
    if (!make) throw new Error(`kind: one of ${Object.keys(made).join(', ')}`);
    const [b, own] = make();
    const want = a['axis'] === undefined ? own : axisOf(a['axis']);
    const dot = own[0] * want[0] + own[1] * want[1] + own[2] * want[2];
    const across: V3 = [
      own[1] * want[2] - own[2] * want[1],
      own[2] * want[0] - own[0] * want[2],
      own[0] * want[1] - own[1] * want[0],
    ];
    const turn =
      dot > 1 - 1e-9
        ? mat4.identity()
        : dot < -1 + 1e-9
          ? mat4.rotationAbout([0, 0, 0], own[0] ? [0, 1, 0] : [1, 0, 0], Math.PI)
          : mat4.rotationAbout([0, 0, 0], across.map((c) => c / Math.hypot(...across)) as V3, Math.acos(dot)); // prettier-ignore
    const pts = new Map(
      b.vertices().map((v) => {
        const p = b.vertexPos(v);
        return [v, mat4.transformPoint(turn, p[0], p[1], p[2])] as const;
      }),
    );
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const p of pts.values())
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, p[k]!);
        hi[k] = Math.max(hi[k]!, p[k]!);
      }
    // Fitted to the box asked: `size` across x, y and z of the room, about `center`.
    for (const [v, p] of pts) {
      const q = [0, 1, 2].map((k) => center[k]! + ((p[k]! - lo[k]!) / (hi[k]! - lo[k]!) - 0.5) * size[k]!); // prettier-ignore
      b.setVertexPos(v, q[0]!, q[1]!, q[2]!);
    }
    const o = createObject(b, {
      name: typeof a['name'] === 'string' ? a['name'] : null,
      color: a['color'] === undefined ? [200, 200, 200] : vec(a['color'], 'color'),
      attrs: { props: ['Visible'] }, // (drawn, as an import's objects are)
    });
    this.everything(); // (what is there numbered first)
    this.unpickAll();
    this.rt.addObjects([o]);
    this.h.settle();
    return this.info(o);
  }

  async move(a: Args): Promise<Args> {
    const os = this.resolve(a['objects']);
    let d: V3;
    if (a['to'] !== undefined) {
      const to = vec(a['to'], 'to');
      const m = this.middle(os);
      d = to.map((c, k) => c - m[k]!) as V3;
    } else d = vec(a['by'], 'by (or to)');
    this.unpickAll();
    await this.over(num(a['ms']) ?? 0, (x, y) => {
      for (const o of os) this.rt.moveBranch(o, d.map((c) => c * (y - x)) as V3);
    });
    return { objects: os.map((o) => this.info(o)) };
  }

  async rotate(a: Args): Promise<Args> {
    const os = this.resolve(a['objects']);
    const axis = axisOf(a['axis']);
    const deg = num(a['degrees']);
    if (deg === undefined) throw new Error('degrees: a number');
    const at = a['point'] === undefined ? this.middle(os) : vec(a['point'], 'point');
    this.unpickAll();
    await this.over(num(a['ms']) ?? 0, (x, y) => {
      const m = mat4.rotationAbout(at, axis, ((deg * (y - x)) / 180) * Math.PI);
      for (const o of os) this.rt.transformBranch(o, m);
    });
    return { objects: os.map((o) => this.info(o)) };
  }

  async scale(a: Args): Promise<Args> {
    const os = this.resolve(a['objects']);
    const [lo, hi] = this.box(os);
    let f: V3;
    if (a['size'] !== undefined) {
      // To a size: [w, h, d], null where it stays.
      const s = a['size'];
      if (!Array.isArray(s) || s.length !== 3) throw new Error('size: [w, h, d], null for one that stays'); // prettier-ignore
      f = [0, 1, 2].map((k) => {
        const want = num(s[k]);
        const has = hi[k]! - lo[k]!;
        return want === undefined || has === 0 ? 1 : want / has;
      }) as V3;
    } else {
      const v = a['factor'];
      f = typeof v === 'number' ? [v, v, v] : vec(v, 'factor (or size)');
    }
    if (f.some((c) => !(c > 0))) throw new Error('each factor more than 0 (a mirror turns a solid inside out)'); // prettier-ignore
    const about =
      a['about'] === undefined
        ? (lo.map((l, k) => (l + hi[k]!) / 2) as V3)
        : vec(a['about'], 'about');
    this.unpickAll();
    await this.over(num(a['ms']) ?? 0, (x, y) => {
      const m = mat4.scaleAbout(about, f.map((c) => c ** (y - x)) as V3);
      for (const o of os) this.rt.transformBranch(o, m);
    });
    return { objects: os.map((o) => this.info(o)) };
  }

  /**
   * Copies, `count` of each, every one moved (`by`), turned (`rotate`) and scaled (`scale`)
   * from the one before: a row, a ring, a stair in one call.
   */
  copy(a: Args): Args {
    const os = this.resolve(a['objects']);
    const count = Math.round(num(a['count']) ?? 1);
    if (count < 1 || count > 500) throw new Error('count: 1..500');
    const by = a['by'] === undefined ? null : vec(a['by'], 'by');
    const rot = a['rotate'] as Args | undefined;
    const axis = rot ? axisOf(rot['axis']) : null;
    const deg = rot ? num(rot['degrees']) : undefined;
    if (rot && deg === undefined) throw new Error('rotate.degrees: a number');
    const point = rot?.['point'] === undefined ? null : vec(rot['point'], 'rotate.point');
    const sc = num(a['scale']);
    if (sc !== undefined && !(sc > 0)) throw new Error('scale: more than 0');
    this.unpickAll();
    const made: CutObject[][] = [];
    for (const o of os) {
      const row: CutObject[] = [];
      let from = o;
      for (let i = 0; i < count; i++) {
        const c = this.rt.duplicate(from);
        if (sc !== undefined && sc !== 1)
          this.rt.transformBranch(c, mat4.scaleAbout(this.middle([c]), [sc, sc, sc]));
        if (axis && deg) {
          const at = point ?? this.middle([c]);
          this.rt.transformBranch(c, mat4.rotationAbout(at, axis, (deg / 180) * Math.PI));
        }
        if (by) this.rt.moveBranch(c, by);
        row.push((from = c));
      }
      made.push(row);
    }
    this.rt.commit();
    this.h.settle();
    return { copies: made.map((row) => row.map((c) => this.idOf(c))) };
  }

  remove(a: Args): Args {
    const os = this.resolve(a['objects']);
    this.unpickAll();
    const gone = os.map((o) => this.idOf(o));
    for (const o of os) for (const x of [...subtree(o)].reverse()) this.rt.killNow(x);
    this.rt.commit();
    this.h.settle();
    return { deleted: gone };
  }

  paint(a: Args): Args {
    const os = this.resolve(a['objects']);
    const rgb = vec(a['color'], 'color').map((c) => Math.max(0, Math.min(255, Math.round(c)))) as V3; // prettier-ignore
    const side = a['face'];
    if (side !== undefined) {
      if (os.length !== 1) throw new Error('face: of one object');
      const o = os[0]!;
      this.rt.setColor(this.rt.features.face(o, this.faceOf(o, side)), rgb);
    } else
      for (const o of os)
        for (const x of subtree(o)) {
          if (!isObject(x)) continue;
          this.rt.setColor(x, rgb);
          // Its faces' own colours (a cut's walls) too, if asked: all one colour.
          if (a['all_faces'] && x.brep.faceColors.size) {
            this.rt.journal.touch(x);
            x.brep.faceColors.clear();
            this.rt.changed(x);
          }
        }
    this.rt.commit();
    this.h.settle();
    return { objects: os.map((o) => this.info(o)) };
  }

  name(a: Args): Args {
    const o = this.one(a['object'], 'object');
    const n = a['name'];
    this.rt.setName(o, typeof n === 'string' && n ? n : null);
    this.rt.commit();
    return this.info(o);
  }

  /** What is asked picked, nothing else: for the keys (D, \, G…) and the tools by hand. */
  pick(a: Args): Args {
    const os = a['objects'] === undefined || (Array.isArray(a['objects']) && a['objects'].length === 0) ? [] : this.resolve(a['objects']); // prettier-ignore
    this.h.controls.pickOnly(os);
    this.h.settle();
    return { picked: os.map((o) => this.idOf(o)) };
  }

  /** G: several grouped as one, or a group taken apart (its parts on their own again). */
  group(a: Args, apart: boolean): Args {
    const os = apart ? [this.one(a['object'], 'object')] : this.resolve(a['objects']);
    if (!apart && os.length < 2) throw new Error('objects: two or more to group');
    if (apart && !os[0]!.children.some(isObject)) throw new Error('object: not a group');
    const parts = apart ? os[0]!.children.filter(isObject) : os;
    this.h.controls.pickOnly(os);
    this.h.settle();
    this.h.controls.group();
    this.h.settle();
    this.unpickAll();
    if (apart) return { objects: parts.map((p) => this.info(this.thingOf(p))) };
    const g = this.thingOf(parts[0]!);
    if (g === parts[0]) throw new Error('they were not grouped');
    return this.info(g);
  }

  /** A, Shift-A: lined up, or spaced out evenly. */
  arrange(a: Args): Args {
    const os = this.resolve(a['objects']);
    if (os.length < 2) throw new Error('objects: two or more');
    this.h.controls.pickOnly(os);
    this.h.settle();
    if (a['spread']) this.h.controls.distribute();
    else this.h.controls.align();
    this.h.settle();
    this.unpickAll();
    return { objects: os.map((o) => this.info(o)) };
  }

  /**
   * The booleans: union fuses the objects into the first; subtract cuts the tool out of
   * each (the drill's cut, its walls the tool's colour), intersect keeps what each shares
   * with it. The tool goes, unless kept. Says what each kept of its room (volume), so a
   * cut that took more than it should shows; and fails, aloud, where the boolean did
   * nothing (a part left out of a union; an object the cut left as it was, the tool kept).
   */
  boolean(a: Args): Args {
    const op = String(a['op']);
    const os = this.resolve(a['objects']).flatMap((o) => this.solids(o));
    this.unpickAll();
    const vol = (o: CutObject) => worldVolume(this.rt.world(o));
    const before = new Map(os.map((o) => [o, vol(o)]));
    let out: CutObject[];
    const failed: CutObject[] = [];
    const kept: Args[] = [];
    let tool: CutObject | undefined;
    if (op === 'union') {
      if (os.length < 2) throw new Error('objects: two or more to union');
      out = [os[0]!];
      for (const b of os.slice(1)) {
        const r = booleanObjects(this.rt, out[0]!, b, BOOL_OP.Union);
        if (r.length > 0) out = r;
        // (Fused, b is gone: still there, it was left out.)
        if (r.length === 0 || this.alive(b)) failed.push(b);
      }
      const sum = os.filter((o) => !failed.includes(o)).reduce((t, o) => t + before.get(o)!, 0);
      // (More than one piece: some of them don't touch, and stay apart.)
      kept.push({ before: r1(sum), after: r1(out.reduce((t, o) => t + vol(o), 0)), pieces: out.length }); // prettier-ignore
    } else if (op === 'subtract' || op === 'intersect') {
      tool = this.one(a['tool'], 'tool');
      if (!isObject(tool) || tool.brep.numFaces === 0) throw new Error('tool: one solid object, not a group'); // prettier-ignore
      if (os.includes(tool)) throw new Error('tool: not among objects');
      const code = op === 'subtract' ? BOOL_OP.Subtraction : BOOL_OP.Intersection;
      out = [];
      for (const o of os) {
        const id = this.idOf(o);
        const r = booleanObjects(this.rt, o, tool, code, true);
        // Nothing back and the object still there as it was: the boolean failed.
        if (r.length === 0 && this.alive(o)) failed.push(o);
        out.push(...r);
        const after = r.reduce((t, x) => t + vol(x), 0);
        const was = before.get(o)!;
        kept.push({ object: id, before: r1(was), after: r1(after), kept: was > 0 ? `${r1((100 * after) / was)}%` : undefined, pieces: r.length }); // prettier-ignore
      }
      if (!a['keep_tool'] && failed.length === 0) this.rt.killNow(tool);
    } else throw new Error('op: union, subtract or intersect');
    this.rt.commit();
    this.h.settle();
    if (failed.length) {
      const ids = failed.map((o) => this.idOf(o)).join(', ');
      throw new Error(
        op === 'union'
          ? `union: ${ids} did not fuse and stay as they were (the rest did, one undo step). Try turning one 0.5°.` // prettier-ignore
          : `${op}: the boolean failed on ${ids}, left as it was; the tool is kept. Try turning the tool 0.5° and again.`, // prettier-ignore
      );
    }
    return { objects: out.map((o) => this.info(o)), volume: kept };
  }

  /** Whether an object is in the world still (not used up by a boolean). */
  private alive(o: CutObject): boolean {
    return this.everything().includes(o);
  }

  /** The solid objects of a thing (a group's parts), each a boolean or a slice takes. */
  private solids(o: CutObject): CutObject[] {
    return [...subtree(o)].filter((x) => isObject(x) && x.brep.numFaces > 0);
  }

  /** \: sliced through at depth z (each piece an object of its own), pulled `gap` off it. */
  slice(a: Args): Args {
    const z = num(a['z']);
    if (z === undefined) throw new Error('z: the depth to slice at');
    const gap = num(a['gap']) ?? 0;
    const os = this.resolve(a['objects']).flatMap((o) => this.solids(o));
    this.unpickAll();
    const back: CutObject[] = [];
    const front: CutObject[] = [];
    for (const o of os) {
      const r = sliceObject(this.rt, o, z);
      back.push(...r.back);
      front.push(...r.front);
    }
    if (gap) {
      for (const o of back) this.rt.moveBranch(o, [0, 0, -gap]);
      for (const o of front) this.rt.moveBranch(o, [0, 0, gap]);
    }
    this.rt.commit();
    this.h.settle();
    if (back.length === 0) throw new Error(`the plane at z ${z} cuts none of them`);
    return { back: back.map((o) => this.info(o)), front: front.map((o) => this.info(o)) };
  }

  /**
   * What a line of sight meets: from a point, along a direction (or toward a point, and
   * no further), each face it crosses, nearest first: the object, how far, where, and
   * going in or coming out. Glass where it should be, or the cabin behind it.
   */
  ray(a: Args): Args {
    const from = vec(a['from'], 'from');
    let d: V3;
    let max = Infinity;
    if (a['to'] !== undefined) {
      const to = vec(a['to'], 'to');
      d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      max = Math.hypot(...d);
      if (max === 0) throw new Error('to: not the same point as from');
      d = d.map((c) => c / max) as V3;
    } else d = axisOf(a['dir'] ?? a['direction']);
    const count = num(a['count']) ?? 12;
    const only = a['objects'] === undefined ? null : new Set(this.resolve(a['objects']).flatMap((o) => this.solids(o))); // prettier-ignore
    const hits: Args[] = [];
    for (const o of this.everything()) {
      if (o.brep.numFaces === 0 || (only && !only.has(o))) continue;
      const b = this.rt.branchBox(o);
      if (b && !rayMeetsBox(from, d, b[0], b[1], max)) continue;
      const top = this.thingOf(o);
      for (const c of crossings(this.rt.world(o), from, d, max))
        hits.push({
          id: this.idOf(o),
          ...(o.name ? { name: o.name } : {}),
          ...(top !== o ? { of: top.name ?? this.idOf(top) } : {}),
          t: r1(c.t),
          at: c.at.map(r1),
          n: c.n.map((x) => Math.round(x * 1000) / 1000),
          into: c.entering,
        });
    }
    hits.sort((x, y) => (x['t'] as number) - (y['t'] as number));
    return { hits: hits.slice(0, count), more: Math.max(0, hits.length - count) };
  }

  /**
   * How two solids sit: whether they share room (one cutting into the other, or holding
   * it), one wholly inside the other, and how close their surfaces come (corner to face).
   */
  clearance(a: Args): Args {
    const x = this.one(a['a'], 'a');
    const y = this.one(a['b'], 'b');
    for (const [o, w] of [[x, 'a'], [y, 'b']] as const)
      if (o.brep.numFaces === 0) throw new Error(`${w}: one solid object, not a group (name a part)`); // prettier-ignore
    const c = clearance(this.rt.world(x), this.rt.world(y));
    return { a: this.idOf(x), b: this.idOf(y), overlap: c.overlap, a_inside_b: c.aInB, b_inside_a: c.bInA, gap: r1(c.gap) }; // prettier-ignore
  }

  /** A face of `o`: its index (inspect's order), or the side it faces ("+y": its top). */
  private faceOf(o: CutObject, side: unknown): number {
    const faces = o.brep.faces();
    if (typeof side === 'number') {
      const f = faces[side];
      if (f === undefined) throw new Error(`face: 0..${faces.length - 1}`);
      return f;
    }
    const dir = typeof side === 'string' ? SIDES[side] : undefined;
    if (!dir) throw new Error('face: "+x", "-x", "+y", "-y", "+z", "-z", or an index');
    // The face looking most that way, the outermost of those.
    let best: { f: number; dot: number; out: number } | null = null;
    for (const f of faces) {
      const w = this.rt.worldFace(o, f);
      if (!w) continue;
      const dot = w.normal[0] * dir[0] + w.normal[1] * dir[1] + w.normal[2] * dir[2];
      const out = w.center[0] * dir[0] + w.center[1] * dir[1] + w.center[2] * dir[2];
      if (dot < 0.7) continue;
      if (!best || dot > best.dot + 1e-6 || (dot > best.dot - 1e-6 && out > best.out))
        best = { f, dot, out };
    }
    if (!best) throw new Error(`face: none of it faces ${side}`);
    return best.f;
  }

  /**
   * A face pulled, as a drag of it pulls it (the solid reshaped, faces kept flat): by a
   * distance along its normal, by [dx, dy, dz], or `to` a coordinate along the side it
   * faces. extrude: pulled out as a new block (the toolbar's Extrude), not stretched.
   */
  moveFace(a: Args): Args {
    const o = this.one(a['object'], 'object');
    if (o.brep.numFaces === 0) throw new Error('object: a group (name one of its parts)');
    const f = this.faceOf(o, a['face']);
    const w = this.rt.worldFace(o, f)!;
    let d: V3;
    if (a['to'] !== undefined) {
      const to = num(a['to']);
      const side = typeof a['face'] === 'string' ? SIDES[a['face']] : undefined;
      if (to === undefined || !side) throw new Error('to: a coordinate, with face a side ("+y")'); // prettier-ignore
      const k = side.findIndex((c) => c !== 0);
      d = [0, 0, 0];
      d[k] = to - w.center[k]!;
    } else if (typeof a['by'] === 'number') d = w.normal.map((c) => c * (a['by'] as number)) as V3;
    else d = vec(a['by'], 'by (a distance, or [x, y, z]; or to)');
    this.unpickAll();
    const rt = this.rt;
    const was = rt.faceDrag;
    rt.faceDrag = a['extrude'] ? 'extrude' : 'stretch';
    try {
      rt.afterInstruction(); // (vertices moved this frame are not moved twice)
      rt.translate(rt.features.face(o, f), d);
      rt.finishDrags();
    } finally {
      rt.faceDrag = was;
    }
    const step = rt.commit();
    this.h.settle();
    if (!step) throw new Error('the face could not move so (the solid would break): nothing changed'); // prettier-ignore
    return this.info(o);
  }
}
