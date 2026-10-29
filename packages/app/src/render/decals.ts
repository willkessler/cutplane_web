import * as THREE from 'three';
import { mat4, type CutObject, type TextDecal } from '@cutplane/kernel';

/**
 * New: lettering on objects (TextDecal), as a decal is laid on: the text is
 * drawn into a picture, and that picture is projected straight down the
 * decal's normal onto the object's own triangles, cut to its box. Only faces
 * turned towards it take it, so it doesn't come through on the far side, and
 * it runs across a seam between faces as a painted word would.
 */

type V3 = [number, number, number];

/** One typeface for now, as a sign painter's plain capitals. */
export const DECAL_FONT = '600 96px "Helvetica Neue", Helvetica, Arial, sans-serif';

/** How steeply a face can lie from the decal and still take it (cos 70°). */
const FACING = Math.cos((70 * Math.PI) / 180);

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** A decal as the room has it: its middle, the way it reads (u), up (v) and out (n). */
export interface DecalFrame {
  at: V3;
  u: V3;
  v: V3;
  n: V3;
  /** The capitals' height, in the room. */
  height: number;
}

function applyDir(m: mat4.Mat4, d: readonly number[]): V3 {
  const o = mat4.transformPoint(m, 0, 0, 0);
  const p = mat4.transformPoint(m, d[0]!, d[1]!, d[2]!);
  return sub(p, o);
}

/** Where `d`, kept in `o`'s own coordinates, lies in the room. */
export function decalFrame(o: CutObject, d: TextDecal): DecalFrame {
  const at = mat4.transformPoint(o.xform, ...d.at);
  const n = unit(applyDir(o.xform, d.normal));
  let u = applyDir(o.xform, d.along);
  u = unit(sub(u, n.map((c) => c * dot(u, n)) as V3));
  const v = cross(n, u);
  const vl = cross(unit([...d.normal]), unit([...d.along]));
  return { at, u, v, n, height: d.height * Math.hypot(...applyDir(o.xform, vl)) };
}

/** The other way: a decal at a frame in the room, kept in `o`'s coordinates. */
export function decalIn(
  o: CutObject,
  f: DecalFrame,
  text: string,
  color: readonly number[],
): TextDecal {
  const at = mat4.transformPoint(o.invXform, ...f.at);
  const v = applyDir(o.invXform, f.v);
  return {
    text,
    color: [color[0]!, color[1]!, color[2]!],
    height: f.height * Math.hypot(...v),
    at,
    normal: unit(applyDir(o.invXform, f.n)),
    along: unit(applyDir(o.invXform, f.u)),
  };
}

/** What the text takes up, in units of the capitals' height: its width and the picture's height. */
export interface TextBox {
  width: number;
  height: number;
  /** The picture (none where there's no canvas: tests). */
  canvas?: HTMLCanvasElement;
}

const boxes = new Map<string, TextBox>();

/** The text drawn white on clear, sized to it (kept: drawn once a text). */
export function textBox(text: string): TextBox {
  let b = boxes.get(text);
  if (b) return b;
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) {
    // No canvas: as a sans capital runs, about 0.7 of its height a letter.
    b = { width: 0.4 + 0.72 * text.length, height: 1.8 };
  } else {
    ctx.font = DECAL_FONT;
    const cap = ctx.measureText('H').actualBoundingBoxAscent || 69;
    const w = ctx.measureText(text).width + cap * 0.4;
    const h = cap * 1.8;
    canvas.width = Math.ceil(w);
    canvas.height = Math.ceil(h);
    ctx.font = DECAL_FONT;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + cap / 2);
    b = { width: canvas.width / cap, height: canvas.height / cap, canvas };
  }
  boxes.set(text, b);
  return b;
}

/**
 * The decal's pieces: each of `pos`'s triangles (world, 9 a triangle) turned
 * towards `f` and within its box (`w` × `h` in the room, `depth` either side of
 * its plane), cut to the box. Positions, picture coordinates, and for each
 * triangle out, the one in `pos` it lies on.
 */
export function projectDecal(
  pos: ArrayLike<number>,
  f: DecalFrame,
  w: number,
  h: number,
  depth: number,
): { pos: number[]; uv: number[]; from: number[] } {
  const out = { pos: [] as number[], uv: [] as number[], from: [] as number[] };
  const lim: [0 | 1 | 2, number][] = [
    [0, -w / 2],
    [0, w / 2],
    [1, -h / 2],
    [1, h / 2],
    [2, -depth],
    [2, depth],
  ];
  for (let t = 0; t + 8 < pos.length; t += 9) {
    const p: V3[] = [0, 3, 6].map((k) => [pos[t + k]!, pos[t + k + 1]!, pos[t + k + 2]!]);
    const tn = unit(cross(sub(p[1]!, p[0]!), sub(p[2]!, p[0]!)));
    if (dot(tn, f.n) < FACING) continue;
    let poly: V3[] = p.map((q) => {
      const r = sub(q, f.at);
      return [dot(r, f.u), dot(r, f.v), dot(r, f.n)];
    });
    for (const [k, c] of lim) {
      const keep = (q: V3) => (c < 0 ? q[k] >= c : q[k] <= c);
      const next: V3[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        if (keep(a)) next.push(a);
        if (keep(a) !== keep(b)) {
          const s = (c - a[k]) / (b[k] - a[k]);
          next.push([a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1]), a[2] + s * (b[2] - a[2])]);
        }
      }
      poly = next;
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;
    const world = (q: V3) => [0, 1, 2].map((i) => f.at[i]! + q[0] * f.u[i]! + q[1] * f.v[i]! + q[2] * f.n[i]!); // prettier-ignore
    for (let i = 1; i + 1 < poly.length; i++)
      for (const q of [poly[0]!, poly[i]!, poly[i + 1]!]) {
        out.pos.push(...world(q));
        out.uv.push(q[0] / w + 0.5, q[1] / h + 0.5);
      }
    for (let i = 1; i + 1 < poly.length; i++) out.from.push(t / 9);
  }
  return out;
}

/** The decal's box in the room: as wide and high as its picture, as deep as half its larger side. */
export function decalSize(f: DecalFrame, text: string): { w: number; h: number; depth: number } {
  const b = textBox(text);
  const w = b.width * f.height;
  const h = b.height * f.height;
  return { w, h, depth: Math.max(h, 0.5 * Math.min(w, 4 * h)) };
}

const textures = new Map<string, THREE.CanvasTexture>();

/** The text's picture as a texture (kept: one a text). */
export function decalTexture(text: string): THREE.Texture | null {
  let t = textures.get(text);
  if (t) return t;
  const c = textBox(text).canvas;
  if (!c) return null;
  t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  textures.set(text, t);
  return t;
}

/**
 * Where a decal goes on a solid (its triangles `pos`, world, each with its face's
 * normal in `normals`) dropped near `point`: the nearest place on its surface,
 * out the way that face looks, reading along the surface's axis there (a hull's
 * length, a tube's) or, where there's none (flat, or round all ways), level;
 * upright. `along` is a way to read instead; `roll` turns it after (degrees,
 * anticlockwise as seen from outside).
 */
export function placeDecal(
  pos: ArrayLike<number>,
  normals: ArrayLike<number>,
  point: V3,
  height: number,
  along?: V3,
  roll = 0,
): DecalFrame {
  let best = { d: Infinity, at: point, t: -1 };
  const n3 = (t: number): V3 => [normals[t * 3]!, normals[t * 3 + 1]!, normals[t * 3 + 2]!];
  const dist: number[] = [];
  for (let t = 0; t * 9 + 8 < pos.length; t++) {
    const p = [0, 3, 6].map((k) => [pos[t * 9 + k]!, pos[t * 9 + k + 1]!, pos[t * 9 + k + 2]!]) as [V3, V3, V3]; // prettier-ignore
    const q = closestOnTriangle(point, ...p);
    const d = Math.hypot(...sub(q, point));
    dist.push(d);
    // Of two as near (an edge between faces), the one facing the point more.
    const facing = dot(n3(t), sub(point, q));
    if (d < best.d - 1e-6 || (d < best.d + 1e-6 && best.t >= 0 && facing > dot(n3(best.t), sub(point, best.at)))) // prettier-ignore
      best = { d, at: q, t };
  }
  if (best.t < 0) throw new Error('no surface to put it on');
  const n = unit(n3(best.t));
  let u: V3 | null = along ? unit(sub(along, n.map((c) => c * dot(along, n)) as V3)) : null;
  if (u && Math.hypot(...u) < 0.5) u = null;
  if (!u) {
    // The surface's axis: the way the normals near it don't turn (least of Σ a·n nᵀ).
    const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const reach = 4 * height;
    for (let t = 0; t < dist.length; t++) {
      if (dist[t]! > reach) continue;
      const tn = n3(t);
      if (dot(tn, n) < FACING) continue;
      const p = (k: number) => [pos[t * 9 + k]!, pos[t * 9 + k + 1]!, pos[t * 9 + k + 2]!] as V3;
      const a = Math.hypot(...cross(sub(p(3), p(0)), sub(p(6), p(0)))) / 2;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j]! += a * tn[i]! * tn[j]!;
    }
    const { values, vectors } = eigen3(m);
    // Bent one way only (a hull): the least turns along it. Flat or round all ways: level.
    if (values[1] > 0.01 * values[0] && values[2] < 0.25 * values[1])
      u = unit(sub(vectors[2], n.map((c) => c * dot(vectors[2], n)) as V3));
    else {
      const level = cross([0, 1, 0], n);
      u = Math.hypot(...level) > 0.3 ? unit(level) : unit(sub([1, 0, 0], n.map((c) => c * n[0]) as V3)); // prettier-ignore
    }
    // Upright: its up towards the ceiling (or, standing on end, reading upwards).
    const up = cross(n, u);
    if (up[1] < -1e-3 || (Math.abs(up[1]) <= 1e-3 && u[1] < 0)) u = u.map((c) => -c) as V3;
  }
  if (roll) {
    const r = (roll * Math.PI) / 180;
    const w = cross(n, u);
    u = unit(u.map((c, i) => c * Math.cos(r) + w[i]! * Math.sin(r)) as V3);
  }
  return { at: best.at, u, v: cross(n, u), n, height };
}

/** The nearest point of triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a); // prettier-ignore
  const d1 = dot(ab, ap), d2 = dot(ac, ap); // prettier-ignore
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp); // prettier-ignore
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  const along = (o: V3, e: V3, s: number): V3 => [o[0] + s * e[0], o[1] + s * e[1], o[2] + s * e[2]]; // prettier-ignore
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return along(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp); // prettier-ignore
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return along(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    return along(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den; // prettier-ignore
  return [0, 1, 2].map((i) => a[i]! + ab[i]! * v + ac[i]! * w) as V3;
}

/** A symmetric 3×3's eigenvalues, largest first, and their vectors (Jacobi). */
export function eigen3(m: readonly number[]): { values: V3; vectors: [V3, V3, V3] } {
  const a = [...m];
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = a[1]! ** 2 + a[2]! ** 2 + a[5]! ** 2;
    if (off < 1e-24) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p * 3 + q]!;
      if (Math.abs(apq) < 1e-30) continue;
      const theta = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p]!, akq = a[k * 3 + q]!; // prettier-ignore
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k]!, aqk = a[q * 3 + k]!; // prettier-ignore
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p]!, vkq = v[k * 3 + q]!; // prettier-ignore
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j * 4]! - a[i * 4]!);
  const col = (i: number): V3 => [v[i]!, v[3 + i]!, v[6 + i]!];
  return {
    values: order.map((i) => a[i * 4]!) as V3,
    vectors: order.map(col) as [V3, V3, V3],
  };
}
