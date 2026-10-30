import { describe, expect, it } from 'vitest';
import { createCube, createObject, mat4, type TextDecal } from '@cutplane/kernel';
import { layTag, noteLines, tagUnder } from './notes.ts';

const note = (normal: [number, number, number], text = 'Flange here is steel'): TextDecal => ({
  text,
  color: [255, 236, 140],
  height: 10,
  at: [50, 50, 100],
  normal,
  along: [1, 0, 0],
  note: 40,
});

describe('notes (new): floating off things, open with the crosshair over them', () => {
  it('folded, shows its start; open, all of it, a few words a line', () => {
    expect(noteLines('Steel', false)).toEqual(['Steel']);
    expect(noteLines('Flange here is made of steel', false)).toEqual(['Flange here is..']);
    expect(noteLines('Flange here is made of steel, 3mm, welded all round', true)).toEqual([
      'Flange here is made of',
      'steel, 3mm, welded all round',
    ]);
    expect(noteLines('  ', true)).toEqual(['...']);
  });

  it('floats out along the normal, reaching away from the thing, and goes where it goes', () => {
    const o = createObject(createCube(100, 100, 100), { xform: mat4.translation(-50, -50, -50) });
    o.decals = [note([0, 0, 1])];
    const right = [1, 0, 0];
    const up = [0, 1, 0];
    const t = layTag({ object: o, index: 0 }, o.decals[0]!, false, right, up);
    expect(t.at).toEqual([0, 0, 90]);
    expect(t.x0).toBe(0);
    expect(t.y0).toBe(0);
    // Pointing left and down, it reaches left and down.
    const l = layTag({ object: o, index: 0 }, note([-0.8, -0.6, 0]), false, right, up);
    expect(l.x1).toBe(0);
    expect(l.y1).toBe(0);
    // Where reaching left would take it out of the room (out of the crosshair's reach), it's slid back in.
    const w = createObject(createCube(100, 100, 100), { xform: mat4.translation(-505, -50, -50) });
    w.decals = [{ ...note([-1, 0, 0]), along: [0, 0, 1] }];
    const r = layTag({ object: w, index: 0 }, w.decals[0]!, false, right, up);
    expect(r.at[0]).toBe(-495);
    expect(r.at[0] + r.x0).toBeCloseTo(-511);
    expect(r.x1).toBeGreaterThan(0);
    // Open, it's bigger.
    const open = layTag({ object: o, index: 0 }, note([0, 0, 1], 'a '.repeat(30)), true, right, up);
    expect(open.lines.length).toBeGreaterThan(1);
    expect(open.y1).toBeGreaterThan(t.y1);
  });

  it('the crosshair is over a tag where the line from the eye through it meets the tag', () => {
    const o = createObject(createCube(100, 100, 100));
    o.decals = [note([0, 0, 1])];
    const right = [1, 0, 0];
    const up = [0, 1, 0];
    const t = layTag({ object: o, index: 0 }, o.decals[0]!, false, right, up);
    const eye = [0, 0, 1000];
    // The crosshair, in a plane at z 0, behind the tag at z 140: seen through it.
    const s = 1000 / (1000 - 140);
    const through = (x: number, y: number) => [x * s, y * s, 0];
    expect(tagUnder([t], eye, through(55, 55), right, up)).toBe(t);
    // A little round it counts too (0.6 of its lettering's height); further off, not.
    expect(tagUnder([t], eye, through(46, 55), right, up)).toBe(t);
    expect(tagUnder([t], eye, through(42, 55), right, up)).toBeNull();
    expect(tagUnder([t], eye, through(55, 42), right, up)).toBeNull();
  });
});
