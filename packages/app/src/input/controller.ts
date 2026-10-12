import { PlaneSnapper, ROOM } from '@cutplane/kernel';
import { motionFor, type Command, type Held, type Motion, type Profile } from './bindings.ts';

/** user.h's room rotation limits, in degrees (the original kept tenths). */
export const YAW_LIMIT = 90;
export const PITCH_MIN = 0;
export const PITCH_MAX = 90;
/** Degrees of room rotation per pixel of pointer motion. */
export const ROTATE_PER_PX = 0.25;
/** Room units of plane depth per pixel of wheel/scroll delta. */
export const PLANE_PER_WHEEL = 0.5;
/** Arrow keys rotate the room in 10° steps. */
export const KEY_STEP = 10;
/** Ctrl (Constrain) slows everything down for fine work and turns plane stops off. */
export const CONSTRAIN_SLOW = 0.25;

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
  /** Where the plane was before a plane jump, so the next jump returns it. */
  private jumpedFrom: number | undefined;

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
      case 'point':
        this.setCursor(this.x + dx * unitsPerPx * slow, this.y - dy * unitsPerPx * slow);
        break;
      case 'plane':
        // Pushing away (up the screen) sends the plane deeper into the room.
        this.pushPlane(dy * unitsPerPx * slow);
        break;
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
        break; // handled by the app
    }
  }
}
