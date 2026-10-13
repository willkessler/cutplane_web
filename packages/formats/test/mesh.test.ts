import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Document, WebIO } from '@gltf-transform/core';
import validator from 'gltf-validator';
import {
  createCube,
  createCubeHole,
  createObject,
  mat4,
  preorder,
  validate,
  volume,
  type CutObject,
} from '@cutplane/kernel';
import {
  fitToRoom,
  holesClosed,
  meshFaces,
  readCut,
  readGltf,
  readObj,
  readStl,
  roomBox,
  writeGlb,
  writeObj,
  writeStl,
} from '../src/index.ts';
import { REPO, read } from './files.ts';

const sample = (name: string) => readCut(read(join(REPO, 'assets/samples', name))).doc.roots;

/** Every vertex of a tree's faces in the room, sorted. */
function roomPoints(roots: readonly CutObject[]): number[][] {
  const out: number[][] = [];
  for (const o of preorder(roots)) {
    if (meshFaces(o).length === 0) continue; // a grouper's point
    for (const v of o.brep.vertices()) {
      const [x, y, z] = o.brep.vertexPos(v);
      out.push([...mat4.transformPoint(o.xform, x, y, z)]);
    }
  }
  return out.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);
}

/** Each point of `a` has one of `b` within `tol` (vertices read back go onto the 1/256 grid), and back. */
function samePoints(a: number[][], b: number[][], tol = 0.004): void {
  const near = (p: number[], qs: number[][]) =>
    qs.some(
      (q) =>
        Math.abs(p[0]! - q[0]!) <= tol &&
        Math.abs(p[1]! - q[1]!) <= tol &&
        Math.abs(p[2]! - q[2]!) <= tol,
    );
  expect(a.filter((p) => !near(p, b))).toEqual([]);
  expect(b.filter((p) => !near(p, a))).toEqual([]);
}

/** Volume in the room (objects may be scaled by their xforms), from their faces' triangles. */
const totalVolume = (roots: readonly CutObject[]) => {
  let v = 0;
  for (const o of preorder(roots))
    for (const f of meshFaces(o)) {
      const all = f.loops.flat();
      for (const [a, b, c] of f.triangles) {
        const [p, q, r] = [all[a]!, all[b]!, all[c]!];
        v += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6; // prettier-ignore
      }
    }
  return v;
};
const faces = (roots: readonly CutObject[]) =>
  [...preorder(roots)].reduce((s, o) => s + o.brep.numFaces, 0);
const errors = (roots: readonly CutObject[]) =>
  [...preorder(roots)].flatMap((o) => validate(o.brep).issues.filter((i) => i.severity === 'error').map((i) => i.code)); // prettier-ignore

const cube = () =>
  createObject(createCube(200, 100, 50), { name: 'brick', color: [200, 40, 40], xform: mat4.translation(-100, 0, 30) }); // prettier-ignore
const holed = () => createObject(createCubeHole(), { name: 'frame', color: [40, 120, 200] });

describe('OBJ', () => {
  it('a cube goes out as six quads and comes back the same solid', () => {
    const text = writeObj([cube()]);
    expect(text.match(/^f /gm)).toHaveLength(6);
    expect(text).toMatch(/^o brick$/m);
    const [back] = readObj(text);
    expect(back!.name).toBe('brick');
    expect(back!.brep.numFaces).toBe(6);
    expect(back!.brep.numVertices).toBe(8);
    expect(back!.color).toEqual([200, 40, 40]);
    expect(volume(back!.brep)).toBeCloseTo(200 * 100 * 50);
    samePoints(roomPoints([back!]), roomPoints([cube()]));
    expect(errors([back!])).toEqual([]);
  });

  it('a face with a hole goes out as triangles and comes back one face with its hole', () => {
    const o = holed();
    const [back] = readObj(writeObj([o]));
    expect(back!.brep.numFaces).toBe(o.brep.numFaces);
    expect(back!.brep.numLoops).toBe(o.brep.numLoops);
    expect(volume(back!.brep)).toBeCloseTo(volume(o.brep));
    expect(errors([back!])).toEqual([]);
  });

  it.each(['discovery.cut', 'stapler.cut', 'chair.cut', 'eaten-sphere.cut', 'lamp.cut'])(
    '%s round-trips: same points, same volume, no more faces',
    (name) => {
      const roots = sample(name);
      const back = readObj(writeObj(roots));
      samePoints(roomPoints(back), roomPoints(roots));
      // Within what putting vertices on the 1/256 grid moves.
      expect(Math.abs(totalVolume(back) - totalVolume(roots))).toBeLessThan(
        Math.abs(totalVolume(roots)) * 1e-4,
      );
      // OBJ has no holes: a face with one goes as triangles, which join again unless it's bent.
      const split = [...preorder(roots)].flatMap(meshFaces).filter((f) => f.loops.length > 1);
      const most = faces(roots) + split.reduce((n, f) => n + f.triangles.length - 1, 0);
      expect(faces(back)).toBeLessThanOrEqual(most);
      expect(errors(back).length).toBeLessThanOrEqual(errors(roots).length);
    },
  );

  it('reads n-gons, negative indices, v/vt/vn references and colours from an .mtl', () => {
    const text = [
      'mtllib a.mtl',
      'o tri',
      'v 0 0 0',
      'v 10 0 0',
      'v 0 10 0',
      'v 0 0 10',
      'usemtl red',
      'f 1/1/1 3/2/1 2/3/1',
      'f -4 -3 -1',
      'f 1//1 4//1 3//1',
      'f 2 3 4',
    ].join('\n');
    const [o] = readObj(text, new Map([['red', [255, 0, 0]]]));
    expect(o!.brep.numFaces).toBe(4);
    expect(o!.color).toEqual([255, 0, 0]);
    expect(volume(o!.brep)).toBeCloseTo(1000 / 6);
  });
});

describe('STL', () => {
  it('binary: a cube goes out as twelve triangles and comes back six faces', () => {
    const bytes = writeStl([cube()]);
    expect(bytes.length).toBe(84 + 50 * 12);
    const [back] = readStl(bytes);
    expect(back!.brep.numFaces).toBe(6);
    expect(volume(back!.brep)).toBeCloseTo(200 * 100 * 50, 1);
    samePoints(roomPoints([back!]), roomPoints([cube()]));
  });

  it.each(['discovery.cut', 'staple.cut', 'chair.cut'])(
    '%s round-trips (float32 positions)',
    (name) => {
      const roots = sample(name);
      const back = readStl(writeStl(roots));
      expect(back).toHaveLength(1);
      expect(Math.abs(totalVolume(back) - totalVolume(roots))).toBeLessThan(
        Math.abs(totalVolume(roots)) * 1e-4,
      );
    },
  );

  it('reads ASCII STL, a solid per block', () => {
    const tri = (a: string, b: string, c: string) =>
      `facet normal 0 0 0\nouter loop\nvertex ${a}\nvertex ${b}\nvertex ${c}\nendloop\nendfacet`;
    const tet = (n: string, o: number) => {
      const p = (x: number, y: number, z: number) => `${x + o} ${y} ${z}`;
      return [
        `solid ${n}`,
        tri(p(0, 0, 0), p(0, 10, 0), p(10, 0, 0)),
        tri(p(0, 0, 0), p(10, 0, 0), p(0, 0, 10)),
        tri(p(0, 0, 0), p(0, 0, 10), p(0, 10, 0)),
        tri(p(10, 0, 0), p(0, 10, 0), p(0, 0, 10)),
        `endsolid ${n}`,
      ].join('\n');
    };
    const objs = readStl(new TextEncoder().encode(`${tet('a', 0)}\n${tet('b', 50)}\n`));
    expect(objs.map((o) => o.name)).toEqual(['a', 'b']);
    for (const o of objs) expect(volume(o.brep)).toBeCloseTo(1000 / 6);
  });
});

describe('glTF', () => {
  it('a GLB is valid glTF 2.0 (the Khronos validator finds no errors)', async () => {
    const glb = await writeGlb(sample('discovery.cut'), 'Discovery');
    const report = await validator.validateBytes(glb);
    expect(report.issues.messages.filter((m: { severity: number }) => m.severity === 0)).toEqual(
      [],
    );
    expect(report.info.totalTriangleCount).toBeGreaterThan(0);
  });

  it('round-trips a group: names, nesting, colours (face colours too) and room positions', async () => {
    const parent = cube();
    const child = holed();
    child.xform = mat4.translation(0, 200, -100);
    child.invXform = mat4.invert(child.xform)!;
    child.parent = parent;
    parent.children.push(child);
    const f = child.brep.faces()[0]!;
    child.brep.faceColors.set(f, [10, 200, 10]);
    const back = await readGltf(await writeGlb([parent]));
    expect(back).toHaveLength(1);
    expect(back[0]!.name).toBe('brick');
    expect(back[0]!.children.map((c) => c.name)).toEqual(['frame']);
    expect(back[0]!.children[0]!.linked).toBe(false);
    expect(back[0]!.color).toEqual([200, 40, 40]);
    const kid = back[0]!.children[0]!;
    expect(kid.color).toEqual([40, 120, 200]);
    expect([...kid.brep.faceColors.values()]).toEqual([[10, 200, 10]]);
    expect(kid.brep.numFaces).toBe(child.brep.numFaces);
    samePoints(roomPoints(back), roomPoints([parent]));
    // Placed where they were: the objects keep their origins.
    expect([...back[0]!.xform.slice(12, 15)].map((v) => Math.round(v))).toEqual([-100, 0, 30]);
  });

  it.each(['discovery.cut', 'stapler.cut', 'floor-fan.cut'])('%s round-trips', async (name) => {
    const roots = sample(name);
    const back = await readGltf(await writeGlb(roots));
    // Every object comes back, groupers too (a lone one holding nothing is passed over).
    const kept = [...preorder(roots)].filter(
      (o) => meshFaces(o).length > 0 || o.children.length >= 2,
    );
    expect([...preorder(back)].length).toBe(kept.length);
    expect(back.length).toBe(roots.filter((o) => kept.includes(o)).length);
    expect(Math.abs(totalVolume(back) - totalVolume(roots))).toBeLessThan(
      Math.abs(totalVolume(roots)) * 1e-4,
    );
    // Face for face, bent ones too: each triangle says which face it's part of.
    const drawn = (rs: readonly CutObject[]) =>
      [...preorder(rs)].reduce((n, o) => n + meshFaces(o).length, 0);
    expect(drawn(back)).toBe(drawn(roots));
    samePoints(roomPoints(back), roomPoints(roots), 0.01);
  });

  it('reads nodes turned and scaled by other tools into the room (metres to millimetres)', async () => {
    const doc = new Document();
    const buf = doc.createBuffer();
    const pos = doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0])); // prettier-ignore
    const mesh = doc
      .createMesh('m')
      .addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos));
    const s = Math.SQRT1_2;
    const turned = doc.createNode('turned').setMesh(mesh).setRotation([0, 0, s, s]).setScale([2, 2, 2]).setTranslation([0.5, 0, 0]); // prettier-ignore
    const sheared = doc.createNode('stretched').setMesh(mesh).setScale([1, 3, 1]);
    doc.createScene().addChild(doc.createNode('empty').addChild(turned)).addChild(sheared);
    const glb = await new WebIO().writeBinary(doc);
    const [a, b] = await readGltf(glb);
    // The empty node has no mesh: its child comes up to the top.
    expect([a!.name, b!.name]).toEqual(['turned', 'stretched']);
    samePoints(roomPoints([a!]), [
      [300, 0, 0],
      [500, 0, 0],
      [500, 200, 0],
    ]);
    samePoints(roomPoints([b!]), [
      [0, 0, 0],
      [0, 300, 0],
      [100, 0, 0],
    ]);
  });
});

describe('meshes that are not solids', () => {
  const V = [
    'v 0 0 0',
    'v 1 0 0',
    'v 1 1 0',
    'v 0 1 0',
    'v 0 0 1',
    'v 1 0 1',
    'v 1 1 1',
    'v 0 1 1',
  ];
  const SIDES = ['f 1 2 6 5', 'f 1 4 3 2', 'f 5 6 7 8', 'f 1 5 8 4', 'f 2 3 7 6'];

  it('a box with no lid has its hole closed: a solid again', () => {
    const [o] = readObj([...V, ...SIDES].join('\n'));
    expect(holesClosed.get(o!)).toBe(1);
    const r = validate(o!.brep);
    expect(r.closedManifold).toBe(true);
    expect(o!.brep.numFaces).toBe(6);
    expect(volume(o!.brep)).toBeCloseTo(1);
  });

  it('a lid in two halves whose middle corners sit on the sides (T-junctions) is stitched shut', () => {
    const lid = ['v 0.5 1 0', 'v 0.5 1 1', 'f 4 8 10 9', 'f 9 10 7 3'];
    const [o] = readObj([...V, ...SIDES, ...lid].join('\n'));
    expect(holesClosed.get(o!)).toBeUndefined();
    expect(validate(o!.brep).closedManifold).toBe(true);
    expect(volume(o!.brep)).toBeCloseTo(1);
  });

  it('a single sheet becomes a thin solid; a bent one is closed with triangles', () => {
    const [flat] = readObj(
      ['v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'v 0 10 0', 'f 1 2 3 4'].join('\n'),
    );
    expect(validate(flat!.brep).closedManifold).toBe(true);
    expect(flat!.brep.numFaces).toBe(2);
    // A strip folded along its middle: its outline isn't flat.
    const bent = [
      'v 0 0 0',
      'v 10 0 0',
      'v 10 10 5',
      'v 0 10 5',
      'v 10 20 0',
      'v 0 20 0',
      'f 1 2 3 4',
      'f 4 3 5 6',
    ];
    const [o] = readObj(bent.join('\n'));
    expect(validate(o!.brep).closedManifold).toBe(true);
    expect(o!.brep.numFaces).toBeGreaterThan(2);
  });
});

describe('glTF colours from textures', () => {
  it('each triangle takes the texel under its middle, times the material colour', async () => {
    const doc = new Document();
    const buf = doc.createBuffer();
    // Two triangles side by side, the left one on the texture's left half, the right on its right.
    const pos = [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 0.1, 0, 0, 0.2, 0, 0, 0.1, 0.1, 0];
    const uv = [0.1, 0.5, 0.2, 0.5, 0.1, 0.4, 0.8, 0.5, 0.9, 0.5, 0.8, 0.4];
    const acc = (type: 'VEC2' | 'VEC3', a: number[]) => doc.createAccessor().setType(type).setBuffer(buf).setArray(new Float32Array(a)); // prettier-ignore
    const tex = doc
      .createTexture('palette')
      .setImage(new Uint8Array([1, 2, 3]))
      .setMimeType('image/png');
    const mat = doc.createMaterial('m').setBaseColorTexture(tex).setBaseColorFactor([1, 1, 1, 1]);
    const prim = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', pos)).setAttribute('TEXCOORD_0', acc('VEC2', uv)).setMaterial(mat); // prettier-ignore
    doc.createScene().addChild(doc.createNode('two').setMesh(doc.createMesh().addPrimitive(prim)));
    const glb = await new WebIO().writeBinary(doc);
    // A 2 × 1 image: red, then blue (the decoder is the browser's; here, a stand-in).
    const decode = async () => ({ width: 2, height: 1, data: [255, 0, 0, 255, 0, 0, 255, 255] });
    const [o] = await readGltf(glb, {}, decode);
    const colors = o!.brep.faces().map((f) => o!.brep.faceColors.get(f) ?? o!.color);
    // (Each triangle is a sheet, closed into a thin solid: two faces each.)
    expect([...new Set(colors.map((c) => c.join(',')))].sort()).toEqual(['0,0,255', '255,0,0']);
    // Without a decoder, the material's own colour.
    const [plain] = await readGltf(glb);
    expect(plain!.color).toEqual([255, 255, 255]);
  });
});

describe('fitting imports into the room', () => {
  const box = (w: number, x = 0) =>
    createObject(createCube(w, w, w), { xform: mat4.translation(x, 0, 0) });

  it('leaves what fits where it is', () => {
    const o = box(300, 50);
    expect(fitToRoom([o])).toBe(1);
    expect(o.xform[12]).toBe(50);
  });

  it('scales a model in metres or a small one up, and one too big for the room down, into the middle', () => {
    for (const o of [box(1), box(150), box(5000, 9000)]) {
      const s = fitToRoom([o]);
      expect(s).not.toBe(1);
      const r = roomBox([o])!;
      const size = r.hi[1]! - r.lo[1]!;
      expect(size).toBeCloseTo(765 * 0.6, 0);
      expect((r.lo[0]! + r.hi[0]!) / 2).toBeCloseTo(-0.5, 0);
    }
  });

  it('moves one that fits in size but lies outside the room into its middle, unscaled', () => {
    const o = box(300, 2000);
    expect(fitToRoom([o])).toBe(1);
    const r = roomBox([o])!;
    expect(r.hi[0]! - r.lo[0]!).toBeCloseTo(300);
    expect((r.lo[0]! + r.hi[0]!) / 2).toBeCloseTo(-0.5);
  });
});
