import { ROOM } from '@cutplane/kernel';
import type { Stage, V3 } from '@cutplane/behaviors';
import type { Controller } from '../input/controller.ts';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Where the crosshair and plane really are: what CPL moved them to. The
 * Controller holds where the user is steering them; each frame the
 * difference goes to CPL as a crosshair TRANS (controls.c), which the
 * world's code may pass on, change (a tool holding the crosshair to a bar)
 * or wipe, and what survives moves the stage.
 */
export class AppStage implements Stage {
  x = 0;
  y = 0;
  z = ROOM.max[2];

  constructor(private readonly control: Controller) {}

  /** How far a move would really go: the room's walls stop it. */
  preview(dx: number, dy: number, dz: number): V3 {
    return [
      clamp(this.x + dx, ROOM.min[0], ROOM.max[0]) - this.x,
      clamp(this.y + dy, ROOM.min[1], ROOM.max[1]) - this.y,
      clamp(this.z + dz, ROOM.min[2], ROOM.max[2]) - this.z,
    ];
  }

  moveCrosshair(dx: number, dy: number, dz: number): V3 {
    const d = this.preview(dx, dy, dz);
    this.x += d[0];
    this.y += d[1];
    this.z += d[2];
    return d;
  }

  /** ROTATE Env:Room_part, in tenths of a degree (pitch, yaw as store_roomrot packs them). */
  rotateRoom(dx: number, dy: number): void {
    this.control.rotate(dy / 10, dx / 10);
  }
}
