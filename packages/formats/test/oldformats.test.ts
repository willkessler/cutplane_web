import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preorder, validate, volume, type CutObject } from '@cutplane/kernel';
import {
  aciColor,
  readCut,
  readDxf,
  readInventor,
  readSgi,
  roomBox,
  writeCut,
  type Pixels,
} from '../src/index.ts';
import { newell } from '../src/mesh/faces.ts';
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

  it('joins face sets in a row into one shape, coloured face by face, each taking only its points', () => {
    // Two parts of one model drawn from one long list of points, each its own material
    // (as a model of thousands of parts is): one object, not one a part.
    const objs = readInventor(`#Inventor V2.1 ascii
Separator {
  Coordinate3 { point [ 0 0 0, 3 0 0, 0 3 0, 0 0 3,  10 0 0, 13 0 0, 10 3 0, 10 0 3,  50 50 50 ] }
  DEF metal+0 Material { diffuseColor 1 0 0 }
  IndexedFaceSet { coordIndex [ 0 2 1 -1 0 1 3 -1 0 3 2 -1 1 2 3 -1 ] }
  Material { diffuseColor 0 0 1 }
  IndexedFaceSet { coordIndex [ 4 6 5 -1 4 5 7 -1 4 7 6 -1 5 6 7 -1 ] }
}`);
    expect(objs).toHaveLength(1);
    const [o] = objs as [CutObject];
    expect(o.brep.numFaces).toBe(8);
    expect(o.brep.vertices()).toHaveLength(8); // the point at 50 50 50 isn't used: not taken
    const colors = new Set(o.brep.faces().map((f) => (o.brep.faceColors.get(f) ?? o.color).join()));
    expect(colors).toEqual(new Set(['255,0,0', '0,0,255']));
    expect(vol(o)).toBeCloseTo(9);
  });

  it('keeps each Separator its own, and names a DEF without its +n', () => {
    const objs = readInventor(`#Inventor V2.1 ascii
Separator {
  Coordinate3 { point [ 0 0 0, 3 0 0, 0 3 0, 0 0 3 ] }
  DEF part+3 Separator { IndexedFaceSet { coordIndex [ 0 2 1 -1 0 1 3 -1 0 3 2 -1 1 2 3 -1 ] } }
  Separator { Translation { translation 9 0 0 } IndexedFaceSet { coordIndex [ 0 2 1 -1 0 1 3 -1 0 3 2 -1 1 2 3 -1 ] } }
}`);
    const [g] = objs;
    expect(g!.children).toHaveLength(2);
    expect(g!.children[0]!.name).toBe('part');
  });

  it("reads a face set's own points and colours (vertexProperty), as JPL's terrain meshes have", () => {
    const objs = readInventor(`#Inventor V2.1 ascii
Separator {
  Coordinate3 { point [ 99 99 99, 98 99 99, 99 98 99 ] }
  IndexedFaceSet {
    vertexProperty VertexProperty {
      vertex [ 0 0 0, 3 0 0, 0 3 0, 0 0 3 ]
      orderedRGBA [ 0xff000000, 0x0000ff00 ]
      materialBinding PER_FACE
    }
    coordIndex [ 0 2 1 -1 0 1 3 -1 0 3 2 -1 1 2 3 -1 ]
  }
}`);
    expect(objs).toHaveLength(1);
    const [o] = objs as [CutObject];
    expect(vol(o)).toBeCloseTo(4.5); // its own tetrahedron, not the Coordinate3's points
    const colors = new Set(o.brep.faces().map((f) => (o.brep.faceColors.get(f) ?? o.color).join()));
    expect(colors).toEqual(new Set(['255,0,0', '0,0,255']));
  });
});

describe('binary Open Inventor', () => {
  // Written by Coin3D from the ASCII files beside them (docker/coin/make.sh).
  const fixture = (name: string) =>
    new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', name)));
  const summary = (objs: CutObject[]) =>
    [...objs.flatMap((o) => [...preorder([o])])].map((o) => ({
      name: o.name,
      faces: o.brep.numFaces,
      color: o.color,
      volume: Math.round(vol(o) * 1000) / 1000,
      at: o.brep.numFaces ? at(o).map((v) => Math.round(v * 1000) / 1000) : null,
    }));

  it('reads as the ASCII it was written from: DEF and USE, materials, transforms, enums', () => {
    const text = readFileSync(join(import.meta.dirname, 'fixtures', 'scene.ascii.iv'), 'latin1');
    const fromText = readInventor(text);
    const fromBinary = readInventor(fixture('scene.bin.iv'));
    expect(summary(fromBinary)).toEqual(summary(fromText));
    expect(summary(fromBinary).some((o) => o.color.join() === '255,0,0')).toBe(true);
  });

  it("reads the other field types, and a node Inventor doesn't know that describes its fields", () => {
    for (const f of ['types', 'rare']) {
      const text = readFileSync(join(import.meta.dirname, 'fixtures', `${f}.ascii.iv`), 'latin1');
      expect(summary(readInventor(fixture(`${f}.bin.iv`)))).toEqual(summary(readInventor(text)));
    }
    // The cylinder (parts SIDES | TOP) and the cube in the switch.
    const solids = readInventor(fixture('types.bin.iv'))
      .flatMap((o) => [...preorder([o])])
      .filter((o) => !o.attrs.props.includes('Grouper'));
    expect(solids.map((o) => o.brep.numFaces)).toEqual([26, 6]);
  });

  it('says what it could not read, and where', () => {
    const bad = new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', 'scene.bin.iv')));
    expect(() => readInventor(bad.subarray(0, 200))).toThrow(
      /binary Inventor: the file ends too soon \(at byte \d+\)/,
    );
  });
});

/** An SGI image (.rgb) of w × h, RGB, its rows given from the top; run-length encoded or not. */
function sgi(
  w: number,
  h: number,
  rgbAt: (x: number, y: number) => number[],
  rle: boolean,
): Uint8Array {
  const head = new Uint8Array(512);
  const dv = new DataView(head.buffer);
  dv.setUint16(0, 474);
  head[2] = rle ? 1 : 0;
  head[3] = 1;
  dv.setUint16(4, 3);
  dv.setUint16(6, w);
  dv.setUint16(8, h);
  dv.setUint16(10, 3);
  // Channel by channel, the bottom row first.
  const rows: number[][] = [];
  for (let z = 0; z < 3; z++)
    for (let r = 0; r < h; r++) rows.push([...Array(w).keys()].map((x) => rgbAt(x, h - 1 - r)[z]!));
  if (!rle) return Uint8Array.from([...head, ...rows.flat()]);
  // Each row as one literal run then the end: the reader must follow the offset table.
  const packed = rows.map((row) => [0x80 | row.length, ...row, 0]);
  const tables = new Uint8Array(rows.length * 8);
  const tv = new DataView(tables.buffer);
  let at = 512 + tables.length;
  packed.forEach((p, i) => {
    tv.setUint32(i * 4, at);
    tv.setUint32(rows.length * 4 + i * 4, p.length);
    at += p.length;
  });
  return Uint8Array.from([...head, ...tables, ...packed.flat()]);
}

describe('SGI images and Inventor textures', () => {
  const red = [250, 10, 10];
  const blue = [10, 10, 250];
  // Red on the left, blue on the right, a green top row.
  const art = (x: number, y: number) => (y === 0 ? [10, 250, 10] : x < 4 ? red : blue);

  it.each([false, true])('reads an SGI image, its top row first (run-length: %s)', (rle) => {
    const img = readSgi(sgi(8, 4, art, rle));
    expect([img.width, img.height]).toEqual([8, 4]);
    const px = (x: number, y: number) => Array.from(img.data).slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4); // prettier-ignore
    expect(px(0, 0)).toEqual([10, 250, 10, 255]);
    expect(px(0, 3)).toEqual([...red, 255]);
    expect(px(7, 3)).toEqual([...blue, 255]);
  });

  /** A JPL-style terrain: a gently rolling n × n grid, Z up (its faces facing −Z, JPL's up), textured. */
  const terrain = (n: number) => {
    const pts: string[] = [];
    const uv: string[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        pts.push(`${i} ${j} ${(Math.sin(i * 0.3) * Math.cos(j * 0.2) * 0.5).toFixed(4)}`);
        uv.push(`${i / (n - 1)} ${j / (n - 1)}`); // u across i, v (from the bottom) along j
      }
    const idx: string[] = [];
    for (let i = 0; i + 1 < n; i++)
      for (let j = 0; j + 1 < n; j++) {
        const a = i * n + j;
        idx.push(`${a} ${a + 1} ${a + n} -1 ${a + 1} ${a + n + 1} ${a + n} -1`);
      }
    return `#Inventor V2.1 ascii
Separator {
  Texture2 { filename "/some/where/ground.rgb" }
  Material { diffuseColor 1 1 1 }
  ShapeHints { vertexOrdering COUNTERCLOCKWISE }
  IndexedFaceSet {
    vertexProperty VertexProperty { vertex [ ${pts.join(',\n')} ] texCoord [ ${uv.join(',\n')} ] }
    coordIndex [ ${idx.join('\n')} ]
    textureCoordIndex -1
  }
}`;
  };

  it('colours a face set from its texture, and lays a terrain made Z up on the floor', () => {
    const img: Pixels = readSgi(sgi(8, 4, art, true));
    let flat = false;
    const asked: string[] = [];
    const [o] = readInventor(terrain(30), {
      images: (name) => (asked.push(name), name === 'ground.rgb' ? img : undefined),
      laidFlat: () => (flat = true),
    });
    expect(asked).toEqual(['ground.rgb']); // by its last part, once
    expect(flat).toBe(true);
    // Lying down: its height (0.5 either way) is now Y, and its faces face up.
    // On a slab: a solid, its flat bottom 5% of its width below its lowest point.
    expect(solid(o!)).toBe(true);
    const b = roomBox([o!])!;
    expect(b.lo[1]!).toBeCloseTo(-0.5 - 0.05 * 29, 1);
    expect(b.hi[1]!).toBeLessThan(0.51);
    expect(b.hi[0]! - b.lo[0]!).toBeCloseTo(29);
    expect(b.hi[2]! - b.lo[2]!).toBeCloseTo(29);
    const up = o!.brep.faces().filter((f) => o!.brep.faceNormal(f)[1]! > 0.5);
    const colors = new Set(up.map((f) => (o!.brep.faceColors.get(f) ?? o!.color).join()));
    // Left red, right blue, and at the far end of v (the image's top row) green.
    expect(colors).toEqual(new Set(['248,8,8', '8,8,248', '8,248,8']));
    // Its colours are a photo's, and stay so in a .cut file.
    expect(o!.attrs.photo).toBe(true);
    const [back] = readCut(writeCut({ title: 't', contains: 'World', name: null, roots: [o!] })).doc.roots; // prettier-ignore
    expect(back!.attrs.photo).toBe(true);
  });

  it('without its texture it comes in uncoloured, and says which file it wanted', () => {
    const missing: string[] = [];
    const [o] = readInventor(terrain(30), { missingImage: (n) => missing.push(n) });
    expect(missing).toEqual(['ground.rgb']);
    expect(new Set(o!.brep.faces().map((f) => o!.brep.faceColors.get(f) ?? null))).toEqual(
      new Set([null]),
    );
  });

  it("doesn't turn a solid, or a small sheet", () => {
    let flat = false;
    readInventor(terrain(8), { laidFlat: () => (flat = true) }); // 98 faces: a picture, not ground
    expect(flat).toBe(false);
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

  it('reads a plan (lines only) as the regions its lines close: laminas lying flat, a layer each', () => {
    let told: number[] = [];
    const house = readDxf(read(join(import.meta.dirname, 'fixtures/house-plan.dxf')), {
      plan: (regions, loose) => (told = [regions, loose]),
    });
    // The doors' leaves and swings, three of each, close nothing.
    expect(told).toEqual([10, 6]);
    expect(house.map((o) => o.name)).toEqual(['WALLS', 'WINDOWS', 'FIXTURES']);
    const [walls, windows, fixtures] = house as [CutObject, CutObject, CutObject];
    // The outside wall (round the front door's opening) and four pieces of inside wall, between doors.
    // The area of the face that looks up (the front), holes taken out.
    const top = (o: CutObject) => {
      const b = o.brep;
      const ys = [...b.faces()].map((f) =>
        b.faceLoops(f).reduce((y, l) => y + newell(b.loopHalfEdges(l).map((h) => b.vertexPos(b.heVertex(h))))[1], 0),
      ); // prettier-ignore
      return Math.max(...ys) / 2;
    };
    const flat = (o: CutObject) => {
      const b = roomBox([o])!;
      return b.hi[1]! - b.lo[1]!;
    };
    expect(walls.children.map((c) => Math.round(top(c)))).toEqual([9720, 1032, 552, 224, 216]);
    expect(walls.children.every((c) => flat(c) === 0 && c.brep.numFaces === 2)).toBe(true);
    expect(windows.children).toHaveLength(3);
    // The island (80 by 40, round ends: its bulges) and the table, a circle 24 across, to 10° steps.
    expect(fixtures.children.map((c) => Math.round(top(c) / 10))).toEqual([445, 180]);
    // White walls, as the WALLS layer is; its front faces up.
    expect(walls.children[0]!.color).toEqual([255, 255, 255]);
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
