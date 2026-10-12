import {
  NONE,
  betterPick,
  deleteEdge,
  deleteFace,
  deleteVertex,
  duplicateTree,
  mat4,
  subtree,
  transformTree,
  volume,
  pickAt,
  planarizeForMotion,
  recombineSurfaces,
  validate,
  type Brep,
  type CutObject,
  type Mat4,
  type ObjectSection,
  type Pick,
} from '@cutplane/kernel';
import type { Model } from '../render/models.ts';

/**
 * Direct manipulation, after the original's rom.cpl (CPnormal) and
 * cursor.cpl, which ran on the C in select.c, translate.c and split.c:
 *
 * - Hover: the crosshair's best pick across all objects (pick.ts).
 * - Press on a feature picks it (shift adds, or takes a picked one away);
 *   press inside an object's section picks the whole object (its group
 *   root), as does anything on an object with Lockedgeometry.
 * - Drag: after a 5-unit dead zone everything picked moves rigidly with the
 *   crosshair, catching up with it, in the plane and, when the plane moves
 *   while held, in depth (carry). Faces the motion would bend are split
 *   first; on release, pieces of one face that are coplanar again merge.
 * - Press on nothing starts a marquee, a box between the press point and the
 *   crosshair (3D if the plane moved); release picks the objects inside it.
 *   A click on nothing drops the picks.
 *
 * Keys (controls.c): D duplicates what is picked (whole objects, moved
 * (100, 100, 0), the copies picked); Backspace deletes it (whole objects with
 * their descendants, or single vertices, edges and faces).
 *
 * Every edit is one undoable step (the original had no undo). A drag or a
 * delete that would leave a solid broken is rolled back.
 */

export type V3 = [number, number, number];

export type Feature =
  | { kind: 'vertex' | 'edge' | 'face'; model: Model; id: number }
  | { kind: 'object'; object: CutObject };

export interface Hover {
  model: Model;
  pick: Pick;
}

export interface EditorHost {
  readonly models: readonly Model[];
  /** The world's top-level objects; duplicate and delete add and remove them. */
  readonly roots: CutObject[];
  /** Objects were added to or removed from `roots`. */
  structureChanged(): void;
  /** The section of a model at the current plane depth, if it has one. */
  section(m: Model): ObjectSection | undefined;
  /** Geometry or placement of these objects changed (rebuild what's drawn). */
  changed(objects: Iterable<CutObject>): void;
  /** An edit was finished, undone or redone. */
  committed(): void;
}

/** update.c's drag_valid: the dead zone (Pkboxsize / 2) before a press becomes a drag. */
export const DRAG_DEAD_ZONE = 5;
/** Onplanetol: a plane move this big during a press also starts a drag. */
const DEPTH_MOVED = 1e-3;
/** The marquee's depth slack when it is flat (execute_WITHIN's ±1). */
const MARQUEE_SLACK = 1;
/** controls.c's DUPLICATEBUTTON: where a copy lands relative to its original. */
export const DUPLICATE_OFFSET: V3 = [100, 100, 0];
/** A delete that leaves less volume than this (cubic room units) has flattened the solid. */
const MIN_VOLUME = 1e-3;

interface Snapshot {
  object: CutObject;
  brep: Brep;
  xform: Mat4;
  invXform: Mat4;
}

interface Step {
  before: Snapshot[];
  after: Snapshot[];
  /** The world's roots before and after, for steps that add or remove objects. */
  roots?: { before: CutObject[]; after: CutObject[] };
}

interface Transform {
  roots: CutObject[];
  before: Snapshot[];
  changed: boolean;
}

interface VertexPlan {
  model: Model;
  start: Map<number, V3>;
}

interface Drag {
  vertices: VertexPlan[];
  objects: { object: CutObject; xform: Mat4 }[];
  before: Snapshot[];
  /** Per object: was it a closed solid, and how many degenerate elements did it have? */
  health: Map<CutObject, Health>;
  last: V3;
}

interface Health {
  closed: boolean;
  degenerate: number;
}

const rootOf = (o: CutObject): CutObject => (o.parent ? rootOf(o.parent) : o);

function snapshot(o: CutObject): Snapshot {
  return { object: o, brep: o.brep.clone(), xform: o.xform.slice(), invXform: o.invXform.slice() };
}

function restore(s: Snapshot): void {
  s.object.brep = s.brep.clone();
  s.object.xform = s.xform.slice();
  s.object.invXform = s.invXform.slice();
}

function health(b: Brep): Health {
  const r = validate(b, { maxIssuesPerCode: 0 });
  return {
    closed: r.ok && r.closedManifold,
    degenerate: (r.counts['zero-length-edge'] ?? 0) + (r.counts['degenerate-face'] ?? 0),
  };
}

/** A world-space vector in an object's local frame (row vectors: v · M, no translation). */
function toLocal(m: Mat4, d: V3): V3 {
  return [
    d[0] * m[0]! + d[1] * m[4]! + d[2] * m[8]!,
    d[0] * m[1]! + d[1] * m[5]! + d[2] * m[9]!,
    d[0] * m[2]! + d[1] * m[6]! + d[2] * m[10]!,
  ];
}

const sameFeature = (a: Feature, b: Feature) =>
  a.kind === 'object' || b.kind === 'object'
    ? a.kind === b.kind &&
      (a as { object: CutObject }).object === (b as { object: CutObject }).object
    : a.kind === b.kind && a.model === b.model && a.id === b.id;

export class Editor {
  hover: Hover | undefined;
  picked: Feature[] = [];
  marquee: { from: V3; to: V3; add: boolean } | undefined;
  /** Bumped on every change worth redrawing highlights for. */
  version = 0;

  private pressAt: V3 | undefined;
  private drag: Drag | undefined;
  /** Pressed (without shift) on something already picked: if no drag follows, pick just that. */
  private solo: Feature | undefined;
  private transform: Transform | undefined;
  private readonly undoStack: Step[] = [];
  private readonly redoStack: Step[] = [];

  constructor(private readonly host: EditorHost) {}

  get pressed(): boolean {
    return this.pressAt !== undefined;
  }
  get dragging(): boolean {
    return this.drag !== undefined;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Finds what the crosshair would pick now (select.c's set_selectables). */
  updateHover(cursor: V3, size?: number): void {
    let best: Hover | undefined;
    for (const model of this.host.models) {
      const p = model.object.attrs.props;
      if (p.includes('Nonselectable') || p.includes('Sectioninvisible')) continue;
      const s = this.host.section(model);
      if (!s) continue;
      const pick = pickAt(model.world, s, cursor[0], cursor[1], cursor[2], size);
      if (pick && (!best || betterPick(pick, best.pick))) best = { model, pick };
    }
    const same =
      best?.model === this.hover?.model &&
      best?.pick.kind === this.hover?.pick.kind &&
      best?.pick.id === this.hover?.pick.id &&
      best?.pick.at.every((c, i) => c === this.hover!.pick.at[i]);
    if (!same || (best === undefined) !== (this.hover === undefined)) {
      this.hover = best;
      this.version++;
    }
  }

  /** What pressing on the hover would pick. */
  private featureOf(h: Hover): Feature {
    const o = h.model.object;
    if (h.pick.kind === 'object' || o.attrs.props.includes('Lockedgeometry'))
      return { kind: 'object', object: rootOf(o) };
    const kind = h.pick.kind === 'inPlaneFace' ? 'face' : h.pick.kind;
    return { kind, model: h.model, id: h.pick.id };
  }

  isPicked(f: Feature): boolean {
    return this.picked.some((p) => sameFeature(p, f));
  }

  /** The Pick button went down with the crosshair at `cursor`. */
  press(cursor: V3, shift: boolean): void {
    this.updateHover(cursor);
    this.pressAt = [...cursor];
    this.solo = undefined;
    if (!this.hover) {
      this.marquee = { from: [...cursor], to: [...cursor], add: shift };
      this.version++;
      return;
    }
    const f = this.featureOf(this.hover);
    if (shift) {
      if (this.isPicked(f)) this.picked = this.picked.filter((p) => !sameFeature(p, f));
      else this.picked.push(f);
    } else if (this.isPicked(f)) this.solo = f;
    else this.picked = [f];
    this.version++;
  }

  /** The crosshair (and plane) moved, or a frame passed; drags follow it. */
  move(cursor: V3): void {
    if (!this.pressAt) return;
    if (this.marquee) {
      if (cursor.some((c, i) => c !== this.marquee!.to[i])) {
        this.marquee.to = [...cursor];
        this.version++;
      }
      return;
    }
    const d: V3 = [
      cursor[0] - this.pressAt[0],
      cursor[1] - this.pressAt[1],
      cursor[2] - this.pressAt[2],
    ];
    if (!this.drag) {
      const started =
        Math.abs(d[0]) > DRAG_DEAD_ZONE ||
        Math.abs(d[1]) > DRAG_DEAD_ZONE ||
        Math.abs(d[2]) > DEPTH_MOVED;
      if (!started || this.picked.length === 0) return;
      this.drag = this.beginDrag();
      this.solo = undefined;
    }
    if (d.every((c, i) => c === this.drag!.last[i])) return;
    this.applyDrag(this.drag, d);
  }

  /** The Pick button came up. */
  release(cursor: V3): void {
    if (!this.pressAt) return;
    this.move(cursor);
    if (this.marquee) this.finishMarquee();
    else if (this.drag) this.finishDrag(this.drag);
    else if (this.solo) this.picked = [this.solo];
    this.pressAt = undefined;
    this.drag = undefined;
    this.solo = undefined;
    this.version++;
  }

  /** Forgets everything: a new model was loaded. */
  reset(): void {
    this.hover = undefined;
    this.picked = [];
    this.marquee = undefined;
    this.pressAt = undefined;
    this.drag = undefined;
    this.solo = undefined;
    this.transform = undefined;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.version++;
  }

  undo(): void {
    this.step(this.undoStack, this.redoStack, 'before');
  }

  redo(): void {
    this.step(this.redoStack, this.undoStack, 'after');
  }

  private step(from: Step[], to: Step[], side: 'before' | 'after'): void {
    if (this.pressed || this.transform) return;
    const s = from.pop();
    if (!s) return;
    if (s.roots) {
      this.host.roots.splice(0, this.host.roots.length, ...s.roots[side]);
      this.host.structureChanged();
    }
    for (const snap of s[side]) restore(snap);
    to.push(s);
    this.picked = [];
    this.hover = undefined;
    this.host.changed(s[side].map((x) => x.object));
    this.host.committed();
    this.version++;
  }

  private push(step: Step): void {
    this.undoStack.push(step);
    this.redoStack.length = 0;
  }

  /** Unpicks everything, then picks what the crosshair is over (rotatecircle.cpl's _Finish_snap). */
  pickHover(): void {
    this.picked = this.hover ? [this.featureOf(this.hover)] : [];
    this.version++;
  }

  unpickAll(): void {
    this.picked = [];
    this.version++;
  }

  /** Forgets the hover (a tool in the room is under the crosshair instead). */
  clearHover(): void {
    if (!this.hover) return;
    this.hover = undefined;
    this.version++;
  }

  /** The group roots of everything picked: what rotating or duplicating moves. */
  pickedRoots(): CutObject[] {
    const out = new Set<CutObject>();
    for (const p of this.picked) out.add(rootOf(p.kind === 'object' ? p.object : p.model.object));
    return [...out];
  }

  // ---- duplicate and delete ----

  /** D: copies the picked features' whole objects, offset, and picks the copies. */
  duplicate(): void {
    if (this.pressed || this.transform) return;
    const originals = this.pickedRoots();
    if (originals.length === 0) return;
    const before = [...this.host.roots];
    const copies = originals.map((o) => {
      const c = duplicateTree(o);
      transformTree(c, mat4.translation(...DUPLICATE_OFFSET));
      return c;
    });
    this.host.roots.push(...copies);
    this.push({ before: [], after: [], roots: { before, after: [...this.host.roots] } });
    this.host.structureChanged();
    this.picked = copies.map((object) => ({ kind: 'object', object }));
    this.hover = undefined;
    this.host.committed();
    this.version++;
  }

  /** Backspace: deletes what is picked. A feature delete that would break its solid is refused. */
  deletePicked(): void {
    if (this.pressed || this.transform || this.picked.length === 0) return;
    const rootsBefore = [...this.host.roots];
    const gone = new Set(
      this.picked.filter((p) => p.kind === 'object').map((p) => rootOf(p.object)),
    );
    const byModel = new Map<Model, Feature[]>();
    for (const p of this.picked) {
      if (p.kind === 'object' || gone.has(rootOf(p.model.object))) continue;
      byModel.set(p.model, [...(byModel.get(p.model) ?? []), p]);
    }
    const before: Snapshot[] = [];
    const after: Snapshot[] = [];
    for (const [model, features] of byModel) {
      const o = model.object;
      const snap = snapshot(o);
      const was = health(o.brep);
      const vol = volume(o.brep);
      try {
        for (const f of features) {
          const b = o.brep;
          if (f.kind === 'vertex' && b.isVertex(f.id)) deleteVertex(b, f.id);
          else if (f.kind === 'edge' && b.isEdge(f.id)) deleteEdge(b, f.id);
          else if (f.kind === 'face' && b.isFace(f.id)) deleteFace(b, f.id);
        }
        const now = health(o.brep);
        const v = volume(o.brep);
        if ((was.closed && !now.closed) || now.degenerate > was.degenerate)
          throw new Error('broken');
        if (Math.sign(v) !== Math.sign(vol) || Math.abs(v) < MIN_VOLUME) throw new Error('flat');
        before.push(snap);
        after.push(snapshot(o));
      } catch {
        restore(snap);
      }
    }
    if (gone.size > 0) {
      const keep = this.host.roots.filter((r) => !gone.has(r));
      this.host.roots.splice(0, this.host.roots.length, ...keep);
    }
    if (before.length === 0 && gone.size === 0) return;
    this.push({
      before,
      after,
      ...(gone.size > 0 ? { roots: { before: rootsBefore, after: [...this.host.roots] } } : {}),
    });
    if (gone.size > 0) this.host.structureChanged();
    this.host.changed(before.map((s) => s.object));
    this.picked = [];
    this.hover = undefined;
    this.host.committed();
    this.version++;
  }

  // ---- rigid and scaling transforms of whole objects (rotate tool, scale box) ----

  /** Starts moving `roots` (default: the picked roots) by world transforms. */
  beginTransform(roots: CutObject[] = this.pickedRoots()): void {
    const all = new Set<CutObject>();
    for (const r of roots) for (const o of subtree(r)) all.add(o);
    this.transform = { roots, before: [...all].map(snapshot), changed: false };
  }

  get transforming(): boolean {
    return this.transform !== undefined;
  }

  /** Places the objects at their start placement followed by `m` (a world transform). */
  setTransform(m: Mat4): void {
    const t = this.transform;
    if (!t) return;
    for (const s of t.before) {
      s.object.xform = s.xform.slice();
      s.object.invXform = s.invXform.slice();
    }
    for (const r of t.roots) transformTree(r, m);
    t.changed = true;
    this.host.changed(t.before.map((s) => s.object));
    this.version++;
  }

  /** Finishes the transform as one undoable step. */
  endTransform(): void {
    const t = this.transform;
    this.transform = undefined;
    if (!t || !t.changed) return;
    this.push({ before: t.before, after: t.before.map((s) => snapshot(s.object)) });
    this.host.committed();
    this.version++;
  }

  // ---- dragging ----

  private beginDrag(): Drag {
    const objects = new Set<CutObject>();
    for (const p of this.picked)
      if (p.kind === 'object') for (const o of subtree(p.object)) objects.add(o);
    const verts = new Map<Model, Set<number>>();
    for (const p of this.picked) {
      if (p.kind === 'object' || objects.has(p.model.object)) continue;
      const b = p.model.object.brep;
      let set = verts.get(p.model);
      if (!set) verts.set(p.model, (set = new Set()));
      for (const v of movingVertices(b, p.kind, p.id)) set.add(v);
    }
    const touched = new Set<CutObject>([...objects, ...[...verts.keys()].map((m) => m.object)]);
    const healthMap = new Map<CutObject, Health>();
    for (const m of verts.keys()) healthMap.set(m.object, health(m.object.brep));
    return {
      vertices: [...verts].map(([model, set]) => ({
        model,
        start: new Map([...set].map((v) => [v, model.object.brep.vertexPos(v)])),
      })),
      objects: [...objects].map((object) => ({ object, xform: object.xform.slice() })),
      before: [...touched].map(snapshot),
      health: healthMap,
      last: [0, 0, 0],
    };
  }

  private applyDrag(drag: Drag, d: V3): void {
    const changed: CutObject[] = [];
    for (const plan of drag.vertices) {
      const o = plan.model.object;
      const b = o.brep;
      const local = toLocal(o.invXform, d);
      const [v0, s0] = plan.start.entries().next().value as [number, V3];
      const now = b.vertexPos(v0);
      const step: V3 = [
        s0[0] + local[0] - now[0],
        s0[1] + local[1] - now[1],
        s0[2] + local[2] - now[2],
      ];
      planarizeForMotion(b, new Set(plan.start.keys()), step);
      for (const [v, s] of plan.start)
        b.setVertexPos(v, s[0] + local[0], s[1] + local[1], s[2] + local[2]);
      changed.push(o);
    }
    for (const { object, xform } of drag.objects) {
      const m = xform.slice();
      m[12] = xform[12]! + d[0];
      m[13] = xform[13]! + d[1];
      m[14] = xform[14]! + d[2];
      object.xform = m;
      object.invXform = mat4.invert(m) ?? object.invXform;
      changed.push(object);
    }
    drag.last = [...d];
    this.host.changed(changed);
    this.version++;
  }

  private finishDrag(drag: Drag): void {
    let broken = false;
    for (const plan of drag.vertices) {
      const o = plan.model.object;
      const keep = new Set<number>();
      for (const p of this.picked) if (p.kind === 'face' && p.model === plan.model) keep.add(p.id);
      recombineSurfaces(o.brep, keep);
      const was = drag.health.get(o)!;
      const now = health(o.brep);
      if ((was.closed && !now.closed) || now.degenerate > was.degenerate) broken = true;
    }
    const objects = drag.before.map((s) => s.object);
    if (broken) {
      // Couldn't keep the solid sound (a face folded onto itself, an edge shrunk to nothing):
      // put everything back where it was.
      for (const s of drag.before) restore(s);
    } else if (drag.last.some((c) => c !== 0)) {
      this.push({ before: drag.before, after: objects.map(snapshot) });
    }
    this.dropDeadPicks();
    this.host.changed(objects);
    this.host.committed();
  }

  private dropDeadPicks(): void {
    this.picked = this.picked.filter((p) => {
      if (p.kind === 'object') return true;
      const b = p.model.object.brep;
      return p.kind === 'vertex'
        ? b.isVertex(p.id)
        : p.kind === 'edge'
          ? b.isEdge(p.id)
          : b.isFace(p.id);
    });
  }

  // ---- marquee ----

  private finishMarquee(): void {
    const { from, to, add } = this.marquee!;
    this.marquee = undefined;
    if (!add) this.picked = [];
    const lo = from.map((c, i) => Math.min(c, to[i]!));
    const hi = from.map((c, i) => Math.max(c, to[i]!));
    if (hi[2]! - lo[2]! < 2 * MARQUEE_SLACK) {
      lo[2] = lo[2]! - MARQUEE_SLACK;
      hi[2] = hi[2]! + MARQUEE_SLACK;
    }
    if (hi[0] === lo[0] || hi[1] === lo[1]) return; // a click, not a box
    const inside = (min: readonly number[], max: readonly number[]) =>
      [0, 1, 2].every((i) => min[i]! >= lo[i]! && max[i]! <= hi[i]!);
    const z = to[2];
    for (const model of this.host.models) {
      if (model.object.attrs.props.includes('Nonselectable')) continue;
      const g = model.world;
      let hit = false;
      // Its section lies inside the box (execute_WITHIN's first test)...
      const s = this.host.section(model);
      if (s && s.loops.length > 0) {
        const min = [Infinity, Infinity, z];
        const max = [-Infinity, -Infinity, z];
        for (const l of s.loops)
          for (let i = 0; i < l.points.length; i += 3) {
            min[0] = Math.min(min[0]!, l.points[i]!);
            max[0] = Math.max(max[0]!, l.points[i]!);
            min[1] = Math.min(min[1]!, l.points[i + 1]!);
            max[1] = Math.max(max[1]!, l.points[i + 1]!);
          }
        hit = inside(min, max);
      }
      // ...or all of it does.
      if (!hit) {
        const min = [Infinity, Infinity, g.zMin];
        const max = [-Infinity, -Infinity, g.zMax];
        for (const v of g.brep.vertices()) {
          min[0] = Math.min(min[0]!, g.x(v));
          max[0] = Math.max(max[0]!, g.x(v));
          min[1] = Math.min(min[1]!, g.y(v));
          max[1] = Math.max(max[1]!, g.y(v));
        }
        hit = Number.isFinite(min[0]) && inside(min, max);
      }
      if (!hit) continue;
      const f: Feature = { kind: 'object', object: rootOf(model.object) };
      if (!this.isPicked(f)) this.picked.push(f);
    }
  }
}

/**
 * The vertices a picked feature drags (translate.c): a vertex itself; an
 * edge's two ends; every vertex of a face. A face that is part of a surface,
 * or an edge inside one, drags the whole surface.
 */
export function movingVertices(b: Brep, kind: 'vertex' | 'edge' | 'face', id: number): number[] {
  if (kind === 'vertex') return [id];
  let faces: number[];
  if (kind === 'edge') {
    const h1 = b.edgeHe1(id);
    const h2 = b.edgeHe2(id);
    const s1 = b.faceSurface.get(b.heFace(h1));
    if (h2 === NONE || s1 === undefined || b.faceSurface.get(b.heFace(h2)) !== s1)
      return b.edgeVertices(id);
    faces = b.surfaceFaces(b.heFace(h1));
  } else faces = b.surfaceFaces(id);
  const out = new Set<number>();
  for (const f of faces)
    for (const l of b.faceLoops(f)) for (const h of b.loopHalfEdges(l)) out.add(b.heVertex(h));
  return [...out];
}
