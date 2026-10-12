import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { initBooleans } from '@cutplane/booleans';
import { BOOL_OP, P } from '@cutplane/cpl';
import { createCube, createObject, mat4, validate, volume, type CutObject } from '@cutplane/kernel';
import { booleanObjects, installToolbars } from '../src/index.ts';
import { world } from './world.ts';

beforeAll(() => initBooleans());

const ORIGINAL = resolve(import.meta.dirname, '../../../assets/original');
const read = (f: string) => {
  for (const dir of ['rsc', 'icons']) {
    const p = join(ORIGINAL, dir, f);
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

  it('pressing and releasing on one object leaves it whole', () => {
    const w = setup();
    w.take(2);
    w.click(w.cube);
    expect(sound(w.cube)).toBe(true);
    expect(volume(w.cube.brep)).toBeCloseTo(200 ** 3, 3);
    expect(w.solids()).toEqual([w.cube]);
  });
});

describe('the pencil (pencil.cpl, start_draw, extend_draw, end_draw)', () => {
  /** Draws a closed stroke through `pts` (offsets from the start) with the pencil down. */
  const draw = (w: ReturnType<typeof setup>, at: [number, number], pts: [number, number][]) => {
    w.at(at[0], at[1], 0);
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
