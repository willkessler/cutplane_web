import { describe, expect, it } from 'vitest';
import { ROOM } from '@cutplane/kernel';
import { keysPlateSize } from '@cutplane/behaviors';
import {
  LEFT,
  MIDDLE,
  NOTHING_HELD,
  RIGHT,
  commandFor,
  keyLines,
  motionFor,
  type Held,
} from './bindings.ts';
import {
  Controller,
  KEY_STEP,
  PITCH_MAX,
  PLANE_GAIN,
  PLANE_UP_BIAS,
  ROTATE_PER_PX,
  YAW_LIMIT,
  isMouseWheel,
} from './controller.ts';

const held = (h: Partial<Held> = {}): Held => ({ ...NOTHING_HELD, ...h });

describe('bindings (one set for a trackpad and either mouse)', () => {
  it('a trackpad: ⌥ pushes the plane, ⌘ rotates, no buttons needed', () => {
    expect(motionFor(held())).toBe('point');
    expect(motionFor(held({ alt: true }))).toBe('plane');
    expect(motionFor(held({ meta: true }))).toBe('rotate');
    expect(motionFor(held({ buttons: LEFT }))).toBe('point');
  });

  it('a mouse: right-drag rotates; middle-drag (the SGI layout) or ⌥ pushes the plane', () => {
    expect(motionFor(held({ buttons: RIGHT }))).toBe('rotate');
    expect(motionFor(held({ buttons: MIDDLE }))).toBe('plane');
    // Left + middle is the carry chord: the plane moves, taking the drag with it.
    expect(motionFor(held({ buttons: LEFT | MIDDLE }))).toBe('plane');
    expect(motionFor(held({ buttons: LEFT, alt: true }))).toBe('plane');
  });

  it('maps keys to commands and leaves ⌘ combinations to the browser', () => {
    expect(commandFor('Space', held())).toBe('planeJump');
    expect(commandFor('ArrowLeft', held())).toBe('rotateLeft');
    expect(commandFor('KeyF', held())).toBe('workMode');
    expect(commandFor('KeyF', held({ meta: true }))).toBeUndefined();
    expect(commandFor('KeyG', held())).toBe('group');
    expect(commandFor('Backslash', held())).toBe('slice');
    expect(commandFor('KeyB', held())).toBe('union');
    expect(commandFor('KeyA', held())).toBe('align');
    expect(commandFor('KeyA', held({ shift: true }))).toBe('distribute');
    expect(commandFor('KeyA', held({ meta: true }))).toBe('selectAll');
    expect(commandFor('KeyH', held())).toBe('panTool');
    expect(commandFor('KeyP', held())).toBe('pencilTool');
    expect(commandFor('KeyZ', held())).toBe('zoomTool');
    expect(commandFor('KeyV', held())).toBe('gravityTool');
    expect(commandFor('Period', held({ shift: true }))).toBeUndefined(); // > no longer
    expect(commandFor('Digit1', held())).toBe('display');
    expect(commandFor('Slash', held({ shift: true }))).toBe('help');
    expect(commandFor('KeyZ', held({ meta: true }))).toBe('undo');
    expect(commandFor('KeyW', held({ meta: true }))).toBeUndefined();
    expect(commandFor('Space', held({ meta: true }))).toBeUndefined();
    expect(commandFor('KeyZ', held({ meta: true }))).toBe('undo');
    expect(commandFor('KeyZ', held({ meta: true, shift: true }))).toBe('redo');
    expect(commandFor('KeyZ', held({ ctrl: true }))).toBe('undo');
    expect(commandFor('KeyY', held({ ctrl: true }))).toBe('redo');
    expect(commandFor('KeyZ', held())).toBe('zoomTool'); // controls.h's ZTOOLBUTTON
  });
});

describe('Controller', () => {
  it('moves the crosshair in the plane, clamped to the room', () => {
    const h = held();
    const c = new Controller(h);
    c.move(10, 20, 2);
    expect([c.x, c.y]).toEqual([20, -40]);
    c.move(10000, -10000, 1);
    expect([c.x, c.y]).toEqual([ROOM.max[0], ROOM.max[1]]);
  });

  it('pushes the plane with ⌥ + move: up the screen goes deeper when facing the room', () => {
    const h = held({ alt: true });
    const c = new Controller(h);
    c.move(0, -100, 1);
    expect(c.z).toBeCloseTo(ROOM.max[2] - 100 * PLANE_GAIN);
    expect(c.x).toBe(0);
    c.move(100, 0, 1); // sideways does nothing straight on
    expect(c.z).toBeCloseTo(ROOM.max[2] - 100 * PLANE_GAIN);
  });

  it('pushes the plane the way it travels on screen once the room is turned', () => {
    const c = new Controller(held({ alt: true }));
    c.planeAxis = [1, 0]; // room turned 90°: deeper is to the right
    c.move(100, 0, 1);
    const z1 = c.z;
    expect(ROOM.max[2] - z1).toBeGreaterThan(100 * PLANE_GAIN * 0.95);
    c.move(0, -100, 1); // up is now mostly sideways to the plane's travel
    expect(z1 - c.z).toBeLessThan(100 * PLANE_GAIN * 0.3);
  });

  it('snaps the plane at vertex depths on slow moves unless Constrain is held', () => {
    const h = held({ alt: true });
    const c = new Controller(h);
    c.plane.setDepths([496]);
    c.move(0, -4, 1);
    expect(c.z).toBe(496);
    h.ctrl = true;
    c.move(0, -40, 1); // slowed to a quarter, and free
    expect(c.z).toBeCloseTo(496 - 10 * PLANE_GAIN);
  });

  it('Ctrl locks the crosshair to the axis it is pushed along', () => {
    const h = held({ ctrl: true });
    const c = new Controller(h);
    c.move(3, 2, 1); // inside the deciding distance: holds still
    expect([c.x, c.y]).toEqual([0, 0]);
    c.move(4, 1, 1); // now 7 right, 3 down: x wins
    expect([c.x, c.y]).toEqual([7, 0]);
    c.move(5, -40, 1); // the y motion is ignored
    expect([c.x, c.y]).toEqual([12, 0]);
    h.ctrl = false;
    c.move(0, -10, 1); // released: free again, from where it was
    expect([c.x, c.y]).toEqual([12, 10]);
  });

  it('Ctrl locks windowed (absolute) pointing too', () => {
    const c = new Controller(held({ ctrl: true }));
    c.pointTo(1, 30);
    expect([c.x, c.y]).toEqual([0, 30]);
    c.pointTo(50, 60);
    expect([c.x, c.y]).toEqual([0, 60]);
    c.resetConstrain();
    c.pointTo(50, 61);
    c.pointTo(70, 62);
    expect([c.x, c.y]).toEqual([70, 60]);
  });

  it('rotates the room with ⌘ + move inside the original limits', () => {
    const h = held({ meta: true });
    const c = new Controller(h);
    c.move(-40, 40, 1);
    expect(c.yaw).toBeCloseTo(40 * ROTATE_PER_PX);
    expect(c.pitch).toBeCloseTo(40 * ROTATE_PER_PX);
    c.move(-1e6, -1e6, 1);
    expect([c.yaw, c.pitch]).toEqual([YAW_LIMIT, 0]);
    c.move(2e6, 2e6, 1);
    expect([c.yaw, c.pitch]).toEqual([-YAW_LIMIT, PITCH_MAX]);
  });

  it('a mouse wheel moves the plane: rolled up (away) goes deeper', () => {
    const c = new Controller(held());
    c.wheel(-100, 0, true);
    expect(c.z).toBe(ROOM.max[2] - 50);
  });

  it('tells a mouse wheel from a trackpad', () => {
    expect(isMouseWheel({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe(true);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: -100, wheelDeltaY: 120 })).toBe(true);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: -4, wheelDeltaY: 12 })).toBe(false);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: -40, wheelDeltaY: 0 })).toBe(false);
  });

  it('a trackpad swipe follows the plane on screen, as fast as ⌥ + move does', () => {
    // Facing the room: a swipe up (deltaY > 0, natural scrolling) goes deeper, as before.
    const c = new Controller(held());
    c.wheel(100, 0, false, 2);
    expect(c.z).toBeCloseTo(ROOM.max[2] - 200 * PLANE_GAIN);
    // Just as far as ⌥ + moving up as many pixels.
    const m = new Controller(held({ alt: true }));
    m.move(0, -100, 2);
    expect(m.z).toBeCloseTo(c.z);
    // The room turned so the plane goes deeper to the right on screen: a swipe right
    // (deltaX < 0) goes deeper, and one straight up barely moves it.
    const t = new Controller(held());
    t.planeAxis = [1, -PLANE_UP_BIAS];
    t.wheel(0, -100);
    expect(t.z).toBeCloseTo(ROOM.max[2] - 100 * PLANE_GAIN);
    const z = t.z;
    t.wheel(100, 0);
    expect(Math.abs(t.z - z)).toBeLessThan(1);
  });

  it('plane jump goes to the back wall and returns, then the front wall and returns', () => {
    const c = new Controller(held());
    c.plane.set(120);
    c.command('planeJump');
    expect(c.z).toBe(ROOM.min[2]);
    c.command('planeJump');
    expect(c.z).toBe(120);
    c.command('planeJump');
    expect(c.z).toBe(ROOM.max[2]);
    c.command('planeJump');
    expect(c.z).toBe(120);
    c.command('planeJump');
    expect(c.z).toBe(ROOM.min[2]);
  });

  it('arrow keys rotate in 10° steps; 0 resets', () => {
    const c = new Controller(held());
    c.command('rotateLeft');
    c.command('rotateUp');
    expect([c.yaw, c.pitch]).toEqual([KEY_STEP, KEY_STEP]);
    c.command('resetView');
    expect([c.yaw, c.pitch]).toEqual([0, 0]);
  });
});

describe('the keys plate', () => {
  it('every line is plain ASCII, and the plate fits beside the room on a 16:10 screen', () => {
    for (const mac of [true, false]) {
      const lines = keyLines(mac);
      for (const l of lines)
        for (const t of 'heading' in l ? [l.heading] : l) expect(t).toMatch(/^[\x20-\x7e]*$/); // the Hershey font's ASCII
      const [width, height] = keysPlateSize(lines);
      expect(width).toBeLessThan(215);
      expect(height).toBeLessThan(764); // the room's height
    }
  });
});
