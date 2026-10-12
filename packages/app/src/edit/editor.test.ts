import { describe, expect, it } from 'vitest';
import { mat4, validate } from '@cutplane/kernel';
import { DRAG_DEAD_ZONE } from './editor.ts';
import { vertexNear, world, worldPos } from './testworld.ts';

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

  it('duplicates the picked objects, offset, and picks the copies; undo takes them away', () => {
    const { models, roots, editor, drag } = world([-100, -100, -100]);
    drag([0, 0, 0]);
    editor.duplicate();
    expect(roots).toHaveLength(2);
    const copy = roots[1]!;
    expect([copy.xform[12], copy.xform[13], copy.xform[14]]).toEqual([0, 0, -100]);
    expect(copy.brep).not.toBe(roots[0]!.brep);
    expect(editor.picked).toEqual([{ kind: 'object', object: copy }]);
    expect(models).toHaveLength(2);
    editor.undo();
    expect(roots).toHaveLength(1);
    expect(models).toHaveLength(1);
    editor.redo();
    expect(roots[1]).toBe(copy);
  });

  it('duplicating a picked face copies its whole object', () => {
    const { roots, editor, drag } = world([-100, -100, -100]);
    drag([102, 0, 0]);
    expect(editor.picked[0]!.kind).toBe('face');
    editor.duplicate();
    expect(roots).toHaveLength(2);
    expect(roots[1]!.brep.numFaces).toBe(6);
  });

  it('deletes picked objects, and undo brings them back', () => {
    const { models, roots, editor, drag } = world([-300, -100, -100], [100, -100, -100]);
    drag([-200, 0, 0]);
    const gone = roots[0]!;
    editor.deletePicked();
    expect(roots).toEqual([models[0]!.object]);
    expect(roots).not.toContain(gone);
    expect(editor.picked).toEqual([]);
    editor.undo();
    expect(roots[0]).toBe(gone);
    expect(models).toHaveLength(2);
  });

  it('deletes a corner vertex, cutting the corner off', () => {
    const { models, editor, drag } = world([-100, -100, -100]);
    const m = models[0]!;
    drag([100, 100, 100]);
    expect(editor.picked[0]!.kind).toBe('vertex');
    editor.deletePicked();
    expect([m.object.brep.numVertices, m.object.brep.numFaces]).toEqual([7, 7]);
    editor.undo();
    expect(m.object.brep.numVertices).toBe(8);
  });

  it('refuses a delete that would flatten the solid', () => {
    const { models, editor, state } = world([-100, -100, -100]);
    const m = models[0]!;
    // Pick the front face (in the plane at z = 100) and delete it: four corners gone, nothing left.
    state.z = 100;
    editor.press([0, 0, 100], false);
    editor.release([0, 0, 100]);
    expect(editor.picked[0]!.kind).toBe('face');
    editor.deletePicked();
    expect(m.object.brep.numFaces).toBe(6);
    expect(editor.canUndo).toBe(false);
  });

  it('rotates the picked objects as one undoable transform', () => {
    const { roots, editor, drag } = world([-100, -100, -100]);
    drag([0, 0, 0]);
    editor.beginTransform();
    editor.setTransform(mat4.rotationAbout([0, 0, 0], [0, 0, 1], Math.PI / 4));
    editor.setTransform(mat4.rotationAbout([0, 0, 0], [0, 0, 1], Math.PI / 2));
    editor.endTransform();
    const p = mat4.transformPoint(roots[0]!.xform, 0, 0, 0);
    expect(p[0]).toBeCloseTo(100);
    expect(p[1]).toBeCloseTo(-100);
    editor.undo();
    expect([...roots[0]!.xform.slice(12, 15)]).toEqual([-100, -100, -100]);
  });
});
