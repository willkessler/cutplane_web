import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ROOM, clampToRoom, isInRoom, type Vec3 } from './room.ts';

const vec3 = fc.tuple(
  fc.double({ noNaN: true }),
  fc.double({ noNaN: true }),
  fc.double({ noNaN: true }),
);

describe('room', () => {
  it('contains its own corners', () => {
    expect(isInRoom(ROOM.min)).toBe(true);
    expect(isInRoom(ROOM.max)).toBe(true);
    expect(isInRoom([0, 0, 501])).toBe(false);
  });

  it('clamps any point into the room, idempotently', () => {
    fc.assert(
      fc.property(vec3, (p: Vec3) => {
        const q = clampToRoom(p);
        expect(isInRoom(q)).toBe(true);
        expect(clampToRoom(q)).toEqual(q);
      }),
    );
  });

  it('leaves points already inside unchanged', () => {
    expect(clampToRoom([12.5, -300, 499])).toEqual([12.5, -300, 499]);
  });
});
