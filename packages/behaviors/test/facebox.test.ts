import { describe, expect, it } from 'vitest';
import { P, T } from '@cutplane/cpl';
import { createObject, createOvalCylinder, mat4, validate, type CutObject } from '@cutplane/kernel';
import { isFaceBox, scaleBoxes } from '../src/index.ts';
import { world } from './world.ts';

type W = ReturnType<typeof world>;

const faceBoxes = (w: W) => scaleBoxes(w.rt, w.rt.primary.root).filter(isFaceBox);

/** The world positions of `o`'s vertices at depth z. */
const ring = (w: W, o: CutObject, z: number) => {
  const g = w.rt.world(o);
  return o.brep
    .vertices()
    .filter((v) => Math.abs(g.z(v) - z) < 1e-6)
    .map((v) => [g.x(v), g.y(v)] as const);
};
const span = (ps: readonly (readonly [number, number])[], k: 0 | 1) => {
  const xs = ps.map((p) => p[k]);
  return [Math.min(...xs), Math.max(...xs)];
};

/** A click at (x, y) with the plane at z: picks what is there. */
function click(w: W, x: number, y: number, z: number) {
  w.at(x, y, z);
  w.controls.pressPick(false);
  w.frame();
  w.controls.releasePick();
  w.frame();
}

/** A drag of the handle at (x, y) by (dx, dy), in two moves, Ctrl held or not. */
function drag(w: W, x: number, y: number, dx: number, dy: number, ctrl = false) {
  w.at(x, y);
  if (ctrl) {
    w.controls.setConstrain(true);
    w.frame();
  }
  expect(w.rt.selected().map((f) => f.type)).toEqual([T.Vfe]);
  w.controls.pressPick(false);
  w.frame();
  w.move(dx / 2, dy / 2);
  w.move(dx / 2, dy / 2);
  w.controls.releasePick();
  w.frame();
  if (ctrl) {
    w.controls.setConstrain(false);
    w.frame();
  }
}

describe('a box round faces picked in the plane (new here)', () => {
  it('comes with a face picked in the plane, flat and 20 out, and goes when the plane leaves it', () => {
    const w = world();
    click(w, 0, 0, 100); // the cube's front face, in the plane
    const picked = w.rt.picked();
    expect(picked.map((f) => f.type)).toEqual([T.Fve]);
    const [box] = faceBoxes(w);
    expect(box).toBeDefined();
    const bb = w.rt.bbox(box!)!;
    expect(bb[0]).toEqual([-120, -120, 100]);
    expect(bb[1]).toEqual([120, 120, 100]);
    expect(w.rt.canUndo).toBe(false);
    // Off the face, the box goes (the face stays picked); back on it, it comes back.
    w.at(0, 0, 60);
    expect(faceBoxes(w)).toHaveLength(0);
    expect(w.rt.vm.props.has(picked[0]!, P.Picked)).toBe(true);
    w.at(0, 0, 100);
    expect(faceBoxes(w)).toHaveLength(1);
  });

  it('a corner scales the face about the opposite corner; one step, which undo takes back', () => {
    const w = world();
    click(w, 0, 0, 100);
    drag(w, 120, 120, -60, 0); // x: 240 → 180 about x = -120
    const front = ring(w, w.cube, 100);
    expect(span(front, 0)[0]).toBeCloseTo(-120 + 20 * 0.75);
    expect(span(front, 0)[1]).toBeCloseTo(-120 + 220 * 0.75);
    expect(span(front, 1)).toEqual([-100, 100]);
    expect(span(ring(w, w.cube, -100), 0)).toEqual([-100, 100]); // the back stays
    expect(validate(w.cube.brep).closedManifold).toBe(true);
    expect(w.stage.x).toBeCloseTo(60); // the crosshair stayed on the handle
    expect(w.stage.z).toBe(100); // and the plane on the face
    expect(w.rt.undo()).toBe(true);
    expect(span(ring(w, w.cube, 100), 0)).toEqual([-100, 100]);
  });

  it('with Ctrl, a cylinder’s end draws in about its axis: a truncated cone, its sides whole', () => {
    const w = world();
    const cyl = createObject(createOvalCylinder(50, 50, 100, 72), {
      name: 'Cylinder',
      xform: mat4.translation(300, 0, 0),
    });
    cyl.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [cyl]);
    const g = w.rt.world(cyl);
    const zs = cyl.brep.vertices().map((v) => g.z(v));
    const top = Math.max(...zs);
    const faces = cyl.brep.numFaces;
    click(w, 300, 0, top);
    expect(w.rt.picked().map((f) => f.type)).toEqual([T.Fve]);
    expect(faceBoxes(w)).toHaveLength(1);
    // The box's corner is at (370, 70); pushed in along the diagonal, by 35 each way.
    drag(w, 370, 70, -35, -35, true);
    const end = ring(w, cyl, top);
    const s = 1 - (35 * 70 * 2) / (2 * 70 * 70);
    for (const k of [0, 1] as const) {
      const [lo, hi] = span(end, k);
      expect((lo + hi) / 2).toBeCloseTo(k === 0 ? 300 : 0); // on its axis
      expect(hi - lo).toBeCloseTo(100 * s);
    }
    expect(span(ring(w, cyl, Math.min(...zs)), 0)).toEqual([250, 350]);
    expect(cyl.brep.numFaces).toBe(faces); // each side still one (flat) face
    expect(validate(cyl.brep).closedManifold).toBe(true);
  });

  it('without Ctrl, a cylinder’s end goes oval: sides it would bend are split, and the solid stays sound', () => {
    const w = world();
    const cyl = createObject(createOvalCylinder(50, 50, 100, 24), {
      name: 'Cylinder',
      xform: mat4.translation(300, 0, 0),
    });
    cyl.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [cyl]);
    const g = w.rt.world(cyl);
    const top = Math.max(...cyl.brep.vertices().map((v) => g.z(v)));
    click(w, 300, 0, top);
    drag(w, 370, 70, -40, 0); // x only, about the box's far side
    const end = ring(w, cyl, top);
    expect(span(end, 1)).toEqual([-50, 50]);
    expect(span(end, 0)[1] - span(end, 0)[0]).toBeCloseTo((100 * 100) / 140); // the box: 140 → 100 across
    expect(validate(cyl.brep).closedManifold).toBe(true);
  });

  it('no box for an edge, a vertex, a face out of the plane or a whole object (it has its own)', () => {
    const w = world();
    click(w, 0, 0, 0); // inside the cube's section: the whole cube
    expect(faceBoxes(w)).toHaveLength(0);
    expect(scaleBoxes(w.rt, w.rt.primary.root)).toHaveLength(1);
  });
});
