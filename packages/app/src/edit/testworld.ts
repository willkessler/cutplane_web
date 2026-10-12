import {
  WorldGeometry,
  computeSection,
  createCube,
  createObject,
  mat4,
  type CutObject,
} from '@cutplane/kernel';
import type { Model } from '../render/models.ts';
import { Editor, type V3 } from './editor.ts';

// A small world of cubes for the editing tests.

/** A world of cubes (200 on a side, placed at `at`), with the plane at `z`. */
export function world(...at: V3[]) {
  const roots = at.map((p) =>
    createObject(createCube(200, 200, 200), { xform: mat4.translation(...p) }),
  );
  const model = (object: CutObject): Model => ({
    object,
    world: new WorldGeometry(object.brep, object.xform),
  });
  const models: Model[] = roots.map(model);
  const state = { z: 0, commits: 0 };
  const editor = new Editor({
    models,
    roots,
    structureChanged() {
      const had = new Map(models.map((m) => [m.object, m]));
      models.splice(0, models.length, ...roots.map((o) => had.get(o) ?? model(o)));
    },
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
  return { models, roots, editor, state, drag };
}

export const worldPos = (m: Model, v: number) => [m.world.x(v), m.world.y(v), m.world.z(v)];
export const vertexNear = (m: Model, p: V3) =>
  m.object.brep.vertices().find((v) => worldPos(m, v).every((c, i) => Math.abs(c - p[i]!) < 1e-9))!;
