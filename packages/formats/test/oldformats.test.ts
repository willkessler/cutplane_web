import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preorder, validate, volume, type CutObject } from '@cutplane/kernel';
import { aciColor, readDxf, readInventor, roomBox } from '../src/index.ts';
import { CORPUS, read } from './files.ts';

const solid = (o: CutObject) => validate(o.brep).closedManifold;
/** Volume in the room (positions are baked in, so local is the room). */
const vol = (o: CutObject) => volume(o.brep);
const at = (o: CutObject) => {
  const b = roomBox([o])!;
  return b.lo.map((l, k) => (l + b.hi[k]!) / 2);
};

describe('Open Inventor', () => {
  const iv = `#Inventor V2.1 ascii
# A grey cube moved right, and a red tetrahedron wound the wrong way round.
Separator {
  DEF Block Separator {
    Translation { translation 10 0 0 }
    Cube { width 4 height 2 depth 2 }
  }
  Separator {
    Material { diffuseColor 1 0 0 }
    ShapeHints { vertexOrdering CLOCKWISE }
    Coordinate3 { point [ 0 0 0, 3 0 0, 0 3 0, 0 0 3 ] }
    IndexedFaceSet { coordIndex [ 0, 1, 2, -1,  0, 3, 1, -1,  0, 2, 3, -1,  1, 3, 2, -1 ] }
  }
}`;

  it('reads shapes under their transforms, as one group of solids', () => {
    const [g] = readInventor(iv);
    expect(g!.attrs.props).toContain('Grouper');
    const [cube, tet] = g!.children as [CutObject, CutObject];
    expect(cube.name).toBe('Block');
    expect(solid(cube)).toBe(true);
    expect(cube.brep.numFaces).toBe(6);
    expect(vol(cube)).toBeCloseTo(16);
    expect(at(cube)).toEqual([10, 0, 0]);
    expect(cube.color).toEqual([204, 204, 204]);
    // CLOCKWISE faces turned to face out: positive volume.
    expect(solid(tet)).toBe(true);
    expect(vol(tet)).toBeCloseTo(4.5);
    expect(tet.color).toEqual([255, 0, 0]);
  });

  it('turns faces of no stated order outward, even when they disagree with each other', () => {
    const [o] = readInventor(`#Inventor V2.1 ascii
Separator { Coordinate3 { point [ 0 0 0, 3 0 0, 0 3 0, 0 0 3 ] }
  IndexedFaceSet { coordIndex [ 0 1 2 -1  0 1 3 -1  0 2 3 -1  1 3 2 -1 ] } }`);
    expect(solid(o!)).toBe(true);
    expect(vol(o!)).toBeCloseTo(4.5);
  });

  it('reads per-face materials, rotations, primitives and USE', () => {
    const objs = readInventor(`#Inventor V2.1 ascii
Separator {
  Material { diffuseColor [ 1 0 0, 0 0 1 ] }
  MaterialBinding { value PER_FACE }
  Coordinate3 { point [ 0 0 0, 1 0 0, 1 1 0, 0 1 0, 0 0 1, 1 0 1, 1 1 1, 0 1 1 ] }
  FaceSet { numVertices [ 4 4 ] }
  Rotation { rotation 0 0 1 1.5707963 }
  DEF Ball Sphere { radius 2 }
  Translation { translation 0 10 0 }
  USE Ball
  Cylinder { }
  Cone { }
}`);
    const [g] = objs;
    const kids = g!.children;
    expect(kids).toHaveLength(5);
    // Two faces, one red and one blue: two sheets, closed into thin solids.
    const colors = new Set(kids[0]!.brep.faces().map((f) => (kids[0]!.brep.faceColors.get(f) ?? kids[0]!.color).join())); // prettier-ignore
    expect(colors).toEqual(new Set(['255,0,0', '0,0,255']));
    for (const k of kids.slice(1)) expect(solid(k)).toBe(true);
    // After a quarter turn about z, the second ball's +y move lands on −x.
    expect(at(kids[2]!).map((v) => Math.round(v))).toEqual([-10, 0, 0]);
    expect(vol(kids[1]!)).toBeGreaterThan(0.9 * (4 / 3) * Math.PI * 8);
  });

  it('says binary Inventor files are not read', () => {
    expect(() => readInventor('#Inventor V2.1 binary\n\0\0')).toThrow(/binary/);
  });
});

describe('VRML', () => {
  it('1.0 is read as Inventor is', () => {
    const [o] = readInventor(`#VRML V1.0 ascii
Separator { Material { diffuseColor 0 1 0 } Transform { translation 0 0 -5 scaleFactor 2 2 2 } Cube { } }`);
    expect(o!.color).toEqual([0, 255, 0]);
    expect(vol(o!)).toBeCloseTo(64);
    expect(at(o!)).toEqual([0, 0, -5]);
  });

  it('2.0: shapes in transforms, materials, face sets with colours', () => {
    const objs = readInventor(`#VRML V2.0 utf8
DEF Car Transform {
  translation 5 0 0
  children [
    Shape { appearance Appearance { material Material { diffuseColor 0 0 1 } } geometry Box { size 2 4 6 } }
    Transform { rotation 0 1 0 3.14159265 children Shape {
      geometry IndexedFaceSet {
        coord Coordinate { point [ 0 0 0, 1 0 0, 0 1 0, 0 0 1 ] }
        coordIndex [ 0 2 1 -1 0 1 3 -1 0 3 2 -1 1 2 3 -1 ]
        color Color { color [ 1 1 0 ] } colorPerVertex FALSE colorIndex [ 0 0 0 0 ]
      } } }
  ]
}`);
    const [g] = objs;
    expect(g!.name).toBe('Car');
    const [box, tet] = g!.children as [CutObject, CutObject];
    expect(box.color).toEqual([0, 0, 255]);
    expect(vol(box)).toBeCloseTo(48);
    expect(at(box)).toEqual([5, 0, 0]);
    expect(tet.color).toEqual([255, 255, 0]);
    expect(solid(tet)).toBe(true);
    expect(vol(tet)).toBeCloseTo(1 / 6);
    // Turned half way round y about the car's origin, then moved: it lies at x 4..5.
    const b = roomBox([tet])!;
    expect(b.lo[0]).toBeCloseTo(4);
    expect(b.hi[0]).toBeCloseTo(5);
  });
});

describe('wireframes (line sets)', () => {
  const wire = (extra = '') => `#VRML V2.0 utf8
Group { children [
  Shape { appearance Appearance { material Material { diffuseColor 1 0.8 0 } }
    geometry IndexedLineSet {
      coord Coordinate { point [ 0 0 0, 3 0 0, 0 3 0, 0 0 3, 0 0 0 ] }
      # Each triangle drawn round as a closed line, as IVREAD wrote them.
      coordIndex [ 0 1 2 4 -1  0 1 3 0 -1  0 2 3 0 -1  1 3 2 1 -1  1 2 -1 ]
    } }
  ${extra}
] }`;

  it('a file of only closed lines (a mesh drawn as its edges) is read as their faces', () => {
    const [o] = readInventor(wire());
    expect(o!.brep.numFaces).toBe(4);
    expect(solid(o!)).toBe(true);
    expect(vol(o!)).toBeCloseTo(4.5);
    expect(o!.color).toEqual([255, 204, 0]);
  });

  it('lines in a file that has faces are left out', () => {
    const objs = readInventor(wire('Shape { geometry Box { size 1 1 1 } }'));
    expect(objs).toHaveLength(1);
    expect(objs[0]!.brep.numFaces).toBe(6);
  });
});

describe('DXF', () => {
  const pairs = (...ps: (string | number)[]) => ps.join('\n') + '\n';
  const polyface = (layer: string) =>
    pairs(
      0, 'POLYLINE', 8, layer, 66, 1, 70, 64, 71, 4, 72, 4,
      ...[[0, 0, 0], [3, 0, 0], [0, 3, 0], [0, 0, 3]].flatMap(([x, y, z]) => [0, 'VERTEX', 8, layer, 10, x!, 20, y!, 30, z!, 70, 192]),
      ...[[1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, -4]].flatMap(([a, b, c]) => [0, 'VERTEX', 8, layer, 10, 0, 20, 0, 30, 0, 70, 128, 71, a!, 72, b!, 73, c!]),
      0, 'SEQEND',
    ); // prettier-ignore
  const dxf =
    'From someone 1993\nSubject: a mail header before the drawing\n\n' +
    pairs(
      0,
      'SECTION',
      2,
      'TABLES',
      0,
      'TABLE',
      2,
      'LAYER',
      0,
      'LAYER',
      2,
      'BODY',
      62,
      1,
      0,
      'ENDTAB',
      0,
      'ENDSEC',
    ) + // prettier-ignore
    pairs(0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 2, 'TET', 10, 0, 20, 0, 30, 0) +
    polyface('0') +
    pairs(0, 'ENDBLK', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES') +
    polyface('BODY') +
    pairs(0, 'INSERT', 8, 'WHEEL', 2, 'TET', 10, 10, 20, 0, 30, 0, 62, 5) +
    pairs(
      0,
      '3DFACE',
      8,
      'LID',
      62,
      3,
      10,
      0,
      20,
      0,
      30,
      5,
      11,
      1,
      21,
      0,
      31,
      5,
      12,
      1,
      22,
      1,
      32,
      5,
      13,
      1,
      23,
      1,
      33,
      5,
    ) + // prettier-ignore
    pairs(0, 'ENDSEC', 0, 'EOF');

  it('reads polyface meshes, blocks placed by INSERT and 3DFACEs: an object per layer, coloured', () => {
    const objs = readDxf(dxf);
    expect(objs.map((o) => o.name)).toEqual(['BODY', 'WHEEL', 'LID']);
    const [body, wheel, lid] = objs as [CutObject, CutObject, CutObject];
    expect(body.color).toEqual([255, 0, 0]); // BYLAYER: the BODY layer is red
    expect(solid(body)).toBe(true);
    expect(vol(body)).toBeCloseTo(4.5); // turned outward
    // Layer 0 in a block, BYLAYER: the layer it's placed on (WHEEL, not in the table: white).
    expect(wheel.color).toEqual([255, 255, 255]);
    expect(at(wheel)[0]).toBeCloseTo(11.5);
    expect(lid.color).toEqual([0, 255, 0]);
    // DXF's z is up: the lid at z = 5 is up in the room (y = 5).
    expect(at(lid)[1]).toBeCloseTo(5);
  });

  it('knows AutoCAD colour numbers', () => {
    expect(aciColor(1)).toEqual([255, 0, 0]);
    expect(aciColor(10)).toEqual([255, 0, 0]);
    expect(aciColor(250)).toEqual([51, 51, 51]);
    expect(aciColor(255)).toEqual([255, 255, 255]);
  });

  const robot = join(CORPUS, 'robot2.dxf');
  it.skipIf(!existsSync(robot))('reads the robot David Lees mailed Larry in 1993', () => {
    const objs = readDxf(read(robot));
    expect(objs).toHaveLength(52);
    const faces = [...preorder(objs)].reduce((n, o) => n + o.brep.numFaces, 0);
    expect(faces).toBeGreaterThan(1000);
    const solids = objs.filter(solid).length;
    expect(solids).toBeGreaterThan(40);
    // Every layer in it is colour 7: AutoCAD's white.
    expect(new Set(objs.map((o) => o.color.join()))).toEqual(new Set(['255,255,255']));
  });
});
