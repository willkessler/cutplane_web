import { Brep, buildShell, createObject, type CutObject, type Rgb } from '@cutplane/kernel';
import type { V3 } from './faces.ts';
import type { MeshOptions } from './options.ts';
import { planRegions, type P2, type Region } from './plan.ts';
import { grouper, soupObjects, type Soup } from './polygonize.ts';

/** A group code and its value: DXF is these, one line each. */
type Pair = [number, string];

function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  // Anything before the first section (a mail header, say) is passed over.
  let i = 0;
  while (i + 1 < lines.length && !(lines[i]!.trim() === '0' && lines[i + 1]!.trim() === 'SECTION'))
    i++;
  const out: Pair[] = [];
  for (; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i]!.trim(), 10);
    if (!Number.isFinite(code)) {
      i--; // out of step: resync a line on
      continue;
    }
    out.push([code, lines[i + 1]!.trim()]);
  }
  return out;
}

/** AutoCAD's colour index: the named nine, the hue wheel 10–249, the greys 250–255. */
export function aciColor(i: number): Rgb {
  const named: Record<number, Rgb> = {
    1: [255, 0, 0], 2: [255, 255, 0], 3: [0, 255, 0], 4: [0, 255, 255], 5: [0, 0, 255],
    6: [255, 0, 255], 7: [255, 255, 255], 8: [128, 128, 128], 9: [192, 192, 192],
  }; // prettier-ignore
  if (named[i]) return [...named[i]!];
  if (i >= 250 && i <= 255) {
    const g = Math.round(51 + ((i - 250) * (255 - 51)) / 5);
    return [g, g, g];
  }
  if (i < 10 || i > 249) return [160, 160, 160];
  const hue = (Math.floor((i - 10) / 10) * 15) / 60;
  const shade = i % 10;
  const v = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][shade]!;
  const s = shade % 2 ? 0.5 : 1;
  const f = (n: number) => {
    const k = (n + hue) % 6;
    return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

interface Entity {
  type: string;
  codes: Pair[];
  /** A POLYLINE's VERTEXes. */
  vertices?: Entity[];
}

const num = (e: Entity, code: number, d = 0) => {
  const p = e.codes.find((c) => c[0] === code);
  return p ? Number(p[1]) : d;
};
const str = (e: Entity, code: number) => e.codes.find((c) => c[0] === code)?.[1];
const point = (e: Entity, base: number): V3 => [num(e, base), num(e, base + 10), num(e, base + 20)];

/** A section's entities, POLYLINEs with their VERTEXes gathered up. */
function entities(ps: readonly Pair[], from: number, to: number): Entity[] {
  const out: Entity[] = [];
  let poly: Entity | null = null;
  for (let i = from; i < to;) {
    const [code, value] = ps[i]!;
    if (code !== 0) {
      i++;
      continue;
    }
    const e: Entity = { type: value, codes: [] };
    for (i++; i < to && ps[i]![0] !== 0; i++) e.codes.push(ps[i]!);
    if (e.type === 'VERTEX' && poly) poly.vertices!.push(e);
    else if (e.type === 'SEQEND') poly = null;
    else {
      if (e.type === 'POLYLINE') poly = Object.assign(e, { vertices: [] });
      out.push(e);
    }
  }
  return out;
}

/**
 * Reads a DXF's 3D surfaces: polyface meshes, polygon meshes and 3DFACEs,
 * blocks placed by INSERT included. Each layer becomes an object, coloured
 * from the entity or its layer, and turned so the room's y is DXF's z (up).
 * New: a drawing with no surfaces (a plan: lines, polylines, arcs and circles)
 * comes in as the regions its lines close round, each a lamina lying flat, to
 * pull up into walls (see plan.ts). Text is passed over.
 */
export function readDxf(text: string, opts: MeshOptions = {}): CutObject[] {
  const ps = pairs(text);
  // Sections by name.
  const sections = new Map<string, [number, number]>();
  for (let i = 0; i < ps.length; i++)
    if (ps[i]![0] === 0 && ps[i]![1] === 'SECTION' && ps[i + 1]?.[0] === 2) {
      const name = ps[i + 1]![1];
      let j = i + 2;
      while (j < ps.length && !(ps[j]![0] === 0 && ps[j]![1] === 'ENDSEC')) j++;
      sections.set(name, [i + 2, j]);
      i = j;
    }
  const layerColors = new Map<string, number>();
  const tables = sections.get('TABLES');
  if (tables)
    for (const e of entities(ps, ...tables))
      if (e.type === 'LAYER') layerColors.set(str(e, 2) ?? '', Math.abs(num(e, 62, 7)));
  const blocks = new Map<string, Entity[]>();
  const b = sections.get('BLOCKS');
  if (b) {
    let name: string | null = null;
    let list: Entity[] = [];
    for (const e of entities(ps, ...b)) {
      if (e.type === 'BLOCK') {
        name = str(e, 2) ?? '';
        list = [];
      } else if (e.type === 'ENDBLK') {
        if (name !== null) blocks.set(name, list);
        name = null;
      } else list.push(e);
    }
  }

  const soups = new Map<string, Soup>();
  const soup = (layer: string) => {
    let s = soups.get(layer);
    if (!s)
      soups.set(layer, (s = { name: layer || null, positions: [], polygons: [], colors: [] }));
    return s;
  };
  // A drawing's lines, by layer: what it's made of if it has no surfaces.
  const lines = new Map<string, { lines: P2[][]; z: number[]; color: Rgb }>();
  type Place = (p: V3) => V3;
  // DXF's z is up; the room's y is.
  const room = ([x, y, z]: V3): V3 => [x, z, -y];
  const add = (layer: string, pts: V3[], polys: number[][], color: Rgb) => {
    const s = soup(layer);
    const base = s.positions.length;
    s.positions.push(...pts.map(room));
    for (const p of polys) {
      s.polygons.push(p.map((i) => base + i));
      s.colors!.push(color);
    }
  };
  const colorOf = (e: Entity, layer: string, inherited: number | null): Rgb => {
    let c = num(e, 62, 256);
    if (c === 0) c = inherited ?? 7; // BYBLOCK
    if (c === 256) c = layerColors.get(layer) ?? 7; // BYLAYER
    return aciColor(Math.abs(c));
  };
  const draw = (
    list: readonly Entity[],
    place: Place,
    parentLayer: string | null,
    blockColor: number | null,
    depth: number,
  ) => {
    for (const e of list) {
      let layer = str(e, 8) ?? '0';
      // Layer 0 in a block takes the layer the block is placed on.
      if (layer === '0' && parentLayer !== null) layer = parentLayer;
      const color = colorOf(e, layer, blockColor);
      const ocs = flipped(e) ? ([x, y, z]: V3): V3 => [-x, y, -z] : (p: V3) => p;
      const line = (pts: V3[]) => {
        if (pts.length < 2) return;
        const l = lines.get(layer) ?? lines.set(layer, { lines: [], z: [], color }).get(layer)!;
        const placed = pts.map((p) => place(ocs(p)));
        l.lines.push(placed.map(([x, y]) => [x, y] as P2));
        for (const p of placed) l.z.push(p[2]);
      };
      if (e.type === '3DFACE') {
        const q = [point(e, 10), point(e, 11), point(e, 12), point(e, 13)];
        const same = q[3]!.every((v, k) => v === q[2]![k]);
        const pts = (same ? q.slice(0, 3) : q).map(place);
        add(layer, pts, [pts.map((_, i) => i)], color);
      } else if (e.type === 'POLYLINE') {
        const flags = num(e, 70);
        const vs = e.vertices ?? [];
        if (flags & 64) {
          // Polyface mesh: vertices first, then faces naming them (1-based, negative = hidden edge).
          const pts = vs.filter((v) => num(v, 70) & 64).map((v) => place(point(v, 10)));
          const faces = vs
            .filter((v) => (num(v, 70) & 192) === 128)
            .map((v) =>
              [71, 72, 73, 74]
                .map((c) => Math.abs(num(v, c)))
                .filter((i) => i > 0)
                .map((i) => i - 1),
            )
            .filter((f) => f.length >= 3 && f.every((i) => i < pts.length));
          add(layer, pts, faces, color);
        } else if (flags & 16) {
          // Polygon mesh: an M × N grid of vertices, closed in either direction by flags 1 and 32.
          const m = num(e, 71);
          const n = num(e, 72);
          const pts = vs.map((v) => place(point(v, 10)));
          if (m * n !== pts.length || m < 2 || n < 2) continue;
          const quads: number[][] = [];
          const mm = flags & 1 ? m : m - 1;
          const nn = flags & 32 ? n : n - 1;
          for (let i = 0; i < mm; i++)
            for (let j = 0; j < nn; j++) {
              const at = (a: number, c: number) => (a % m) * n + (c % n);
              quads.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
            }
          add(layer, pts, quads, color);
        } else {
          // A 2D or 3D polyline: a line.
          const z = num(e, 30);
          const v = vs.map((x) => ({ p: [num(x, 10), num(x, 20), flags & 8 ? num(x, 30) : z] as V3, bulge: num(x, 42) })); // prettier-ignore
          line(bulged(v, (flags & 1) !== 0));
        }
      } else if (e.type === 'LWPOLYLINE') {
        const z = num(e, 38);
        const v: { p: V3; bulge: number }[] = [];
        for (const [c, val] of e.codes)
          if (c === 10) v.push({ p: [Number(val), 0, z], bulge: 0 });
          else if (c === 20 && v.length) v[v.length - 1]!.p[1] = Number(val);
          else if (c === 42 && v.length) v[v.length - 1]!.bulge = Number(val);
        line(bulged(v, (num(e, 70) & 1) !== 0));
      } else if (e.type === 'LINE') {
        line([point(e, 10), point(e, 11)]);
      } else if (e.type === 'ARC' || e.type === 'CIRCLE') {
        const c = point(e, 10);
        const r = num(e, 40);
        const a0 = e.type === 'ARC' ? (num(e, 50) * Math.PI) / 180 : 0;
        let a1 = e.type === 'ARC' ? (num(e, 51) * Math.PI) / 180 : 2 * Math.PI;
        while (a1 <= a0) a1 += 2 * Math.PI;
        line(arc(c, r, a0, a1));
      } else if (e.type === 'SPLINE') {
        // Through its fit points if it has them, else along its control points.
        const fit = e.codes.some((c) => c[0] === 11);
        const [cx, cy, cz] = fit ? [11, 21, 31] : [10, 20, 30];
        const pts: V3[] = [];
        for (const [c, val] of e.codes)
          if (c === cx) pts.push([Number(val), 0, 0]);
          else if (c === cy && pts.length) pts[pts.length - 1]![1] = Number(val);
          else if (c === cz && pts.length) pts[pts.length - 1]![2] = Number(val);
        if (num(e, 70) & 1 && pts.length > 2) pts.push(pts[0]!);
        line(pts);
      } else if (e.type === 'INSERT' && depth < 8) {
        const block = blocks.get(str(e, 2) ?? '');
        if (!block) continue;
        const at = point(e, 10);
        const sx = num(e, 41, 1), sy = num(e, 42, 1), sz = num(e, 43, 1); // prettier-ignore
        const r = (num(e, 50) * Math.PI) / 180;
        const [c, s] = [Math.cos(r), Math.sin(r)];
        const inner: Place = ([x, y, z]) => {
          const [px, py] = [x * sx, y * sy];
          return place([at[0] + px * c - py * s, at[1] + px * s + py * c, at[2] + z * sz]);
        };
        draw(block, inner, layer, num(e, 62, 256), depth + 1);
      }
    }
  };
  const ents = sections.get('ENTITIES');
  if (ents) draw(entities(ps, ...ents), (p) => p, null, null, 0);
  // Nothing in a DXF says which way a face winds: each piece is turned outward.
  const list = [...soups.values()].filter((s) => s.polygons.length > 0);
  for (const s of list) s.unordered = true;
  if (list.length > 0) return soupObjects(list, opts);
  // No surfaces: a drawing. Each layer's lines, as the regions they close.
  const out: CutObject[] = [];
  let [found, left] = [0, 0];
  for (const [layer, l] of lines) {
    const { regions, loose } = planRegions(l.lines);
    found += regions.length;
    left += loose;
    const z = l.z.slice().sort((a, b) => a - b)[l.z.length >> 1] ?? 0;
    const laminas = regions.map((r) => lamina(r, z, layer || null, l.color));
    if (laminas.length > 1) out.push(grouper(layer || null, laminas));
    else out.push(...laminas);
  }
  if (lines.size > 0) opts.plan?.(found, left);
  opts.progress?.(1);
  return out;
}

/** A region as a lamina lying flat at height z, its front up. */
function lamina(r: Region, z: number, name: string | null, color: Rgb): CutObject {
  const positions: V3[] = [];
  const loop = (l: readonly P2[]) => l.map(([x, y]) => positions.push([x, z, -y]) - 1);
  const front = [r.outer, ...r.holes].map(loop);
  const back = front.map((l) => [...l].reverse());
  const brep = new Brep();
  buildShell(brep, { positions, faces: [front, back] });
  return createObject(brep, { name, color: [...color] });
}

/** An OCS with its z down (a drawing mirrored): its x runs the other way. */
const flipped = (e: Entity) => num(e, 230, 1) < 0;

/** Points round an arc about c from angle a0 to a1 (clockwise if less), every 10° or so. */
function arc(c: V3, r: number, a0: number, a1: number): V3[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 18)));
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), c[2]]);
  }
  return out;
}

/** A polyline's points, its bulges (arcs, tan of a quarter of their angle) drawn as arcs. */
function bulged(v: readonly { p: V3; bulge: number }[], closed: boolean): V3[] {
  const out: V3[] = [];
  const n = v.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const { p, bulge } = v[i]!;
    const q = v[(i + 1) % n]!.p;
    out.push(p);
    if (Math.abs(bulge) < 1e-9) continue;
    // The arc's angle, centre and radius from its chord.
    const theta = 4 * Math.atan(bulge);
    const chord = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (chord < 1e-12) continue;
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    const mid: P2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const h = r * Math.cos(Math.abs(theta) / 2) * Math.sign(bulge);
    const [ux, uy] = [(q[0] - p[0]) / chord, (q[1] - p[1]) / chord];
    const c: V3 = [mid[0] - uy * h, mid[1] + ux * h, p[2]];
    const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]);
    const pts = arc(c, r, a0, a0 + theta);
    out.push(...pts.slice(1, -1));
  }
  if (n > 0) out.push(closed ? v[0]!.p : v[n - 1]!.p);
  return out;
}
