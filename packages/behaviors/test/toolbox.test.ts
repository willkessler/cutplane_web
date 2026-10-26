import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { P } from '@cutplane/cpl';
import { ROOM, createCube, createObject, mat4, subtree, type CutObject } from '@cutplane/kernel';
import { COLOR_CRTNS, installToolbars, installToolboxes } from '../src/index.ts';
import { source, world } from './world.ts';

const ASSETS = resolve(import.meta.dirname, '../../../assets');
/** Resources by name (rsc/, icons/): cutplane_web's own first, else the original's. */
const read = (f: string) => {
  for (const dir of ['rsc', 'icons', 'original/rsc', 'original/icons']) {
    const p = join(ASSETS, dir, f);
    if (existsSync(p)) return readFileSync(p, 'latin1');
  }
  throw new Error(`${f}: not found`);
};

/** The plane through the boxes, standing by the back wall. */
const Z = -490;

function setup() {
  const w = world();
  w.rt.registerCrtns(COLOR_CRTNS);
  const boxes = installToolboxes(w.rt, source);
  w.at(0, 0, Z);
  const center = (o: CutObject): [number, number] => {
    const b = w.rt.bbox(o)!;
    return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  };
  const click = (o: CutObject) => {
    const [x, y] = center(o);
    w.at(x, y, Z);
    w.controls.pressPick(false);
    w.frame();
    w.controls.releasePick();
    w.frame();
    w.frame();
  };
  return { ...w, ...boxes, center, click };
}

const visible = (w: ReturnType<typeof setup>, o: CutObject) => w.rt.vm.props.has(o, P.Visible);

describe('toolboxes through toolbox.cpl, stamp.cpl and goodies.cpl', () => {
  it('stand closed by the back wall; a click opens one, its contents stacked above it', () => {
    const w = setup();
    const prims = w.prims.children.filter((c) => w.rt.hasProp(c, 'Stamp'));
    expect(prims).toHaveLength(5);
    expect(prims.some((p) => visible(w, p))).toBe(false);
    w.click(w.prims);
    expect(w.rt.hasProp(w.prims, 'Toolboxopen')).toBe(true);
    expect(prims.every((p) => visible(w, p))).toBe(true);
    const top = w.rt.bbox(w.prims)![1][1];
    const bottoms = prims.map((p) => w.rt.bbox(p)![0][1]);
    expect(Math.min(...bottoms)).toBeGreaterThan(top);
    // Stacked: each above the one before.
    for (let i = 1; i < bottoms.length; i++) expect(bottoms[i]!).toBeGreaterThan(bottoms[i - 1]!);
    w.click(w.prims);
    expect(prims.some((p) => visible(w, p))).toBe(false);
  });

  it('picking a primitive stamps a copy into the world, picked, and the box closes', () => {
    const w = setup();
    w.click(w.prims);
    const cube = w.prims.children.find((c) => w.rt.hasProp(c, 'Stamp'))!;
    const before = w.rt.primary.root.children.length;
    w.click(cube);
    const picked = w.rt.picked();
    expect(picked).toHaveLength(1);
    const copy = picked[0] as CutObject;
    expect(copy).not.toBe(cube);
    expect(w.rt.worldOf(copy)).toBe(w.rt.primary);
    expect(w.rt.hasProp(copy, 'Stamp')).toBe(false);
    expect(w.rt.hasProp(copy, 'Lockedgeometry')).toBe(false);
    expect(visible(w, copy)).toBe(true);
    expect(w.rt.primary.root.children.length).toBeGreaterThan(before);
    // The original stays in its box, which has closed.
    expect(cube.parent).toBe(w.prims);
    expect(visible(w, cube)).toBe(false);
    // The stamp is one undoable step.
    expect(w.rt.undo()).toBe(true);
    expect(w.rt.worldOf(copy)).not.toBe(w.rt.primary);
  });

  it('the goodies box holds the camera, light bulb and colour control; one comes out when dragged', () => {
    const w = setup();
    const names = w.goodies.children.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Nikon', 'Lightbulb', 'Colorcontrol']));
    w.click(w.goodies);
    const bulb = w.goodies.children.find((c) => c.name === 'Lightbulb')!;
    expect(visible(w, bulb)).toBe(true);
    const [x, y] = w.center(bulb);
    w.at(x, y, Z);
    w.controls.pressPick(false);
    w.frame();
    w.move(-150, 0);
    w.move(-100, 0);
    w.controls.releasePick();
    w.frame();
    w.frame();
    expect(bulb.parent).toBe(w.rt.environment.root);
    expect(w.center(bulb)[0]).toBeCloseTo(x - 250, 0);
  });

  /** Opens the goodies box and drags `name` out of it, 250 to the left. */
  const takeOut = (w: ReturnType<typeof setup>, name: string) => {
    if (!w.rt.hasProp(w.goodies, 'Toolboxopen')) w.click(w.goodies);
    const o = w.goodies.children.find((c) => c.name === name)!;
    w.at(...w.center(o), Z);
    w.controls.pressPick(false);
    w.frame();
    w.move(-150, 0);
    w.move(-100, 0);
    w.controls.releasePick();
    w.frame();
    w.frame();
    return o;
  };

  it('the light bulb and the camera go back in when dropped on their box (dunked)', () => {
    const w = setup();
    for (const name of ['Lightbulb', 'Nikon']) {
      const o = takeOut(w, name);
      expect(o.parent).toBe(w.rt.environment.root);
      const from = w.center(o);
      const to = w.center(w.goodies);
      w.at(...from, Z);
      w.controls.pressPick(false);
      w.frame();
      w.move(to[0] - from[0], to[1] - from[1]);
      // The box stays selectable under the goodie being dragged over it.
      expect(w.rt.vm.props.has(w.goodies, P.Selectable)).toBe(true);
      w.controls.releasePick();
      w.frame();
      w.frame();
      expect(o.parent).toBe(w.goodies);
      expect(visible(w, o)).toBe(false);
      expect(w.rt.hasProp(w.goodies, 'Toolboxopen')).toBe(false);
    }
  });

  it("dragging the camera's lens aims the camera (lens.cpl, rotate_camera)", () => {
    const w = setup();
    const nikon = takeOut(w, 'Nikon');
    const lens = nikon.children[0]!;
    const b = w.rt.bbox(lens)!;
    w.at(...w.center(lens), (b[0][2] + b[1][2]) / 2);
    w.frame();
    const before = [...nikon.xform];
    const dir = () => [nikon.xform[8]!, nikon.xform[9]!, nikon.xform[10]!];
    expect(dir()[1]).toBeCloseTo(0, 5);
    w.controls.pressPick(false);
    w.frame();
    w.move(0, 40);
    w.move(0, 40);
    w.controls.releasePick();
    w.frame();
    expect(nikon.xform).not.toEqual(before);
    // Pulled up, the lens now looks up.
    expect(dir()[1]).toBeGreaterThan(0.3);
    expect(nikon.parent).toBe(w.rt.environment.root);
  });

  /** `thing` (the cube) picked whole at its middle and dragged to `to`, at depth `z`; `held` runs before it's let go. */
  const drag = (
    w: ReturnType<typeof setup>,
    to: readonly [number, number],
    thing: CutObject = w.cube,
    z = Z,
    held?: () => void,
  ) => {
    const b = w.rt.branchBox(thing)!;
    const from = [0, 1, 2].map((k) => (b[0][k]! + b[1][k]!) / 2) as [number, number, number];
    w.at(...from);
    w.controls.pressPick(false);
    w.frame();
    for (let i = 1; i <= 20; i++)
      w.move((to[0] - from[0]) / 20, (to[1] - from[1]) / 20, (z - from[2]) / 20);
    // (What's under the crosshair is found after each frame's code: one more to see it.)
    if (held) {
      w.frame();
      held();
    }
    w.controls.releasePick();
    w.frame();
    w.frame();
    w.frame();
  };
  /** What is at the cube (picked whole at its middle) dragged onto `box`, at the box's depth. */
  const dropOn = (w: ReturnType<typeof setup>, box: CutObject, thing: CutObject = w.cube) =>
    drag(w, w.center(box), thing);
  const size = (w: ReturnType<typeof setup>, o: CutObject) => {
    const b = w.rt.branchBox(o)!;
    return [0, 1, 2].map((k) => b[1][k]! - b[0][k]!);
  };
  const added = (w: ReturnType<typeof setup>) =>
    w.prims.children.filter((c) => w.rt.hasProp(c, 'Stamp')).slice(5);

  it('a thing dropped on the goodies box stays in the world (only the primitives box takes it)', () => {
    const w = setup();
    dropOn(w, w.goodies);
    expect(w.rt.worldOf(w.cube)).toBe(w.rt.primary);
    expect(visible(w, w.cube)).toBe(true);
    expect(w.rt.hasProp(w.cube, 'Stamp')).toBe(false);
  });

  it('a group dropped on the primitives box goes in whole, and stamps out whole', () => {
    const w = setup();
    installToolbars(w.rt, read, ['toolpads.rsc', 'arrangepads.rsc']);
    const other = createObject(createCube(100, 100, 100), {
      name: 'Other',
      xform: mat4.translation(150, -50, -50),
    });
    other.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [other]);
    for (const [x, shift] of [
      [0, false],
      [200, true],
    ] as const) {
      w.at(x, 0, 0);
      w.controls.pressPick(shift);
      w.frame();
      w.controls.releasePick();
      w.frame();
    }
    w.controls.group();
    for (let i = 0; i < 3; i++) w.frame();
    const group = w.cube.parent!;
    expect(w.rt.hasProp(group, 'Grouper')).toBe(true);
    dropOn(w, w.prims);
    // In the box, all of it: put away with the box, nothing left showing by it.
    expect(group.parent).toBe(w.prims);
    expect([...subtree(w.rt.primary.root)].filter((o) => o.brep.numFaces > 0)).toEqual([]);
    for (const o of subtree(group)) {
      expect(w.rt.hasProp(o, 'Stamp')).toBe(true);
      expect(visible(w, o)).toBe(false);
    }
    // Opened, it's stacked with the others, above the box.
    w.click(w.prims);
    expect([w.cube, other].every((o) => visible(w, o))).toBe(true);
    expect(w.rt.bbox(other)![0][1]).toBeGreaterThan(w.rt.bbox(w.prims)![1][1]);
    // A part of it picked: the whole group stamped into the world, plain, picked.
    w.click(other);
    const copy = [...subtree(w.rt.primary.root)].find((o) => w.rt.hasProp(o, 'Grouper'));
    expect(copy).toBeDefined();
    // (Copies go unnamed.)
    expect(copy!.children.map((c) => c.brep.numFaces)).toEqual(group.children.map((c) => c.brep.numFaces)); // prettier-ignore
    expect(copy!.children).toHaveLength(2);
    for (const o of subtree(copy!))
      for (const p of ['Stamp', 'Hideable', 'Lockedgeometry'])
        expect(w.rt.hasProp(o, p)).toBe(false);
    expect(w.rt.picked()).toEqual([copy]);
    // The box closes, the group still in it.
    expect(w.rt.hasProp(w.prims, 'Toolboxopen')).toBe(false);
    expect(group.parent).toBe(w.prims);
    expect(visible(w, other)).toBe(false);
  });

  it('a thing dropped in is shown smaller there, and its copies come out its own size', () => {
    const w = setup();
    dropOn(w, w.prims);
    expect(added(w)).toEqual([w.cube]);
    expect(Math.max(...size(w, w.cube))).toBeCloseTo(85 / 2, 6);
    w.click(w.prims);
    w.click(w.cube);
    const copy = w.rt.picked()[0] as CutObject;
    expect(w.rt.worldOf(copy)).toBe(w.rt.primary);
    for (const d of size(w, copy)) expect(d).toBeCloseTo(200, 6);
    // In the room still, grown at the top of the stack by the back wall.
    const b = w.rt.branchBox(copy)!;
    for (const k of [0, 1, 2]) {
      expect(b[0][k]!).toBeGreaterThanOrEqual(ROOM.min[k]! - 1e-6);
      expect(b[1][k]!).toBeLessThanOrEqual(ROOM.max[k]! + 1e-6);
    }
  });

  it('a copy of it dropped back shows red over the box, takes it out, and goes back where it was', () => {
    const w = setup();
    const color = [...w.cube.color];
    dropOn(w, w.prims);
    w.click(w.prims);
    w.click(w.cube);
    const copy = w.rt.picked()[0] as CutObject;
    // Out to the middle of the room, and let go.
    drag(w, [-250, 0], copy, 0);
    expect(w.rt.worldOf(copy)).toBe(w.rt.primary);
    const at = [...copy.xform];
    const red: number[][] = [];
    drag(w, w.center(w.prims), copy, Z, () => red.push([...copy.color]));
    expect(red).toEqual([[255, 0, 0]]);
    // Out of the box; the copy where it was, its own colour, not picked.
    expect(added(w)).toEqual([]);
    expect(w.cube.parent).toBeNull();
    expect(w.rt.worldOf(copy)).toBe(w.rt.primary);
    expect([...copy.xform]).toEqual(at);
    expect([...copy.color]).toEqual(color);
    expect(w.rt.picked()).toEqual([]);
    // Another like it dropped in: the copy held over the box and taken away again is its own colour.
    const again = createObject(createCube(200, 200, 200), {
      xform: mat4.translation(100, 0, -100),
    });
    again.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [again]);
    dropOn(w, w.prims, again);
    expect(added(w)).toEqual([again]);
    w.at(...w.center(copy), 0);
    w.controls.pressPick(false);
    w.frame();
    w.at(...w.center(w.prims), Z);
    w.frame();
    const over = [...copy.color];
    w.at(-250, 0, 0);
    w.controls.releasePick();
    w.frame();
    expect(over).toEqual([255, 0, 0]);
    expect([...copy.color]).toEqual(color);
    expect(added(w)).toEqual([again]);
  });

  it("a copy of a 1991 primitive dropped back goes in as one more: those can't be taken out", () => {
    const w = setup();
    w.click(w.prims);
    const cube = w.prims.children.find((c) => w.rt.hasProp(c, 'Stamp'))!;
    w.click(cube);
    const copy = w.rt.picked()[0] as CutObject;
    drag(w, [-250, 0], copy, 0);
    const red: number[][] = [];
    drag(w, w.center(w.prims), copy, Z, () => red.push([...copy.color]));
    expect(red[0]).not.toEqual([255, 0, 0]);
    expect(cube.parent).toBe(w.prims);
    expect(added(w)).toEqual([copy]);
  });

  it('dropped in, many still stack up inside the room, beside the 1991 ones', () => {
    const w = setup();
    const things = Array.from({ length: 10 }, (_, i) => {
      // (Each its own shape: one like another would take that out again.)
      const o = createObject(createCube(60, 120 + i * 10, 60), {
        xform: mat4.translation(-400 + i * 70, 150, -30),
      });
      o.attrs.props = ['Visible'];
      w.rt.importObjects(w.rt.primary, [o]);
      return o;
    });
    for (const o of things) dropOn(w, w.prims, o);
    expect(added(w)).toEqual(things);
    w.click(w.prims);
    const top = w.rt.bbox(w.prims)![1][1];
    for (const o of w.prims.children.filter((c) => w.rt.hasProp(c, 'Stamp'))) {
      const b = w.rt.branchBox(o)!;
      expect(visible(w, o)).toBe(true);
      expect(b[0][1]).toBeGreaterThan(top);
      expect(b[1][1]).toBeLessThan(ROOM.max[1]);
      expect(b[0][0]).toBeGreaterThan(ROOM.min[0]);
    }
  });
});
