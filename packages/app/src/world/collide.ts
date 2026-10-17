import type RAPIER from '@dimforge/rapier3d-compat';
import { groupRoot, mat4, subtree, type CutObject, type Mat4 } from '@cutplane/kernel';
import { P, T, type Feature } from '@cutplane/cpl';
import { isSub, type Runtime, type Sub, type V3 } from '@cutplane/behaviors';
import { loadRapier, type Poser } from './gravity.ts';

/**
 * New here: the magnet's push-back. An object dragged with the magnet is solid:
 * it can't go into another, but stops where they touch (and slides along it, as
 * far as the drag goes that way), so two objects are slapped together quickly.
 * What it hits is as drawn (its triangles); what moves is a convex hull per part,
 * cast along each step of the drag (Rapier's shape casts).
 *
 * Taken by a face, it sticks by that face, like a magnet, for as long as the button
 * is held: near enough another object's face, it turns to meet it with the face
 * being dragged, flush (as the magnet's release snaps it), and slides on stuck
 * there; drawn off again it lets go, back as it was taken, and near another face
 * it sticks to that one. The release leaves it as it is.
 */

/** How close it comes (room units): touching, as near as the eye can tell. */
const GAP = 0.05;
/** How many times one step of the drag may slide off something it meets. */
const SLIDES = 4;
/** Taken by a face, it sticks to a face this near (room units)... */
const CATCH = 20;
/** ...and lets go of it farther than this. */
const HOLD = 30;
/** On a face's plane, this nearly (room units). */
const FLUSH = 0.5;

interface Session {
  root: CutObject;
  world: RAPIER.World;
  /** The dragged group's parts, as hulls placed where they were when the drag began. */
  shapes: RAPIER.Shape[];
  /** Each part's placement then. */
  start: Map<CutObject, Mat4>;
  /** The parts' vertices then (world), for how near they come to anything. */
  points: V3[];
  /** Where the drag has it, as it was taken (unstuck): its move from the start. */
  at: V3;
  /** The root's placement as it was last left (moved some other way since: begin again). */
  left: Mat4;
  /** What each collider is of. */
  owners: Map<number, CutObject>;
}

export class Blocker {
  private R: typeof RAPIER | null = null;
  private loading = false;
  private session: Session | null = null;
  /** The face the magnet took hold of, if it took a face. */
  private grabbed: Sub | null = null;
  /** The face the drag has it stuck to now (its release snaps there). */
  private stuck: Sub | null = null;

  constructor(
    private readonly rt: Runtime,
    private readonly view: Poser & { shows(o: CutObject): boolean },
  ) {}

  /** Loads the physics ahead of a drag (the magnet has been taken). */
  ready(): void {
    if (this.R || this.loading) return;
    this.loading = true;
    void loadRapier().then((R) => (this.R = R));
  }

  /** A press with the magnet on what was selectable: by a face, it sticks by that face. */
  grab(selectable: readonly Feature[]): void {
    const subs = selectable.filter(isSub);
    this.grabbed = subs.length > 0 && subs.every((f) => f.type === T.Fve) ? subs[0]! : null;
    this.stuck = null;
  }

  /** Runtime.snapTo: the release snaps what was grabbed to where its drag stuck it, if it did. */
  readonly snapTo = (source: Feature, under: Feature): Feature => {
    const g = this.grabbed;
    const stuck = this.stuck;
    if (!g || !stuck || !isSub(source) || groupRoot(source.object) !== groupRoot(g.object))
      return under;
    return stuck;
  };

  /** The magnet is put down: nothing is held by it, or stuck. */
  forget(): void {
    this.grabbed = this.stuck = null;
  }

  /** The drag is over: what it was cast against is let go. */
  end(): void {
    this.session?.world.free();
    this.session = null;
  }

  /**
   * How far `root`'s group may move of the `d` asked for. Taken by a face, it is
   * placed here instead (as taken, or stuck to a face), and goes no further.
   */
  readonly guard = (root: CutObject, d: V3): V3 => {
    const R = this.R;
    if (!R) return d;
    let s = this.session;
    // A different object, or this one moved some other way since: cast it afresh.
    if (s && (s.root !== root || !same(s.left, root.xform))) {
      this.end();
      s = null;
    }
    if (!s) {
      s = this.session = this.begin(R, root);
      this.stuck = null;
    }
    // Cast, go as far as it can, and slide the rest along what it hit; again, as it
    // may meet something else (or an edge of the same) sliding.
    const from: V3 = [...s.at];
    let left = d;
    let hit: Hit | null = null;
    for (let i = 0; i < SLIDES && Math.hypot(...left) > 1e-6; i++) {
      const h = this.cast(s, s.at, left);
      const t = h ? h.t : 1;
      for (let k = 0; k < 3; k++) s.at[k]! += left[k]! * t;
      if (!h) break;
      hit ??= h;
      const rest = scale(left, 1 - t);
      const into = dot(rest, h.normal);
      left = into < 0 ? sub(rest, scale(h.normal, into)) : rest;
    }
    const g = this.grabbed;
    if (!g || groupRoot(g.object) !== root) {
      const moved = sub(s.at, from);
      s.left = mat4.multiply(root.xform, mat4.translation(...moved)); // (as moveBranch will)
      return moved;
    }
    // By a face: placed as taken, moved as far as it got, then stuck to what it's near.
    this.place(s);
    const target = this.near(s, hit);
    this.stuck = null;
    if (target) {
      this.rt.snapFeatures(g, target);
      this.stuck = target;
    }
    s.left = Float64Array.from(root.xform);
    return [0, 0, 0];
  };

  /** The group as it was taken, moved on to where the drag has it. */
  private place(s: Session): void {
    const rt = this.rt;
    const m = mat4.translation(...s.at);
    for (const [o, x] of s.start) {
      rt.journal.touch(o);
      o.xform = mat4.multiply(x, m);
      o.invXform = mat4.invert(o.xform) ?? o.invXform;
      rt.changed(o);
    }
  }

  /**
   * The face it sticks to, placed as taken where the drag has it: the one it's stuck
   * to while still near enough, else the nearest face it has come near (or hit).
   */
  private near(s: Session, hit: Hit | null): Sub | null {
    const held = this.stuck?.object;
    if (held) {
      const p = this.nearest(s, (o) => o === held);
      if (p && p.distance <= HOLD) {
        const f = this.faceAt(held, p.point, p.normal);
        if (f) return f;
      }
    }
    if (hit?.owner) {
      const f = this.faceAt(hit.owner, hit.point, hit.normal);
      if (f) return f;
    }
    const p = this.nearest(s, () => true);
    return p && p.distance <= CATCH ? this.faceAt(p.owner, p.point, p.normal) : null;
  }

  /** The point of what it could stick to (`which`) nearest any of its vertices, and the way out from it there. */
  private nearest(
    s: Session,
    which: (o: CutObject) => boolean,
  ): { owner: CutObject; point: V3; normal: V3; distance: number } | null {
    let best: { owner: CutObject; point: V3; normal: V3; distance: number } | null = null;
    const pred = (c: RAPIER.Collider) => {
      const o = s.owners.get(c.handle);
      return !!o && which(o);
    };
    for (const v of s.points) {
      const q: V3 = [v[0] + s.at[0], v[1] + s.at[1], v[2] + s.at[2]];
      const p = s.world.projectPoint({ x: q[0], y: q[1], z: q[2] }, false, undefined, undefined, undefined, undefined, pred); // prettier-ignore
      if (!p) continue;
      const point: V3 = [p.point.x, p.point.y, p.point.z];
      const out = sub(q, point);
      const distance = Math.hypot(...out);
      if (distance < 1e-6 || (best && distance >= best.distance)) continue;
      const owner = s.owners.get(p.collider.handle)!;
      best = { owner, point, normal: scale(out, 1 / distance), distance };
    }
    return best;
  }

  /** The face of `o` that `point` lies on, outward along `normal` (or nearest so). */
  private faceAt(o: CutObject, point: V3, normal: V3): Sub | null {
    let best: Sub | null = null;
    let most = 0.5;
    for (const id of o.brep.faces()) {
      const f = this.rt.worldFace(o, id);
      if (!f || Math.abs(dot(sub(point, f.center), f.normal)) > FLUSH + GAP) continue;
      const along = dot(f.normal, normal);
      if (along <= most) continue;
      most = along;
      best = { type: T.Fve, object: o, id } as Sub;
    }
    return best;
  }

  private begin(R: typeof RAPIER, root: CutObject): Session {
    const rt = this.rt;
    const world = new R.World({ x: 0, y: 0, z: 0 });
    world.lengthUnit = 100;
    const moving = new Set(subtree(root));
    const solid = (o: CutObject) =>
      o.brep.numFaces > 0 &&
      rt.vm.props.has(o, P.Visible) &&
      !rt.vm.props.has(o, P.Scalebbox) &&
      !rt.hasProp(o, 'Grouper');
    const owners = new Map<number, CutObject>();
    for (const o of subtree(rt.primary.root)) {
      if (moving.has(o) || !solid(o) || !this.view.shows(o)) continue;
      const tris = this.view.triangles(o);
      if (!tris || tris.length < 9) continue;
      const index = Uint32Array.from({ length: tris.length / 3 }, (_, i) => i);
      try {
        owners.set(world.createCollider(R.ColliderDesc.trimesh(tris, index)).handle, o);
      } catch {
        // (A shape Rapier can't take is left out.)
      }
    }
    const shapes: RAPIER.Shape[] = [];
    const points: V3[] = [];
    const start = new Map<CutObject, Mat4>();
    for (const o of moving) start.set(o, Float64Array.from(o.xform));
    for (const o of moving) {
      if (!solid(o)) continue;
      const g = rt.world(o);
      const vs = o.brep.vertices();
      const pts = new Float32Array(vs.length * 3);
      vs.forEach((v, i) => {
        const p: V3 = [g.x(v), g.y(v), g.z(v)];
        pts.set(p, i * 3);
        points.push(p);
      });
      try {
        const hull = R.ColliderDesc.convexHull(pts);
        if (hull) shapes.push(hull.shape);
      } catch {
        // (Flat: nothing to hull.)
      }
    }
    world.step(); // (the colliders go into what the casts look through)
    return { root, world, shapes, start, points, at: [0, 0, 0], left: Float64Array.from(root.xform), owners }; // prettier-ignore
  }

  /**
   * The first thing the parts hit moving from `at` by `d`: how far along (0..1), and
   * the normal there, turned against the move. Touching something already and moving
   * along it (or away) hits nothing.
   */
  private cast(s: Session, at: V3, d: V3): Hit | null {
    let best: Hit | null = null;
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    const len = Math.hypot(...d);
    for (const shape of s.shapes) {
      const hit = s.world.castShape(
        { x: at[0], y: at[1], z: at[2] },
        rot,
        { x: d[0], y: d[1], z: d[2] },
        shape,
        GAP,
        1,
        false,
      );
      if (!hit || (best && hit.time_of_impact >= best.t)) continue;
      // (Rapier's normal can face either way.)
      let n: V3 = [hit.normal2.x, hit.normal2.y, hit.normal2.z];
      if (dot(n, d) > 0) n = scale(n, -1);
      if (dot(n, d) > -1e-6 * len) continue;
      const w = hit.witness1; // (on what was hit: it stands in the world as it is)
      best = {
        t: Math.max(0, hit.time_of_impact),
        normal: n,
        point: [w.x, w.y, w.z],
        owner: s.owners.get(hit.collider.handle) ?? null,
      };
    }
    return best;
  }
}

/** What a cast met: how far along, the normal there (turned against the move), where, and whose. */
interface Hit {
  t: number;
  normal: V3;
  point: V3;
  owner: CutObject | null;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

/** Is `now` where `then` was? */
function same(then: Mat4, now: Mat4): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs(then[i]! - now[i]!) > 1e-9) return false;
  return true;
}
