import { describe, expect, it } from 'vitest';
import { mat4 } from '@cutplane/kernel';
import { solve3 } from './dangle.ts';
import { stays } from './gravity.ts';

describe('dangling and resting', () => {
  it('solves a 3×3 system (an inertia about a point, for the turn a torque gives)', () => {
    const m = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ];
    const x = solve3(m, [1, 2, 3])!;
    const back = m.map((r) => r[0]! * x[0] + r[1]! * x[1] + r[2]! * x[2]);
    back.forEach((v, i) => expect(v).toBeCloseTo([1, 2, 3][i]!, 12));
    expect(solve3([[1, 2, 3], [2, 4, 6], [0, 0, 1]], [1, 1, 1])).toBeNull(); // prettier-ignore
  });

  it('tells a landing that leaves things where they were from one that moves them', () => {
    expect(stays(mat4.identity())).toBe(true);
    expect(stays(mat4.translation(0, -0.01, 0))).toBe(true);
    expect(stays(mat4.translation(0, -1, 0))).toBe(false);
    expect(stays(mat4.rotationAbout([0, 0, 0], [0, 1, 0], 0.01))).toBe(false);
  });
});
