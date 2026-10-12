import { describe, expect, it } from 'vitest';
import { DEMO_SECONDS, demoPose } from './demo.ts';

describe('README demo script', () => {
  it('loops seamlessly', () => {
    expect(demoPose(0)).toEqual(demoPose(DEMO_SECONDS));
    expect(demoPose(DEMO_SECONDS - 1e-9).depth).toBeCloseTo(demoPose(0).depth);
  });

  it('does one thing at a time: never rotates and moves the plane together', () => {
    const dt = 1 / 30;
    for (let t = 0; t < DEMO_SECONDS; t += dt) {
      const a = demoPose(t);
      const b = demoPose(t + dt);
      const turning = Math.abs(b.yaw - a.yaw) > 1e-9 || Math.abs(b.pitch - a.pitch) > 1e-9;
      const cutting = Math.abs(b.depth - a.depth) > 1e-9;
      expect(turning && cutting, `t=${t.toFixed(2)}`).toBe(false);
      expect(b.pitch).toBe(a.pitch); // side to side only
    }
  });

  it('pulls a face out and puts it back, rolls the module and back, then clicks on nothing', () => {
    const dt = 1 / 30;
    type At = { x: number; y: number; depth: number };
    const holds: { from: At; to: At; reach: number }[] = [];
    for (let t = 0, was = false; t < DEMO_SECONDS; t += dt) {
      const p = demoPose(t);
      const at = { x: p.x, y: p.y, depth: p.depth };
      if (p.pressed && !was) holds.push({ from: at, to: at, reach: 0 });
      const h = holds.at(-1);
      // The release happens on the first frame the button is up, wherever the crosshair is then.
      if (!p.pressed && was && h) h.to = at;
      if (p.pressed && h) {
        expect(p.depth).toBe(h.from.depth); // only the crosshair moves while held
        h.reach = Math.max(h.reach, Math.hypot(p.x - h.from.x, p.y - h.from.y));
      }
      was = p.pressed;
    }
    expect(holds).toHaveLength(3);
    expect(holds[0]!.reach).toBeGreaterThan(100);
    expect(holds[0]!.to).toEqual(holds[0]!.from);
    expect(holds[1]!.reach).toBeGreaterThan(50); // the roll along the rotate tool's bar...
    expect(holds[1]!.to).toEqual(holds[1]!.from); // ...and back
    expect(holds[2]!.reach).toBe(0);
    expect(demoPose(0).pressed).toBe(false);
    // R twice: the tool comes and is put away again, so the loop starts with it docked.
    expect(demoPose(DEMO_SECONDS - 1e-6).rotateKeys).toBe(2);
  });
});
