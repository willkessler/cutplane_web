import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { initBooleans } from '@cutplane/booleans';
import { P } from '@cutplane/cpl';
import { createCube, createObject, mat4, type CutObject } from '@cutplane/kernel';
import { installToolbars, isObject, isScaleBox, isSub } from '../src/index.ts';
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

/** The arrange pads: 0 magnifier, 1 group, 2 pan, 3 magnet, 4 grabber. */
function setup() {
  const w = world();
  const [, arrangers] = installToolbars(w.rt, read, ['toolpads.rsc', 'arrangepads.rsc']);
  w.at(0, 0, 0);
  w.frame();
  const center = (o: CutObject): [number, number] => {
    const b = w.rt.bbox(o)!;
    return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  };
  const click = (at: CutObject | [number, number]) => {
    const [x, y] = Array.isArray(at) ? at : center(at);
    w.at(x, y);
    w.controls.pressPick(false);
    w.frame();
    w.controls.releasePick();
    w.frame();
    w.frame();
  };
  const take = (i: number) => {
    if (!w.rt.vm.props.has(arrangers!.children[0]!, P.Visible)) click(arrangers!);
    const pad = arrangers!.children[0]!.children[i]!.children[0]!;
    const tool = pad.children[0]!;
    click(pad);
    expect(tool.parent).toBe(w.rt.cursorObj);
    return { pad, tool };
  };
  const drag = (from: [number, number], by: [number, number], steps = 10) => {
    w.at(...from);
    w.frame();
    w.controls.pressPick(false);
    w.frame();
    for (let i = 0; i < steps; i++) w.move(by[0] / steps, by[1] / steps);
    w.controls.releasePick();
    w.frame();
    w.frame();
  };
  const add = (name: string, x: number, y: number, z = -50, s = 100) => {
    const o = createObject(createCube(s, s, s), { name, xform: mat4.translation(x, y, z) });
    o.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [o]);
    w.rt.commit();
    w.frame();
    return o;
  };
  const picked = () =>
    w.rt
      .picked()
      .map((f) => (isObject(f) ? f.name : isSub(f) ? `${f.object.name}:${f.type}` : '?'));
  return { ...w, center, click, take, drag, add, picked };
}

describe('the grabber (grabber.cpl)', () => {
  it('picks whole objects, even where a click would take a face', () => {
    const w = setup();
    const { tool } = w.take(4);
    expect(w.rt.hasProp(tool, 'Grabber')).toBe(true);
    w.click([60, 60]);
    expect(w.picked()).toEqual(['Cube']);
  });
});

describe('the pan tool (pan.cpl)', () => {
  it('dragging moves the whole world', () => {
    const w = setup();
    const other = w.add('Other', 200, 100);
    w.take(2);
    const a = w.rt.bbox(w.cube)![0];
    const b = w.rt.bbox(other)![0];
    w.drag([150, -250], [50, -30]); // on nothing (clear of the rails and tools)
    expect(w.rt.bbox(w.cube)![0][0]).toBeCloseTo(a[0] + 50, 6);
    expect(w.rt.bbox(w.cube)![0][1]).toBeCloseTo(a[1] - 30, 6);
    expect(w.rt.bbox(other)![0][0]).toBeCloseTo(b[0] + 50, 6);
  });
});

describe('the magnifier (zoom.cpl, do_zoom)', () => {
  it('dragging up zooms the world in about the crosshair', () => {
    const w = setup();
    w.take(0);
    const size = () => {
      const b = w.rt.bbox(w.cube)!;
      return b[1][0] - b[0][0];
    };
    expect(size()).toBeCloseTo(200, 6);
    w.drag([0, 0], [0, 40]);
    expect(size()).toBeCloseTo(200 * 1.01 ** 40, 3);
  });
});

describe('the magnet (magnetic.cpl, snap_features_together)', () => {
  it("a face grabbed with the magnet turns and lies flush on the face it's let go on", () => {
    const w = setup();
    // A cube turned 30° about z, its left face through (300, 0).
    const other = w.add('Other', 300, -50);
    other.xform = mat4.multiply(other.xform, mat4.rotationAbout([300, 0, 0], [0, 0, 1], Math.PI / 6)); // prettier-ignore
    other.invXform = mat4.invert(other.xform)!;
    w.rt.changed(other);
    w.frame();
    w.take(3);
    // Grab the cube's right face (x = 100) and let go on the other's left face.
    w.drag([100, 0], [200, 0]);
    // The cube's right face now faces the other's left face, in its plane.
    const n = [-Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6), 0]; // the other's left face
    const g = w.rt.world(w.cube);
    const verts = w.cube.brep.vertices().map((v) => [g.x(v), g.y(v)] as const);
    const along = verts.map((p) => (p[0] - 300) * n[0]! + p[1] * n[1]!);
    // Every vertex is on the far side of the face, and the nearest are on it.
    expect(Math.max(...along)).toBeCloseTo(200, 3);
    expect(Math.min(...along)).toBeCloseTo(0, 3);
    expect(w.rt.bbox(w.cube)![1][2] - w.rt.bbox(w.cube)![0][2]).toBeCloseTo(200, 3);
  });

  it('grabbing an object (not a face or an edge) does nothing', () => {
    const w = setup();
    w.take(3);
    const before = Float64Array.from(w.cube.xform);
    w.drag([0, 0], [50, 0]);
    expect([...w.cube.xform]).toEqual([...before]);
  });
});

describe('the group tool (group.cpl)', () => {
  it('G groups what is picked under a new grouper; G on one group ungroups it', () => {
    const w = setup();
    const other = w.add('Other', 250, -50);
    w.click([0, 0]);
    w.controls.pressPick(true);
    w.frame();
    w.controls.releasePick();
    w.frame();
    w.at(300, 0);
    w.controls.pressPick(true);
    w.frame();
    w.controls.releasePick();
    w.frame();
    w.frame();
    // (Picked objects are wrapped in their scale boxes.)
    const inner = () =>
      w.rt.pickedObjects().flatMap((o) => (isScaleBox(w.rt, o) ? o.children : [o]));
    expect(
      inner()
        .map((o) => o.name)
        .sort(),
    ).toEqual(['Cube', 'Other']);
    w.controls.group();
    w.frame();
    w.frame();
    w.frame();
    const g = w.cube.parent!;
    expect(w.rt.hasProp(g, 'Grouper')).toBe(true);
    expect(other.parent).toBe(g);
    expect(inner()).toEqual([g]);
    // One drag moves both.
    const a = w.rt.bbox(other)![0][0];
    w.drag([0, 0], [40, 0]);
    expect(w.rt.bbox(other)![0][0]).toBeCloseTo(a + 40, 3);
    // And G again takes them apart.
    w.click([0, 0]);
    w.controls.group();
    w.frame();
    w.frame();
    expect(w.rt.primary.root.children.some((o) => w.rt.hasProp(o, 'Grouper'))).toBe(false);
    // Picked, they sit in their scale box; let go, they're back at the top of the world.
    w.click([150, -250]);
    expect(w.cube.parent).toBe(w.rt.primary.root);
    expect(other.parent).toBe(w.rt.primary.root);
  });
});
