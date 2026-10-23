import { describe, expect, it } from 'vitest';
import { createCube, createObject, createSphere, mat4 } from '@cutplane/kernel';
import { ModelView, shapeKey, standInSection } from './models.ts';

const view = (...objects: ReturnType<typeof createObject>[]) => {
  const v = new ModelView();
  v.load({ title: '', contains: 'World', name: null, roots: objects });
  return v;
};

describe("the plane's stops", () => {
  it("are a cube's vertex depths, its front and back sticky", () => {
    const v = view(
      createObject(createCube(200, 200, 200), { xform: mat4.translation(0, 0, -100) }),
    );
    expect(new Set(v.depths())).toEqual(new Set([-100, 100]));
    expect(new Set(v.flatDepths())).toEqual(new Set([-100, 100]));
  });
  it('hold the plane only at faces turned along its axis, not at any tiny face (new)', () => {
    const tiny = [...view(createObject(createSphere(2, 24))).flatDepths()];
    expect(tiny.length).toBe(0); // every facet's corners are within half a unit, none faces the plane
  });
  it("are only a fine mesh's front and back, none of them sticky (new)", () => {
    const fine = view(createObject(createSphere(300, 160)));
    expect(fine.models[0]!.object.brep.numVertices).toBeGreaterThan(20_000);
    expect([...fine.depths()].length).toBe(2);
    expect([...fine.flatDepths()].length).toBe(0);
  });
});

describe('the shape key', () => {
  it("isn't changed by a pick, only by what is drawn (new)", () => {
    const o = createObject(createCube(200, 200, 200));
    const key = shapeKey(o);
    const f = o.brep.faces()[0]!;
    o.brep.faceAttrs.set(f, { props: ['Picked'] });
    expect(shapeKey(o)).toBe(key);
    o.brep.faceColors.set(f, [255, 0, 0]);
    expect(shapeKey(o)).not.toBe(key);
  });
});

describe('a fine mesh turned (new)', () => {
  it('is drawn as a stand-in, turned by its matrix, until it settles', () => {
    const o = createObject(createSphere(300, 160));
    const v = view(o);
    const mesh = v.models[0]!.mesh!;
    o.xform = mat4.rotationAbout([0, 0, 0], [0, 1, 0], 0.3);
    expect(v.rebuild([o])).toBe(true);
    expect(v.isMoving(o)).toBe(true);
    expect(v.models[0]!.mesh).toBe(mesh); // not built again
    expect(mesh.matrixAutoUpdate).toBe(false);
    expect(v.settle(true, performance.now())).toEqual([]); // still held, just turned
    expect(v.settle(false)).toEqual([o]); // let go: built where it is
    expect(v.isMoving(o)).toBe(false);
    expect(v.models[0]!.mesh).not.toBe(mesh);
  });
  it('is cut where it now is: its section from its triangles, turned', () => {
    const o = createObject(createSphere(300, 160));
    const v = view(o);
    o.xform = mat4.multiply(
      mat4.rotationAbout([0, 0, 0], [0, 1, 0], 0.3),
      mat4.translation(0, 0, 200),
    );
    v.rebuild([o]);
    const pts: number[] = [];
    standInSection(v.models[0]!, 200, pts); // through the moved sphere's middle
    expect(pts.length).toBeGreaterThan(0);
    for (let i = 0; i < pts.length; i += 3)
      expect(Math.hypot(pts[i]!, pts[i + 1]!)).toBeCloseTo(300, -1);
  });
});
