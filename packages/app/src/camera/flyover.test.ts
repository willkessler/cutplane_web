import { describe, expect, it } from 'vitest';
import { Flyover, flyoverSeconds, type Shot } from './flyover.ts';

const shot = (x: number, y: number, z: number, dir: Shot['dir'] = [0, 0, -1]): Shot => ({
  eye: [x, y, z],
  dir,
});

describe('the camera fly-over', () => {
  it('needs two shots to fly', () => {
    expect(flyoverSeconds([])).toBe(0);
    expect(flyoverSeconds([shot(0, 0, 0)])).toBe(0);
    expect(new Flyover([shot(0, 0, 0), shot(1, 0, 0), shot(2, 0, 0)], 2).seconds).toBe(4);
    expect(new Flyover([]).at(1)).toBeNull();
    expect(new Flyover([shot(5, 6, 7)]).at(3)!.eye).toEqual([5, 6, 7]);
  });

  it('starts at the first shot, ends at the last, and passes through the others', () => {
    const shots = [shot(0, 0, 0), shot(100, 50, -20), shot(200, 0, -100), shot(300, 80, 0)];
    const f = new Flyover(shots, 2);
    for (const [k, v] of f.at(0)!.eye.entries()) expect(v).toBeCloseTo(shots[0]!.eye[k]!);
    for (const [k, v] of f.at(f.seconds)!.eye.entries()) expect(v).toBeCloseTo(shots[3]!.eye[k]!);
    for (const [k, v] of f.at(99)!.eye.entries()) expect(v).toBeCloseTo(shots[3]!.eye[k]!);
    // Some moment comes close to each shot in between.
    for (const s of shots.slice(1, 3)) {
      let best = Infinity;
      for (let t = 0; t <= f.seconds; t += 0.01) {
        const e = f.at(t)!.eye;
        best = Math.min(best, Math.hypot(e[0] - s.eye[0], e[1] - s.eye[1], e[2] - s.eye[2]));
      }
      expect(best).toBeLessThan(2);
    }
  });

  it('moves smoothly: no jumps from one moment to the next, slow at the ends', () => {
    const f = new Flyover([shot(0, 0, 0), shot(100, 0, 0), shot(400, 0, 0)], 3);
    const step = (t: number) => {
      const a = f.at(t)!.eye;
      const b = f.at(t + 0.05)!.eye;
      return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    };
    const steps = Array.from({ length: 119 }, (_, i) => step(i * 0.05));
    const max = Math.max(...steps);
    expect(max).toBeLessThan(15);
    expect(steps[0]!).toBeLessThan(max / 10);
    expect(steps.at(-1)!).toBeLessThan(max / 10);
  });

  it('turns the lens from one shot’s direction to the next, always a unit vector', () => {
    const f = new Flyover([shot(0, 0, 0, [0, 0, -1]), shot(100, 0, 0, [1, 0, 0])], 2);
    expect(f.at(0)!.dir[2]).toBeCloseTo(-1);
    expect(f.at(2)!.dir[0]).toBeCloseTo(1);
    const mid = f.at(1)!.dir;
    expect(Math.hypot(...mid)).toBeCloseTo(1);
    expect(mid[0]).toBeGreaterThan(0.3);
    expect(mid[2]).toBeLessThan(-0.3);
  });

  it('gives points along its path to draw it', () => {
    const f = new Flyover([shot(0, 0, 0), shot(100, 0, 0), shot(200, 50, 0)]);
    const pts = f.points(10);
    expect(pts).toHaveLength(21);
    expect(pts[0]).toEqual([0, 0, 0]);
  });
});
