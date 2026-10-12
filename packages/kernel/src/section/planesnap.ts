import { ROOM } from '../room.ts';

/** Depths closer than this collapse into one stop (user.c's sort_into_nearpts). */
export const DEPTH_MERGE = 0.5;
/** How far the plane must be pushed before it comes unstuck (user.c's Freedomforplane). */
export const PLANE_FREEDOM = 5;

/**
 * Moves the cutplane in depth, "clicking" onto vertex depths as it passes
 * them, as the original's do_sticking does: when a move would carry the
 * plane past a vertex depth, it stops there and stays put until it has
 * been pushed PLANE_FREEDOM units further. Parking the plane exactly on a
 * vertex depth is what makes faces and edges lie in the plane.
 */
export class PlaneSnapper {
  private depths: Float64Array = new Float64Array(0);
  private stuck = false;
  private push = 0;
  z: number;

  constructor(z = ROOM.max[2]) {
    this.z = z;
  }

  /** Replaces the depth stops; values outside the room are ignored. */
  setDepths(zs: Iterable<number>): void {
    const sorted = [...zs]
      .filter((z) => z >= ROOM.min[2] && z <= ROOM.max[2])
      .sort((a, b) => a - b);
    const kept: number[] = [];
    for (const z of sorted) if (kept.length === 0 || z - kept.at(-1)! >= DEPTH_MERGE) kept.push(z);
    this.depths = Float64Array.from(kept);
  }

  get stops(): Float64Array {
    return this.depths;
  }

  get isStuck(): boolean {
    return this.stuck;
  }

  /** Jumps without snapping (plane jump, programmatic moves). */
  set(z: number): void {
    this.z = clampZ(z);
    this.stuck = false;
  }

  /** Applies a depth change `dz`, honouring stops unless `free` (the Constrain key turns them off). */
  move(dz: number, free = false): number {
    if (dz === 0) return this.z;
    if (this.stuck && !free) {
      this.push += Math.abs(dz);
      if (this.push <= PLANE_FREEDOM) return this.z;
      this.stuck = false;
    }
    const from = this.z;
    const to = clampZ(from + dz);
    const stop = free ? undefined : this.firstStopBetween(from, to);
    if (stop !== undefined) {
      this.z = stop;
      this.stuck = true;
      this.push = 0;
    } else this.z = to;
    return this.z;
  }

  /** The first stop strictly past `from`, up to and including `to`, in the direction of travel. */
  private firstStopBetween(from: number, to: number): number | undefined {
    const d = this.depths;
    if (to > from) {
      let lo = 0;
      let hi = d.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (d[mid]! <= from) lo = mid + 1;
        else hi = mid;
      }
      return lo < d.length && d[lo]! <= to ? d[lo] : undefined;
    }
    let lo = 0;
    let hi = d.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (d[mid]! < from) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && d[lo - 1]! >= to ? d[lo - 1] : undefined;
  }
}

function clampZ(z: number): number {
  return Math.min(ROOM.max[2], Math.max(ROOM.min[2], z));
}
