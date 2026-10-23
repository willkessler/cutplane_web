import { mat4, type CutObject, type Mat4, type Rgb } from '@cutplane/kernel';
import type { V3 } from './faces.ts';
import { soupObjects, type Soup } from './polygonize.ts';
import { parseBinary } from './inventorbin.ts';
import { part, type MeshOptions } from './options.ts';
import type { Pixels } from './gltf.ts';
import { layFlat } from './terrain.ts';
import { paintSoups, quantize, texel } from './texture.ts';

/**
 * Open Inventor (.iv, ASCII) and VRML (.wrl, 1.0 and 2.0). VRML 1.0 is
 * Inventor's text format under another header; 2.0 nests shapes in fields
 * instead. One parser reads all three: a node is `[DEF name] Type { ... }`,
 * its body fields (a name and its values) and, in Inventor, child nodes.
 */

export type Value = number | string | VNode;
/** A field's values: numbers alone come as one array of them (the big lists: points, indices). */
export type Field = Value[] | Float64Array;

export interface VNode {
  type: string;
  fields: Map<string, Field>;
  children: VNode[];
  name?: string;
}

/** A growing list of numbers. */
class Numbers {
  a = new Float64Array(16);
  n = 0;
  push(v: number): void {
    if (this.n === this.a.length) {
      const b = new Float64Array(this.n * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  take(): Float64Array {
    return this.a.slice(0, this.n);
  }
}

// Character codes.
const HASH = 35, COMMA = 44, QUOTE = 34, BACKSLASH = 92, LF = 10, CR = 13; // prettier-ignore
const PLUS = 43, MINUS = 45, DOT = 46, ZERO = 48, NINE = 57; // prettier-ignore
/** Characters that end a word: space and below, and these. */
const BREAKS = new Set([...'{}[]()|,#"'].map((c) => c.charCodeAt(0)));
const isDigit = (c: number) => c >= ZERO && c <= NINE;

/**
 * The name a DEF gives a node, as it's shown: writers add "+n" to tell apart
 * nodes that share a name (rover_metal+0, rover_metal+1), which isn't part of it.
 * (USE refers to the whole of it.)
 */
/** Bytes as 8-bit text: Latin-1 maps every byte to the character of that code. */
export function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

export const defName = (def: string): string | undefined => def.replace(/\+\d+$/, '') || undefined;

/**
 * The text formats' nodes, read in one pass over the text: words, strings,
 * brackets and numbers, the numbers read straight into number arrays (a file
 * of millions of points makes no string for each).
 */
function parseText(text: string, progress?: (f: number) => void): VNode[] {
  const n = text.length;
  let i = 0;
  let reported = 0;
  const defs = new Map<string, VNode>();

  /** Past spaces, commas and comments. */
  const skip = () => {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === HASH) while (i < n && text.charCodeAt(i) !== LF && text.charCodeAt(i) !== CR) i++;
      else if (i < n && (c <= 32 || c === COMMA)) i++;
      else return;
    }
  };
  const isNumberAt = (at: number) => {
    let c = text.charCodeAt(at);
    if (c === PLUS || c === MINUS) c = text.charCodeAt(++at);
    return isDigit(c) || (c === DOT && isDigit(text.charCodeAt(at + 1)));
  };
  /** The word (or number) here, and past it. */
  const word = () => {
    const start = i;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c <= 32 || BREAKS.has(c)) break;
      i++;
    }
    return text.slice(start, i);
  };
  /** The number here: whole numbers (indices) without making a string. */
  const number = () => {
    const start = i;
    let c = text.charCodeAt(i);
    const neg = c === MINUS;
    if (c === PLUS || c === MINUS) c = text.charCodeAt(++i);
    let v = 0;
    while (isDigit(c)) {
      v = v * 10 + (c - ZERO);
      c = text.charCodeAt(++i);
    }
    if (c <= 32 || c === COMMA || BREAKS.has(c) || i >= n) {
      if (v <= Number.MAX_SAFE_INTEGER) return neg ? -v : v;
    }
    i = start;
    return Number(word());
  };
  const string = () => {
    let s = '';
    for (i++; i < n && text.charCodeAt(i) !== QUOTE; i++)
      s += text.charCodeAt(i) === BACKSLASH ? text[++i] : text[i];
    i++;
    return s;
  };
  /** Whether a node starts here: DEF, USE, or a type name and its {. */
  const startsNode = () => {
    const c = text.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95)) return false;
    const at = i;
    const w = word();
    if (w === 'DEF' || w === 'USE') {
      i = at;
      return true;
    }
    skip();
    const brace = text[i] === '{';
    i = at;
    return brace;
  };
  const tick = () => {
    if (i - reported < 1 << 20) return;
    reported = i;
    progress!(i / n);
  };
  const node = (): VNode => {
    if (progress) tick();
    let w = word();
    if (w === 'USE') {
      skip();
      const name = word();
      return defs.get(name) ?? { type: 'Group', fields: new Map(), children: [] };
    }
    let name: string | undefined;
    if (w === 'DEF') {
      skip();
      name = word();
      skip();
      w = word();
    }
    const shown = name && defName(name);
    const nd: VNode = {
      type: w,
      fields: new Map(),
      children: [],
      ...(shown ? { name: shown } : {}),
    };
    if (name) defs.set(name, nd);
    skip();
    i++; // {
    for (skip(); i < n && text[i] !== '}'; skip()) {
      if (startsNode()) {
        nd.children.push(node());
        continue;
      }
      const field = BREAKS.has(text.charCodeAt(i)) ? text[i++]! : word();
      skip();
      nd.fields.set(field, value());
    }
    i++; // }
    return nd;
  };
  const value = (): Field => {
    const c = text[i];
    if (c === '[') {
      i++;
      const nums = new Numbers();
      let vs: Value[] | null = null;
      for (skip(); i < n && text[i] !== ']'; skip()) {
        let v: Value;
        if (progress && (nums.n & 0xffff) === 0) tick();
        if (isNumberAt(i)) {
          v = number();
          if (!vs) {
            nums.push(v);
            continue;
          }
        } else if (text[i] === '"') v = string();
        else if (startsNode()) v = node();
        else if (BREAKS.has(text.charCodeAt(i))) v = text[i++]!;
        else v = word();
        vs ??= Array.from(nums.take());
        vs.push(v);
      }
      i++;
      return vs ?? nums.take();
    }
    if (c === '(') {
      const vs: Value[] = [];
      for (i++, skip(); i < n && text[i] !== ')'; skip())
        if (text[i] === '|') i++;
        else vs.push(word());
      i++;
      return vs;
    }
    if (c === '}' || i >= n) return [];
    if (startsNode()) return [node()];
    if (isNumberAt(i)) {
      const nums = new Numbers();
      for (; isNumberAt(i); skip()) nums.push(number());
      return nums.take();
    }
    if (c === '"') return [string()];
    if (BREAKS.has(text.charCodeAt(i))) return [text[i++]!];
    return [word()];
  };

  const roots: VNode[] = [];
  for (skip(); i < n; skip()) {
    if (startsNode()) roots.push(node());
    else if (BREAKS.has(text.charCodeAt(i)) && text[i] !== '"') i++;
    else if (text[i] === '"') string();
    else word();
  }
  return roots;
}

/** A field's numbers (a short one, as a list). */
const nums = (n: VNode, f: string, d: number[] = []): number[] => {
  const v = n.fields.get(f);
  if (!v) return d;
  return v instanceof Float64Array
    ? Array.from(v)
    : v.filter((x): x is number => typeof x === 'number');
};
/** A field's numbers as they are kept (a long list: points, indices), not copied. */
const list = (n: VNode, f: string): ArrayLike<number> => {
  const v = n.fields.get(f);
  if (!v) return [];
  return v instanceof Float64Array ? v : v.filter((x): x is number => typeof x === 'number');
};
const first = (n: VNode, f: string): Value | undefined => {
  const v = n.fields.get(f);
  return v instanceof Float64Array ? v[0] : v?.[0];
};
const word = (n: VNode, f: string, d = ''): string => {
  const v = first(n, f);
  return typeof v === 'string' ? v : d;
};
const child = (n: VNode, f: string): VNode | undefined => {
  const v = first(n, f);
  return typeof v === 'object' ? v : undefined;
};
const triples = (a: ArrayLike<number>): V3[] => {
  const out: V3[] = new Array<V3>(Math.floor(a.length / 3));
  for (let k = 0, j = 0; k + 2 < a.length; k += 3) out[j++] = [a[k]!, a[k + 1]!, a[k + 2]!];
  return out;
};
const pairs = (a: ArrayLike<number>): [number, number][] => {
  const out = new Array<[number, number]>(Math.floor(a.length / 2));
  for (let k = 0, j = 0; k + 1 < a.length; k += 2) out[j++] = [a[k]!, a[k + 1]!];
  return out;
};
const rgb = (c: readonly number[]): Rgb =>
  c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)) as Rgb;
/** Faces of an index list, each ended by -1 (the last may not be). */
const runs = (idx: ArrayLike<number>): number[][] => {
  const out: number[][] = [];
  let f: number[] = [];
  for (let k = 0; k < idx.length; k++) {
    const v = idx[k]!;
    if (v >= 0) f.push(v);
    else if (f.length) {
      out.push(f);
      f = [];
    }
  }
  if (f.length) out.push(f);
  return out;
};

/** Translation, rotation, scale about a centre (scaleOrientation left out), as a row-vector matrix. */
function trs(n: VNode): Mat4 {
  const t = nums(n, 'translation', [0, 0, 0]);
  const r = nums(n, 'rotation', [0, 0, 1, 0]);
  const s = nums(n, 'scaleFactor', nums(n, 'scale', [1, 1, 1]));
  const c = nums(n, 'center', [0, 0, 0]) as unknown as V3;
  const len = Math.hypot(r[0]!, r[1]!, r[2]!) || 1;
  const axis: V3 = [r[0]! / len, r[1]! / len, r[2]! / len];
  return mat4.multiply(
    mat4.multiply(mat4.scaleAbout(c, s as unknown as V3), mat4.rotationAbout(c, axis, r[3] ?? 0)),
    mat4.translation(t[0]!, t[1]!, t[2]!),
  );
}

// Primitives, centred on the origin as Inventor and VRML place them (turned outward on the way in).
const SIDES = 24;
function box(w: number, h: number, d: number): { pts: V3[]; faces: number[][] } {
  const [x, y, z] = [w / 2, h / 2, d / 2];
  const pts: V3[] = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]; // prettier-ignore
  return { pts, faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [0, 4, 7, 3], [1, 2, 6, 5]] }; // prettier-ignore
}
function lathe(top: number, bottom: number, h: number): { pts: V3[]; faces: number[][] } {
  const pts: V3[] = [];
  const faces: number[][] = [];
  const ring = (r: number, y: number) => {
    const at = pts.length;
    for (let k = 0; k < SIDES; k++) {
      const a = (2 * Math.PI * k) / SIDES;
      pts.push([r * Math.sin(a), y, r * Math.cos(a)]);
    }
    return at;
  };
  const b = ring(bottom, -h / 2);
  if (top > 0) {
    const t = ring(top, h / 2);
    for (let k = 0; k < SIDES; k++)
      faces.push([b + k, b + ((k + 1) % SIDES), t + ((k + 1) % SIDES), t + k]);
    faces.push([...Array(SIDES).keys()].map((k) => t + k));
  } else {
    pts.push([0, h / 2, 0]);
    const apex = pts.length - 1;
    for (let k = 0; k < SIDES; k++) faces.push([b + k, b + ((k + 1) % SIDES), apex]);
  }
  faces.push([...Array(SIDES).keys()].reverse().map((k) => b + k));
  return { pts, faces };
}
function sphere(r: number): { pts: V3[]; faces: number[][] } {
  const rings = 12;
  const pts: V3[] = [[0, r, 0]];
  for (let i = 1; i < rings; i++) {
    const p = (Math.PI * i) / rings;
    for (let k = 0; k < SIDES; k++) {
      const a = (2 * Math.PI * k) / SIDES;
      pts.push([r * Math.sin(p) * Math.sin(a), r * Math.cos(p), r * Math.sin(p) * Math.cos(a)]);
    }
  }
  pts.push([0, -r, 0]);
  const at = (i: number, k: number) => 1 + (i - 1) * SIDES + (k % SIDES);
  const faces: number[][] = [];
  for (let k = 0; k < SIDES; k++) faces.push([0, at(1, k), at(1, k + 1)]);
  for (let i = 1; i + 1 < rings; i++)
    for (let k = 0; k < SIDES; k++)
      faces.push([at(i, k), at(i + 1, k), at(i + 1, k + 1), at(i, k + 1)]);
  for (let k = 0; k < SIDES; k++)
    faces.push([pts.length - 1, at(rings - 1, k + 1), at(rings - 1, k)]);
  return { pts, faces };
}

interface State {
  matrix: Mat4;
  coords: V3[];
  materials: Rgb[];
  binding: string;
  ordering: string;
  /** The Texture2 in force (its file's name), and the texture coordinates. */
  texture: string | null;
  texCoords: (readonly [number, number])[];
}

const GREY: Rgb = [204, 204, 204]; // Inventor's default diffuse 0.8

/**
 * A shape's own points and colours (Inventor 2.1's `vertexProperty` field, a
 * VertexProperty node), in place of the Coordinate3 and Material before it.
 */
function ownVertices(n: VNode, st: State): State {
  const vp = child(n, 'vertexProperty');
  if (!vp) return st;
  const out = { ...st };
  const v = list(vp, 'vertex');
  if (v.length) out.coords = triples(v);
  const t = list(vp, 'texCoord');
  if (t.length) out.texCoords = pairs(t);
  // Colours packed as 0xRRGGBBAA, bound by the VertexProperty's own materialBinding.
  const c = list(vp, 'orderedRGBA');
  if (c.length) {
    out.materials = Array.from(c, (x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255] as Rgb); // prettier-ignore
    out.binding = word(vp, 'materialBinding', 'OVERALL');
  }
  return out;
}
/** The share of the time reading the text takes; the rest is making solids of it. */
const READING = 0.15;

/**
 * Reads Open Inventor ASCII (.iv) and VRML 1.0 / 2.0 (.wrl): face sets,
 * triangle strips and the four primitives (and, in a file with no faces, line
 * sets whose lines close, as their faces), placed by their transforms (baked
 * into the positions), coloured by their materials. Each Separator (or VRML
 * 2.0 Transform/Group) holding several shapes becomes a group. `file` is
 * the text, or the file's bytes: binary Inventor is read from those (see
 * inventorbin.ts).
 */
export function readInventor(file: string | Uint8Array, opts: MeshOptions = {}): CutObject[] {
  const { progress } = opts;
  const head =
    typeof file === 'string' ? file.slice(0, 64) : latin1(file.subarray(0, 64)); // prettier-ignore
  const binary = /^#Inventor V\d\.\d binary/.test(head);
  if (binary && typeof file === 'string') throw new Error('binary Inventor is read from its bytes, not as text'); // prettier-ignore
  const vrml2 = /^#VRML V2\.0/.test(head);
  const roots = binary
    ? parseBinary(file as Uint8Array, part(progress, 0, READING))
    : parseText(typeof file === 'string' ? file : latin1(file), part(progress, 0, READING)); // prettier-ignore

  // Textures by name: a Texture2's file, found among those dropped with this one by its last part.
  const images = new Map<string, Pixels | undefined>();
  const image = (file: string): Pixels | undefined => {
    const base = file.split(/[\\/]/).pop()!;
    if (!images.has(base)) {
      const got = opts.images?.(base);
      if (!got) opts.missingImage?.(base);
      images.set(base, got);
    }
    return images.get(base);
  };

  const shape = (
    st: State,
    pts: V3[],
    faces: number[][],
    colors: (Rgb | null)[],
    ccw: boolean | null,
    name: string | null,
    tcFaces?: number[][],
  ): Soup => {
    const m = st.matrix;
    const det =
      m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!) + m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!); // prettier-ignore
    const flip = (ccw === false) !== det < 0;
    // Only the points its faces use: face sets often share one long list of points.
    const at = new Int32Array(pts.length).fill(-1);
    const positions: V3[] = [];
    // Its texture, if it has one and coordinates on it: by vertex, or (tcFaces) corner by corner.
    const img = st.texture && st.texCoords.length ? image(st.texture) : undefined;
    const tc = st.texCoords;
    const uvs: ([number, number] | null)[] | null = img && !tcFaces ? [] : null;
    // Inventor's textures have (0, 0) at the bottom left; a texture's rows go from the top.
    const uvOf = (t: readonly [number, number] | undefined): [number, number] | null =>
      t ? [t[0], 1 - t[1]] : null;
    const polygons = faces.map((f) => {
      const g = f.map((v) => {
        let k = at[v];
        if (k === undefined) return -1; // out of range: dropped below
        if (k < 0) {
          const p = pts[v]!;
          k = at[v] = positions.length;
          positions.push([...mat4.transformPoint(m, p[0], p[1], p[2])] as V3);
          uvs?.push(uvOf(tc[v]));
        }
        return k;
      });
      const ok = g.every((k) => k >= 0) ? g : g.filter((k) => k >= 0);
      return flip ? ok.reverse() : ok;
    });
    if (img && tcFaces) {
      // Coordinates of their own a corner: each face coloured now, from the middle of its.
      colors = colors.map((c, i) => {
        const ts = (tcFaces[i] ?? []).map((k) => uvOf(tc[k])).filter((t) => t !== null);
        if (!ts.length) return c;
        const u = ts.reduce((a, t) => a + t[0], 0) / ts.length;
        const v = ts.reduce((a, t) => a + t[1], 0) / ts.length;
        return texel(img, u, v).map((x, k) => quantize(c ? (x * c[k]!) / 255 : x)) as Rgb;
      });
    }
    return {
      name,
      positions,
      polygons,
      colors,
      ...(ccw === null ? { unordered: true } : {}),
      ...(uvs ? { texture: img!, uvs } : {}),
    };
  };
  /** A face set's shape: one of several in a row may join the others (see `joined`). */
  const faceSet = (soup: Soup): Soup[] => {
    faceSets.add(soup);
    return [soup];
  };
  const ordering = (st: State): boolean | null =>
    st.ordering === 'COUNTERCLOCKWISE' ? true : st.ordering === 'CLOCKWISE' ? false : null;
  const faceColors = (st: State, n: number, materialIndex: ArrayLike<number>): (Rgb | null)[] => {
    const mats = st.materials.length ? st.materials : [GREY];
    const b = st.binding;
    return Array.from({ length: n }, (_, f) =>
      b === 'PER_FACE' || b === 'PER_PART'
        ? (mats[f % mats.length] ?? GREY)
        : b === 'PER_FACE_INDEXED' || b === 'PER_PART_INDEXED'
          ? (mats[materialIndex[f] ?? 0] ?? GREY)
          : mats[0]!,
    );
  };
  const strips = (st: State, list: number[][]): number[][] => {
    const out: number[][] = [];
    for (const s of list)
      for (let k = 0; k + 2 < s.length; k++)
        out.push(k % 2 ? [s[k + 1]!, s[k]!, s[k + 2]!] : [s[k]!, s[k + 1]!, s[k + 2]!]);
    return out;
  };

  /** One node under the traversal state; what shapes it makes. */
  const visit = (n: VNode, st: State): Soup[] => {
    const name = n.name ?? null;
    const group = (kids: VNode[], scoped: State): Soup[] => {
      const out = joined(kids.flatMap((k) => visit(k, scoped)));
      // A Separator's shapes are its own: none join the shapes beside it.
      for (const x of out) faceSets.delete(x);
      if (out.length >= 2) return [{ name, positions: [], polygons: [], children: out }];
      // A named Separator round one shape names the shape.
      if (out.length === 1 && name && !out[0]!.name) out[0]!.name = name;
      return out;
    };
    const copy = (): State => ({ ...st, coords: st.coords, materials: st.materials });
    const vs = vrml2 ? st : ownVertices(n, st); // (a shape's own points, if it has them)
    switch (n.type) {
      // ---- Inventor and VRML 1.0 ----
      case 'Separator':
      case 'TransformSeparator':
        return group(n.children, copy());
      case 'Group':
      case 'SoGroup':
        return vrml2
          ? group(nodesOf(n, 'children'), copy())
          : n.children.flatMap((k) => visit(k, st));
      case 'Switch': {
        const which = nums(n, vrml2 ? 'whichChoice' : 'whichChild', [-1])[0]!;
        const kids = vrml2 ? nodesOf(n, 'choice') : n.children;
        if (which === -3) return kids.flatMap((k) => visit(k, st));
        return which >= 0 && kids[which] ? visit(kids[which], st) : [];
      }
      case 'LOD':
        return (vrml2 ? nodesOf(n, 'level') : n.children).slice(0, 1).flatMap((k) => visit(k, st));
      case 'Transform':
        if (vrml2)
          return group(nodesOf(n, 'children'), {
            ...copy(),
            matrix: mat4.multiply(trs(n), st.matrix),
          });
        st.matrix = mat4.multiply(trs(n), st.matrix);
        return [];
      case 'Translation': {
        const t = nums(n, 'translation', [0, 0, 0]);
        st.matrix = mat4.multiply(mat4.translation(t[0]!, t[1]!, t[2]!), st.matrix);
        return [];
      }
      case 'Rotation':
      case 'Scale':
        st.matrix = mat4.multiply(trs(n), st.matrix);
        return [];
      case 'RotationXYZ': {
        const axis = word(n, 'axis', 'X');
        const a: V3 = axis === 'Y' ? [0, 1, 0] : axis === 'Z' ? [0, 0, 1] : [1, 0, 0];
        st.matrix = mat4.multiply(
          mat4.rotationAbout([0, 0, 0], a, nums(n, 'angle', [0])[0]!),
          st.matrix,
        );
        return [];
      }
      case 'MatrixTransform': {
        // Inventor's matrices are row-vector ones, as ours are.
        const m = nums(n, 'matrix');
        if (m.length === 16) st.matrix = mat4.multiply(Float64Array.from(m), st.matrix);
        return [];
      }
      case 'Coordinate3':
        st.coords = triples(list(n, 'point'));
        return [];
      case 'Texture2':
        st.texture = word(n, 'filename') || null;
        return [];
      case 'TextureCoordinate2':
        st.texCoords = pairs(list(n, 'point'));
        return [];
      case 'Material':
        if (!vrml2) st.materials = triples(nums(n, 'diffuseColor', [0.8, 0.8, 0.8])).map(rgb);
        return [];
      case 'BaseColor':
        st.materials = triples(nums(n, 'rgb', [0.8, 0.8, 0.8])).map(rgb);
        return [];
      case 'MaterialBinding':
        st.binding = word(n, 'value', 'OVERALL');
        return [];
      case 'ShapeHints':
        st.ordering = word(n, 'vertexOrdering', 'UNKNOWN_ORDERING');
        return [];
      case 'IndexedLineSet':
        if (vrml2) return [];
        {
          const faces = loops(list(n, 'coordIndex'), vs.coords);
          return lineShape([
            shape(vs, vs.coords, faces, faceColors(vs, faces.length, []), null, name),
          ]);
        }
      case 'IndexedFaceSet':
        if (vrml2) return [];
        {
          const faces = runs(list(n, 'coordIndex'));
          // Texture coordinates go by the points' indices, unless it has indices of its own for them.
          const tci = list(n, 'textureCoordIndex');
          const own = tci.length > 1 || (tci.length === 1 && tci[0] !== -1);
          return faceSet(
            shape(
              vs,
              vs.coords,
              faces,
              faceColors(vs, faces.length, list(n, 'materialIndex')),
              ordering(vs),
              name,
              own ? runs(tci) : undefined,
            ),
          );
        }
      case 'FaceSet': {
        let at = nums(n, 'startIndex', [0])[0]!;
        const faces = nums(n, 'numVertices', [-1]).map((c) => {
          const count = c < 0 ? vs.coords.length - at : c;
          const f = [...Array(count).keys()].map((k) => at + k);
          at += count;
          return f;
        });
        return faceSet(
          shape(vs, vs.coords, faces, faceColors(vs, faces.length, []), ordering(vs), name),
        );
      }
      case 'IndexedTriangleStripSet': {
        const faces = strips(vs, runs(list(n, 'coordIndex')));
        return faceSet(
          shape(vs, vs.coords, faces, faceColors(vs, faces.length, []), ordering(vs), name),
        );
      }
      case 'TriangleStripSet': {
        let at = nums(n, 'startIndex', [0])[0]!;
        const list = nums(n, 'numVertices').map((c) => {
          const s = [...Array(c).keys()].map((k) => at + k);
          at += c;
          return s;
        });
        const faces = strips(vs, list);
        return faceSet(
          shape(vs, vs.coords, faces, faceColors(vs, faces.length, []), ordering(vs), name),
        );
      }
      case 'Cube': {
        const g = box(
          nums(n, 'width', [2])[0]!,
          nums(n, 'height', [2])[0]!,
          nums(n, 'depth', [2])[0]!,
        );
        return [shape(st, g.pts, g.faces, faceColors(st, g.faces.length, []), null, name)];
      }
      case 'Sphere': {
        const g = sphere(nums(n, 'radius', [1])[0]!);
        return [
          shape(
            st,
            g.pts,
            g.faces,
            g.faces.map(() => st.materials[0] ?? GREY),
            null,
            name,
          ),
        ];
      }
      case 'Cylinder': {
        const r = nums(n, 'radius', [1])[0]!;
        const g = lathe(r, r, nums(n, 'height', [2])[0]!);
        return [
          shape(
            st,
            g.pts,
            g.faces,
            g.faces.map(() => st.materials[0] ?? GREY),
            null,
            name,
          ),
        ];
      }
      case 'Cone': {
        const g = lathe(0, nums(n, 'bottomRadius', [1])[0]!, nums(n, 'height', [2])[0]!);
        return [
          shape(
            st,
            g.pts,
            g.faces,
            g.faces.map(() => st.materials[0] ?? GREY),
            null,
            name,
          ),
        ];
      }
      // ---- VRML 2.0 ----
      case 'Collision':
      case 'Anchor':
      case 'Billboard':
        return group(nodesOf(n, 'children'), copy());
      case 'Shape':
        return vrmlShape(n, st, name);
      default:
        // Inventor kits and nodes it doesn't know: what they hold, if anything.
        return n.children.flatMap((k) => visit(k, st));
    }
  };
  const nodesOf = (n: VNode, f: string): VNode[] => {
    const v = n.fields.get(f);
    return !v || v instanceof Float64Array
      ? []
      : v.filter((x): x is VNode => typeof x === 'object');
  };
  const vrmlShape = (n: VNode, st: State, name: string | null): Soup[] => {
    const mat = child(child(n, 'appearance') ?? n, 'material');
    const base = mat ? rgb(nums(mat, 'diffuseColor', [0.8, 0.8, 0.8])) : GREY;
    const g = child(n, 'geometry');
    if (!g) return [];
    const one = (pts: V3[], faces: number[][], ccw: boolean | null) => [
      shape(
        st,
        pts,
        faces,
        faces.map(() => base),
        ccw,
        name ?? g.name ?? null,
      ),
    ];
    switch (g.type) {
      case 'IndexedLineSet': {
        const coord = child(g, 'coord');
        const pts = coord ? triples(list(coord, 'point')) : [];
        return lineShape(one(pts, loops(list(g, 'coordIndex'), pts), null));
      }
      case 'IndexedFaceSet': {
        const coord = child(g, 'coord');
        const pts = coord ? triples(list(coord, 'point')) : [];
        const faces = runs(list(g, 'coordIndex'));
        const ccw = word(g, 'ccw', 'TRUE') !== 'FALSE';
        const color = child(g, 'color');
        if (!color) return one(pts, faces, ccw);
        const cs = triples(list(color, 'color')).map(rgb);
        const ci = list(g, 'colorIndex');
        const perVertex = word(g, 'colorPerVertex', 'TRUE') !== 'FALSE';
        const flat = list(g, 'coordIndex');
        let k = 0;
        const colors = faces.map((f, i) => {
          if (perVertex) {
            const start = k;
            k += f.length + 1;
            return cs[ci.length ? (ci[start] ?? 0) : (flat[start] ?? 0)] ?? base;
          }
          return cs[ci.length ? (ci[i] ?? i) : i] ?? base;
        });
        return [shape(st, pts, faces, colors, ccw, name ?? g.name ?? null)];
      }
      case 'Box': {
        const s = nums(g, 'size', [2, 2, 2]);
        const b = box(s[0]!, s[1]!, s[2]!);
        return one(b.pts, b.faces, null);
      }
      case 'Sphere': {
        const b = sphere(nums(g, 'radius', [1])[0]!);
        return one(b.pts, b.faces, null);
      }
      case 'Cylinder': {
        const r = nums(g, 'radius', [1])[0]!;
        const b = lathe(r, r, nums(g, 'height', [2])[0]!);
        return one(b.pts, b.faces, null);
      }
      case 'Cone': {
        const b = lathe(0, nums(g, 'bottomRadius', [1])[0]!, nums(g, 'height', [2])[0]!);
        return one(b.pts, b.faces, null);
      }
      default:
        return [];
    }
  };

  const st: State = { matrix: mat4.identity(), coords: [], materials: [], binding: 'OVERALL', ordering: 'UNKNOWN_ORDERING', texture: null, texCoords: [] }; // prettier-ignore
  const soups = joined(roots.flatMap((r) => visit(r, st)));
  // Inventor's up is Y; a terrain made with Z up is laid on the floor.
  if (!vrml2 && layFlat(soups)) opts.laidFlat?.();
  // Line sets count only when there's nothing else: a wireframe of a mesh (IVREAD wrote them).
  const faced = (list: readonly Soup[]): boolean =>
    list.some((x) => (!fromLines.has(x) && x.polygons.length > 0) || faced(x.children ?? []));
  if (faced(soups)) {
    const drop = (list: Soup[]): Soup[] =>
      list
        .filter((x) => !fromLines.has(x))
        .map((x) => ({ ...x, children: drop(x.children ?? []) }));
    return soupObjects(drop(soups), { ...opts, progress: part(progress, READING, 1) });
  }
  return soupObjects(soups, { ...opts, progress: part(progress, READING, 1) });
}

/** Shapes made from face sets (not primitives or lines). */
const faceSets = new WeakSet<Soup>();

/**
 * Face sets one after another in one group, unnamed, come in as one shape,
 * coloured face by face: a model drawn as thousands of face sets (a part
 * each, its own material) would otherwise be thousands of objects.
 */
function joined(list: Soup[]): Soup[] {
  const out: Soup[] = [];
  let run: Soup[] = [];
  const end = () => {
    if (run.length === 1) out.push(run[0]!);
    else if (run.length > 1) {
      const positions: V3[] = [];
      const polygons: number[][] = [];
      const colors: (Rgb | null)[] = [];
      const painted = paintSoups(run);
      for (const s of painted) {
        const base = positions.length;
        for (const p of s.positions) positions.push(p);
        for (const p of s.polygons) polygons.push(p.map((v) => v + base));
        s.polygons.forEach((_, i) => colors.push(s.colors?.[i] ?? null));
      }
      const one: Soup = { name: null, positions, polygons, colors, ...(run[0]!.unordered ? { unordered: true } : {}), ...(painted.some((s) => s.photo) ? { photo: true } : {}) }; // prettier-ignore
      faceSets.add(one);
      out.push(one);
    }
    run = [];
  };
  for (const s of list) {
    const joins = faceSets.has(s) && !s.name;
    if (!joins || (run.length && run[0]!.unordered !== s.unordered)) end();
    if (joins) run.push(s);
    else out.push(s);
  }
  end();
  return out;
}

/** Shapes made from line sets, kept only if the file has no faces of its own. */
const fromLines = new WeakSet<Soup>();
function lineShape(list: Soup[]): Soup[] {
  for (const x of list) fromLines.add(x);
  return list;
}

/**
 * A line set's closed polylines (each ending where it began, round three
 * corners or more) as faces: a mesh drawn as its edges. Open ones are left out.
 */
function loops(idx: ArrayLike<number>, pts: readonly V3[]): number[][] {
  const same = (a: number, b: number) => a === b || (pts[a] !== undefined && pts[b] !== undefined && pts[a]!.every((v, k) => v === pts[b]![k])); // prettier-ignore
  const out: number[][] = [];
  for (const run of runs(idx)) {
    if (run.length < 4 || !same(run[0]!, run[run.length - 1]!)) continue;
    out.push(run.slice(0, -1));
  }
  return out;
}
