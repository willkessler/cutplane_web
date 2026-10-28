import { describe, expect, it } from 'vitest';
import { P, T } from '@cutplane/cpl';
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

  it('extrude mode: a tilted face dragged along its own plane slides, as a stretch does', () => {
    const { rt, controls, frame, at, move } = world();
    rt.faceDrag = 'extrude';
    // A box turned 8° about x, all but (as the Orion's tail end): its back face leans
    // across the plane, and out of square with x by no more than rounding.
    const box = createObject(createCube(100, 100, 100), {
      name: 'Tilted',
      xform: mat4.multiply(
        mat4.multiply(mat4.translation(-50, -50, -50), mat4.rotationAbout([0, 0, 0], [1, 0, 1e-9], 0.14)), // prettier-ignore
        mat4.translation(0, 250, -250),
      ),
    });
    box.attrs.props = ['Visible'];
    rt.importObjects(rt.primary, [box]);
    const g = () => rt.world(box);
    const back = box.brep.faces().find((f) => g().faceNormal(f)[2] < -0.9)!;
    const corners = () => box.brep.loopHalfEdges(box.brep.faceLoop(back)).map((h) => box.brep.heVertex(h)); // prettier-ignore
    const xs = () => corners().map((v) => g().x(v));
    const before = xs();
    // On the back face's section, at its middle depth.
    const ys = corners().map((v) => g().y(v));
    const zs = corners().map((v) => g().z(v));
    at(0, (Math.min(...ys) + Math.max(...ys)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2);
    expect(kinds(rt.selected())).toEqual(['face']);
    // Across, the way its normal leans by that rounding.
    const n = g().faceNormal(back);
    expect(Math.abs(n[0])).toBeGreaterThan(0);
    expect(Math.abs(n[0])).toBeLessThan(1e-6);
    const way = Math.sign(n[0]);
    const faces = box.brep.numFaces;
    controls.pressPick(false);
    frame();
    move(10 * way, 0);
    move(20 * way, 0);
    controls.releasePick();
    frame();
    // Not extruded by nothing (and taken back on release, the move with it): slid across.
    expect(box.brep.numFaces).toBe(faces);
    xs().forEach((x, i) => expect(x).toBeCloseTo(before[i]! + 30 * way, 6));
  });

  it('extrude mode: a lamina lying flat (a plan) is pulled up into a solid, or down, by either face or an edge', () => {
    const { rt, cube, controls, frame, at, move } = world();
    rt.faceDrag = 'extrude';
    // The cube made a lamina 200 square, flat at y = 0, its front up (local is the room + 100).
    const b = new Brep();
    makeLamina(b, [[0, 100, 200], [200, 100, 200], [200, 100, 0], [0, 100, 0]]); // prettier-ignore
    cube.brep = b;
    rt.changed(cube);
    // Its two faces lie on each other, whichever the press takes: up and down both pull one out.
    for (const dy of [1, -1]) {
      at(0, 0, 0);
      controls.pressPick(false);
      frame();
      expect(kinds(rt.picked())).toEqual(['face']);
      move(0, 3 * dy);
      move(0, 47 * dy);
      controls.releasePick();
      frame();
      expect(cube.brep.numFaces).toBe(6);
      expect(validate(cube.brep).closedManifold).toBe(true);
      expect(Math.abs(volume(cube.brep))).toBeCloseTo(50 * 200 * 200, 3);
      const ys = cube.brep.vertices().map((v) => rt.world(cube).y(v));
      expect(dy > 0 ? Math.max(...ys) : Math.min(...ys)).toBeCloseTo(50 * dy, 3);
      rt.undo();
      expect(cube.brep.numFaces).toBe(2);
    }
    // The plane on its front edge (as it clicks onto the edge's depth): the edge is taken,
    // and pulling it up pulls the lamina up whole, not the edge alone into a slope.
    at(0, 0, 100);
    controls.pressPick(false);
    frame();
    expect(kinds(rt.picked())).toEqual(['edge']);
    move(0, 3);
    move(0, 47);
    controls.releasePick();
    frame();
    expect(cube.brep.numFaces).toBe(6);
    expect(Math.abs(volume(cube.brep))).toBeCloseTo(50 * 200 * 200, 3);
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

  it('groups picked whole: a picked object in its scale box still offers its faces', () => {
    const { rt, controls, frame, at, move } = world();
    rt.groupPick = 'whole';
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    move(50, 0);
    controls.releasePick();
    frame();
    expect(scaleBoxes(rt, rt.primary.root)).toHaveLength(1);
    at(150, 0, 0); // the moved cube's right side
    expect(kinds(rt.selected())).toEqual(['face']);
    controls.pressPick(false);
    frame();
    expect(kinds(rt.picked())).toEqual(['face']);
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

  it('a marquee picks what it takes in even partly (new: the original wanted it wholly inside)', () => {
    const { rt, cube, controls, frame, at, move } = world();
    const other = createObject(createCube(200, 200, 200), { xform: mat4.translation(200, 150, -100) }); // prettier-ignore
    other.attrs.props = ['Visible'];
    rt.importObjects(rt.primary, [other]);
    // From above the first cube's right half to below the other's left half.
    at(0, 380, 0);
    controls.pressPick(false);
    frame();
    move(250, -500);
    controls.releasePick();
    frame();
    expect(new Set(rt.picked())).toEqual(new Set([cube, other]));
  });

  it('shift-pressing on nothing starts a marquee that picks more; what is picked stays put', () => {
    const { rt, cube, controls, frame, at, move } = world();
    const other = createObject(createCube(100, 100, 100), { xform: mat4.translation(300, 0, 0) });
    other.attrs.props = ['Visible'];
    rt.importObjects(rt.primary, [other]);
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    expect(rt.picked()).toEqual([cube]);
    const xs = () => cube.brep.vertices().map((v) => rt.world(cube).x(v));
    const before = xs();
    // Above and to the right of the cube's box, down across the other one.
    at(240, 200, 0);
    controls.pressPick(true);
    frame();
    move(120, -260);
    expect(xs()).toEqual(before);
    controls.releasePick();
    frame();
    expect(new Set(rt.picked())).toEqual(new Set([cube, other]));
    expect(xs()).toEqual(before);
  });

  it("a marquee by a turned thing, in its box but not on it, doesn't pick it", () => {
    const { rt, cube, controls, frame, at, move } = world();
    rt.transformBranch(cube, mat4.rotationAbout([0, 0, 0], [0, 0, 1], Math.PI / 4));
    // The diamond's box reaches 141 each way; its corner at (110..140, 110..140) is empty.
    at(110, 110, 0);
    controls.pressPick(false);
    frame();
    move(30, 30);
    controls.releasePick();
    frame();
    expect(rt.picked()).toEqual([]);
    // One reaching onto it does.
    at(130, 130, 0);
    controls.pressPick(false);
    frame();
    move(-90, -90);
    controls.releasePick();
    frame();
    expect(rt.picked()).toEqual([cube]);
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

  it('⌘A picks every object in the world; Backspace then clears it, in one undo', () => {
    const { rt, cube, controls, frame } = world();
    const other = createObject(createCube(50, 50, 50), {
      name: 'Other',
      xform: mat4.translation(200, 0, 0),
    });
    other.attrs.props = ['Visible'];
    rt.importObjects(rt.primary, [other]);
    controls.selectAll();
    frame();
    frame();
    expect(new Set(rt.picked())).toEqual(new Set([cube, other]));
    controls.delete();
    frame();
    frame();
    expect(rt.primary.root.children.filter((o) => o === cube || o === other)).toEqual([]);
    rt.undo();
    expect(rt.primary.root.children).toContain(cube);
    expect(rt.primary.root.children).toContain(other);
  });

  it('a world loaded (an autosave) comes back with nothing picked or selectable from before', () => {
    const { rt } = world();
    const o = createObject(createCube(50, 50, 50), { name: 'Saved' });
    o.attrs.props = ['Visible', 'Picked', 'Selectable'];
    o.brep.faceAttrs.set(o.brep.faces()[0]!, { props: ['Picked'] });
    rt.importObjects(rt.primary, [o]);
    expect(rt.picked()).toEqual([]);
    expect(o.attrs.props).toEqual(['Visible']);
    expect(o.brep.faceAttrs.get(o.brep.faces()[0]!)!.props).toEqual([]);
    expect(rt.vm.props.has(o, P.Visible)).toBe(true);
  });

  it('⌘A with something picked picks it too, the thing, not its scale box', () => {
    const { rt, cube, controls, frame, at } = world();
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    controls.duplicate();
    frame();
    frame();
    const copy = rt.picked()[0]!;
    controls.selectAll();
    frame();
    frame();
    expect(new Set(rt.picked())).toEqual(new Set([cube, copy]));
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

  // New here: D goes on from the last copy as that went on from its original.
  const copies = () => {
    const w = world();
    w.at(0, 0, 0);
    w.controls.pressPick(false);
    w.frame();
    w.controls.releasePick();
    w.frame();
    const d = () => {
      w.controls.duplicate();
      w.frame();
      w.frame();
      return w.rt.picked()[0] as CutObject;
    };
    const mid = (o: CutObject) => {
      const b = w.rt.bbox(o)!;
      return [0, 1, 2].map((k) => Math.round((b[0][k]! + b[1][k]!) / 2) + 0);
    };
    return { ...w, d, mid };
  };

  it('D again on a copy that was moved puts the next copy as far on, and the next', () => {
    const { rt, d, mid } = copies();
    const first = d();
    expect(mid(first)).toEqual([100, 100, 0]);
    rt.moveBranch(first, [150, -100, 0]); // now 250 to the right of the cube
    expect(mid(d())).toEqual([500, 0, 0]);
    expect(mid(d())).toEqual([750, 0, 0]);
    // One undo takes back one copy.
    rt.undo();
    expect(rt.primary.root.children).toHaveLength(3);
  });

  it('a copy turned as well as moved: each next one turns as much again, round a ring', () => {
    const { rt, d, mid } = copies();
    const first = d();
    // Turned 90° about a point 300 below the cube, from where D put it.
    rt.moveBranch(first, [-100, -100, 0]);
    rt.transformBranch(first, mat4.rotationAbout([0, -300, 0], [0, 0, 1], Math.PI / 2));
    expect(mid(first)).toEqual([-300, -300, 0]);
    expect(mid(d())).toEqual([0, -600, 0]);
    expect(mid(d())).toEqual([300, -300, 0]);
  });

  it('a copy scaled as well as moved: the next goes as far on, not scaled again', () => {
    const { rt, d, mid } = copies();
    const first = d();
    rt.moveBranch(first, [100, -100, 0]); // 200 right
    rt.transformBranch(first, mat4.scaleAbout([200, 0, 0], [0.5, 2, 1]));
    const next = d();
    expect(mid(next)).toEqual([400, 0, 0]);
    const b = rt.bbox(next)!;
    expect(b[1][0] - b[0][0]).toBeCloseTo(rt.bbox(first)![1][0] - rt.bbox(first)![0][0], 6);
  });

  it('a copy reshaped since (a union of copies) starts afresh', () => {
    const { rt, d, mid } = copies();
    const first = d();
    rt.moveBranch(first, [200, -100, 0]); // 300 right
    first.brep = createCube(100, 300, 100); // as a union of it and others leaves it
    rt.changed(first);
    const [x, y, z] = mid(first);
    expect(mid(d())).toEqual([x! + 100, y! + 100, z]); // not another 300 on
  });

  it('a copy flipped over to meet its original: the next goes on, not back', () => {
    const { rt, d, mid } = copies();
    const first = d();
    rt.moveBranch(first, [100, -100, 0]); // 200 right: face to face
    rt.transformBranch(first, mat4.rotationAbout([200, 0, 0], [0, 1, 0], Math.PI));
    expect(mid(first)).toEqual([200, 0, 0]);
    expect(mid(d())).toEqual([400, 0, 0]);
  });

  it('a copy of an object that was not itself a copy goes the usual way over', () => {
    const { rt, cube, d, mid, controls, frame, at } = copies();
    d();
    // Pick the cube again: its copy goes (100, 100, 0) over, as the first did.
    rt.moveBranch(rt.picked()[0] as CutObject, [500, 0, 0]);
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    expect(rt.picked()).toEqual([cube]);
    expect(mid(d())).toEqual([100, 100, 0]);
  });

  it('a copy made some other way (as the primitives box makes one) starts afresh', () => {
    const { rt, cube, d, mid, controls, frame, at } = copies();
    // Copied (not by D) and carried far off, as a cube taken from the box comes away.
    const taken = rt.duplicate(cube);
    rt.moveBranch(taken, [300, 300, 300]);
    rt.unpick(cube);
    frame();
    at(300, 300, 300);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    expect(rt.picked()).toEqual([taken]);
    expect(mid(d())).toEqual([400, 400, 300]);
  });

  it('Space jumps the plane to the back wall and back, then the front and back (cursor.cpl)', () => {
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
    // The next jump goes to the front wall instead, and the one after returns.
    jump();
    expect(stage.z).toBeCloseTo(500, 6);
    jump();
    expect(stage.z).toBeCloseTo(z0, 6);
    // And round again: the back wall.
    jump();
    expect(stage.z).toBeCloseTo(-499, 6);
    jump();
    // Moving the plane by hand starts the round afresh, at the back wall.
    jump();
    expect(stage.z).toBeCloseTo(500, 6);
    controls.pressPlane();
    frame();
    controls.releasePlane();
    frame();
    jump();
    expect(stage.z).toBeCloseTo(-499, 6);
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
