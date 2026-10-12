import {
  Brep,
  DEFAULT_TECHNIQUES,
  buildShell,
  createObject,
  mat4,
  type CutObject,
  type FeatureAttrs,
  type Rgb,
} from '@cutplane/kernel';
import { CutParseError, type CutDocument, type ReadResult } from './document.ts';
import { floats, ints } from './numbers.ts';

const ESC = '\x1b';

/** Non-blank lines with their 1-based line numbers. */
class Lines {
  private i = 0;
  private readonly rows: { text: string; no: number }[] = [];

  constructor(text: string) {
    text.split(/\r?\n/).forEach((t, n) => {
      if (t.trim() !== '') this.rows.push({ text: t, no: n + 1 });
    });
  }

  get line(): number {
    return this.rows[Math.min(this.i, this.rows.length - 1)]?.no ?? 0;
  }
  peek(): string | undefined {
    return this.rows[this.i]?.text.trim();
  }
  next(): string {
    const r = this.rows[this.i++];
    if (!r) throw new CutParseError('unexpected end of file', this.line);
    return r.text.trim();
  }
  /** `count` lines of inline code (each written behind a `|`), verbatim. */
  code(count: number): string {
    const out: string[] = [];
    for (let k = 0; k < count; k++) {
      const r = this.rows[this.i];
      const at = r?.text.indexOf('|') ?? -1;
      if (!r || at < 0 || r.text.slice(0, at).trim() !== '')
        throw new CutParseError('expected a line of inline CPL code', this.line);
      out.push(r.text.slice(at + 1));
      this.i++;
    }
    return `${out.join('\n')}\n`;
  }
  /** Consumes the next line if it matches; returns the match. */
  maybe(re: RegExp): RegExpMatchArray | null {
    const t = this.peek();
    const m = t === undefined ? null : t.match(re);
    if (m) this.i++;
    return m;
  }
  expect(re: RegExp, what: string): RegExpMatchArray {
    const t = this.peek();
    const m = t === undefined ? null : t.match(re);
    if (!m)
      throw new CutParseError(`expected ${what}, found ${JSON.stringify(t ?? '<eof>')}`, this.line);
    this.i++;
    return m;
  }
  /** The next n integers, which may continue onto following lines. */
  moreInts(first: number[], n: number): number[] {
    const out = [...first];
    while (out.length < n) {
      const t = this.peek();
      if (t === undefined || !/^[-+\d\s]+$/.test(t)) break;
      out.push(...ints(this.next()));
    }
    return out;
  }
}

const n = (m: RegExpMatchArray, i = 1) => Number(m[i]);
const rest = (m: RegExpMatchArray, i = 1) => (m[i] ?? '').trim();
const unesc = (s: string) => s.replaceAll(ESC, ' ');

/** Reads a .cut, .rsc or .icon file. */
export function readCut(text: string): ReadResult {
  const L = new Lines(text);
  const warnings: string[] = [];
  const warn = (msg: string) => warnings.push(`line ${L.line}: ${msg}`);

  const title = rest(L.expect(/^\*\* Start of file\s+(.*?)(?:\s*\*\*)?$/, '"** Start of file"'));
  const contains = rest(L.expect(/^Contains:\s*(\S+)/, 'Contains:'));
  if (contains !== 'World' && contains !== 'Branch')
    throw new CutParseError(`unknown contents "${contains}"`, L.line);

  const doc: CutDocument = { title, contains, name: null, roots: [] };
  let declared: number;
  if (contains === 'World') {
    const name = rest(L.expect(/^World Name:(.*)$/, 'World Name:'));
    doc.name = name === '<none>' ? null : unesc(name);
    declared = n(L.expect(/^Total Number of Objects In World:\s*(-?\d+)/, 'object count'));
  } else {
    const name = rest(L.expect(/^Branch Name:(.*)$/, 'Branch Name:'));
    doc.name = name === '<none>' ? null : unesc(name);
    const pm = L.maybe(/^Branch Preferred Motherworld:(.*)$/);
    if (pm) doc.preferredMotherworld = rest(pm);
    declared = n(L.expect(/^Total Number of Objects In Branch:\s*(-?\d+)/, 'object count'));
  }
  const zoom = L.maybe(/^Zoom Scale:\s*(\S+)/);
  if (zoom) doc.zoomScale = Number(zoom[1]);

  const objects: CutObject[] = [];
  while (L.peek() !== undefined && /^Object\s+-?\d+:$/.test(L.peek()!)) {
    const obj = readObject(L, warn);
    objects.push(obj.object);
    const p = obj.parent;
    const parent = p > 0 && p <= objects.length - 1 ? objects[p - 1]! : null;
    if (p > objects.length - 1)
      warn(`object ${objects.length} names parent ${p}, which comes later; attached to the root`);
    obj.object.parent = parent;
    if (parent) parent.children.push(obj.object);
    else doc.roots.push(obj.object);
  }
  if (objects.length !== declared)
    warnings.push(`file declares ${declared} objects but contains ${objects.length}`);

  if (!L.maybe(/^\*\* End of file/)) {
    if (L.peek() === undefined)
      warnings.push('missing "** End of file" line (file was probably truncated)');
    else throw new CutParseError(`unexpected line ${JSON.stringify(L.peek())}`, L.line);
  }
  return { doc, warnings };
}

function readProps(L: Lines, count: number): FeatureAttrs {
  const attrs: FeatureAttrs = { props: [] };
  for (let i = 0; i < count; i++) attrs.props.push(L.next().split(/\s+/)[0]!);
  if (attrs.props.includes('Hasdecal')) {
    const d = L.maybe(/^Decal File:(.*)$/);
    if (d) attrs.decalFile = rest(d);
  }
  return attrs;
}

function readMatrix(L: Lines): mat4.Mat4 {
  const rows: number[][] = [];
  for (let r = 0; r < 4; r++) {
    const m = L.expect(/^\[(.*)\]$/, 'matrix row');
    const v = floats(m[1]!);
    if (v.length !== 4) throw new CutParseError('matrix row needs 4 numbers', L.line);
    rows.push(v);
  }
  return mat4.fromRows(rows);
}

function readObject(L: Lines, warn: (m: string) => void): { object: CutObject; parent: number } {
  L.expect(/^Object\s+-?\d+:$/, 'Object N:');
  const name = rest(L.expect(/^Object Name:(.*)$/, 'Object Name:'));
  L.expect(/^Object Transform:$/, 'Object Transform:');
  const xform = readMatrix(L);
  L.expect(/^Object Inverse Transform:$/, 'Object Inverse Transform:');
  const invXform = readMatrix(L);
  const parent = n(L.expect(/^Object Parent:\s*(-?\d+)/, 'Object Parent:'));
  const color = ints(L.expect(/^Object Color:(.*)$/, 'Object Color:')[1]!).slice(0, 3) as Rgb;
  const nprops = n(L.expect(/^Object has\s+(\d+)\s+properties:$/, 'object property count'));
  const attrs = readProps(L, nprops);

  const brep = new Brep();
  const object = createObject(brep, {
    name: name === '<none>' ? null : unesc(name),
    xform,
    invXform,
    color,
    attrs,
    ...DEFAULT_TECHNIQUES,
  });

  if (L.maybe(/^Primitive Info:$/)) {
    const len = Number(L.expect(/^Cube Length:\s*(\S+)/, 'Cube Length:')[1]);
    const wid = Number(L.expect(/^Cube Width:\s*(\S+)/, 'Cube Width:')[1]);
    const hei = Number(L.expect(/^Cube Height:\s*(\S+)/, 'Cube Height:')[1]);
    object.primitive = { length: len, width: wid, height: hei };
  }
  const sel = L.maybe(/^Object Selectechnique:(.*)$/);
  if (sel) object.selectTechnique = rest(sel);
  const draw = L.maybe(/^Object Drawtechnique:(.*)$/);
  if (draw) object.drawTechnique = rest(draw);
  const bbox = L.maybe(/^Object Screenbboxtechnique:(.*)$/);
  if (bbox) object.screenBBoxTechnique = rest(bbox);
  const code = L.maybe(/^Object CPL private code:\s*(\d+)/);
  if (code) object.attrs.privateSource = L.code(n(code));

  const nshells = n(L.expect(/^Number of Shells:\s*(\d+)/, 'Number of Shells:'));
  for (let s = 0; s < nshells; s++) readShell(L, brep, warn);
  return { object, parent };
}

function readShell(L: Lines, b: Brep, warn: (m: string) => void): void {
  L.expect(/^Shell\s+\d+:$/, 'Shell N:');
  const nv = n(L.expect(/^Number of Vertices:\s*(\d+)/, 'Number of Vertices:'));
  L.expect(/^VFE List:$/, 'VFE List:');
  const positions: [number, number, number][] = [];
  for (let i = 0; i < nv; i++) {
    const m = L.expect(/^Vertex\s+\d+:(.*)$/, 'vertex');
    const v = floats(m[1]!);
    if (v.length < 3) throw new CutParseError('vertex needs 3 coordinates', L.line);
    positions.push([v[0]!, v[1]!, v[2]!]);
  }
  const nf = n(L.expect(/^Number of Faces:\s*(\d+)/, 'Number of Faces:'));
  L.expect(/^FVE List:$/, 'FVE List:');
  const faces: number[][][] = [];
  for (let i = 0; i < nf; i++) {
    const nb = n(L.expect(/^Face:\s*\d+\s*\((\d+) bounds\)/, 'face'), 1);
    const loops: number[][] = [];
    for (let j = 0; j < nb; j++) {
      const m = L.expect(/^Bound\s+\d+\s*\((\d+) le's\):(.*)$/, 'bound');
      const count = n(m);
      const idx = L.moreInts(ints(m[2]!), count);
      if (idx.length !== count) warn(`bound lists ${idx.length} vertices, expected ${count}`);
      loops.push(idx);
    }
    faces.push(loops);
  }
  // Indices are 1-based; a few converted files are 0-based throughout.
  const all = faces.flat(2);
  const zeroBased = all.length > 0 && Math.min(...all) === 0 && Math.max(...all) < nv;
  if (zeroBased) warn('shell uses 0-based vertex indices; read as such');
  for (const loops of faces)
    for (const loop of loops) loop.forEach((k, i) => (loop[i] = zeroBased ? k : k - 1));
  if (L.maybe(/^EVF List:$/)) while (L.maybe(/^Edge\s+\d+:\s*\(Vertices/)); // obsolete; edges are rebuilt

  const built = buildShell(b, { positions, faces });
  const at = <T>(list: T[], k: number, what: string): T | undefined => {
    const v = list[k - 1];
    if (v === undefined) warn(`${what} ${k} out of range`);
    return v;
  };

  const fc = L.maybe(/^Faces with different colors:\s*(\d+)/);
  if (fc) {
    for (let i = 0; i < n(fc); i++) {
      const [k, r, g, bl] = ints(L.expect(/^Face\s+\d+:.*$/, 'face colour')[0]);
      const f = at(built.faces, k!, 'coloured face');
      if (f !== undefined) b.faceColors.set(f, [r!, g!, bl!]);
    }
  }
  const sections = [
    ['Vertices', 'Vertex', built.vertices, b.vertexAttrs],
    ['Edges', 'Edge', built.edges, b.edgeAttrs],
    ['Faces', 'Face', built.faces, b.faceAttrs],
  ] as const;
  for (const [plural, single, ids, map] of sections) {
    const m = L.maybe(new RegExp(`^${plural} with properties:\\s*(\\d+)`));
    if (!m) continue;
    for (let i = 0; i < n(m); i++) {
      const h = L.expect(
        new RegExp(`^${single}\\s+(\\d+) has (\\d+) properties:$`),
        `${single} properties`,
      );
      const attrs = readProps(L, n(h, 2));
      const id = at(ids as number[], n(h), single.toLowerCase());
      if (id !== undefined) map.set(id, attrs);
    }
  }
  for (const [plural, single, ids, map] of sections) {
    const m = L.maybe(new RegExp(`^${plural} with CPL private code:\\s*(\\d+)`));
    if (!m) continue;
    for (let i = 0; i < n(m); i++) {
      const h = L.expect(
        new RegExp(`^${single}\\s+(\\d+):\\s*(\\S+)(?:\\s+(\\d+))?`),
        `${single} private code`,
      );
      const inline = h[2] === 'inline' && h[3] !== undefined ? L.code(n(h, 3)) : undefined;
      const id = at(ids as number[], n(h), single.toLowerCase());
      if (id === undefined) continue;
      const attrs = map.get(id) ?? { props: [] };
      if (inline !== undefined) attrs.privateSource = inline;
      else attrs.privateCode = h[2]!;
      map.set(id, attrs);
    }
  }
}
