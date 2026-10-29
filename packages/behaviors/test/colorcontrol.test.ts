import { describe, expect, it } from 'vitest';
import { createCube, createObject, mat4 } from '@cutplane/kernel';
import { COLOR_CRTNS, createColorControl } from '../src/index.ts';
import { world } from './world.ts';

/** A world with the colour control standing across the plane, to the cube's right. */
function setup() {
  const w = world();
  w.rt.registerCrtns(COLOR_CRTNS);
  // Base from x = 190 to 320, y = -50 to -10, z = -30 to 30 (the plane is at z = 0).
  const cc = createColorControl(w.rt, [200, -50, -30]);
  w.frame();
  return { ...w, cc };
}

const top = (rt: ReturnType<typeof world>['rt'], o: Parameters<typeof rt.bbox>[0]) =>
  rt.bbox(o)![1][1];

describe('the colour control through colorbar.cpl and paint.cpl', () => {
  it('dragging a bar recolours what is picked, limited to the bar’s range', () => {
    const { rt, cube, cc, controls, frame, at, move } = setup();
    // Pick the cube.
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    expect(rt.picked()).toEqual([cube]);
    // Press on the red bar (x 200–230, its top at y = -10 + 96 = 86).
    at(215, 50, 0);
    controls.pressPick(false);
    frame();
    expect(rt.hasProp(cc.bars[0], 'Active')).toBe(true);
    // Drag it down 40: the bar is 56 tall, so red is 255·51/95.
    move(0, -10);
    move(0, -30);
    expect(top(rt, cc.bars[0])).toBeCloseTo(46);
    expect(cube.color[0]).toBe(Math.round((255 * 51) / 95));
    // Way past the bottom: it stops at the minimum.
    move(0, -300);
    expect(top(rt, cc.bars[0])).toBeCloseTo(-5);
    expect(cube.color[0]).toBe(0);
    controls.releasePick();
    frame();
    expect(rt.hasProp(cc.bars[0], 'Active')).toBe(false);
    // The cube is still the one picked, and the colour is one undoable step.
    expect(rt.picked()).toEqual([cube]);
    rt.undo();
    expect(cube.color[0]).not.toBe(0);
  });

  it('with faces dragged as extrusions, a bar taken to nothing comes back up a bar (cutplane_web)', () => {
    const { rt, cube, cc, controls, frame, at, move } = setup();
    rt.faceDrag = 'extrude';
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    const drag = (dy: number) => {
      at(215, top(rt, cc.bars[0]) - 3, 0);
      controls.pressPick(false);
      frame();
      move(0, dy);
      controls.releasePick();
      frame();
    };
    drag(-300);
    expect(top(rt, cc.bars[0])).toBeCloseTo(-5);
    // Up from the bottom: the top face rises, it isn't pulled out as a block on the bar.
    drag(40);
    expect(cc.bars[0].brep.numVertices).toBe(8);
    expect(top(rt, cc.bars[0])).toBeCloseTo(35);
    expect(cube.color[0]).toBe(Math.round((255 * 40) / 95));
    // And it still works.
    drag(-20);
    expect(top(rt, cc.bars[0])).toBeCloseTo(15);
  });

  it('a group picked takes the colour in every part (cutplane_web)', () => {
    const { rt, cube, controls, frame, at, move } = setup();
    // The cube with two parts under it, as G makes a group of picked things.
    const parts = [0, 1].map((i) => {
      const o = createObject(createCube(20, 20, 20), {
        xform: mat4.translation(-100 + 40 * i, 120, -10),
      });
      o.attrs.props = ['Visible'];
      rt.importObjects(rt.primary, [o]);
      rt.adopt(cube, o, true);
      return o;
    });
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    expect(rt.picked()).toEqual([cube]);
    at(215, 50, 0);
    controls.pressPick(false);
    frame();
    move(0, -40);
    controls.releasePick();
    frame();
    const red = Math.round((255 * 51) / 95);
    expect([cube, ...parts].map((o) => o.color[0])).toEqual([red, red, red]);
  });

  it('a dragged copy of the chip paints what it is let go on', () => {
    const { rt, cube, cc, controls, frame, at, move } = setup();
    cc.chip.color = [10, 200, 30];
    // The chip leans on the base's right end (x 320–370, crossing the plane at y ≈ -18);
    // pressing on it takes a copy.
    at(345, -18, 0);
    controls.pressPick(false);
    frame();
    // The copy goes to the top of the environment (duplicate_obj_branch), without the name.
    const copies = () => rt.environment.root.children.filter((o) => rt.hasProp(o, 'Paint'));
    expect(copies()).toHaveLength(1);
    move(-200, 30);
    move(-130, 10);
    controls.releasePick();
    frame();
    expect(cube.color).toEqual([10, 200, 30]);
    // The copy is gone; the chip itself stays on the control.
    expect(copies()).toHaveLength(0);
    expect(cc.chip.parent).toBe(cc.base);
  });

  it('the glass chip paints see-through; the paint chip makes it solid again (new)', () => {
    const { rt, cube, cc, controls, frame, at, move } = setup();
    // The glass chip leans beside the paint chip, a quarter as wide (x 374–386.5).
    expect(rt.bbox(cc.glass)![0][0]).toBeCloseTo(374);
    expect(rt.bbox(cc.glass)![1][0]).toBeCloseTo(386.5);
    expect(cc.glass.opacity).toBe(0.5);
    const drop = (x: number) => {
      at(x, -18, 0);
      controls.pressPick(false);
      frame();
      move(-200, 30);
      move(215 - x, 10); // onto the cube, as the paint chip test goes
      controls.releasePick();
      frame();
    };
    // The bars colour both chips: drag red down to nothing.
    at(215, 50, 0);
    controls.pressPick(false);
    frame();
    move(0, -300);
    controls.releasePick();
    frame();
    const cyan = [...cc.chip.color];
    expect(cyan[0]).toBe(0);
    expect(cc.glass.color).toEqual(cyan);
    expect(cc.glass.opacity).toBe(0.5);
    // Pressed near its left edge, beside the paint chip: still the glass.
    drop(375.5);
    expect(cube.color).toEqual(cyan);
    expect(cube.opacity).toBe(0.5);
    // The chip itself stays as it was; its copy is gone.
    expect(cc.glass.parent).toBe(cc.base);
    expect(rt.environment.root.children.filter((o) => rt.hasProp(o, 'Paint'))).toHaveLength(0);
    // One step: undone, the cube is solid again; redone, see-through.
    rt.undo();
    expect(cube.opacity).toBeUndefined();
    rt.redo();
    expect(cube.opacity).toBe(0.5);
    drop(345);
    expect(cube.color).toEqual(cyan);
    expect(cube.opacity).toBeUndefined();
  });

  it('a bar drawn down to its least is still the bar’s to take, not the base’s (cutplane_web)', () => {
    const { rt, cc, controls, frame, at, move } = setup();
    at(215, 50, 0);
    controls.pressPick(false);
    frame();
    move(0, -300);
    controls.releasePick();
    frame();
    expect(top(rt, cc.bars[0])).toBeCloseTo(-5); // 5 above the base's top, in reach of it
    const base = rt.bbox(cc.base)![0][1];
    at(400, 300, 0); // away, and back on it
    at(215, -7, 0);
    controls.pressPick(false);
    frame();
    expect(rt.hasProp(cc.bars[0], 'Active')).toBe(true);
    move(0, 20);
    controls.releasePick();
    frame();
    expect(top(rt, cc.bars[0])).toBeCloseTo(15);
    expect(rt.bbox(cc.base)![0][1]).toBe(base);
  });

  it('the base (goodies.cpl) carries the whole control', () => {
    const { rt, cc, controls, frame, at, move } = setup();
    at(195, -30, 0);
    controls.pressPick(false);
    frame();
    move(0, 20);
    move(0, 20);
    controls.releasePick();
    frame();
    expect(rt.bbox(cc.base)![0][1]).toBeCloseTo(-10);
    expect(rt.bbox(cc.bars[2])![0][1]).toBeCloseTo(30);
  });
});
