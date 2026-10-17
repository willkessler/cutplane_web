// The globe pad's picture (assets/icons/globe.icon): a little Earth, its seas,
// land and ice from Natural Earth's 1:110m land (the world-atlas package), on a
// sphere of latitude and longitude faces, tilted as the Earth is.
//
//   docker run --rm -v "$PWD":/work -w /work/docker/globe node:22 \
//     sh -c "npm i --no-save --silent world-atlas@2 topojson-client@3 && node make.mjs"
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';

const LON = 48; // faces round
const LAT = 24; // faces from pole to pole
const R = 25;
const C = [25, 25, 25];
const TILT = (23.44 * Math.PI) / 180;
const FRONT = -30; // the longitude that faces out of the pad: the Atlantic, between the Americas and Africa
const SEA = [45, 115, 230];
const LAND = [85, 185, 75];
const ICE = [235, 240, 245];

const topo = JSON.parse(readFileSync('node_modules/world-atlas/land-110m.json', 'utf8'));
const land = feature(topo, topo.objects.land);
const rings = land.features.flatMap((f) =>
  f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat(),
);

/** Even-odd over every ring: is (lon, lat) on land? */
function onLand(lon, lat) {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
  return inside;
}

/** A face's colour: land if most of a 4 × 4 sampling of it is. */
function colorOf(lon0, lon1, lat0, lat1) {
  let n = 0;
  for (let a = 0; a < 4; a++)
    for (let b = 0; b < 4; b++)
      if (onLand(lon0 + ((a + 0.5) / 4) * (lon1 - lon0), lat0 + ((b + 0.5) / 4) * (lat1 - lat0)))
        n++;
  if (n < 6) return SEA;
  const lat = (lat0 + lat1) / 2;
  return lat > 66 || lat < -60 ? ICE : LAND;
}

function point(lon, lat) {
  const t = ((lon - FRONT) * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const x = Math.cos(p) * Math.sin(t);
  const y = Math.sin(p);
  const z = Math.cos(p) * Math.cos(t);
  // The north pole leans to the right.
  return [
    C[0] + R * (x * Math.cos(TILT) + y * Math.sin(TILT)),
    C[1] + R * (-x * Math.sin(TILT) + y * Math.cos(TILT)),
    C[2] + R * z,
  ];
}

// Vertex 1 is the south pole (the hotspot: the globe hangs over the crosshair from it),
// then each ring of latitude from the south, then the north pole.
const verts = [point(0, -90)];
const ring = (j) => 2 + (j - 1) * LON; // first vertex of ring j (1 … LAT-1)
for (let j = 1; j < LAT; j++)
  for (let i = 0; i < LON; i++) verts.push(point(-180 + (i * 360) / LON, -90 + (j * 180) / LAT));
const north = verts.push(point(0, 90));

const faces = []; // [vertex numbers (anticlockwise from outside), colour]
const lonOf = (i) => -180 + (i * 360) / LON;
const latOf = (j) => -90 + (j * 180) / LAT;
for (let i = 0; i < LON; i++) {
  const k = (i + 1) % LON;
  faces.push([[1, ring(1) + k, ring(1) + i], colorOf(lonOf(i), lonOf(i + 1), latOf(0), latOf(1))]);
}
for (let j = 1; j < LAT - 1; j++)
  for (let i = 0; i < LON; i++) {
    const k = (i + 1) % LON;
    faces.push([
      [ring(j) + i, ring(j) + k, ring(j + 1) + k, ring(j + 1) + i],
      colorOf(lonOf(i), lonOf(i + 1), latOf(j), latOf(j + 1)),
    ]);
  }
for (let i = 0; i < LON; i++) {
  const k = (i + 1) % LON;
  faces.push([
    [ring(LAT - 1) + i, ring(LAT - 1) + k, north],
    colorOf(lonOf(i), lonOf(i + 1), latOf(LAT - 1), latOf(LAT)),
  ]);
}

const f = (x) => x.toFixed(4);
const identity = [
  ' [  1.000000  0.000000  0.000000  0.000000  ]',
  ' [  0.000000  1.000000  0.000000  0.000000  ]',
  ' [  0.000000  0.000000  1.000000  0.000000  ]',
  ' [  0.000000  0.000000  0.000000  1.000000  ]',
];
const colored = faces.map(([, c], n) => [n + 1, c]).filter(([, c]) => c !== SEA);

// Its axle, a brass rod through the poles, as on a desk globe. (A tool's picture needs a
// part under it: tool.cpl's Put_away_tool turns a tool with none over to find its other side.)
const AXLE = [190, 150, 60];
const W = 1.2; // half its thickness
const L = R + 5; // half its length
const up = [Math.sin(TILT), Math.cos(TILT), 0];
const across = [Math.cos(TILT), -Math.sin(TILT), 0]; // across × up = z: a right-handed frame
const axle = [];
for (const [x, y, z] of [
  [-W, -L, -W],
  [W, -L, -W],
  [W, L, -W],
  [-W, L, -W],
  [-W, -L, W],
  [W, -L, W],
  [W, L, W],
  [-W, L, W],
])
  // prettier-ignore
  axle.push([0, 1, 2].map((k) => C[k] + x * across[k] + y * up[k] + (k === 2 ? z : 0)));
// A box's faces (as union.icon's blocks have them).
const BOX = [[8, 5, 6, 7], [1, 4, 3, 2], [6, 5, 1, 2], [7, 6, 2, 3], [8, 7, 3, 4], [5, 8, 4, 1]]; // prettier-ignore
const out = [
  '** Start of file ./icons/globe.icon **',
  'Contains:Branch',
  'Branch Name:Globe',
  '\tTotal Number of Objects In Branch:2',
  '',
  '',
  '\tObject 0:',
  'Object Name:Globe',
  ' Object Transform:',
  ...identity,
  ' Object Inverse Transform:',
  ...identity,
  'Object Parent:0',
  `Object Color:${SEA.join(' ')}`,
  'Object has 4 properties:',
  'Lockedgeometry',
  'Tool',
  'Gravity',
  'Quickupdate',
  'Object Selectechnique:set_object_selectable',
  'Object Drawtechnique:normal_draw_technique',
  'Object Screenbboxtechnique:Normal',
  '',
  'Number of Shells:1',
  'Shell 1:',
  ` Number of Vertices:${verts.length}`,
  ' VFE List:',
  ...verts.map((v, n) => `Vertex ${n + 1}: ${v.map(f).join(' ')}`),
  ` Number of Faces:${faces.length}`,
  ' FVE List:',
  ...faces.flatMap(([vs], n) => [
    `Face:${n + 1} (1 bounds)`,
    `\tBound 1 (${vs.length} le's):${vs.join(' ')} `,
  ]),
  `Faces with different colors:${colored.length}`,
  ...colored.map(([n, c]) => `\tFace ${n}:${c.join(' ')}`),
  'Vertices with properties:1',
  'Vertex 1 has 1 properties:',
  'Hotspot',
  'Edges with properties:0',
  'Faces with properties:0',
  'Vertices with CPL private code:0',
  'Edges with CPL private code:0',
  'Faces with CPL private code:0',
  '',
  '',
  '\tObject 1:',
  'Object Name:Axle',
  ' Object Transform:',
  ...identity,
  ' Object Inverse Transform:',
  ...identity,
  'Object Parent:1',
  `Object Color:${AXLE.join(' ')}`,
  'Object has 2 properties:',
  'Lockedgeometry',
  'Quickupdate',
  'Object Selectechnique:set_object_selectable',
  'Object Drawtechnique:normal_draw_technique',
  'Object Screenbboxtechnique:Normal',
  '',
  'Number of Shells:1',
  'Shell 1:',
  ' Number of Vertices:8',
  ' VFE List:',
  ...axle.map((v, n) => `Vertex ${n + 1}: ${v.map(f).join(' ')}`),
  ' Number of Faces:6',
  ' FVE List:',
  ...BOX.flatMap((vs, n) => [`Face:${n + 1} (1 bounds)`, `\tBound 1 (4 le's):${vs.join(' ')} `]),
  'Faces with different colors:0',
  'Vertices with properties:0',
  'Edges with properties:0',
  'Faces with properties:0',
  'Vertices with CPL private code:0',
  'Edges with CPL private code:0',
  'Faces with CPL private code:0',
  '** End of file ./icons/globe.icon **',
  '',
];
writeFileSync('../../assets/icons/globe.icon', out.join('\n'));
console.log(
  `${verts.length} vertices, ${faces.length} faces, ${colored.length} of them land or ice`,
);
