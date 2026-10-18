import { ROOM } from '../room.ts';

/** Depths closer than this collapse into one stop (user.c's sort_into_nearpts). */
export const DEPTH_MERGE = 0.5;
/** Moves bigger than this fly past stops (user.h's Minplanesnapdist). */
export const MIN_SNAP_MOVE = 7;
/** user.c's Freedomforplane: how far the plane is pushed before it comes off a sticky stop. */
export const FREEDOM_FOR_PLANE = 5;

/**
 * Moves the cutplane in depth, "clicking" onto vertex depths as it passes
 * them, as the original's snap_plane_to_nearestpt does: a slow move (at
 * most MIN_SNAP_MOVE) that would carry the plane past a vertex depth lands
 * exactly on it instead; the next move carries on from there. Fast moves
 * pass straight through, so the plane flies through a dense model and only
 * clicks into place as you slow down. Parking the plane exactly on a vertex
 * depth is what makes faces and edges lie in the plane.
 *
 * Sticky stops (user.c's do_sticking, which nothing in the original called; new
 * here): the depths of faces parallel to the plane also hold the plane once it
 * lands on one, until it has been pushed `stick` units further (either way), so
 * the plane seems to stick to the face for a moment and the face is easy to take.
 * They catch moves of up to `stick` too, not just slow ones.
 */
export class PlaneSnapper {
  private depths: Float64Array = new Float64Array(0);
  private sticky: Float64Array = new Float64Array(0);
  private snapped = false;
  /** How far the plane has been pushed while stuck (undefined: not stuck). */
  private pushed: number | undefined;
  /** How far a sticky stop holds the plane (0: sticky stops are plain stops). */
  stick = 0;
  z: number;

  constructor(z = ROOM.max[2]) {
    this.z = z;
  }

  /** Replaces the depth stops; values outside the room are ignored. */
  setDepths(zs: Iterable<number>): void {
    this.depths = merged(zs);
  }

  /** Replaces the sticky stops: the depths of faces parallel to the plane. */
  setStickyDepths(zs: Iterable<number>): void {
    this.sticky = merged(zs);
    if (this.pushed !== undefined && !this.isSticky(this.z)) this.pushed = undefined;
  }

  get stickyStops(): Float64Array {
    return this.sticky;
  }

  /** True while the plane is held on a sticky stop. */
  get isStuck(): boolean {
    return this.pushed !== undefined;
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
    this.pushed = undefined;
  }

  /** Applies a depth change `dz`, honouring stops unless `free` (the Constrain key turns them off). */
  move(dz: number, free = false): number {
    if (dz === 0) return this.z;
    if (free) this.pushed = undefined;
    if (this.pushed !== undefined) {
      this.pushed += Math.abs(dz);
      if (this.pushed <= this.stick) return this.z; // stuck: no move in depth
      // Pushed free: the plane goes on by what was pushed past the hold.
      dz = Math.sign(dz) * (this.pushed - this.stick);
      this.pushed = undefined;
    }
    const from = this.z;
    const to = clampZ(from + dz);
    const plain = free || Math.abs(dz) > MIN_SNAP_MOVE ? undefined : firstStopBetween(this.depths, from, to); // prettier-ignore
    const sticky = free || this.stick <= 0 || Math.abs(dz) > Math.max(this.stick, MIN_SNAP_MOVE) ? undefined : firstStopBetween(this.sticky, from, to); // prettier-ignore
    // The nearer of the two, in the direction of travel.
    const stop =
      plain === undefined ? sticky
      : sticky === undefined ? plain
      : Math.abs(sticky - from) <= Math.abs(plain - from) ? sticky
      : plain; // prettier-ignore
    this.snapped = stop !== undefined;
    this.z = stop ?? to;
    if (stop !== undefined && stop === sticky && this.stick > 0) this.pushed = 0;
    return this.z;
  }

  private isSticky(z: number): boolean {
    return this.sticky.some((s) => Math.abs(s - z) < DEPTH_MERGE);
  }
}

function merged(zs: Iterable<number>): Float64Array {
  const sorted = Float64Array.from(zs).sort(); // a typed array sorts by value, quickly
  const kept: number[] = [];
  for (const z of sorted) {
    if (!(z >= ROOM.min[2] && z <= ROOM.max[2])) continue;
    if (kept.length === 0 || z - kept.at(-1)! >= DEPTH_MERGE) kept.push(z);
  }
  return Float64Array.from(kept);
}

/** The first of the sorted depths `d` strictly past `from`, up to and including `to`, in the direction of travel. */
function firstStopBetween(d: Float64Array, from: number, to: number): number | undefined {
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

function clampZ(z: number): number {
  return Math.min(ROOM.max[2], Math.max(ROOM.min[2], z));
}
