import type RAPIER from '@dimforge/rapier3d-compat';
import { subtree, type CutObject, type Mat4 } from '@cutplane/kernel';
import { P } from '@cutplane/cpl';
import type { Runtime, V3 } from '@cutplane/behaviors';
import { loadRapier, type Poser } from './gravity.ts';

/**
 * New here: the magnet's push-back. An object dragged with the magnet is solid:
 * it can't go into another, but stops where they touch (and slides along it, as
 * far as the drag goes that way), so two objects are slapped together quickly.
 * What it hits is as drawn (its triangles); what moves is a convex hull per part,
 * cast along each step of the drag (Rapier's shape casts).
 */

/** How close it comes (room units): touching, as near as the eye can tell. */
const GAP = 0.05;
/** How many times one step of the drag may slide off something it meets. */
const SLIDES = 4;

interface Session {
  root: CutObject;
  world: RAPIER.World;
  /** The dragged group's parts, as hulls placed where they were when the drag began. */
  shapes: RAPIER.Shape[];
  /** The root's placement then. */
  from: Mat4;
}

export class Blocker {
  private R: typeof RAPIER | null = null;
  private loading = false;
  private session: Session | null = null;

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
      const rest = scale(left, 1 - t);
      const into = dot(rest, hit.normal);
      left = into < 0 ? sub(rest, scale(hit.normal, into)) : rest;
    }
    return sub(pos, at);
  };

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
    for (const o of subtree(rt.primary.root)) {
      if (moving.has(o) || !solid(o) || !this.view.shows(o)) continue;
      const tris = this.view.triangles(o);
      if (!tris || tris.length < 9) continue;
      const index = Uint32Array.from({ length: tris.length / 3 }, (_, i) => i);
      try {
        world.createCollider(R.ColliderDesc.trimesh(tris, index));
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
    return { root, world, shapes, from: Float64Array.from(root.xform) };
  }

  /**
   * The first thing the parts hit moving from `at` by `d`: how far along (0..1), and
   * the normal there, turned against the move. Touching something already and moving
   * along it (or away) hits nothing.
   */
  private cast(s: Session, at: V3, d: V3): { t: number; normal: V3 } | null {
    let best: { t: number; normal: V3 } | null = null;
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
      best = { t: Math.max(0, hit.time_of_impact), normal: n };
    }
    return best;
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

/** Does `now` differ from `then` by a move alone? */
function onlyMoved(then: Mat4, now: Mat4): boolean {
  for (let i = 0; i < 12; i++) if (Math.abs(then[i]! - now[i]!) > 1e-9) return false;
  return true;
}
