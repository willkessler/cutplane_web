import { ROOM } from '../room.ts';

/** Depths closer than this collapse into one stop (user.c's sort_into_nearpts). */
export const DEPTH_MERGE = 0.5;
/** Moves bigger than this fly past stops (user.h's Minplanesnapdist). */
export const MIN_SNAP_MOVE = 7;

/**
 * Moves the cutplane in depth, "clicking" onto vertex depths as it passes
 * them, as the original's snap_plane_to_nearestpt does: a slow move (at
 * most MIN_SNAP_MOVE) that would carry the plane past a vertex depth lands
 * exactly on it instead; the next move carries on from there. Fast moves
 * pass straight through, so the plane flies through a dense model and only
 * clicks into place as you slow down. Parking the plane exactly on a vertex
 * depth is what makes faces and edges lie in the plane.
 *
 * (user.c also has do_sticking, which held the plane on a stop until it was
 * pushed 5 units further, but nothing calls it.)
 */
export class PlaneSnapper {
  private depths: Float64Array = new Float64Array(0);
  private snapped = false;
  z: number;

  constructor(z = ROOM.max[2]) {
    this.z = z;
  }

  /** Replaces the depth stops; values outside the room are ignored. */
  setDepths(zs: Iterable<number>): void {
    const sorted = Float64Array.from(zs).sort(); // a typed array sorts by value, quickly
    const kept: number[] = [];
    for (const z of sorted) {
      if (!(z >= ROOM.min[2] && z <= ROOM.max[2])) continue;
      if (kept.length === 0 || z - kept.at(-1)! >= DEPTH_MERGE) kept.push(z);
    }
    this.depths = Float64Array.from(kept);
  }

  get stops(): Float64Array {
    return this.depths;
  }

  /** True when the last move landed on a stop. */
  get isSnapped(): boolean {
    return this.snapped;
  }

  /** Jumps without snapping (plane jump, programmatic moves). */
  set(z: number): void {
    this.z = clampZ(z);
    this.snapped = false;
  }

  /** Applies a depth change `dz`, honouring stops unless `free` (the Constrain key turns them off). */
  move(dz: number, free = false): number {
    if (dz === 0) return this.z;
    const from = this.z;
    const to = clampZ(from + dz);
    const stop = free || Math.abs(dz) > MIN_SNAP_MOVE ? undefined : this.firstStopBetween(from, to);
    this.snapped = stop !== undefined;
    this.z = stop ?? to;
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
