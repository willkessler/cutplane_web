import type { Rgb } from '@cutplane/kernel';
import { floats, ints } from './cut/numbers.ts';

export interface DecalPolygon {
  color: Rgb;
  points: [number, number, number][];
}

/** A .dcl decal: flat coloured polygons drawn on pads and plates (read_decal_file). */
export interface Decal {
  name: string;
  origin: [number, number, number];
  scale: number;
  polygons: DecalPolygon[];
}

/** Reads a .dcl file. Missing origin/scale lines default to 0 and 1, as some files omit them. */
export function readDecal(text: string): { decal: Decal; warnings: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const warnings: string[] = [];
  let i = 0;
  const head = lines[i++] ?? '';
  if (!head.startsWith('*** Start of Decal File')) throw new Error('not a decal file');
  const decal: Decal = {
    name: head.split(':')[1]?.trim() ?? '',
    origin: [0, 0, 0],
    scale: 1,
    polygons: [],
  };
  const value = (prefix: string) =>
    lines[i]?.startsWith(prefix) ? lines[i++]!.slice(prefix.length) : null;
  const count = Number(value('Number of Polygons:') ?? 0);
  const o = value('Decal Origin:');
  if (o !== null) decal.origin = floats(o).slice(0, 3) as [number, number, number];
  const s = value('Decal Scale:');
  if (s !== null) decal.scale = Number(s);
  for (let p = 0; p < count; p++) {
    const c = value('Polygon Color:');
    const nv = Number(value('Number of Vertices:') ?? 0);
    const poly: DecalPolygon = { color: (c ? ints(c).slice(0, 3) : [0, 0, 0]) as Rgb, points: [] };
    while (poly.points.length < nv && lines[i] && /^[-+\d.\s]+$/.test(lines[i]!)) {
      const v = floats(lines[i++]!);
      poly.points.push([v[0] ?? 0, v[1] ?? 0, v[2] ?? 0]);
    }
    if (poly.points.length !== nv)
      warnings.push(`polygon ${p + 1} lists ${poly.points.length} of ${nv} vertices`);
    decal.polygons.push(poly);
  }
  return { decal, warnings };
}
