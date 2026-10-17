import type RAPIER from '@dimforge/rapier3d-compat';
import { groupRoot, subtree, type CutObject, type Mat4 } from '@cutplane/kernel';
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
 * Taken by a face, it sticks by that face: what it meets, it turns to meet with
 * the face being dragged, flush (as the magnet's release snaps it), and slides on
 * stuck there; the release then leaves it there.
 */

/** How close it comes (room units): touching, as near as the eye can tell. */
const GAP = 0.05;
/** How many times one step of the drag may slide off something it meets. */
const SLIDES = 4;
/** Already flush: facing each other this nearly, this near (room units). */
const FACING = 0.9995;
const FLUSH = 0.5;

interface Session {
  root: CutObject;
  world: RAPIER.World;
  /** The dragged group's parts, as hulls placed where they were when the drag began. */
  shapes: RAPIER.Shape[];
  /** The root's placement then. */
  from: Mat4;
  /** What each collider is of. */
  owners: Map<number, CutObject>;
}

export class Blocker {
  private R: typeof RAPIER | null = null;
  private loading = false;
  private session: Session | null = null;
  /** The face the magnet took hold of, if it took a face. */
  private grabbed: Sub | null = null;
  /** The face the drag stuck it to (its release snaps there). */
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

  /** How far `root`'s group may move of the `d` asked for. */
  readonly guard = (root: CutObject, d: V3): V3 => {
    const R = this.R;
    if (!R) return d;
    let s = this.session;
    // A different object, or this one turned or scaled since (a snap): cast it afresh.
    if (s && (s.root !== root || !onlyMoved(s.from, root.xform))) {
      this.end();
      s = null;
    }
    s ??= this.session = this.begin(R, root);
    const at: V3 = [
      root.xform[12]! - s.from[12]!,
      root.xform[13]! - s.from[13]!,
      root.xform[14]! - s.from[14]!,
    ];
    // Cast, go as far as it can, and slide the rest along what it hit; again, as it
    // may meet something else (or an edge of the same) sliding.
    const pos: V3 = [...at];
    let left = d;
    for (let i = 0; i < SLIDES && Math.hypot(...left) > 1e-6; i++) {
      const hit = this.cast(s, pos, left);
      const t = hit ? hit.t : 1;
      for (let k = 0; k < 3; k++) pos[k]! += left[k]! * t;
      if (!hit) break;
      // Met by any face but the one dragged: it turns to meet with that one.
      if (this.stick(s, root, sub(pos, at), hit)) return [0, 0, 0];
      const rest = scale(left, 1 - t);
      const into = dot(rest, hit.normal);
      left = into < 0 ? sub(rest, scale(hit.normal, into)) : rest;
    }
    return sub(pos, at);
  };

  /**
   * The grabbed face, turned and moved flush against the face hit (the magnet's snap),
   * unless it is flush with it already. `moved`: how far the cast has come this step.
   */
  private stick(s: Session, root: CutObject, moved: V3, hit: Hit): boolean {
    const g = this.grabbed;
    const o = hit.owner;
    if (!g || !o || groupRoot(g.object) !== root) return false;
    const target = this.faceAt(o, hit.point, hit.normal);
    if (!target) return false;
    const rt = this.rt;
    const a = rt.worldFace(g.object, g.id);
    const b = rt.worldFace(o, target.id);
    if (!a || !b) return false;
    // (The cast has the faces where they would be `moved` on.)
    const gap = dot(sub(b.center, a.center), b.normal) - dot(moved, b.normal);
    if (dot(a.normal, b.normal) < -FACING && Math.abs(gap) < FLUSH) return false;
    rt.moveBranch(root, moved);
    this.stuck = null;
    rt.snapFeatures(g, target);
    this.stuck = target;
    return true;
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
    for (const o of moving) {
      if (!solid(o)) continue;
      const g = rt.world(o);
      const vs = o.brep.vertices();
      const pts = new Float32Array(vs.length * 3);
      vs.forEach((v, i) => pts.set([g.x(v), g.y(v), g.z(v)], i * 3));
      try {
        const hull = R.ColliderDesc.convexHull(pts);
        if (hull) shapes.push(hull.shape);
      } catch {
        // (Flat: nothing to hull.)
      }
    }
    world.step(); // (the colliders go into what the casts look through)
    return { root, world, shapes, from: Float64Array.from(root.xform), owners };
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

/** Does `now` differ from `then` by a move alone? */
function onlyMoved(then: Mat4, now: Mat4): boolean {
  for (let i = 0; i < 12; i++) if (Math.abs(then[i]! - now[i]!) > 1e-9) return false;
  return true;
}
