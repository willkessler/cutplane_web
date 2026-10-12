import { describe, expect, it } from 'vitest';
import { PLANE_FREEDOM, ROOM } from '@cutplane/kernel';
import {
  LEFT,
  MIDDLE,
  NOTHING_HELD,
  RIGHT,
  commandFor,
  defaultProfile,
  motionFor,
  type Held,
} from './bindings.ts';
import { Controller, KEY_STEP, PITCH_MAX, ROTATE_PER_PX, YAW_LIMIT } from './controller.ts';

const held = (h: Partial<Held> = {}): Held => ({ ...NOTHING_HELD, ...h });

describe('binding profiles', () => {
  it('trackpad: ⌥ pushes the plane, ⌘ rotates, no buttons needed', () => {
    expect(motionFor('trackpad', held())).toBe('point');
    expect(motionFor('trackpad', held({ alt: true }))).toBe('plane');
    expect(motionFor('trackpad', held({ meta: true }))).toBe('rotate');
    expect(motionFor('trackpad', held({ buttons: LEFT }))).toBe('point');
  });

  it('three-button: the SGI layout', () => {
    expect(motionFor('three-button', held({ buttons: MIDDLE }))).toBe('plane');
    expect(motionFor('three-button', held({ buttons: RIGHT }))).toBe('rotate');
    // Left + middle is the carry chord (M3), not a plane move.
    expect(motionFor('three-button', held({ buttons: LEFT | MIDDLE }))).toBe('point');
  });

  it('two-button: right-drag rotates, ⌥ pushes the plane', () => {
    expect(motionFor('two-button', held({ buttons: RIGHT }))).toBe('rotate');
    expect(motionFor('two-button', held({ alt: true }))).toBe('plane');
  });

  it('defaults to the trackpad profile on a Mac', () => {
    expect(defaultProfile('MacIntel')).toBe('trackpad');
    expect(defaultProfile('Win32')).toBe('two-button');
  });

  it('maps keys to commands and leaves ⌘ combinations to the browser', () => {
    expect(commandFor('Space', held())).toBe('planeJump');
    expect(commandFor('ArrowLeft', held())).toBe('rotateLeft');
    expect(commandFor('KeyW', held({ meta: true }))).toBeUndefined();
    expect(commandFor('Space', held({ meta: true }))).toBeUndefined();
  });
});

describe('Controller', () => {
  it('moves the crosshair in the plane, clamped to the room', () => {
    const h = held();
    const c = new Controller('trackpad', h);
    c.move(10, 20, 2);
    expect([c.x, c.y]).toEqual([20, -40]);
    c.move(10000, -10000, 1);
    expect([c.x, c.y]).toEqual([ROOM.max[0], ROOM.max[1]]);
  });

  it('pushes the plane with ⌥ + move: up the screen goes deeper', () => {
    const h = held({ alt: true });
    const c = new Controller('trackpad', h);
    c.move(0, -100, 1);
    expect(c.z).toBe(ROOM.max[2] - 100);
    expect(c.x).toBe(0);
  });

  it('stops the plane at vertex depths unless Constrain is held', () => {
    const h = held({ alt: true });
    const c = new Controller('trackpad', h);
    c.plane.setDepths([400]);
    c.move(0, -200, 1);
    expect(c.z).toBe(400);
    c.move(0, -PLANE_FREEDOM, 1);
    expect(c.z).toBe(400);
    h.ctrl = true;
    c.move(0, -40, 1); // slowed to a quarter, and free
    expect(c.z).toBe(390);
  });

  it('rotates the room with ⌘ + move inside the original limits', () => {
    const h = held({ meta: true });
    const c = new Controller('trackpad', h);
    c.move(-40, 40, 1);
    expect(c.yaw).toBeCloseTo(40 * ROTATE_PER_PX);
    expect(c.pitch).toBeCloseTo(40 * ROTATE_PER_PX);
    c.move(-1e6, -1e6, 1);
    expect([c.yaw, c.pitch]).toEqual([YAW_LIMIT, 0]);
    c.move(2e6, 2e6, 1);
    expect([c.yaw, c.pitch]).toEqual([-YAW_LIMIT, PITCH_MAX]);
  });

  it('wheel moves the plane in every profile', () => {
    const c = new Controller('three-button', held());
    c.wheel(100);
    expect(c.z).toBe(ROOM.max[2] - 50);
  });

  it('plane jump goes to the back wall and returns', () => {
    const c = new Controller('trackpad', held());
    c.plane.set(120);
    c.command('planeJump');
    expect(c.z).toBe(ROOM.min[2]);
    c.command('planeJump');
    expect(c.z).toBe(120);
  });

  it('arrow keys rotate in 10° steps; 0 resets', () => {
    const c = new Controller('trackpad', held());
    c.command('rotateLeft');
    c.command('rotateUp');
    expect([c.yaw, c.pitch]).toEqual([KEY_STEP, KEY_STEP]);
    c.command('resetView');
    expect([c.yaw, c.pitch]).toEqual([0, 0]);
  });
});
