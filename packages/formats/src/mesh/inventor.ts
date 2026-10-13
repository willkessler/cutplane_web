import { mat4, type CutObject, type Mat4, type Rgb } from '@cutplane/kernel';
import type { V3 } from './faces.ts';
import { soupObjects, type Soup } from './polygonize.ts';

/**
 * Open Inventor (.iv, ASCII) and VRML (.wrl, 1.0 and 2.0). VRML 1.0 is
 * Inventor's text format under another header; 2.0 nests shapes in fields
 * instead. One parser reads all three: a node is `[DEF name] Type { ... }`,
 * its body fields (a name and its values) and, in Inventor, child nodes.
 */

type Value = number | string | VNode;

interface VNode {
  type: string;
  fields: Map<string, Value[]>;
  children: VNode[];
  name?: string;
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  const n = text.length;
  for (let i = 0; i < n;) {
    const c = text[i]!;
    if (c === '#') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
    } else if (c <= ' ' || c === ',') i++;
    else if ('{}[]()|'.includes(c)) {
      out.push(c);
      i++;
    } else if (c === '"') {
      let s = '';
      for (i++; i < n && text[i] !== '"'; i++) s += text[i] === '\\' ? text[++i] : text[i];
      i++;
      out.push(`"${s}`); // a leading quote marks a string
    } else {
      const start = i;
      while (i < n && text[i]! > ' ' && !'{}[]()|,#"'.includes(text[i]!)) i++;
      out.push(text.slice(start, i));
    }
  }
  return out;
}

const isNumber = (t: string | undefined) => t !== undefined && /^[+-]?(\d|\.\d)/.test(t);

function parse(tokens: string[]): VNode[] {
  let i = 0;
  const defs = new Map<string, VNode>();
  const startsNode = () => {
    const t = tokens[i];
    return (
      t === 'DEF' ||
      t === 'USE' ||
      (t !== undefined && /^[A-Za-z_]/.test(t) && tokens[i + 1] === '{')
    );
  };
  const node = (): VNode => {
    if (tokens[i] === 'USE') {
      const name = tokens[i + 1]!;
      i += 2;
      return defs.get(name) ?? { type: 'Group', fields: new Map(), children: [] };
    }
    let name: string | undefined;
    if (tokens[i] === 'DEF') {
      name = tokens[i + 1];
      i += 2;
    }
    const n: VNode = {
      type: tokens[i]!,
      fields: new Map(),
      children: [],
      ...(name ? { name } : {}),
    };
    if (name) defs.set(name, n);
    i += 2; // the type and its {
    while (i < tokens.length && tokens[i] !== '}') {
      if (startsNode()) {
        n.children.push(node());
        continue;
      }
      const field = tokens[i++]!;
      n.fields.set(field, value());
    }
    i++; // }
    return n;
  };
  const value = (): Value[] => {
    const t = tokens[i];
    if (t === '[') {
      i++;
      const vs: Value[] = [];
      while (i < tokens.length && tokens[i] !== ']') {
        if (startsNode()) vs.push(node());
        else vs.push(atom(tokens[i++]!));
      }
      i++;
      return vs;
    }
    if (t === '(') {
      const vs: Value[] = [];
      for (i++; i < tokens.length && tokens[i] !== ')'; i++)
        if (tokens[i] !== '|') vs.push(tokens[i]!);
      i++;
      return vs;
    }
    if (startsNode()) return [node()];
    if (isNumber(t)) {
      const vs: Value[] = [];
      while (isNumber(tokens[i])) vs.push(Number(tokens[i++]));
      return vs;
    }
    i++;
    return t === undefined ? [] : [atom(t)];
  };
  const atom = (t: string): Value => (isNumber(t) ? Number(t) : t.startsWith('"') ? t.slice(1) : t);
  const roots: VNode[] = [];
  while (i < tokens.length) {
    if (startsNode()) roots.push(node());
    else i++;
  }
  return roots;
}

const nums = (n: VNode, f: string, d: number[] = []): number[] => {
  const v = n.fields.get(f);
  return v ? v.filter((x): x is number => typeof x === 'number') : d;
};
const word = (n: VNode, f: string, d = ''): string => {
  const v = n.fields.get(f)?.[0];
  return typeof v === 'string' ? v : d;
};
const child = (n: VNode, f: string): VNode | undefined => {
  const v = n.fields.get(f)?.[0];
  return typeof v === 'object' ? v : undefined;
};
const triples = (a: readonly number[]): V3[] => {
  const out: V3[] = [];
  for (let k = 0; k + 2 < a.length; k += 3) out.push([a[k]!, a[k + 1]!, a[k + 2]!]);
  return out;
};
const rgb = (c: readonly number[]): Rgb =>
  c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)) as Rgb;
/** Faces of an index list, each ended by -1 (the last may not be). */
const runs = (idx: readonly number[]): number[][] => {
  const out: number[][] = [[]];
  for (const v of idx) {
    if (v < 0) out.push([]);
    else out[out.length - 1]!.push(v);
  }
  return out.filter((f) => f.length > 0);
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
}

const GREY: Rgb = [204, 204, 204]; // Inventor's default diffuse 0.8

/**
 * Reads Open Inventor ASCII (.iv) and VRML 1.0 / 2.0 (.wrl): face sets,
 * triangle strips and the four primitives (and, in a file with no faces, line
 * sets whose lines close, as their faces), placed by their transforms (baked
 * into the positions), coloured by their materials. Each Separator (or VRML
 * 2.0 Transform/Group) holding several shapes becomes a group. Binary
 * Inventor isn't read (SGI's `ivcat -a` turns it into ASCII).
 */
export function readInventor(text: string): CutObject[] {
  const head = text.slice(0, 64);
  if (/^#Inventor V\d\.\d binary/.test(head)) throw new Error('binary Inventor files are not read yet (ivcat -a makes an ASCII one)'); // prettier-ignore
  const vrml2 = /^#VRML V2\.0/.test(head);
  const roots = parse(tokenize(text));

  const shape = (
    st: State,
    pts: V3[],
    faces: number[][],
    colors: (Rgb | null)[],
    ccw: boolean | null,
    name: string | null,
  ): Soup => {
    const m = st.matrix;
    const det =
      m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!) + m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!); // prettier-ignore
    const flip = (ccw === false) !== det < 0;
    const positions = pts.map((p) => [...mat4.transformPoint(m, p[0], p[1], p[2])] as V3);
    const polygons = faces.map((f) => (flip ? [...f].reverse() : f));
    return { name, positions, polygons, colors, ...(ccw === null ? { unordered: true } : {}) };
  };
  const ordering = (st: State): boolean | null =>
    st.ordering === 'COUNTERCLOCKWISE' ? true : st.ordering === 'CLOCKWISE' ? false : null;
  const faceColors = (st: State, n: number, materialIndex: readonly number[]): (Rgb | null)[] => {
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
      const out = kids.flatMap((k) => visit(k, scoped));
      if (out.length >= 2) return [{ name, positions: [], polygons: [], children: out }];
      // A named Separator round one shape names the shape.
      if (out.length === 1 && name && !out[0]!.name) out[0]!.name = name;
      return out;
    };
    const copy = (): State => ({ ...st, coords: st.coords, materials: st.materials });
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
        st.coords = triples(nums(n, 'point'));
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
          const faces = loops(nums(n, 'coordIndex'), st.coords);
          return lineShape([
            shape(st, st.coords, faces, faceColors(st, faces.length, []), null, name),
          ]);
        }
      case 'IndexedFaceSet':
        if (vrml2) return [];
        {
          const faces = runs(nums(n, 'coordIndex'));
          return [
            shape(
              st,
              st.coords,
              faces,
              faceColors(st, faces.length, nums(n, 'materialIndex')),
              ordering(st),
              name,
            ),
          ];
        }
      case 'FaceSet': {
        let at = nums(n, 'startIndex', [0])[0]!;
        const faces = nums(n, 'numVertices', [-1]).map((c) => {
          const count = c < 0 ? st.coords.length - at : c;
          const f = [...Array(count).keys()].map((k) => at + k);
          at += count;
          return f;
        });
        return [shape(st, st.coords, faces, faceColors(st, faces.length, []), ordering(st), name)];
      }
      case 'IndexedTriangleStripSet': {
        const faces = strips(st, runs(nums(n, 'coordIndex')));
        return [shape(st, st.coords, faces, faceColors(st, faces.length, []), ordering(st), name)];
      }
      case 'TriangleStripSet': {
        let at = nums(n, 'startIndex', [0])[0]!;
        const list = nums(n, 'numVertices').map((c) => {
          const s = [...Array(c).keys()].map((k) => at + k);
          at += c;
          return s;
        });
        const faces = strips(st, list);
        return [shape(st, st.coords, faces, faceColors(st, faces.length, []), ordering(st), name)];
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
  const nodesOf = (n: VNode, f: string): VNode[] =>
    (n.fields.get(f) ?? []).filter((v): v is VNode => typeof v === 'object');
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
        const pts = coord ? triples(nums(coord, 'point')) : [];
        return lineShape(one(pts, loops(nums(g, 'coordIndex'), pts), null));
      }
      case 'IndexedFaceSet': {
        const coord = child(g, 'coord');
        const pts = coord ? triples(nums(coord, 'point')) : [];
        const faces = runs(nums(g, 'coordIndex'));
        const ccw = word(g, 'ccw', 'TRUE') !== 'FALSE';
        const color = child(g, 'color');
        if (!color) return one(pts, faces, ccw);
        const cs = triples(nums(color, 'color')).map(rgb);
        const ci = nums(g, 'colorIndex');
        const perVertex = word(g, 'colorPerVertex', 'TRUE') !== 'FALSE';
        const flat = nums(g, 'coordIndex');
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

  const st: State = { matrix: mat4.identity(), coords: [], materials: [], binding: 'OVERALL', ordering: 'UNKNOWN_ORDERING' }; // prettier-ignore
  const soups = roots.flatMap((r) => visit(r, st));
  // Line sets count only when there's nothing else: a wireframe of a mesh (IVREAD wrote them).
  const faced = (list: readonly Soup[]): boolean =>
    list.some((x) => (!fromLines.has(x) && x.polygons.length > 0) || faced(x.children ?? []));
  if (faced(soups)) {
    const drop = (list: Soup[]): Soup[] =>
      list
        .filter((x) => !fromLines.has(x))
        .map((x) => ({ ...x, children: drop(x.children ?? []) }));
    return soupObjects(drop(soups));
  }
  return soupObjects(soups);
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
function loops(idx: readonly number[], pts: readonly V3[]): number[][] {
  const same = (a: number, b: number) => a === b || (pts[a] !== undefined && pts[b] !== undefined && pts[a]!.every((v, k) => v === pts[b]![k])); // prettier-ignore
  const out: number[][] = [];
  for (const run of runs(idx)) {
    if (run.length < 4 || !same(run[0]!, run[run.length - 1]!)) continue;
    out.push(run.slice(0, -1));
  }
  return out;
}
