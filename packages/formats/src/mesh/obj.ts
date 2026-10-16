import type { CutObject, Rgb } from '@cutplane/kernel';
import { meshFaces, type V3 } from './faces.ts';
import { exportable, nameOf } from './objects.ts';
import type { MeshOptions } from './options.ts';
import { soupObjects, type Soup } from './polygonize.ts';

const hex = (c: Rgb) => c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const num = (v: number) => String(Number(v.toPrecision(10)));

/**
 * Wavefront OBJ: each object a named `o`, in room units, faces as polygons
 * (a face with holes as its triangles). Colours go by material name,
 * `color_rrggbb`, which `readObj` reads back with or without an .mtl.
 */
export function writeObj(roots: readonly CutObject[], title = 'Cutplane world'): string {
  const out = [`# ${title}`, '# Written by Cutplane (room units)'];
  let base = 1;
  let material = '';
  exportable(roots).forEach((o, i) => {
    out.push(`o ${nameOf(o, i).replace(/\s+/g, '_')}`);
    const faces = meshFaces(o);
    const index = new Map<string, number>();
    const at = (p: V3) => {
      const k = p.join(',');
      let n = index.get(k);
      if (n === undefined) {
        n = base + index.size;
        index.set(k, n);
        out.push(`v ${num(p[0])} ${num(p[1])} ${num(p[2])}`);
      }
      return n;
    };
    const lines: string[] = [];
    for (const f of faces) {
      const m = `color_${hex(f.color)}`;
      if (m !== material) lines.push(`usemtl ${(material = m)}`);
      const ids = f.loops.map((l) => l.map(at));
      if (ids.length === 1) lines.push(`f ${ids[0]!.join(' ')}`);
      else {
        const all = ids.flat();
        for (const t of f.triangles) lines.push(`f ${t.map((k) => all[k]).join(' ')}`);
      }
    }
    base += index.size;
    out.push(...lines);
  });
  return out.join('\n') + '\n';
}

/** An .mtl file's diffuse colours (Kd, 0–1), by material name, as 0–255. */
export function readMtl(text: string): Map<string, Rgb> {
  const out = new Map<string, Rgb>();
  let name: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const [k, ...rest] = raw.trim().split(/\s+/);
    if (k === 'newmtl') name = rest.join(' ');
    else if (k === 'Kd' && name !== null) {
      const c = rest.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, Number(v))) * 255));
      if (c.length === 3 && c.every(Number.isFinite)) out.set(name, c as Rgb);
    }
  }
  return out;
}

/**
 * Reads a Wavefront OBJ: an object per `o` (or per `g` when there are no
 * `o`s), polygons as they are, coplanar triangles joined back into faces.
 * Colours come from `materials` (an .mtl's) or from `color_rrggbb` names.
 */
export function readObj(
  text: string,
  materials: Map<string, Rgb> = new Map(),
  opts: MeshOptions = {},
): CutObject[] {
  const positions: V3[] = [];
  const soups: Soup[] = [];
  const lines = text.split(/\r?\n/);
  const split = lines.some((l) => /^o\s/.test(l)) ? 'o' : 'g';
  let current: Soup | null = null;
  let color: Rgb | null = null;
  const part = () => (current ??= add(null));
  const add = (name: string | null): Soup => {
    const s: Soup = { name, positions: [], polygons: [], colors: [] };
    soups.push(s);
    return s;
  };
  const local = new Map<Soup, Map<number, number>>();
  for (const raw of lines) {
    const [k, ...rest] = raw.trim().split(/\s+/);
    if (k === 'v') positions.push(rest.slice(0, 3).map(Number) as V3);
    else if (k === split) current = add(rest.join(' ') || null);
    else if (k === 'usemtl') {
      const name = rest.join(' ');
      const m = /^color_([0-9a-f]{6})$/i.exec(name);
      color =
        materials.get(name) ??
        (m ? ([0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as Rgb) : null);
    } else if (k === 'f') {
      const s = part();
      let map = local.get(s);
      if (!map) local.set(s, (map = new Map()));
      const poly: number[] = [];
      for (const ref of rest) {
        let i = parseInt(ref.split('/')[0]!, 10);
        if (!Number.isFinite(i) || i === 0) continue;
        i = i < 0 ? positions.length + i : i - 1;
        if (i < 0 || i >= positions.length) continue;
        let j = map.get(i);
        if (j === undefined) {
          j = s.positions.length;
          map.set(i, j);
          s.positions.push(positions[i]!);
        }
        poly.push(j);
      }
      s.polygons.push(poly);
      s.colors!.push(color);
    }
  }
  return soupObjects(
    soups.filter((s) => s.polygons.length > 0),
    opts,
  );
}
