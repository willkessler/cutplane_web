import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ROOM, subtree, type CutObject, type Mat4 } from '@cutplane/kernel';
import { P } from '@cutplane/cpl';
import type { Runtime } from '@cutplane/behaviors';

/**
 * The globe's gravity: objects fall as solids would, tumbling, bouncing a
 * little and coming to rest on the room's floor or on whatever is under them.
 * Each falling group is one rigid body made of a convex hull per part (what a
 * solid lying on something can touch it with), in Rapier (a physics engine,
 * compiled to WebAssembly). The other objects in the world stand still, solid
 * as they are drawn (their triangles), so things dropped on them stack. Only
 * the floor of the room is solid: what is bigger than the room is too. The
 * whole fall is worked out first, then played back in time; only where it ends
 * is an edit (one undo).
 */

/** Room units a second squared: a fall across the room's height takes about seven tenths of a second. */
export const GRAVITY = 1600;
/** Frames a second, of the fall as played back. */
const FPS = 60;
/** Physics steps a frame. */
const SUBSTEPS = 2;
/** The longest a fall is followed for (seconds). */
const LONGEST = 8;
/** At rest: slower than this (room units a second, and radians a second) for REST_FRAMES. */
const STILL_SPEED = 3;
const STILL_SPIN = 0.05;
const REST_FRAMES = 15;
/** How lively a landing is (a little bounce), how things grip the floor, and how a spin dies away. */
const BOUNCE = 0.1;
const GRIP = 0.9;
const SPIN_DAMPING = 8;
/** The most points a hull is made from (a bigger part's are sampled evenly). */
const HULL_POINTS = 60_000;

let rapier: Promise<typeof RAPIER> | null = null;

/** Rapier, loaded the first time something falls (4 MB, 1.6 MB as sent: its own chunk). */
export function loadRapier(): Promise<typeof RAPIER> {
  return (rapier ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    await m.default.init();
    return m.default;
  }));
}

/** A body to drop: each part's world points (x y z …). */
export interface Dropped {
  parts: Float32Array[];
}

/** Each body's placement, frame by frame: world → world (row vectors), 16 numbers a frame. */
export interface Fall {
  frames: number;
  poses: Float64Array[];
}

/** Where a body's frame `i` puts it. */
export function poseAt(fall: Fall, body: number, i: number): Mat4 {
  const k = Math.min(fall.frames - 1, Math.max(0, i)) * 16;
  return fall.poses[body]!.slice(k, k + 16);
}

/** The world-space box of some points. */
function bounds(parts: Float32Array[]): [number[], number[]] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, p[i + k]!);
        hi[k] = Math.max(hi[k]!, p[i + k]!);
      }
  return [lo, hi];
}

/**
 * The fall of every body together (they can land on each other), until all are at
 * rest. `obstacles`: what stays put, each as triangles (x y z × 3 a triangle).
 */
export async function simulate(bodies: Dropped[], obstacles: Float32Array[] = []): Promise<Fall> {
  const R = await loadRapier();
  const world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
  try {
    // A typical object is about a hundred room units across: Rapier's tolerances scale with it.
    world.lengthUnit = 100;
    world.timestep = 1 / (FPS * SUBSTEPS);
    // The floor, as a slab under it, out past the room's walls (things can be bigger than the room).
    const T = 200;
    const FLOOR = ROOM.min[1];
    world.createCollider(
      R.ColliderDesc.cuboid(1e5, T, 1e5)
        .setTranslation(0, FLOOR - T, 0)
        .setFriction(GRIP)
        .setRestitution(BOUNCE),
    );
    // Everything else, where it stands.
    for (const tris of obstacles) {
      if (tris.length < 9) continue;
      const index = Uint32Array.from({ length: tris.length / 3 }, (_, i) => i);
      try {
        world.createCollider(
          R.ColliderDesc.trimesh(tris, index).setFriction(GRIP).setRestitution(BOUNCE),
        );
      } catch {
        // (A shape Rapier can't take is left out.)
      }
    }

    const rigid = bodies.map((b) => {
      // Anything through the floor is brought up onto it first.
      const [blo] = bounds(b.parts);
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(0, Math.max(0, FLOOR - blo[1]!), 0)
          .setCcdEnabled(true)
          .setLinearDamping(0.05)
          .setAngularDamping(SPIN_DAMPING),
      );
      // (A hull needs four points: fewer is a group's placeholder, not a part.)
      for (const part of b.parts.filter((p) => p.length >= 12)) {
        const make = (desc: RAPIER.ColliderDesc | null) =>
          desc && world.createCollider(desc.setDensity(1).setFriction(GRIP).setRestitution(BOUNCE), body); // prettier-ignore
        // A part with no hull (flat: all its points in a plane) is a thin box round it.
        // (Rapier only finds that out on making it.)
        try {
          make(R.ColliderDesc.convexHull(sampled(part)) ?? slab(R, part));
        } catch {
          make(slab(R, part));
        }
      }
      return body;
    });

    const most = LONGEST * FPS;
    const poses = rigid.map(() => new Float64Array(16 * most));
    const m = new THREE.Matrix4();
    const t = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    let frames = 0;
    let still = 0;
    while (frames < most) {
      rigid.forEach((body, i) => {
        const p = body.translation();
        const r = body.rotation();
        // three.js keeps a matrix by columns: read out in order, that is the row-vector matrix.
        m.compose(t.set(p.x, p.y, p.z), q.set(r.x, r.y, r.z, r.w), one);
        poses[i]!.set(m.elements, frames * 16);
      });
      frames++;
      const resting = rigid.every((body) => {
        if (body.isSleeping()) return true;
        const v = body.linvel();
        const w = body.angvel();
        return Math.hypot(v.x, v.y, v.z) < STILL_SPEED && Math.hypot(w.x, w.y, w.z) < STILL_SPIN;
      });
      still = resting ? still + 1 : 0;
      if (still >= REST_FRAMES && frames > REST_FRAMES) break;
      for (let s = 0; s < SUBSTEPS; s++) world.step();
    }
    return { frames, poses: poses.map((p) => p.slice(0, frames * 16)) };
  } finally {
    world.free();
  }
}

/** A part's points, at most HULL_POINTS of them. */
function sampled(part: Float32Array): Float32Array {
  const n = part.length / 3;
  if (n <= HULL_POINTS) return part;
  const out = new Float32Array(HULL_POINTS * 3);
  for (let i = 0; i < HULL_POINTS; i++) {
    const j = Math.floor((i * n) / HULL_POINTS) * 3;
    out.set(part.subarray(j, j + 3), i * 3);
  }
  return out;
}

/** A flat part (no hull: a lamina) as a thin box round it. */
function slab(R: typeof RAPIER, part: Float32Array): RAPIER.ColliderDesc | null {
  if (part.length < 3) return null;
  const [lo, hi] = bounds([part]);
  const h = [0, 1, 2].map((k) => Math.max(0.5, (hi[k]! - lo[k]!) / 2));
  return R.ColliderDesc.cuboid(h[0]!, h[1]!, h[2]!).setTranslation(
    (lo[0]! + hi[0]!) / 2,
    (lo[1]! + hi[1]!) / 2,
    (lo[2]! + hi[2]!) / 2,
  );
}

/** Where falling objects are drawn while they fall (the models' view). */
export interface Poser {
  pose(o: CutObject, m: THREE.Matrix4 | null): void;
  /** An object's triangles in the world, as drawn (x y z × 3 a triangle), if it's drawn. */
  triangles(o: CutObject): Float32Array | null;
}

interface Falling {
  root: CutObject;
  objects: CutObject[];
  /** The root's placement as the fall began: anything else moving it (an undo) stops the fall. */
  start: Mat4;
  /** Those put out of reach for the fall (not any that already were). */
  held: CutObject[];
  fall: Fall;
  body: number;
  began: number;
}

/**
 * The falls under way. A falling object is drawn where the fall has it (its
 * placement in the world stays as it was, so nothing else is recomputed each
 * frame), can't be picked, and comes to rest as one edit.
 */
export class Falls {
  private falling: Falling[] = [];
  /** Those whose fall is being worked out. */
  private readonly starting = new Set<CutObject>();
  private readonly matrix = new THREE.Matrix4();
  /** Where each falling object has got to: world → world from where the world has it. */
  private readonly poses = new Map<CutObject, Mat4>();

  constructor(
    private readonly rt: Runtime,
    private readonly view: Poser,
  ) {}

  /** Is anything falling (drawn where its fall has got to)? */
  get active(): boolean {
    return this.falling.length > 0;
  }

  /** Is anything falling, or about to? */
  get busy(): boolean {
    return this.active || this.starting.size > 0;
  }

  /** How far a falling object has moved from where the world has it (world → world). */
  poseOf(o: CutObject): Mat4 | undefined {
    return this.poses.get(o);
  }

  /** Is `o` (or its group) falling, or about to? */
  has(o: CutObject): boolean {
    return this.starting.has(o) || this.falling.some((f) => f.objects.includes(o));
  }

  /** Each group root (and its parts) falls, all together. */
  async drop(roots: CutObject[], now: () => number = () => performance.now()): Promise<void> {
    const rt = this.rt;
    const fresh = roots.filter((r) => !this.has(r));
    if (fresh.length === 0) return;
    const groups = fresh.map((root) => ({
      root,
      objects: [...subtree(root)],
      start: root.xform,
      held: [] as CutObject[],
    }));
    const solid = (o: CutObject) =>
      o.brep.numFaces > 0 && rt.vm.props.has(o, P.Visible) && !rt.hasProp(o, 'Grouper');
    const bodies: Dropped[] = groups.map((g) => ({
      parts: g.objects.filter(solid).map((o) => {
        const w = rt.world(o);
        const vs = o.brep.vertices();
        const pts = new Float32Array(vs.length * 3);
        vs.forEach((v, i) => pts.set([w.x(v), w.y(v), w.z(v)], i * 3));
        return pts;
      }),
    }));
    // What they can land on: the world's other objects under where they fall (as far
    // round as the biggest of them is across, for one tumbling off an edge).
    const [lo, hi] = bounds(bodies.flatMap((b) => b.parts));
    const reach = Math.max(...bodies.map((b) => {
      const [a, z] = bounds(b.parts);
      return Math.max(z[0]! - a[0]!, z[2]! - a[2]!);
    })); // prettier-ignore
    const dropping = new Set(groups.flatMap((g) => g.objects));
    const obstacles: Float32Array[] = [];
    for (const o of subtree(rt.primary.root)) {
      if (dropping.has(o) || this.has(o) || !solid(o)) continue;
      const tris = this.view.triangles(o);
      if (!tris) continue;
      const [a, z] = bounds([tris]);
      const under =
        z[0]! >= lo[0]! - reach && a[0]! <= hi[0]! + reach &&
        z[2]! >= lo[2]! - reach && a[2]! <= hi[2]! + reach &&
        a[1]! <= hi[1]!; // prettier-ignore
      if (under) obstacles.push(tris);
    }
    // While it falls it is neither picked nor pickable (it isn't where the world has it).
    for (const g of groups)
      for (const o of g.objects) {
        rt.unpickNow(o); // out of its scale box too, or the next click picks the box
        if (rt.outOfReach.has(o)) continue;
        rt.outOfReach.add(o);
        g.held.push(o);
      }
    for (const o of dropping) this.starting.add(o);
    let fall: Fall;
    try {
      fall = await simulate(bodies, obstacles);
    } catch (e) {
      for (const g of groups) this.release(g.held);
      throw e;
    } finally {
      for (const o of dropping) this.starting.delete(o);
    }
    const began = now();
    groups.forEach((g, body) => {
      // Moved meanwhile (an undo while Rapier loaded): it doesn't fall.
      if (g.root.xform !== g.start) this.release(g.held);
      else this.falling.push({ ...g, fall, body, began });
    });
  }

  /** Each frame: every falling object drawn where its fall has got to; those at rest land. */
  tick(now: number = performance.now()): void {
    this.poses.clear();
    if (this.falling.length === 0) return;
    const inWorld = new Set(subtree(this.rt.primary.root));
    this.falling = this.falling.filter((f) => {
      // Something else moved it (an undo, a new world): the fall is called off.
      if (f.root.xform !== f.start || !inWorld.has(f.root)) {
        for (const o of f.objects) this.view.pose(o, null);
        this.release(f.held);
        return false;
      }
      const i = Math.floor(((now - f.began) / 1000) * FPS);
      const done = i >= f.fall.frames - 1;
      const pose = poseAt(f.fall, f.body, i);
      if (done) {
        for (const o of f.objects) this.view.pose(o, null);
        this.release(f.held);
        this.rt.transformBranch(f.root, pose);
        // Closed now, as its own edit: an undo pressed before the next frame takes the fall back.
        this.rt.commit();
        return false;
      }
      this.matrix.fromArray(pose);
      for (const o of f.objects) {
        this.view.pose(o, this.matrix);
        this.poses.set(o, pose);
      }
      return true;
    });
  }

  private release(objects: CutObject[]): void {
    for (const o of objects) this.rt.outOfReach.delete(o);
  }
}
