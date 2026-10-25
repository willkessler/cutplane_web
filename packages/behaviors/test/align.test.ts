import { describe, expect, it } from 'vitest';
import { createCube, createObject, mat4, type CutObject } from '@cutplane/kernel';
import { alignMoves, distributeMoves, type Box, type V3 } from '../src/index.ts';
import { world } from './world.ts';

const near = (a: readonly number[], b: readonly number[]) =>
  a.forEach((v, k) => expect(v).toBeCloseTo(b[k]!, 9));

/** A box `s` across about the middle `m`. */
const box = (m: V3, s = 100): Box => [
  [m[0] - s / 2, m[1] - s / 2, m[2] - s / 2],
  [m[0] + s / 2, m[1] + s / 2, m[2] + s / 2],
];

describe('A and Shift-A (new here: lining up, spacing out evenly)', () => {
  it('A puts each middle on the line through the two farthest apart', () => {
    // Ends at (0,0) and (400,400); the one between, off it, comes square onto it.
    const m = alignMoves([box([0, 0, 0]), box([100, 300, 0]), box([400, 400, 0])])!;
    near(m[0]!, [0, 0, 0]);
    near(m[1]!, [100, -100, 0]);
    near(m[2]!, [0, 0, 0]);
  });

  it('nearly along an axis, the line is squared to it, through the end picked first', () => {
    const m = alignMoves([box([0, 0, 0]), box([300, 20, 0]), box([600, -10, 0])])!;
    near(m[0]!, [0, 0, 0]);
    near(m[1]!, [0, -20, 0]);
    near(m[2]!, [0, 10, 0]);
    // Two are enough: the other comes level with the first.
    near(alignMoves([box([0, 0, 0]), box([5, 300, 8])])![1]!, [-5, 0, -8]);
  });

  it('Shift-A leaves the ends and spaces the rest between them, gaps even, sizes and all', () => {
    // A big one (200) and two small: 750 across with 400 of things, gaps of 175.
    const m = distributeMoves([box([0, 0, 0], 200), box([600, 0, 0]), box([200, 0, 0])])!;
    near(m[0]!, [0, 0, 0]);
    near(m[1]!, [0, 0, 0]);
    near(m[2]!, [125, 0, 0]); // 100 + 175 + 50
  });

  it('Shift-A goes in the order along the line, and only along it', () => {
    const m = distributeMoves([
      box([0, 0, 0]),
      box([500, 30, 0]),
      box([350, 0, 0]),
      box([100, -20, 0]),
      box([800, 0, 0]),
    ])!;
    // 900 across (-50 to 850), 500 of things: gaps of 100, middles at 0, 200, 400, 600, 800.
    near(m[3]!, [100, 0, 0]);
    near(m[2]!, [50, 0, 0]);
    near(m[1]!, [100, 0, 0]); // off the line by 30, it stays off it
    near(m[4]!, [0, 0, 0]);
  });

  it('too few, or all at one place: nothing', () => {
    expect(alignMoves([box([0, 0, 0])])).toBeNull();
    expect(distributeMoves([box([0, 0, 0]), box([9, 0, 0])])).toBeNull();
    expect(alignMoves([box([0, 0, 0]), box([0, 0, 0])])).toBeNull();
  });

  it('A then Shift-A on what is picked, scale boxes and all; undo puts each back', () => {
    const w = world(); // its cube 200 across about the middle
    const add = (name: string, x: number, y: number) => {
      const o = createObject(createCube(100, 100, 100), {
        name,
        xform: mat4.translation(x - 50, y - 50, -50),
      });
      o.attrs.props = ['Visible'];
      w.rt.importObjects(w.rt.primary, [o]);
      w.rt.commit();
      w.frame();
      return o;
    };
    const p = add('P', 200, 20);
    const q = add('Q', 400, -10);
    const click = (x: number, y: number, shift: boolean) => {
      w.at(x, y, 0);
      w.controls.pressPick(shift);
      w.frame();
      w.controls.releasePick();
      w.frame();
      w.frame();
    };
    click(0, 0, false);
    click(200, 20, true);
    click(400, -10, true);
    expect(w.rt.picked()).toHaveLength(3);
    const mid = (o: CutObject) => {
      const b = w.rt.branchBox(o)!;
      return [0, 1, 2].map((k) => Math.round((b[0][k]! + b[1][k]!) / 2) + 0);
    };
    w.controls.align();
    w.frame();
    expect([mid(w.cube), mid(p), mid(q)]).toEqual([
      [0, 0, 0],
      [200, 0, 0],
      [400, 0, 0],
    ]);
    // The scale box P sits in, picked, came with it.
    expect(p.parent).not.toBe(w.rt.primary.root);
    w.controls.distribute();
    w.frame();
    expect(mid(p)).toEqual([225, 0, 0]); // 100 + 75 + 50
    expect(w.rt.undo()).toBe(true);
    expect(mid(p)).toEqual([200, 0, 0]);
    expect(w.rt.undo()).toBe(true);
    expect([mid(p), mid(q)]).toEqual([
      [200, 20, 0],
      [400, -10, 0],
    ]);
  });
});
