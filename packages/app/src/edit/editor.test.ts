import { describe, expect, it } from 'vitest';
import {
  WorldGeometry,
  computeSection,
  createCube,
  createObject,
  mat4,
  validate,
  type CutObject,
} from '@cutplane/kernel';
import type { Model } from '../render/models.ts';
import { DRAG_DEAD_ZONE, Editor, type V3 } from './editor.ts';

/** A world of cubes (200 on a side, placed at `at`), with the plane at `z`. */
function world(...at: V3[]) {
  const models: Model[] = at.map((p) => {
    const object = createObject(createCube(200, 200, 200), { xform: mat4.translation(...p) });
    return { object, world: new WorldGeometry(object.brep, object.xform) };
  });
  const state = { z: 0, commits: 0 };
  const editor = new Editor({
    models,
    section: (m) => computeSection(m.world, state.z),
    changed(objects: Iterable<CutObject>) {
      const set = new Set(objects);
      for (const m of models)
        if (set.has(m.object)) m.world = new WorldGeometry(m.object.brep, m.object.xform);
    },
    committed() {
      state.commits++;
    },
  });
  /** Press at a, move through the points, release at the last. */
  const drag = (a: V3, ...path: V3[]) => {
    state.z = a[2];
    editor.press(a, false);
    for (const p of path) {
      state.z = p[2];
      editor.move(p);
    }
    editor.release(path.at(-1) ?? a);
  };
  return { models, editor, state, drag };
}

const worldPos = (m: Model, v: number) => [m.world.x(v), m.world.y(v), m.world.z(v)];
const vertexNear = (m: Model, p: V3) =>
  m.object.brep.vertices().find((v) => worldPos(m, v).every((c, i) => Math.abs(c - p[i]!) < 1e-9))!;

describe('Editor', () => {
  it('drags a corner vertex in the plane and keeps the solid sound', () => {
    const { models, editor, drag } = world([-100, -100, -100]);
    const m = models[0]!;
    // The front face lies in the plane at z = 100; its corner is a vertex there.
    const v = vertexNear(m, [100, 100, 100]);
    drag([98, 97, 100], [110, 100, 100], [130, 125, 100]);
    expect(editor.picked).toEqual([{ kind: 'vertex', model: m, id: v }]);
    expect(worldPos(m, v)).toEqual([132, 128, 100]);
    const r = validate(m.object.brep, { planarityTolerance: 1e-6 });
    expect(r.closedManifold).toBe(true);
    expect(r.counts['nonplanar-face'] ?? 0).toBe(0);
  });

  it('waits out the dead zone, then catches up with the crosshair', () => {
    const { models, editor, state } = world([-100, -100, -100]);
    const m = models[0]!;
    const v = vertexNear(m, [100, 100, 100]);
    state.z = 100;
    editor.press([100, 100, 100], false);
    editor.move([100 + DRAG_DEAD_ZONE, 100, 100]);
    expect(editor.dragging).toBe(false);
    expect(worldPos(m, v)).toEqual([100, 100, 100]);
    editor.move([100 + DRAG_DEAD_ZONE + 1, 100, 100]);
    expect(editor.dragging).toBe(true);
    expect(worldPos(m, v)).toEqual([106, 100, 100]);
    editor.release([106, 100, 100]);
  });

  it('carries a vertex in depth when the plane moves while it is held', () => {
    const { models, editor, state } = world([-100, -100, -100]);
    const m = models[0]!;
    const v = vertexNear(m, [100, 100, 100]);
    state.z = 100;
    editor.press([100, 100, 100], false);
    state.z = 160;
    editor.move([100, 100, 160]);
    editor.release([100, 100, 160]);
    expect(worldPos(m, v)).toEqual([100, 100, 160]);
    expect(validate(m.object.brep).closedManifold).toBe(true);
  });

  it('moves a face rigidly through its section segment', () => {
    const { models, drag } = world([-100, -100, -100]);
    const m = models[0]!;
    // At z = 0 the right side (x = 100) crosses the plane as a vertical segment.
    drag([102, 0, 0], [140, 0, 0]);
    const right = m.object.brep
      .vertices()
      .filter((v) => worldPos(m, v)[0] === 138)
      .map((v) => worldPos(m, v));
    expect(right).toHaveLength(4);
    expect(validate(m.object.brep).closedManifold).toBe(true);
  });

  it('picks the whole object from inside its section and moves it', () => {
    const { models, editor, drag } = world([-100, -100, -100]);
    const m = models[0]!;
    drag([0, 0, 0], [50, -20, 0]);
    expect(editor.picked).toEqual([{ kind: 'object', object: m.object }]);
    expect(m.world.zMin).toBe(-100);
    expect([m.object.xform[12], m.object.xform[13]]).toEqual([-50, -120]);
  });

  it('shift adds and takes away; a click on nothing drops everything', () => {
    const { models, editor, drag, state } = world([-300, -100, -100], [100, -100, -100]);
    drag([-200, 0, 0]);
    state.z = 0;
    editor.press([200, 0, 0], true);
    editor.release([200, 0, 0]);
    expect(editor.picked.map((p) => p.kind === 'object' && p.object)).toEqual([
      models[0]!.object,
      models[1]!.object,
    ]);
    editor.press([-200, 0, 0], true);
    editor.release([-200, 0, 0]);
    expect(editor.picked).toEqual([{ kind: 'object', object: models[1]!.object }]);
    drag([0, 300, 0]);
    expect(editor.picked).toEqual([]);
  });

  it('drags everything picked together', () => {
    const { models, editor, state } = world([-300, -100, -100], [100, -100, -100]);
    state.z = 0;
    for (const x of [-200, 200]) {
      editor.press([x, 0, 0], true);
      editor.release([x, 0, 0]);
    }
    // A plain press on something already picked keeps the others for the drag.
    editor.press([200, 0, 0], false);
    editor.move([200, 40, 0]);
    editor.release([200, 40, 0]);
    expect(models.map((m) => m.object.xform[13])).toEqual([-60, -60]);
    expect(editor.picked).toHaveLength(2);
  });

  it('picks the objects inside a marquee', () => {
    const { models, editor, drag } = world([-300, -100, -100], [100, -100, -100]);
    drag([-450, 150, 0], [-50, -150, 0]);
    expect(editor.picked).toEqual([{ kind: 'object', object: models[0]!.object }]);
    expect(editor.marquee).toBeUndefined();
  });

  it('undoes and redoes a drag, merging split faces back', () => {
    const { models, editor, drag } = world([-100, -100, -100]);
    const m = models[0]!;
    drag([100, 100, 100], [140, 130, 100]);
    expect(m.object.brep.numFaces).toBeGreaterThan(6);
    editor.undo();
    expect(m.object.brep.numFaces).toBe(6);
    expect(vertexNear(m, [100, 100, 100])).toBeDefined();
    editor.redo();
    expect(vertexNear(m, [140, 130, 100])).toBeDefined();
    expect(editor.canRedo).toBe(false);
  });

  it('merges the pieces back when a vertex is dragged home', () => {
    const { models, drag } = world([-100, -100, -100]);
    drag([100, 100, 100], [140, 130, 100], [100, 100, 100]);
    expect(models[0]!.object.brep.numFaces).toBe(6);
  });

  it('rolls back a drag that would fold an edge to nothing', () => {
    const { models, editor, drag } = world([-100, -100, -100]);
    const m = models[0]!;
    // Drag the front top-right corner onto the front top-left one.
    drag([100, 100, 100], [-100, 100, 100]);
    expect(m.object.brep.numFaces).toBe(6);
    expect(vertexNear(m, [100, 100, 100])).toBeDefined();
    expect(editor.canUndo).toBe(false);
  });
});
