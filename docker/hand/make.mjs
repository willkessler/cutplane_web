// The pan tool's picture (assets/icons/pan.icon): a hand, open, fingers up. The
// original's was drawn by hand in 1991, its outline doubling back on itself and its
// sides joining the front to the back at the wrong points, so it shaded in pieces.
// This one is a single smooth outline (a palm, four fingers and a thumb, blended
// where they meet), its edges rounded over front and back, one shell, every face
// flat. Its cuff is a second piece, its child: tool.cpl turns a tool with no children
// end for end as it goes back on its pad (the pencil to its eraser), and a hand with
// no other end was lost doing so (the original's was in three pieces).
//
//   docker run --rm -v "$PWD":/work -w /work/docker/hand node:22 node make.mjs
import { writeFileSync } from 'node:fs';

const PINK = [244, 69, 177]; // the original's
const DEPTH = 9; // front to back
const ROUND = 2.2; // the edges' radius, front and back
const ROUND_STEPS = 4; // rings round each rounded edge
const POINTS = 240; // round the outline
const CELL = 0.1; // the outline is traced on a grid this fine

// ---- the outline, as a signed distance (negative inside) ----
const capsule = (ax, ay, bx, by, r) => (x, y) => {
  const [dx, dy] = [bx - ax, by - ay];
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy) - r;
};
const roundBox = (cx, cy, hx, hy, r) => (x, y) => {
  const qx = Math.abs(x - cx) - hx + r;
  const qy = Math.abs(y - cy) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
/** A smooth union (polynomial smooth min): what meets is blended over about `k`. */
const blend = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};

// A right hand, its back to us: the thumb out to the right, as the original's; about 55
// high, as small in hand as the other tools.
const palm = roundBox(23, 16, 10, 9, 5);
const digits = [
  capsule(14.5, 21, 9, 37, 2.4), // little
  capsule(19.5, 23, 17.5, 44, 2.6), // ring
  capsule(25, 24, 26, 48, 2.7), // middle
  capsule(30.5, 22, 34.5, 44, 2.6), // index
  capsule(31, 11, 42, 24, 2.9), // thumb
];
const TIP = [26, 48 + 2.7]; // the middle finger's tip: the hotspot
function hand(x, y) {
  let d = palm(x, y);
  for (const f of digits) d = blend(d, f(x, y), 2);
  return d;
}
// The cuff, round the wrist and over the palm's foot: a little proud of the hand,
// front and back.
const cuff = roundBox(23, 3, 8, 6, 2.5);
const CUFF_PROUD = 1;

// ---- traced (marching squares), then spaced evenly along its length ----
function trace(sdf) {
  const [x0, y0, x1, y1] = [-2, -6, 52, 56];
  const nx = Math.round((x1 - x0) / CELL);
  const ny = Math.round((y1 - y0) / CELL);
  const v = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) v[j * (nx + 1) + i] = sdf(x0 + i * CELL, y0 + j * CELL);
  const at = (i, j) => v[j * (nx + 1) + i];
  // Where the outline crosses each cell edge, keyed so neighbouring cells share it.
  const cross = (i0, j0, i1, j1) => {
    const [a, b] = [at(i0, j0), at(i1, j1)];
    const t = a / (a - b);
    return {
      key: `${i0},${j0},${i1},${j1}`,
      p: [x0 + (i0 + (i1 - i0) * t) * CELL, y0 + (j0 + (j1 - j0) * t) * CELL],
    };
  };
  // Each segment runs with the inside on its left (counter-clockwise round the shape).
  const next = new Map();
  const where = new Map();
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const c = [at(i, j) < 0, at(i + 1, j) < 0, at(i + 1, j + 1) < 0, at(i, j + 1) < 0];
      const e = [
        () => cross(i, j, i + 1, j),
        () => cross(i + 1, j, i + 1, j + 1),
        () => cross(i, j + 1, i + 1, j + 1),
        () => cross(i, j, i, j + 1),
      ];
      // Corners 0..3 go round counter-clockwise; edge k joins corner k and k + 1.
      const segs = [];
      for (let k = 0; k < 4; k++) {
        const [a, b] = [c[k], c[(k + 1) % 4]];
        if (a !== b) segs.push({ k, entering: !a && b });
      }
      if (segs.length !== 2) continue; // (no saddles here: the shape is never that thin)
      const [s0, s1] = segs;
      const from = s0.entering ? s1 : s0;
      const to = s0.entering ? s0 : s1;
      // Inside on the left: from the edge where it leaves the inside to where it enters.
      const a = e[from.k]();
      const b = e[to.k]();
      next.set(b.key, a.key);
      where.set(a.key, a.p);
      where.set(b.key, b.p);
    }
  const start = next.keys().next().value;
  const loop = [];
  for (let k = start; ;) {
    loop.push(where.get(k));
    k = next.get(k);
    if (k === start || k === undefined) break;
  }
  if (loop.length < next.size * 0.9) throw new Error('the outline is in more than one piece');
  return loop;
}

function area(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function resample(loop, n) {
  const pts = area(loop) < 0 ? [...loop].reverse() : loop;
  const len = [0];
  for (let i = 1; i <= pts.length; i++) {
    const [p, q] = [pts[i - 1], pts[i % pts.length]];
    len.push(len[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const total = len[pts.length];
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / n) * total;
    while (len[k + 1] < s) k++;
    const t = (s - len[k]) / (len[k + 1] - len[k]);
    const [p, q] = [pts[k], pts[(k + 1) % pts.length]];
    out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
  }
  return out;
}

// ---- a solid: rings of an outline, inset where the edges round over ----
/** What `sdf` outlines, from z0 to z0 + depth, its edges rounded over. */
function solid(sdf, z0, depth) {
  const outline = resample(trace(sdf), POINTS);
  /** Each point's way in: square to the line through its neighbours (the outline goes counter-clockwise). */
  const inward = outline.map((_, i) => {
    const [p, q] = [outline[(i + POINTS - 1) % POINTS], outline[(i + 1) % POINTS]];
    const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
    const l = Math.hypot(dx, dy);
    return [-dy / l, dx / l];
  });
  const ring = (inset, z) =>
    outline.map((p, i) => [p[0] + inward[i][0] * inset, p[1] + inward[i][1] * inset, z0 + z]);
  // From the back face's edge round to the side, up the side, and round to the front's.
  const rings = [];
  for (let s = 0; s <= ROUND_STEPS; s++) {
    const t = (s / ROUND_STEPS) * (Math.PI / 2);
    rings.push(ring(ROUND * (1 - Math.sin(t)), ROUND * (1 - Math.cos(t))));
  }
  for (let s = 0; s <= ROUND_STEPS; s++) {
    const t = (s / ROUND_STEPS) * (Math.PI / 2);
    rings.push(ring(ROUND * (1 - Math.cos(t)), depth - ROUND + ROUND * Math.sin(t)));
  }

  const verts = rings.flat();
  const id = (r, i) => r * POINTS + (i % POINTS) + 1;
  const faces = [];
  // The back, seen from behind; the front, seen from in front (counter-clockwise from outside).
  faces.push(outline.map((_, i) => id(0, POINTS - i)));
  faces.push(outline.map((_, i) => id(rings.length - 1, i)));
  // Round the sides, outward: the straight band a quad a step; where it rounds over, the
  // way in turns from point to point, so two triangles a step (each flat).
  for (let r = 0; r + 1 < rings.length; r++)
    for (let i = 0; i < POINTS; i++) {
      const [a, b, c, d] = [id(r, i), id(r, i + 1), id(r + 1, i + 1), id(r + 1, i)];
      if (r === ROUND_STEPS) faces.push([a, b, c, d]);
      else faces.push([a, b, c], [a, c, d]);
    }
  /** The front's vertex nearest (x, y). */
  const nearest = ([x, y]) => {
    const d = (k) => Math.hypot(outline[k][0] - x, outline[k][1] - y);
    let best = 0;
    for (let i = 1; i < POINTS; i++) if (d(i) < d(best)) best = i;
    return id(rings.length - 1, best);
  };
  return { outline, verts, faces, nearest };
}

const palmAndFingers = solid(hand, 0, DEPTH);
const wristband = solid(cuff, -CUFF_PROUD, DEPTH + 2 * CUFF_PROUD);
// The hotspot: the front's point nearest the middle fingertip.
const hotspot = palmAndFingers.nearest(TIP);

const f = (n) => n.toFixed(4);
const identity = [
  ' [  1.000000  0.000000  0.000000  0.000000  ]',
  ' [  0.000000  1.000000  0.000000  0.000000  ]',
  ' [  0.000000  0.000000  1.000000  0.000000  ]',
  ' [  0.000000  0.000000  0.000000  1.000000  ]',
];
/** One object of the branch: its header, its shell, its vertex with the hotspot (if it has it). */
const object = (n, name, parent, props, { verts, faces }, hot) => [
  `\tObject ${n}:`,
  `Object Name:${name}`,
  ' Object Transform:',
  ...identity,
  ' Object Inverse Transform:',
  ...identity,
  `Object Parent:${parent}`,
  `Object Color:${PINK.join(' ')}`,
  `Object has ${props.length} properties:`,
  ...props,
  'Object Selectechnique:set_object_selectable',
  'Object Drawtechnique:normal_draw_technique',
  'Object Screenbboxtechnique:Normal',
  '',
  'Number of Shells:1',
  'Shell 1:',
  ` Number of Vertices:${verts.length}`,
  ' VFE List:',
  ...verts.map((v, k) => `Vertex ${k + 1}: ${v.map(f).join(' ')}`),
  ` Number of Faces:${faces.length}`,
  ' FVE List:',
  ...faces.flatMap((vs, k) => [
    `Face:${k + 1} (1 bounds)`,
    `\tBound 1 (${vs.length} le's):${vs.join(' ')} `,
  ]),
  'Faces with different colors:0',
  ...(hot
    ? ['Vertices with properties:1', `Vertex ${hot} has 1 properties:`, 'Hotspot']
    : ['Vertices with properties:0']),
  'Edges with properties:0',
  'Faces with properties:0',
  'Vertices with CPL private code:0',
  'Edges with CPL private code:0',
  'Faces with CPL private code:0',
  '',
  '',
];
const out = [
  '** Start of file ./icons/pan.icon **',
  'Contains:Branch',
  'Branch Name:Pantool',
  '\tTotal Number of Objects In Branch:2',
  '',
  '',
  ...object(0, 'Pantool', 0, ['Tool', 'Pan', 'Lockedgeometry', 'Visible'], palmAndFingers, hotspot),
  ...object(1, 'Pancuff', 1, ['Lockedgeometry', 'Visible'], wristband, null),
  '** End of file ./icons/pan.icon **',
  '',
];
writeFileSync('../../assets/icons/pan.icon', out.join('\n'));
for (const [name, s] of [
  ['hand', palmAndFingers],
  ['cuff', wristband],
]) {
  const xs = s.outline.map((p) => p[0]);
  const ys = s.outline.map((p) => p[1]);
  console.log(
    `${name}: ${s.verts.length} vertices, ${s.faces.length} faces; ${f(Math.min(...xs))}..${f(Math.max(...xs))} across, ${f(Math.min(...ys))}..${f(Math.max(...ys))} up`,
  );
}
