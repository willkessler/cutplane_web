import * as THREE from 'three';

export type V3 = [number, number, number];

/** Where the camera's lens is and which way it looks (a unit vector), in the room. */
export interface Shot {
  eye: V3;
  dir: V3;
}

/** How long the fly-over takes from one shot to the next, unless set otherwise. */
export const SECONDS_PER_SHOT = 3;

/** The whole fly-over's length: nothing to fly with fewer than two shots. */
export const flyoverSeconds = (shots: readonly Shot[], perShot = SECONDS_PER_SHOT): number =>
  shots.length < 2 ? 0 : (shots.length - 1) * perShot;

/** Eases in and out, so the fly-over starts and stops gently. */
const ease = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;

const vec = (v: V3) => new THREE.Vector3(...v);

/**
 * The fly-over through `shots`: a smooth curve through every lens position, travelled
 * at an even speed (easing in and out at the ends), the lens turning smoothly from
 * each shot's direction to the next. Not part of the 1991 original, whose camera
 * only showed one view.
 */
export class Flyover {
  private readonly path?: THREE.CatmullRomCurve3;
  private readonly look?: THREE.CatmullRomCurve3;

  constructor(
    readonly shots: readonly Shot[],
    readonly perShot = SECONDS_PER_SHOT,
  ) {
    if (shots.length < 2) return;
    this.path = new THREE.CatmullRomCurve3(
      shots.map((s) => vec(s.eye)),
      false,
      'centripetal',
    );
    this.look = new THREE.CatmullRomCurve3(
      shots.map((s) => vec(s.dir)),
      false,
      'catmullrom',
    );
  }

  get seconds(): number {
    return flyoverSeconds(this.shots, this.perShot);
  }

  /** The lens `t` seconds into the fly-over (held at the ends). */
  at(t: number): Shot | null {
    const first = this.shots[0];
    if (!first) return null;
    if (!this.path || !this.look) return first;
    const u = ease(Math.min(1, Math.max(0, t / this.seconds)));
    const p = this.path.getPointAt(u);
    // The same place along the curve, in the curve's own parameter, for the direction.
    const d = this.look.getPoint(this.path.getUtoTmapping(u, 0)).normalize();
    return { eye: [p.x, p.y, p.z], dir: [d.x, d.y, d.z] };
  }

  /** Points along the path for drawing it, `perLeg` to each leg. */
  points(perLeg = 24): V3[] {
    if (!this.path) return this.shots.map((s) => s.eye);
    return this.path.getPoints((this.shots.length - 1) * perLeg).map((p) => [p.x, p.y, p.z]);
  }
}
