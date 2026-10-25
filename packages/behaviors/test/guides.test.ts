import { describe, expect, it } from 'vitest';
import { flatGuides, guideLines, guideStop, type V3 } from '../src/index.ts';

const near = (a: readonly number[], b: readonly number[]) =>
  a.forEach((v, k) => expect(v).toBeCloseTo(b[k]!, 9));

describe('guides (new here: a dragged thing holds on lines through things near it)', () => {
  it('along the world’s axes, and the original’s own when it is turned', () => {
    expect(guideLines([0, 0, 0])).toHaveLength(3);
    // Turned 30° about z: two more (its z is the world's).
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const own: V3[] = [[c, s, 0], [-s, c, 0], [0, 0, 1]]; // prettier-ignore
    const lines = guideLines([0, 0, 0], own);
    expect(lines).toHaveLength(5);
    near(lines[3]!.dir, [c, s, 0]);
  });

  it('near a line in the plane, it holds on it, moved square to it', () => {
    const stop = guideStop([300, 7, 0], guideLines([0, 0, 0]))!;
    near(stop.move, [0, -7]);
    expect(stop.on).toHaveLength(1);
    near(stop.on[0]!.dir, [1, 0, 0]);
  });

  it('near where two cross, it holds there', () => {
    const stop = guideStop([5, -6, 0], guideLines([0, 0, 0]))!;
    near(stop.move, [-5, 6]);
  });

  it('at another depth, the line through the plane is a point: in front of the original', () => {
    const stop = guideStop([4, 3, 250], guideLines([0, 0, 0]))!;
    near(stop.move, [-4, -3]);
    near(stop.on[0]!.dir, [0, 0, 1]);
    // The lines at the original's depth are out of the plane: nothing near else.
    expect(guideStop([300, 3, 250], guideLines([0, 0, 0]))).toBeNull();
  });

  it('along a turned original’s own axis', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const lines = guideLines([0, 0, 0], [[c, s, 0]]);
    // 200 along its axis, 8 off it.
    const p: V3 = [200 * c - 8 * s, 200 * s + 8 * c, 0];
    const stop = guideStop(p, lines)!;
    near(stop.move, [8 * s, -8 * c]);
  });

  it('carried into the plane, a thing at another depth lines up as seen from in front', () => {
    // A cone's middle at depth 60, a cube's (dragged) at 0: still in line across.
    const flat = flatGuides(guideLines([0, 0, 60]), 0);
    expect(flat).toHaveLength(2); // across and up; the one in depth goes
    const stop = guideStop([300, 7, 0], flat)!;
    near(stop.move, [0, -7]);
    near(stop.on[0]!.from!, [0, 0, 60]);
    // And under it, where the two cross.
    near(guideStop([5, 200, 0], flat)!.move, [-5, 0]);
    near(guideStop([4, -3, 0], flat)!.move, [-4, 3]);
  });

  it('out of reach of every line, it goes where it is taken', () => {
    expect(guideStop([300, 40, 0], guideLines([0, 0, 0]))).toBeNull();
  });
});
