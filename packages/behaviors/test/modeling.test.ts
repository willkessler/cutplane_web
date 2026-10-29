import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { initBooleans } from '@cutplane/booleans';
import { BOOL_OP, P } from '@cutplane/cpl';
import {
  Brep,
  createCube,
  createObject,
  makeLamina,
  mat4,
  validate,
  volume,
  type CutObject,
} from '@cutplane/kernel';
import { booleanObjects, installToolbars } from '../src/index.ts';
import { world } from './world.ts';

beforeAll(() => initBooleans());

const ASSETS = resolve(import.meta.dirname, '../../../assets');
const read = (f: string) => {
  // cutplane_web's own (the rails with the union pad) first, else the original's.
  for (const dir of ['rsc', 'icons', 'original/rsc', 'original/icons']) {
    const p = join(ASSETS, dir, f);
    if (existsSync(p)) return readFileSync(p, 'latin1');
  }
  throw new Error(`${f}: not found`);
};

function setup() {
  const w = world();
  const [tools] = installToolbars(w.rt, read, ['toolpads.rsc']);
  w.at(0, 0, 0);
  w.frame();
  const center = (o: CutObject): [number, number] => {
    const b = w.rt.bbox(o)!;
    return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  };
  const click = (o: CutObject | [number, number]) => {
    const [x, y] = Array.isArray(o) ? o : center(o);
    w.at(x, y);
    w.controls.pressPick(false);
    w.frame();
    w.controls.releasePick();
    w.frame();
    w.frame();
  };
  /** Opens the toolpads rail and takes the tool off pad `i` (0 pencil, 1 saw, 2 drill). */
  const take = (i: number) => {
    if (!w.rt.hasProp(tools!, 'Open') && !w.rt.vm.props.has(tools!.children[0]!, P.Visible))
      click(tools!);
    const pad = tools!.children[0]!.children[i]!.children[0]!;
    const tool = pad.children[0]!;
    click(pad);
    expect(tool.parent).toBe(w.rt.cursorObj);
    return { pad, tool };
  };
  const solids = () => w.rt.primary.root.children.filter((o) => o.brep.numFaces > 0);
  return { ...w, tools: tools!, center, click, take, solids };
}

/** Newell's normal of a loop: twice its area long. */
const newell = (l: readonly (readonly number[])[]) =>
  l.reduce(
    (n, a, i) => {
      const b = l[(i + 1) % l.length]!;
      return [
        n[0]! + (a[1]! - b[1]!) * (a[2]! + b[2]!),
        n[1]! + (a[2]! - b[2]!) * (a[0]! + b[0]!),
        n[2]! + (a[0]! - b[0]!) * (a[1]! + b[1]!),
      ];
    },
    [0, 0, 0],
  );

const sound = (o: CutObject) => {
  const r = validate(o.brep);
  return r.ok && r.closedManifold;
};

describe('booleans on objects (do_boolean)', () => {
  it('A less B: A takes the result, B is gone; one undo puts both back', () => {
    const w = setup();
    const a = w.cube;
    const b = createObject(createCube(100, 100, 400), { xform: mat4.translation(-50, -50, -200) });
    b.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [b]);
    w.rt.commit();
    const out = booleanObjects(w.rt, a, b, BOOL_OP.Subtraction);
    expect(out).toEqual([a]);
    expect(sound(a)).toBe(true);
    expect(volume(a.brep)).toBeCloseTo(200 ** 3 - 100 * 100 * 200, 3);
    w.frame();
    expect(w.solids()).toEqual([a]);
    expect(w.rt.undo()).toBe(true);
    expect(w.solids()).toHaveLength(2);
    expect(volume(w.cube.brep)).toBeCloseTo(200 ** 3, 3);
  });
});

describe('the B key: union what is picked', () => {
  it('two overlapping picked objects become one, still picked; one undo parts them', () => {
    const w = setup();
    const b = createObject(createCube(200, 200, 200), {
      name: 'B',
      xform: mat4.translation(0, 0, -100),
    });
    b.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [b]);
    w.rt.commit();
    w.rt.pick(w.cube);
    w.rt.pick(b);
    w.controls.union();
    w.frame();
    expect(w.solids()).toHaveLength(1);
    const [u] = w.solids();
    expect(sound(u!)).toBe(true);
    expect(volume(u!.brep)).toBeCloseTo(200 ** 3 * 2 - 100 * 100 * 200, 3);
    expect(w.rt.picked()).toEqual([u]);
    expect(w.rt.undo()).toBe(true);
    expect(w.solids()).toHaveLength(2);
  });

  it('laminas lying in one plane (pieces of a plan) are joined as one face, the line between gone', () => {
    const w = setup();
    // Two flat pieces side by side up at y = 300, and one beside them standing up.
    const flat = (pts: [number, number, number][]) => {
      const b = new Brep();
      makeLamina(b, pts);
      const o = createObject(b, { name: 'piece' });
      o.attrs.props = ['Visible'];
      w.rt.importObjects(w.rt.primary, [o]);
      return o;
    };
    const a = flat([[0, 300, 0], [100, 300, 0], [100, 300, -100], [0, 300, -100]]); // prettier-ignore
    const b = flat([[100, 300, -100], [100, 300, 0], [200, 300, 0], [200, 300, -40], [100, 300, -40]].reverse() as [number, number, number][]); // prettier-ignore
    const up = flat([[0, 300, 0], [0, 400, 0], [100, 400, 0]]); // prettier-ignore
    w.rt.commit();
    const before = w.solids().length;
    // Not in one plane: B does nothing (as solids, laminas would come to nothing).
    for (const o of [a, up]) w.rt.pick(o);
    w.controls.union();
    w.frame();
    expect(w.solids()).toHaveLength(before);
    w.rt.unpick(up);
    w.rt.pick(b);
    w.controls.union();
    w.frame();
    expect(w.solids()).toHaveLength(before - 1);
    // One of them holds the join, and is picked.
    expect(w.rt.picked()).toHaveLength(1);
    const u = w.rt.picked()[0] as CutObject;
    expect([a, b]).toContain(u);
    // One lamina: an L of six corners (the corner where b met a's side is gone too), 14000 in area.
    expect(u.brep.numFaces).toBe(2);
    const [f] = u.brep.faces();
    const ring = u.brep.loopHalfEdges(u.brep.faceLoop(f!));
    expect(ring).toHaveLength(6);
    expect(Math.abs(newell(ring.map((h) => u.brep.vertexPos(u.brep.heVertex(h))))[1]) / 2).toBeCloseTo(14000); // prettier-ignore
    expect(validate(u.brep).ok).toBe(true);
    expect(w.rt.undo()).toBe(true);
    expect(w.solids()).toHaveLength(before);
  });

  it('one object picked: nothing happens', () => {
    const w = setup();
    w.rt.pick(w.cube);
    w.controls.union();
    w.frame();
    expect(w.solids()).toEqual([w.cube]);
    expect(volume(w.cube.brep)).toBeCloseTo(200 ** 3, 3);
  });
});

describe('the saw (slice.cpl, slice_object)', () => {
  it('a click with the saw cuts what is under the crosshair in two at the plane', () => {
    const w = setup();
    const { pad, tool } = w.take(1);
    expect(tool.name).toBe('Saw');
    w.at(40, 30, 0);
    w.frame();
    w.click([40, 30]);
    const pieces = w.solids();
    expect(pieces).toHaveLength(2);
    for (const p of pieces) {
      expect(sound(p)).toBe(true);
      expect(volume(p.brep)).toBeCloseTo(200 * 200 * 100, 3);
    }
    // Pulled 10 apart either side of the plane, so the cut shows.
    const [back, front] = [...pieces].sort((a, b) => w.rt.bbox(a)![0][2] - w.rt.bbox(b)![0][2]);
    expect(w.rt.bbox(back!)![1][2]).toBeCloseTo(-10, 6);
    expect(w.rt.bbox(front!)![0][2]).toBeCloseTo(10, 6);
    // The saw goes back to its pad once used.
    expect(tool.parent).toBe(pad);
    // One step undoes the cut.
    expect(w.rt.undo()).toBe(true);
    expect(w.solids()).toHaveLength(1);
    expect(volume(w.solids()[0]!.brep)).toBeCloseTo(200 ** 3, 3);
  });

  it('a part of a group is cut too, its halves parting while the group stays put', () => {
    const w = setup();
    const body = createObject(createCube(50, 50, 50), { name: 'Body', xform: mat4.translation(-450, -25, -25) }); // prettier-ignore
    const part = createObject(createCube(100, 100, 100), { name: 'Part', xform: mat4.translation(250, -50, -50) }); // prettier-ignore
    body.attrs.props = ['Visible'];
    part.attrs.props = ['Visible'];
    part.linked = false;
    part.parent = body;
    body.children = [part];
    w.rt.importObjects(w.rt.primary, [body]);
    w.rt.commit();
    w.frame();
    w.take(1);
    w.click([300, 0]);
    expect(body.children).toHaveLength(2);
    const [back, front] = [...body.children].sort((a, b) => w.rt.bbox(a)![0][2] - w.rt.bbox(b)![0][2]); // prettier-ignore
    expect(w.rt.bbox(back!)![1][2]).toBeCloseTo(-10, 6);
    expect(w.rt.bbox(front!)![0][2]).toBeCloseTo(10, 6);
    expect(w.rt.bbox(body)![0]).toEqual([-450, -25, -25]);
  });

  it('a group picked whole stays picked when the saw is taken, and one click cuts all of it', () => {
    const w = setup();
    const body = createObject(createCube(100, 100, 100), { name: 'Body', xform: mat4.translation(-300, -50, -50) }); // prettier-ignore
    const part = createObject(createCube(100, 100, 100), { name: 'Part', xform: mat4.translation(250, -50, -50) }); // prettier-ignore
    body.attrs.props = ['Visible'];
    part.attrs.props = ['Visible'];
    part.linked = false;
    part.parent = body;
    body.children = [part];
    w.rt.importObjects(w.rt.primary, [body]);
    w.rt.commit();
    w.frame();
    w.click([300, 0]);
    expect(w.rt.picked()).toEqual([body]);
    w.take(1);
    expect(w.rt.picked()).toEqual([body]);
    // The click lands on the part; the body, picked with it, is cut too.
    w.click([300, 0]);
    const zs = (o: CutObject) => [w.rt.bbox(o)![0][2], w.rt.bbox(o)![1][2]];
    const pieces = [body, ...body.children].filter((o) => o !== w.cube);
    expect(pieces).toHaveLength(4);
    expect(pieces.map(zs).sort((a, b) => a[0]! - b[0]!)).toEqual([[-60, -10], [-60, -10], [10, 60], [10, 60]].map((r) => r.map((v) => expect.closeTo(v, 6)))); // prettier-ignore
  });

  it('\\ cuts a picked group whole, every part parting', () => {
    const w = setup();
    const body = createObject(createCube(100, 100, 100), { name: 'Body', xform: mat4.translation(-300, -50, -50) }); // prettier-ignore
    const part = createObject(createCube(100, 100, 100), { name: 'Part', xform: mat4.translation(250, -50, -50) }); // prettier-ignore
    body.attrs.props = ['Visible'];
    part.attrs.props = ['Visible'];
    part.linked = false;
    part.parent = body;
    body.children = [part];
    w.rt.importObjects(w.rt.primary, [body]);
    w.rt.commit();
    w.frame();
    w.click([300, 0]);
    w.controls.slice();
    w.frame();
    expect(body.children).toHaveLength(3);
    const fronts = [body, ...body.children].filter((o) => w.rt.bbox(o)![0][2] > 0);
    expect(fronts).toHaveLength(2);
    expect(w.rt.undo()).toBe(true);
    expect(body.children).toEqual([part]);
  });

  it('\\ cuts a lone object into pieces of their own, each picked and moved alone (cutplane_web)', () => {
    const w = setup();
    w.click([40, 30]);
    w.controls.slice();
    w.frame();
    const pieces = w.solids();
    expect(pieces).toHaveLength(2);
    const front = pieces.find((o) => w.rt.bbox(o)![0][2] > 0)!;
    w.at(0, 0, 50);
    w.click([0, 0]);
    expect(w.rt.picked()).toEqual([front]);
    w.controls.pressPick(false);
    w.frame();
    w.move(0, 40);
    w.controls.releasePick();
    w.frame();
    expect(w.rt.bbox(front)![0][1]).toBeCloseTo(-60);
    expect(w.rt.picked()).toEqual([front]);
  });

  it('clicking on nothing with the saw cuts nothing', () => {
    const w = setup();
    w.take(1);
    w.click([300, 200]);
    expect(w.solids()).toHaveLength(1);
  });
});

describe('the drill (drill.cpl, CPBOOLEAN)', () => {
  it('pressing on a bar makes a red cutter of it; dropped through the cube, it drills a hole', () => {
    const w = setup();
    const bar = createObject(createCube(40, 40, 400), {
      name: 'Bar',
      xform: mat4.translation(-320, -20, -200),
    });
    bar.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [bar]);
    w.rt.commit();
    const { pad, tool } = w.take(2);
    expect(w.rt.hasProp(tool, 'Drill')).toBe(true); // the bit; the body and handle are its children
    w.at(-300, 0, 0);
    w.frame();
    w.controls.pressPick(false);
    w.frame();
    // The cutter: a red copy of the bar, carried by the drill.
    const cutter = tool.children.find((c) => c.color[0] === 155 && c.brep.numFaces > 0);
    expect(cutter).toBeDefined();
    w.move(150, 0);
    w.move(150, 0);
    w.controls.releasePick();
    w.frame();
    w.frame();
    // The cube has a 40 × 40 hole through it; the bar is untouched; the cutter is gone.
    expect(sound(w.cube)).toBe(true);
    expect(volume(w.cube.brep)).toBeCloseTo(200 ** 3 - 40 * 40 * 200, 3);
    expect(w.cube.brep.faces().filter((f) => w.cube.brep.faceLoops(f).length === 2)).toHaveLength(
      2,
    );
    expect(volume(bar.brep)).toBeCloseTo(40 * 40 * 400, 3);
    expect(w.solids().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))).toEqual([
      bar,
      w.cube,
    ]);
    expect(tool.parent).toBe(pad);
    expect(w.rt.undo()).toBe(true);
    expect(volume(w.cube.brep)).toBeCloseTo(200 ** 3, 3);
  });
  it("a hole's walls are the colour of what it was drilled with, not the red cutter's (cutplane_web)", () => {
    const w = setup();
    const bar = createObject(createCube(40, 40, 400), {
      name: 'Bar',
      xform: mat4.translation(-320, -20, -200),
    });
    bar.attrs.props = ['Visible'];
    bar.color = [0, 0, 200];
    w.rt.importObjects(w.rt.primary, [bar]);
    w.rt.commit();
    w.take(2);
    w.at(-300, 0, 0);
    w.frame();
    w.controls.pressPick(false);
    w.frame();
    w.move(150, 0);
    w.move(150, 0);
    w.controls.releasePick();
    w.frame();
    w.frame();
    const b = w.cube.brep;
    // The hole's four walls are blue; the cube's own six faces aren't painted.
    const painted = b.faces().filter((f) => b.faceColors.has(f));
    expect(painted).toHaveLength(4);
    for (const f of painted) expect(b.faceColors.get(f)).toEqual([0, 0, 200]);
    expect(b.faces()).toHaveLength(10);
  });

  it('after a cut, the drilled object is not left selectable from anywhere', () => {
    const w = setup();
    const bar = createObject(createCube(40, 40, 400), {
      name: 'Bar',
      xform: mat4.translation(-320, -20, -200),
    });
    bar.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [bar]);
    w.rt.commit();
    w.take(2);
    w.at(-300, 0, 0);
    w.frame();
    w.controls.pressPick(false);
    w.frame();
    w.move(150, 0);
    w.move(150, 0);
    w.controls.releasePick();
    w.frame();
    w.frame();
    // A reshape used to leave the cube's Selectable on it, so a click on the bar
    // picked the cube too, and the bar could not be picked again.
    w.click([-300, 0]);
    expect(w.rt.picked()).toEqual([bar]);
    w.click([500, 300]);
    expect(w.rt.picked()).toEqual([]);
    w.click([-300, 0]);
    expect(w.rt.picked()).toEqual([bar]);
    w.click([80, 80]);
    expect(w.rt.picked()).toEqual([w.cube]);
  });

  it('let go over a toolpad, the cutter is thrown away and the drill goes home (cutplane_web)', () => {
    const w = setup();
    const bar = createObject(createCube(40, 40, 400), {
      name: 'Bar',
      xform: mat4.translation(-320, -20, -200),
    });
    bar.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [bar]);
    w.rt.commit();
    const { pad, tool } = w.take(2);
    w.at(-300, 0, 0);
    w.frame();
    w.controls.pressPick(false);
    w.frame();
    const [px, py] = w.center(pad);
    for (let i = 1; i <= 10; i++) w.move((px + 300) / 10, py / 10);
    w.controls.releasePick();
    w.frame();
    w.frame();
    // The original left the cutter on the drill, in hand, and every press after made
    // another cutter: nothing could be picked.
    expect(tool.parent).toBe(pad);
    expect(tool.children.some((c) => c.color[0] === 155)).toBe(false);
    expect(w.solids().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))).toEqual([bar, w.cube]); // prettier-ignore
    w.click([-300, 0]);
    expect(w.rt.picked()).toEqual([bar]);
  });

  it('let go anywhere, the cutter takes a bite out of everything it overlaps (new)', () => {
    const w = setup();
    const slab = createObject(createCube(400, 40, 400), {
      name: 'Slab',
      xform: mat4.translation(-500, 300, -200),
    });
    const other = createObject(createCube(200, 200, 200), {
      name: 'Other',
      xform: mat4.translation(150, -100, -100),
    });
    slab.attrs.props = ['Visible'];
    other.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [slab, other]);
    w.rt.commit();
    w.take(2);
    w.at(-480, 320, 0); // near the slab's end
    w.frame();
    w.controls.pressPick(false);
    w.frame();
    // Its cutter carried across the cube and into the other block, the crosshair
    // (at x = -110) is on neither's section; both are selectable, as what it would cut.
    w.move(185, -160);
    w.move(185, -160);
    expect(w.rt.selectableOf(w.cube).feature).toBe(w.cube);
    expect(w.rt.selectableOf(other).feature).toBe(other);
    expect(w.rt.selectableOf(slab).feature).toBe(null);
    w.controls.releasePick();
    w.frame();
    w.frame();
    // The cutter's x is -130 to 270: right through the cube, 120 into the other.
    // Through the cube, the cut leaves it in two.
    const halves = w.solids().filter((o) => o !== slab && o !== other);
    expect(halves).toHaveLength(2);
    expect(volume(w.cube.brep)).toBeCloseTo((200 ** 3 - 200 * 40 * 200) / 2, 3);
    expect(halves.reduce((v, o) => v + volume(o.brep), 0)).toBeCloseTo(200 ** 3 - 200 * 40 * 200, 3); // prettier-ignore
    expect(volume(other.brep)).toBeCloseTo(200 ** 3 - 120 * 40 * 200, 3);
    expect(volume(slab.brep)).toBeCloseTo(400 * 40 * 400, 3);
    expect(w.solids().every(sound)).toBe(true);
    expect(w.rt.undo()).toBe(true);
    expect(w.solids()).toHaveLength(3);
    expect(volume(w.cube.brep)).toBeCloseTo(200 ** 3, 3);
    expect(volume(other.brep)).toBeCloseTo(200 ** 3, 3);
  });

  it('let go where it overlaps nothing, the cutter cuts nothing and is gone', () => {
    const w = setup();
    const bar = createObject(createCube(40, 40, 400), {
      name: 'Bar',
      xform: mat4.translation(-320, -20, -200),
    });
    bar.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [bar]);
    w.rt.commit();
    w.take(2);
    w.at(-300, 0, 0);
    w.frame();
    w.controls.pressPick(false);
    w.frame();
    w.move(0, 300);
    w.controls.releasePick();
    w.frame();
    w.frame();
    expect(volume(w.cube.brep)).toBeCloseTo(200 ** 3, 3);
    expect(volume(bar.brep)).toBeCloseTo(40 * 40 * 400, 3);
    expect(w.solids()).toHaveLength(2);
  });

  it('the cutter leaves the object it was copied from alone', () => {
    const w = setup();
    const bar = createObject(createCube(40, 40, 400), {
      name: 'Bar',
      xform: mat4.translation(-320, -20, -200),
    });
    bar.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [bar]);
    w.rt.commit();
    w.take(2);
    w.at(-300, 0, 0);
    w.frame();
    w.controls.pressPick(false);
    w.frame();
    w.move(20, 0); // half over the bar still
    expect(w.rt.selectableOf(bar).feature).toBe(null);
    w.controls.releasePick();
    w.frame();
    w.frame();
    expect(volume(bar.brep)).toBeCloseTo(40 * 40 * 400, 3);
    expect(w.solids()).toHaveLength(2);
  });

  it('pressing and releasing on one object leaves it whole', () => {
    const w = setup();
    w.take(2);
    w.click(w.cube);
    expect(sound(w.cube)).toBe(true);
    expect(volume(w.cube.brep)).toBeCloseTo(200 ** 3, 3);
    expect(w.solids()).toEqual([w.cube]);
  });
});

describe('the union tool (union.cpl, CPBOOLEAN)', () => {
  const addBar = (w: ReturnType<typeof setup>) => {
    const bar = createObject(createCube(40, 40, 400), {
      name: 'Bar',
      xform: mat4.translation(-320, -20, -200),
    });
    bar.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [bar]);
    w.rt.commit();
    return bar;
  };

  it('pressing on a bar picks it up; let go through the cube, the two become one', () => {
    const w = setup();
    const bar = addBar(w);
    const { pad, tool } = w.take(3);
    expect(w.rt.hasProp(tool, 'Union')).toBe(true);
    w.at(-300, 0, 0);
    w.frame();
    w.controls.pressPick(false);
    w.frame();
    // The bar itself rides with the tool (no copy left behind).
    expect(bar.parent).toBe(tool);
    expect(w.solids()).toEqual([w.cube]);
    w.move(150, 0);
    w.move(150, 0);
    w.controls.releasePick();
    w.frame();
    w.frame();
    expect(w.solids()).toEqual([w.cube]);
    expect(sound(w.cube)).toBe(true);
    expect(volume(w.cube.brep)).toBeCloseTo(200 ** 3 + 40 * 40 * 200, 3);
    expect(tool.parent).toBe(pad);
    // One undo parts them, the bar back where it started.
    expect(w.rt.undo()).toBe(true);
    w.frame();
    expect(w.solids()).toHaveLength(2);
    expect(volume(w.cube.brep)).toBeCloseTo(200 ** 3, 3);
    const back = w.solids().find((o) => o.name === 'Bar')!;
    expect(w.rt.bbox(back)![0][0]).toBeCloseTo(-320);
  });

  it('let go over nothing, what it carried is just put down', () => {
    const w = setup();
    const bar = addBar(w);
    w.take(3);
    w.at(-300, 0, 0);
    w.frame();
    w.controls.pressPick(false);
    w.frame();
    w.move(0, 150);
    w.controls.releasePick();
    w.frame();
    w.frame();
    expect(bar.parent).toBe(w.rt.primary.root);
    expect(volume(bar.brep)).toBeCloseTo(40 * 40 * 400, 3);
    expect(w.rt.bbox(bar)![0][1]).toBeCloseTo(130);
    expect(volume(w.cube.brep)).toBeCloseTo(200 ** 3, 3);
  });
});

describe('the pencil (pencil.cpl, start_draw, extend_draw, end_draw)', () => {
  it('on a surface (draw_on_surface): edge to edge splits the face they share, in one undo', () => {
    const w = setup();
    w.take(0);
    const press = (x: number, y: number) => {
      w.at(x, y, 0);
      w.frame();
      w.controls.pressPick(false);
      w.frame();
      w.controls.releasePick();
      w.frame();
    };
    // The plane cuts the cube's four z edges at its corners: start at one...
    press(100, 100);
    expect(w.rt.vm.props.has(w.rt.line, P.Visible)).toBe(true);
    expect(w.cube.brep.numFaces).toBe(6);
    // ...the white line follows the crosshair...
    w.move(0, -40);
    const [a, b] = w.rt.line.brep.vertices().map((v) => w.rt.line.brep.vertexPos(v));
    expect(a).toEqual([100, 100, 0]);
    expect(b![1]).toBeCloseTo(60);
    // ...and ends at the next corner down the right side: that face is split across.
    press(100, -100);
    w.frame();
    expect(w.rt.vm.props.has(w.rt.line, P.Visible)).toBe(false);
    expect(w.cube.brep.numFaces).toBe(7);
    expect(w.cube.brep.numVertices).toBe(10);
    expect(sound(w.cube)).toBe(true);
    expect(volume(w.cube.brep)).toBeCloseTo(200 ** 3);
    expect(w.solids()).toEqual([w.cube]); // no scribble left behind
    expect(w.rt.undo()).toBe(true);
    expect(w.cube.brep.numFaces).toBe(6);
  });

  it('on a surface: ends with no face in common draw nothing', () => {
    const w = setup();
    w.take(0);
    const press = (x: number, y: number) => {
      w.at(x, y, 0);
      w.frame();
      w.controls.pressPick(false);
      w.frame();
      w.controls.releasePick();
      w.frame();
    };
    press(100, 100);
    press(-100, -100); // diagonally opposite: no face shares both
    expect(w.cube.brep.numFaces).toBe(6);
    expect(w.rt.vm.props.has(w.rt.line, P.Visible)).toBe(false);
  });

  /** Draws a closed stroke through `pts` (offsets from the start) with the pencil down. */
  const draw = (
    w: ReturnType<typeof setup>,
    at: [number, number],
    pts: [number, number][],
    z = 0,
  ) => {
    w.at(at[0], at[1], z);
    w.frame();
    w.controls.pressPick(false);
    w.frame();
    let [x, y] = [0, 0];
    for (const [px, py] of pts) {
      // In small steps, as a hand moves.
      const n = Math.ceil(Math.hypot(px - x, py - y) / 3);
      for (let i = 1; i <= n; i++) w.move((px - x) / n, (py - y) / n);
      [x, y] = [px, py];
    }
    w.controls.releasePick();
    w.frame();
    w.frame();
  };

  it('a closed stroke in the plane becomes a solid, extruded 50 and straddling the plane', () => {
    const w = setup();
    const { tool } = w.take(0);
    expect(w.rt.hasProp(tool, 'Draw')).toBe(true);
    const before = w.solids().length;
    // A triangle beside the cube, drawn in the plane.
    draw(w, [-400, -200], [[120, 0], [60, 100], [0, 0]]); // prettier-ignore
    const made = w.solids().filter((o) => o !== w.cube);
    expect(made).toHaveLength(before);
    const o = made[0]!;
    expect(sound(o)).toBe(true);
    expect(o.brep.faces()).toHaveLength(5); // a triangular prism
    expect(volume(o.brep) / (0.5 * 120 * 100 * 50)).toBeCloseTo(1, 2); // as drawn, near enough
    const b = w.rt.bbox(o)!;
    expect(b[0][2]).toBeCloseTo(-10, 6);
    expect(b[1][2]).toBeCloseTo(40, 6);
    expect(w.rt.undo()).toBe(true);
    expect(w.solids()).toEqual([w.cube]);
  });

  it('a stroke drawn off z = 0 is still flat (CPL words are single precision)', () => {
    const w = setup();
    w.take(0);
    draw(
      w,
      [-300, -150],
      [
        [120, 0],
        [60, 100],
        [0, 0],
      ],
      34.9,
    );
    const made = w.solids().filter((o) => o !== w.cube);
    expect(made).toHaveLength(1);
    const b = w.rt.bbox(made[0]!)!;
    expect(b[0][2]).toBeCloseTo(34.9 - 10, 1); // as at z = 0: from 10 behind to 40 in front
  });

  it('an open stroke is closed with a straight line, then made solid', () => {
    const w = setup();
    w.take(0);
    // An arc, its ends left 150 apart.
    const arc: [number, number][] = [];
    for (let i = 1; i <= 24; i++) {
      const a = (Math.PI * i) / 24;
      arc.push([75 - 75 * Math.cos(a), 75 * Math.sin(a)]);
    }
    draw(w, [-400, -200], arc);
    const made = w.solids().filter((o) => o !== w.cube);
    expect(made).toHaveLength(1);
    expect(sound(made[0]!)).toBe(true);
    expect(volume(made[0]!.brep) / ((Math.PI * 75 * 75) / 2) / 50).toBeGreaterThan(0.9); // a 24-gon
  });

  it('a stroke that crosses itself keeps the largest region it encloses', () => {
    const w = setup();
    w.take(0);
    // A bow tie of two triangles, the right one the bigger, crossing at (100, 50).
    draw(w, [-400, -200], [[200, 100], [200, 0], [0, 100], [0, 0]]); // prettier-ignore
    const made = w.solids().filter((o) => o !== w.cube);
    expect(made).toHaveLength(1);
    expect(sound(made[0]!)).toBe(true);
    expect(volume(made[0]!.brep) / (0.5 * 100 * 100 * 50)).toBeCloseTo(1, 2); // the big triangle
  });

  it('a stroke that overshoots its start is closed where it crosses', () => {
    const w = setup();
    w.take(0);
    // A square drawn from the middle of its bottom edge, ending 30 past the start.
    draw(w, [-400, -200], [[50, 0], [50, 100], [-50, 100], [-50, 0], [30, 0], [30, -20]]); // prettier-ignore
    const made = w.solids().filter((o) => o !== w.cube);
    expect(made).toHaveLength(1);
    expect(sound(made[0]!)).toBe(true);
    expect(volume(made[0]!.brep) / (100 * 100 * 50)).toBeCloseTo(1, 1);
  });

  it('a stroke too small to be a face is thrown away', () => {
    const w = setup();
    w.take(0);
    draw(w, [-400, -200], [[100, 0], [100, 1]]); // prettier-ignore
    expect(w.solids()).toEqual([w.cube]);
    expect(w.rt.primary.root.children.filter((o) => o !== w.cube)).toEqual([]);
  });
});

describe('a tool after a click on nothing (tool.cpl)', () => {
  it('the saw still cuts: the click left no message in its way', () => {
    const w = setup();
    const { tool } = w.take(1);
    w.click([300, 200]);
    w.click([300, 200]);
    expect(tool.parent).toBe(w.rt.cursorObj);
    expect(w.rt.vm.pending(tool)).toHaveLength(0);
    w.at(40, 30, 0);
    w.frame();
    w.click([40, 30]);
    expect(w.solids()).toHaveLength(2);
  });
});
