import { describe, expect, it } from 'vitest';
import { P, T } from '@cutplane/cpl';
import { createCube, createObject, mat4, validate, volume } from '@cutplane/kernel';
import { GLIDE_MS, isObject, isSub, scaleBoxes } from '../src/index.ts';
import { world } from './world.ts';

const kinds = (fs: { type: number }[]) =>
  fs.map((f) =>
    f.type === T.Obj ? 'object' : f.type === T.Fve ? 'face' : f.type === T.Evf ? 'edge' : 'vertex',
  );

describe('editing through rom.cpl and cursor.cpl', () => {
  it('the crosshair over a face section makes that face selectable', () => {
    const { rt, at } = world();
    at(100, 0, 0); // the cube's right side crosses the plane at x = 100
    expect(kinds(rt.selected())).toEqual(['face']);
    at(0, 0, 0); // inside the section: the whole object
    expect(kinds(rt.selected())).toEqual(['object']);
  });

  it('press picks it (CPnormal), drag moves it, release ends the step; undo puts it back', () => {
    const { rt, cube, controls, frame, at, move } = world();
    at(100, 0, 0);
    controls.pressPick(false);
    frame();
    expect(kinds(rt.picked())).toEqual(['face']);
    move(3, 0); // inside the dead zone: nothing moves
    const xs = () =>
      cube.brep
        .vertices()
        .map((v) => rt.world(cube).x(v))
        .sort((a, b) => a - b);
    expect(Math.max(...xs())).toBe(100);
    move(20, 0); // past it: the face catches up with the crosshair
    expect(Math.max(...xs())).toBe(123);
    controls.releasePick();
    frame();
    expect(rt.canUndo).toBe(true);
    rt.undo();
    expect(Math.max(...xs())).toBe(100);
    rt.redo();
    expect(Math.max(...xs())).toBe(123);
  });

  it('extrude mode: a face pulled out grows walls; pushed in, it stretches; undo restores', () => {
    const { rt, cube, controls, frame, at, move } = world();
    rt.faceDrag = 'extrude';
    const sound = () => {
      const r = validate(cube.brep);
      return r.ok && r.closedManifold;
    };
    at(100, 0, 0);
    controls.pressPick(false);
    frame();
    move(3, 0);
    move(47, 0);
    controls.releasePick();
    frame();
    // 6 faces + 4 walls, the old ones left as they were: 50 more of a 200 × 200 face.
    expect(cube.brep.numFaces).toBe(10);
    expect(sound()).toBe(true);
    expect(volume(cube.brep)).toBeCloseTo(200 ** 3 + 50 * 200 * 200, 3);
    rt.undo();
    expect(cube.brep.numFaces).toBe(6);
    expect(volume(cube.brep)).toBeCloseTo(200 ** 3, 3);

    // Pushed in, it stretches as in the original.
    at(100, 0, 0);
    controls.pressPick(false);
    frame();
    move(-3, 0);
    move(-47, 0);
    controls.releasePick();
    frame();
    expect(cube.brep.numFaces).toBe(6);
    expect(volume(cube.brep)).toBeCloseTo(200 ** 3 - 50 * 200 * 200, 3);
    rt.undo();

    // Pulled out and back again: the walls go, and nothing has changed.
    at(100, 0, 0);
    controls.pressPick(false);
    frame();
    move(3, 0);
    move(47, 0);
    move(-50, 0);
    controls.releasePick();
    frame();
    expect(cube.brep.numFaces).toBe(6);
    expect(sound()).toBe(true);
    expect(volume(cube.brep)).toBeCloseTo(200 ** 3, 3);
  });

  it('stretch mode (the original): a face pulled out stretches the faces around it', () => {
    const { cube, controls, frame, at, move } = world();
    at(100, 0, 0);
    controls.pressPick(false);
    frame();
    move(3, 0);
    move(47, 0);
    controls.releasePick();
    frame();
    expect(cube.brep.numFaces).toBe(6);
    expect(volume(cube.brep)).toBeCloseTo(200 ** 3 + 50 * 200 * 200, 3);
  });

  it('pressing inside the section picks the whole object and drags it', () => {
    const { rt, cube, controls, frame, at, move } = world();
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    expect(rt.picked()).toEqual([cube]);
    expect(rt.vm.props.has(cube, P.Grabbed)).toBe(true);
    move(40, -10);
    expect(cube.xform[12]).toBe(-60);
    expect(cube.xform[13]).toBe(-110);
    controls.releasePick();
    frame();
    expect(rt.vm.props.has(cube, P.Grabbed)).toBe(false);
  });

  it('pressing on nothing starts a marquee; releasing picks what is inside it', () => {
    const { rt, cube, controls, frame, at, move } = world();
    at(-300, -300, 0);
    controls.pressPick(false);
    frame();
    const marquee = rt.environment.root.children.find(
      (o) => o.drawTechnique === 'draw_marquee_technique',
    );
    expect(marquee).toBeDefined();
    move(600, 600);
    controls.releasePick();
    frame();
    expect(rt.picked()).toEqual([cube]);
    // The marquee is gone again.
    expect(
      rt.environment.root.children.some((o) => o.drawTechnique === 'draw_marquee_technique'),
    ).toBe(false);
  });

  it('a click on nothing drops what was picked', () => {
    const { rt, controls, frame, at } = world();
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    at(-400, 300, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    expect(rt.picked()).toEqual([]);
  });

  it('Backspace deletes the picked object (a message to it, CPnormal); undo brings it back', () => {
    const { rt, cube, controls, frame, at } = world();
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    controls.delete();
    frame();
    frame();
    expect(rt.primary.root.children).not.toContain(cube);
    rt.undo();
    expect(rt.primary.root.children).toContain(cube);
    // ...with its properties: drawn and selectable again.
    expect(rt.vm.props.has(cube, P.Visible)).toBe(true);
    expect(cube.attrs.props).toContain('Visible');
  });

  it('D duplicates what is picked, (100, 100, 0) away, and picks the copy', () => {
    const { rt, cube, controls, frame, at } = world();
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    controls.duplicate();
    frame();
    frame();
    // The copy is picked, so it sits in a scale box of its own; the cube's has gone.
    const boxes = scaleBoxes(rt, rt.primary.root);
    expect(boxes).toHaveLength(1);
    const copy = boxes[0]!.children[0];
    expect(copy).toBeDefined();
    expect(cube.parent).toBe(rt.primary.root);
    expect([copy!.xform[12], copy!.xform[13], copy!.xform[14]]).toEqual([0, 0, -100]);
    expect(rt.picked()).toEqual([copy]);
    expect(rt.vm.props.has(cube, P.Picked)).toBe(false);
    // One undoable step (scale boxes changing hands reorder siblings, which is no edit).
    rt.undo();
    expect(rt.primary.root.children).toEqual([cube]);
    // Nothing selectable is left over from before (nor from the copy, which is gone).
    at(100, 100, 100);
    expect(kinds(rt.selected())).toEqual(['vertex']);
    expect(rt.vm.props.features(rt.primary, P.Visible)).toEqual([cube]);
    // Redo brings the copy back, drawn.
    rt.redo();
    const back = rt.primary.root.children.find((o) => o !== cube)!;
    expect(rt.vm.props.has(back, P.Visible)).toBe(true);
  });

  it('Space jumps the plane to the back wall and back (cursor.cpl)', () => {
    const { rt, stage, controls, frame } = world();
    const z0 = stage.z;
    // It glides there over GLIDE_MS, eased: a little way at first, all the way at the end.
    const jump = () => {
      controls.planeJump();
      frame();
      const seen: number[] = [];
      for (let t = 0; t <= GLIDE_MS; t += 25) {
        controls.glide(t);
        frame();
        frame();
        seen.push(stage.z);
      }
      expect(controls.planeGliding).toBe(false);
      return seen;
    };
    const there = jump();
    expect(stage.z).toBeCloseTo(-499, 6);
    expect(there[2]).toBeGreaterThan(-499 + (z0 + 499) / 2); // not halfway yet at 50 ms
    for (let i = 1; i < there.length; i++) expect(there[i]!).toBeLessThanOrEqual(there[i - 1]!);
    jump();
    expect(stage.z).toBeCloseTo(z0, 6);
    void rt;
  });

  it('the crosshair object follows the crosshair', () => {
    const { rt, stage, at } = world();
    at(30, 40, 10);
    expect([rt.cursorObj.xform[12], rt.cursorObj.xform[13], rt.cutplane.xform[14]]).toEqual([
      30, 40, 10,
    ]);
    expect(stage.x).toBe(30);
    void mat4;
    void isObject;
    void isSub;
  });
  it('pressing one of several picked things drags them all; a click picks it alone (our rom.cpl)', () => {
    const { rt, cube, controls, frame, at, move } = world();
    const other = createObject(createCube(100, 100, 100), {
      name: 'Other',
      xform: mat4.translation(250, -50, -50),
    });
    rt.importObjects(rt.primary, [other]);
    const tap = (shift: boolean) => {
      controls.pressPick(shift);
      frame();
      controls.releasePick();
      frame();
      frame();
    };
    at(0, 0, 0);
    tap(false);
    at(300, 0, 0);
    tap(true); // Shift adds it
    expect(new Set(rt.picked())).toEqual(new Set([cube, other]));
    const x0 = [rt.bbox(cube)![0][0], rt.bbox(other)![0][0]];
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    move(40, 0);
    move(40, 0);
    controls.releasePick();
    frame();
    frame();
    expect(rt.bbox(cube)![0][0]).toBeCloseTo(x0[0]! + 80);
    expect(rt.bbox(other)![0][0]).toBeCloseTo(x0[1]! + 80);
    expect(new Set(rt.picked())).toEqual(new Set([cube, other]));
    // A click without a drag on one of them: just that one.
    at(80, 0, 0);
    tap(false);
    expect(rt.picked()).toEqual([cube]);
  });
});
