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
});
