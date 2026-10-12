import { describe, expect, it } from 'vitest';
import { mat4 } from '@cutplane/kernel';
import { ROTATE_DOCK, ROTATE_RADIUS, RotateTool } from './rotatetool.ts';
import { world } from './testworld.ts';
import type { V3 } from './editor.ts';

const placed = (m: { object: { xform: Float64Array } }, p: V3) =>
  mat4.transformPoint(m.object.xform, ...p);

/** Drags the tool from `a` through `path` (crosshair positions as pushed), returning where it put the crosshair. */
function toolDrag(tool: RotateTool, a: V3, ...path: V3[]): [number, number] {
  tool.press(a);
  let at: [number, number] = [a[0], a[1]];
  let prev: V3 = a;
  for (const p of path) {
    // Relative motion from the crosshair's last (constrained) place, as in work mode.
    at = tool.move([at[0] + p[0] - prev[0], at[1] + p[1] - prev[1], p[2]]);
    prev = p;
  }
  tool.release([at[0], at[1], a[2]]);
  return at;
}

describe('rotate tool', () => {
  it('starts docked at the upper right, squared up', () => {
    const { editor } = world([-100, -100, -100]);
    const t = new RotateTool(editor);
    expect(t.center).toEqual([...ROTATE_DOCK]);
    expect(t.center).toEqual([347.5, 220.5]);
    expect(t.partAt(347.5 + 5, 220.5)).toEqual({ kind: 'center' });
    expect(t.partAt(347.5 + 70, 220.5 + 3)).toEqual({ kind: 'bar', bar: 'h' });
    expect(t.partAt(347.5, 220.5 + ROTATE_RADIUS - 2)).toEqual({
      kind: 'bauble',
      bar: 'v',
      end: 1,
    });
  });

  it('R brings it to the crosshair and picks what is there; R on its centre puts it away', () => {
    const { editor, state } = world([-100, -100, -100]);
    const t = new RotateTool(editor);
    state.z = 0;
    t.snap([0, 0, 0]);
    expect(t.center).toEqual([0, 0]);
    expect(editor.picked.map((p) => p.kind)).toEqual(['object']);
    t.snap([3, 3, 0]);
    expect(t.center).toEqual([...ROTATE_DOCK]);
  });

  it('dragging right along the horizontal bar rolls the near side to the right, 1° per unit', () => {
    const { models, editor, state } = world([-100, -100, -100]);
    const t = new RotateTool(editor);
    state.z = 0;
    t.snap([0, 0, 0]); // picks the cube, tool at its centre
    toolDrag(t, [40, 0, 0], [70, 0, 0], [130, 0, 0]);
    // 90° about +y through the centre: the near face's centre (0, 0, 100) goes to (100, 0, 0).
    const p = placed(models[0]!, [100, 100, 200]);
    expect(p[0]).toBeCloseTo(100);
    expect(p[2]).toBeCloseTo(0);
    expect(editor.canUndo).toBe(true);
  });

  it('keeps the crosshair on the bar while the bar is dragged', () => {
    const { editor, state } = world([-100, -100, -100]);
    const t = new RotateTool(editor);
    state.z = 0;
    t.snap([0, 0, 0]);
    t.press([40, 0, 0]);
    expect(t.move([60, 25, 0])).toEqual([60, 0]);
    t.release([60, 0, 0]);
  });

  it('turns into a dial off the end of a bar, and the dial spins about the plane normal', () => {
    const { models, editor, state } = world([-100, -100, -100]);
    const t = new RotateTool(editor);
    state.z = 0;
    t.snap([0, 0, 0]);
    t.press([ROTATE_RADIUS, 0, 0]); // the right-hand bauble
    // Swing it a quarter turn counter-clockwise along the circle.
    let at: [number, number] = [ROTATE_RADIUS, 0];
    for (let deg = 5; deg <= 90; deg += 5) {
      const r = (deg * Math.PI) / 180;
      at = t.move([ROTATE_RADIUS * Math.cos(r), ROTATE_RADIUS * Math.sin(r), 0]);
    }
    t.release([...at, 0]);
    expect(at[0]).toBeCloseTo(0);
    expect(at[1]).toBeCloseTo(ROTATE_RADIUS);
    const p = placed(models[0]!, [200, 100, 100]); // the right face's centre
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(100);
    // The bars turned with it.
    expect(t.hdir[0]).toBeCloseTo(0);
    expect(t.hdir[1]).toBeCloseTo(1);
  });

  it('set on a face section line, rolls the face into the plane and stops there', () => {
    const { models, editor, state } = world([-100, -100, -100]);
    const t = new RotateTool(editor);
    state.z = 0;
    // The right side (x = 100) crosses the plane as a vertical line.
    t.snap([100, 0, 0]);
    expect(t.snapFace?.pick.kind).toBe('face');
    expect(t.center).toEqual([100, 0]);
    expect(t.show.vbar).toBe(false);
    // Roll about the section line (y axis): the horizontal bar runs along x.
    t.press([140, 0, 0]);
    let x = 140;
    for (let i = 0; i < 120 && editor.picked.length > 0; i++) t.move([(x -= 1), 0, 0]);
    t.release([x, 0, 0]);
    expect(editor.picked).toEqual([]);
    // The face's normal (was +x) now points straight out of or into the plane.
    const n = models[0]!.world.faceNormal(t.snapFace!.pick.id);
    expect(Math.abs(n[2])).toBeCloseTo(1, 12);
  });

  it('carries the centre and drops it on a feature, lined up with it', () => {
    const { editor, state } = world([-100, -100, -100]);
    const t = new RotateTool(editor);
    state.z = 0;
    t.press([...ROTATE_DOCK, 0]);
    expect(t.carrying).toBe(true);
    t.move([60, 30, 0]);
    t.move([100, 5, 0]);
    t.release([100, 5, 0]);
    expect(t.center[0]).toBeCloseTo(100);
    expect(editor.picked.map((p) => p.kind)).toEqual(['face']);
    expect(t.snapFace).toBeDefined();
  });
});
