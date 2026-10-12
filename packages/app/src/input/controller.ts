import { PlaneSnapper, ROOM } from '@cutplane/kernel';
import { motionFor, type Command, type Held, type Motion, type Profile } from './bindings.ts';

/** user.h's room rotation limits, in degrees (the original kept tenths). */
export const YAW_LIMIT = 90;
export const PITCH_MIN = 0;
export const PITCH_MAX = 90;
/** Degrees of room rotation per pixel of pointer motion. */
export const ROTATE_PER_PX = 0.25;
/** Plane drags move the plane this much faster than the crosshair moves for the same motion. */
export const PLANE_GAIN = 1.5;
/**
 * Plane drags are read along the screen direction the plane moves in as it goes deeper,
 * plus this much "up the screen", so that looking straight into the room (where depth
 * has no screen direction) pushing up still means deeper, and the axis turns smoothly.
 */
export const PLANE_UP_BIAS = 0.3;
/** Room units of plane depth per pixel of wheel/scroll delta. */
export const PLANE_PER_WHEEL = 0.5;
/** Arrow keys rotate the room in 10° steps. */
export const KEY_STEP = 10;
/** Ctrl (Constrain) slows the plane and the room down for fine work and turns plane stops off. */
export const CONSTRAIN_SLOW = 0.25;
/**
 * Ctrl also locks the crosshair to one axis (update.c's constrain_movecrosshair): it holds
 * still until it has been pushed this far (Pkboxsize / 2), then follows only along the
 * axis it was pushed along most.
 */
export const CONSTRAIN_DECIDE = 5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The cutplane state the user steers: the crosshair (always in the plane),
 * the plane's depth, and the room's rotation. Inputs arrive as logical
 * motion; `unitsPerPx` converts screen pixels to room units at the plane.
 */
export class Controller {
  x = 0;
  y = 0;
  readonly plane = new PlaneSnapper(ROOM.max[2]);
  yaw = 0;
  pitch = 0;
  profile: Profile;
  held: Held;
  /**
   * Where a point moving deeper into the room goes on screen, as (right, up) with length
   * at most 1 (the room's -z axis seen by the camera; see scene.ts deeperOnScreen). The
   * app keeps it current as the room turns: with the room turned 90°, the plane goes
   * deeper as you move right, not up.
   */
  planeAxis: readonly [number, number] = [0, 0];
  /** Where the plane was before a plane jump, so the next jump returns it. */
  private jumpedFrom: number | undefined;
  /** Where the crosshair would be without Ctrl's axis lock. */
  private free: [number, number] | undefined;
  private anchor: [number, number] | undefined;
  private axis: 'x' | 'y' | undefined;

  constructor(profile: Profile, held: Held) {
    this.profile = profile;
    this.held = held;
  }

  get z(): number {
    return this.plane.z;
  }

  get motion(): Motion {
    return motionFor(this.profile, this.held);
  }

  /** Relative pointer motion (pointer-locked, or during a quasimode in windowed mode). */
  move(dx: number, dy: number, unitsPerPx: number): void {
    const slow = this.held.ctrl ? CONSTRAIN_SLOW : 1;
    switch (this.motion) {
      case 'point': {
        // Released Ctrl continues from where the crosshair is, not from where it would have been.
        const [fx, fy] = (this.held.ctrl && this.free) || [this.x, this.y];
        this.pointTo(fx + dx * unitsPerPx, fy - dy * unitsPerPx);
        break;
      }
      case 'plane': {
        // Drag the plane the way it visibly travels: along its on-screen depth direction.
        const ax = this.planeAxis[0];
        const ay = this.planeAxis[1] + PLANE_UP_BIAS;
        const len = Math.hypot(ax, ay);
        const deeper = (dx * ax - dy * ay) / len;
        this.pushPlane(-deeper * unitsPerPx * PLANE_GAIN * slow);
        break;
      }
      case 'rotate':
        // Drag the room around: rightward turns its front to the right, downward tips its top toward you.
        this.rotate(-dx * ROTATE_PER_PX * slow, dy * ROTATE_PER_PX * slow);
        break;
    }
  }

  /** Scroll / wheel: plane depth in every profile. Fingers or wheel pushed away go deeper. */
  wheel(deltaY: number): void {
    this.pushPlane(-deltaY * PLANE_PER_WHEEL * (this.held.ctrl ? CONSTRAIN_SLOW : 1));
  }

  pushPlane(dz: number): void {
    this.plane.move(dz, this.held.ctrl);
    this.jumpedFrom = undefined;
  }

  /**
   * Moves the crosshair toward (x, y), as far as Ctrl's axis lock allows. Windowed mode
   * calls this with the point under the pointer; pointer-locked motion adds up deltas.
   */
  pointTo(x: number, y: number): void {
    if (!this.held.ctrl) {
      this.free = this.anchor = this.axis = undefined;
      this.setCursor(x, y);
      return;
    }
    this.free = [x, y];
    this.anchor ??= [this.x, this.y];
    const dx = x - this.anchor[0];
    const dy = y - this.anchor[1];
    if (!this.axis && Math.max(Math.abs(dx), Math.abs(dy)) > CONSTRAIN_DECIDE)
      this.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (this.axis === 'x') this.setCursor(x, this.anchor[1]);
    else if (this.axis === 'y') this.setCursor(this.anchor[0], y);
  }

  /** Starts Ctrl's axis detection afresh from here (each press of the Pick button does). */
  resetConstrain(): void {
    this.free = this.anchor = this.axis = undefined;
  }

  setCursor(x: number, y: number): void {
    this.x = clamp(x, ROOM.min[0], ROOM.max[0]);
    this.y = clamp(y, ROOM.min[1], ROOM.max[1]);
  }

  rotate(dYaw: number, dPitch: number): void {
    this.yaw = clamp(this.yaw + dYaw, -YAW_LIMIT, YAW_LIMIT);
    this.pitch = clamp(this.pitch + dPitch, PITCH_MIN, PITCH_MAX);
  }

  command(c: Command): void {
    switch (c) {
      case 'planeJump':
        // controls.c: to the back wall, and back again.
        if (this.jumpedFrom === undefined) {
          const from = this.plane.z;
          this.plane.set(ROOM.min[2]);
          this.jumpedFrom = from;
        } else {
          this.plane.set(this.jumpedFrom);
          this.jumpedFrom = undefined;
        }
        break;
      case 'rotateLeft':
        this.rotate(KEY_STEP, 0);
        break;
      case 'rotateRight':
        this.rotate(-KEY_STEP, 0);
        break;
      case 'rotateUp':
        this.rotate(0, KEY_STEP);
        break;
      case 'rotateDown':
        this.rotate(0, -KEY_STEP);
        break;
      case 'resetView':
        this.yaw = 0;
        this.pitch = 0;
        break;
      case 'workMode':
      case 'undo':
      case 'redo':
        break; // handled by the app
    }
  }
}
