import { describe, expect, it } from 'vitest';
import {
  WorldGeometry,
  createCube,
  createObject,
  createOvalCylinder,
  createSphere,
  mat4,
  type CutObject,
} from '@cutplane/kernel';
import { decalFrame, decalIn, eigen3, placeDecal, projectDecal } from './decals.ts';
import { triangulate } from './models.ts';

/** An object's triangles in the room and each one's normal, as add_decal takes them. */
function tris(o: CutObject) {
  const g = new WorldGeometry(o.brep, o.xform);
  const pos: number[] = [];
  const faces: number[] = [];
  triangulate(o.brep, g, () => true, () => [0, 0, 0], pos, [], undefined, faces);
  return { pos, normals: faces.flatMap((f) => g.faceNormal(f)) };
}

const close = (a: readonly number[], b: readonly number[]) =>
  a.forEach((x, i) => expect(x).toBeCloseTo(b[i]!, 3));

describe('decals (new): lettering laid on a surface', () => {
  it('eigen3 finds a symmetric matrix’s axes, largest first', () => {
    const { values, vectors } = eigen3([2, 1, 0, 1, 2, 0, 0, 0, 5]);
    close(values, [5, 3, 1]);
    close(vectors[0].map(Math.abs), [0, 0, 1]);
    close(vectors[2].map(Math.abs), [Math.SQRT1_2, Math.SQRT1_2, 0]);
  });

  it('on the side of a hull, reads along its length, upright', () => {
    // A tube 300 long along z, radius 50: like a fuselage lying front to back.
    const hull = createObject(createOvalCylinder(50, 50, 300, 24));
    const { pos, normals } = tris(hull);
    const f = placeDecal(pos, normals, [60, 0, 150], 10);
    expect(f.n[0]).toBeGreaterThan(0.99); // the facet there
    close(f.u, [0, 0, -1]); // seen from +x, the front (+z) is on the left
    expect(f.v[1]).toBeGreaterThan(0.99);
    expect(f.at[0]).toBeCloseTo(50, -1);
    // Turned so it lies along x, the lettering turns with it.
    const turned = createObject(createOvalCylinder(50, 50, 300, 24), {
      xform: mat4.rotationAbout([0, 0, 0], [0, 1, 0], Math.PI / 2),
    });
    const t = tris(turned);
    const xs = t.pos.filter((_, i) => i % 3 === 0);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    const ft = placeDecal(t.pos, t.normals, [mid, 0, -60], 10);
    close(ft.u.map(Math.abs), [1, 0, 0]);
    expect(ft.v[1]).toBeGreaterThan(0.99);
    // Rolled half round: it reads the other way, still out of the same face.
    const r = placeDecal(pos, normals, [60, 0, 150], 10, undefined, 180);
    close(r.u, [0, 0, 1]);
    close(r.n, f.n);
  });

  it('on a flat face or a ball, reads level', () => {
    const box = createObject(createCube(200, 200, 200));
    const b = tris(box);
    const f = placeDecal(b.pos, b.normals, [100, 100, 230], 10);
    close(f.n, [0, 0, 1]);
    close(f.u, [1, 0, 0]);
    close(f.v, [0, 1, 0]);
    const ball = createObject(createSphere(100, 24));
    const s = tris(ball);
    const g = placeDecal(s.pos, s.normals, [0, 0, 150], 10);
    expect(g.u[1]).toBeCloseTo(0, 3);
    expect(g.v[1]).toBeGreaterThan(0.9);
  });

  it('is laid on the faces turned to it, cut to its box', () => {
    const box = createObject(createCube(200, 200, 200));
    const b = tris(box);
    const f = placeDecal(b.pos, b.normals, [100, 100, 210], 10);
    const p = projectDecal(b.pos, f, 50, 20, 20);
    let area = 0;
    for (let i = 0; i < p.pos.length; i += 9) {
      const q = (k: number) => [p.pos[i + k]!, p.pos[i + k + 1]!, p.pos[i + k + 2]!];
      const [a, c, d] = [q(0), q(3), q(6)];
      const u = c.map((x, k) => x - a[k]!);
      const v = d.map((x, k) => x - a[k]!);
      area += Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2; // prettier-ignore
      for (const k of [0, 3, 6]) expect(p.pos[i + k + 2]).toBeCloseTo(200, 6); // only the front
    }
    expect(area).toBeCloseTo(1000, 6);
    expect(Math.min(...p.uv)).toBeGreaterThanOrEqual(-1e-9);
    expect(Math.max(...p.uv)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('kept in the object’s own coordinates, goes where the object goes', () => {
    const o = createObject(createCube(100, 100, 100), {
      xform: mat4.multiply(
        mat4.scaleAbout([0, 0, 0], [2, 2, 2]),
        mat4.translation(10, 0, 0),
      ),
    });
    const t = tris(o);
    const f = placeDecal(t.pos, t.normals, [120, 100, 300], 8);
    const d = decalIn(o, f, 'X', [0, 0, 0]);
    expect(d.height).toBeCloseTo(4);
    const back = decalFrame(o, d);
    close(back.at, f.at);
    close(back.u, f.u);
    expect(back.height).toBeCloseTo(8);
  });
});
