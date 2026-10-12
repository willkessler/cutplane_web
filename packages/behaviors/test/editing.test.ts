import { describe, expect, it } from 'vitest';
import { P, T } from '@cutplane/cpl';
import { mat4 } from '@cutplane/kernel';
import { isObject, isSub, scaleBoxes } from '../src/index.ts';
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
  });

  it('Space jumps the plane to the back wall and back (cursor.cpl)', () => {
    const { rt, stage, controls, frame } = world();
    const z0 = stage.z;
    controls.planeJump();
    frame();
    frame();
    expect(stage.z).toBe(-499);
    controls.planeJump();
    frame();
    frame();
    expect(stage.z).toBe(z0);
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
});
