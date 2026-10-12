import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOM, createCube, createObject, mat4 } from '@cutplane/kernel';
import { Controls, Runtime, type Stage, type V3 } from '../src/index.ts';

const CPL = resolve(import.meta.dirname, '../../../assets/original/cpl');
export const source = (f: string) => readFileSync(join(CPL, f), 'latin1');

/** A stage that just clamps to the room (no plane stops). */
export class TestStage implements Stage {
  x = 0;
  y = 0;
  z = ROOM.max[2];
  yaw = 0;
  pitch = 0;
  preview(dx: number, dy: number, dz: number): V3 {
    const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    return [
      c(this.x + dx, ROOM.min[0], ROOM.max[0]) - this.x,
      c(this.y + dy, ROOM.min[1], ROOM.max[1]) - this.y,
      c(this.z + dz, ROOM.min[2], ROOM.max[2]) - this.z,
    ];
  }
  moveCrosshair(dx: number, dy: number, dz: number): V3 {
    const d = this.preview(dx, dy, dz);
    this.x += d[0];
    this.y += d[1];
    this.z += d[2];
    return d;
  }
  rotateRoom(dx: number, dy: number): void {
    this.pitch += dx / 10;
    this.yaw += dy / 10;
  }
}

/** A runtime with ROM and the property files, and a 200-unit cube at the room's centre. */
export function world() {
  const stage = new TestStage();
  const rt = new Runtime({ stage, source });
  rt.loadCode(source);
  const cube = createObject(createCube(200, 200, 200), {
    name: 'Cube',
    xform: mat4.translation(-100, -100, -100),
  });
  cube.attrs.props = ['Visible'];
  rt.importObjects(rt.primary, [cube]);
  const controls = new Controls(rt);
  const frame = () => controls.frame();
  /** Moves the crosshair as the app would (through CPL), then runs a frame. */
  const move = (dx: number, dy: number, dz = 0) => {
    controls.moveCrosshair([dx, dy, dz], (d) => stage.preview(...d));
    frame();
  };
  const at = (x: number, y: number, z = stage.z) => {
    controls.moveCrosshair([x - stage.x, y - stage.y, z - stage.z], (d) => stage.preview(...d));
    frame();
  };
  return { rt, stage, cube, controls, frame, move, at };
}
