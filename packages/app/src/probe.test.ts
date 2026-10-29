import { describe, expect, it } from 'vitest';
import { WorldGeometry, createCube, createSphere, mat4 } from '@cutplane/kernel';
import { clearance, crossings, insideSolid, worldVolume } from './probe.ts';

/** A cube of side s with its least corner at (x, y, z). */
const cube = (s: number, x = 0, y = 0, z = 0) =>
  new WorldGeometry(createCube(s, s, s), mat4.translation(x, y, z));

describe('the probes', () => {
  it('measure the room a solid takes', () => {
    expect(worldVolume(cube(100, 40, -20, 7))).toBeCloseTo(1e6, 3);
    const r = 100;
    const v = worldVolume(new WorldGeometry(createSphere(r, 48), mat4.identity()));
    expect(v / ((4 / 3) * Math.PI * r ** 3)).toBeGreaterThan(0.98);
  });

  it('say where a line of sight goes in and out, nearest first', () => {
    const hits = crossings(cube(100), [50, 50, -50], [0, 0, 1]);
    expect(hits.map((h) => [Math.round(h.t), h.entering])).toEqual([
      [50, true],
      [150, false],
    ]);
    // No further than asked; and a line that misses meets nothing.
    expect(crossings(cube(100), [50, 50, -50], [0, 0, 1], 100)).toHaveLength(1);
    expect(crossings(cube(100), [150, 50, -50], [0, 0, 1])).toEqual([]);
  });

  it('tell inside from outside', () => {
    expect(insideSolid(cube(100), [50, 50, 50])).toBe(true);
    expect(insideSolid(cube(100), [150, 50, 50])).toBe(false);
  });

  it('say how two solids sit: apart, cutting in, one inside', () => {
    expect(clearance(cube(100), cube(100, 150))).toMatchObject({ overlap: false, gap: 50 });
    expect(clearance(cube(100), cube(100, 50, 50, 50))).toMatchObject({ overlap: true, gap: 0 }); // prettier-ignore
    expect(clearance(cube(20, 40, 40, 40), cube(100))).toMatchObject({ overlap: true, aInB: true, bInA: false }); // prettier-ignore
  });

  it('tell touching from cutting in: a block resting on another, a tilted pane', () => {
    // Face to face, flush at one end and overhanging at the other.
    expect(clearance(cube(50, 25, 100, 25), cube(100))).toMatchObject({ overlap: false, gap: 0 }); // prettier-ignore
    expect(clearance(cube(50, 60, 100, 60), cube(100))).toMatchObject({ overlap: false, gap: 0 }); // prettier-ignore
    expect(clearance(cube(100, 0, 100, 0), cube(100))).toMatchObject({ overlap: false, gap: 0 }); // prettier-ignore
    // Tilted, as a pane on a sloped window floor; and sunk 1 into it, it cuts in.
    const turn = (g: WorldGeometry) => new WorldGeometry(g.brep, mat4.multiply(g.xform, mat4.rotationAbout([0, 0, 0], [1, 0, 0], 0.8169))); // prettier-ignore
    const pane = (y: number) => new WorldGeometry(createCube(36, 4, 36), mat4.translation(32, y, 32)); // prettier-ignore
    expect(clearance(turn(pane(100)), turn(cube(100)))).toMatchObject({ overlap: false, gap: 0 });
    expect(clearance(turn(pane(99)), turn(cube(100)))).toMatchObject({ overlap: true });
  });
});
