import { describe, expect, it } from 'vitest';
import { DEMO_SECONDS, demoPose } from './demo.ts';

describe('README demo script', () => {
  it('loops seamlessly', () => {
    expect(demoPose(0)).toEqual(demoPose(DEMO_SECONDS));
    expect(demoPose(DEMO_SECONDS - 1e-9).depth).toBeCloseTo(demoPose(0).depth);
  });

  it('does one thing at a time: turns about one axis at once, never while moving the plane', () => {
    const dt = 1 / 30;
    const moved = (a: number, b: number) => Math.abs(b - a) > 1e-9;
    let pitched = false;
    for (let t = 0; t < DEMO_SECONDS; t += dt) {
      const a = demoPose(t);
      const b = demoPose(t + dt);
      const yawing = moved(a.yaw, b.yaw);
      const pitching = moved(a.pitch, b.pitch);
      const cutting = moved(a.depth, b.depth) || moved(a.back, b.back);
      expect(yawing && pitching, `t=${t.toFixed(2)}`).toBe(false);
      expect((yawing || pitching) && cutting, `t=${t.toFixed(2)}`).toBe(false);
      pitched ||= pitching;
      // Never far: a little turn shows the depth without losing the room.
      expect(Math.abs(b.yaw)).toBeLessThanOrEqual(18);
      expect(Math.abs(b.pitch)).toBeLessThanOrEqual(26);
    }
    expect(pitched).toBe(true); // about x as well as y
  });

  it('pulls a face out and back, rolls the module and back, drills it, opens and closes a rail, stamps a primitive', () => {
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
        expect(p.depth).toBe(h.from.depth); // held, only the crosshair moves (and the plane from the back wall)
        h.reach = Math.max(h.reach, Math.hypot(p.x - h.from.x, p.y - h.from.y));
      }
      was = p.pressed;
    }
    expect(holds).toHaveLength(9);
    expect(holds[0]!.reach).toBeGreaterThan(100);
    expect(holds[0]!.to).toEqual(holds[0]!.from);
    expect(holds[1]!.reach).toBeGreaterThan(50); // the roll along the rotate tool's bar...
    expect(holds[1]!.to).toEqual(holds[1]!.from); // ...and back
    // Clicks on the headpad (open its rail) and the drill's pad; the drill's press and carry
    // across the module; the headpad again (close it), then a click on nothing.
    for (const i of [2, 3, 5, 6, 8]) expect(holds[i]!.reach).toBe(0);
    expect(holds[2]!.from).toEqual(holds[5]!.from);
    expect(holds[3]!.from.y).toBeLessThan(holds[2]!.from.y); // the drill's pad, down the rail
    expect(holds[4]!.reach).toBeGreaterThan(40);
    // At the back wall, a click opens the primitives box; the pyramid is pressed on and
    // carried down and forward (the plane coming with it, ⌥ and move) to beside the ship.
    expect(holds[7]!.reach).toBeGreaterThan(300);
    expect(demoPose(0).pressed).toBe(false);
    // R twice: the tool comes and is put away again, so the loop starts with it docked;
    // and an undo after the cut and after the stamp, so it starts with the module whole and
    // no pyramid.
    expect(demoPose(DEMO_SECONDS - 1e-6).rotateKeys).toBe(2);
    expect(demoPose(DEMO_SECONDS - 1e-6).undoKeys).toBe(2);
  });
});
