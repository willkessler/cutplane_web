import type { CutObject } from '@cutplane/kernel';
import { meshFaces, type V3 } from './faces.ts';
import { exportable } from './objects.ts';
import type { MeshOptions } from './options.ts';
import { soupObjects, type Soup } from './polygonize.ts';

/** Binary STL: every object's triangles, in room units, with their faces' normals. */
export function writeStl(
  roots: readonly CutObject[],
  title = 'Cutplane world',
): Uint8Array<ArrayBuffer> {
  const tris: { n: V3; p: V3[] }[] = [];
  for (const o of exportable(roots))
    for (const f of meshFaces(o)) {
      const all = f.loops.flat();
      for (const t of f.triangles) tris.push({ n: f.normal, p: t.map((k) => all[k]!) });
    }
  const bytes = new Uint8Array(84 + 50 * tris.length);
  // The 80-byte header: text, one byte a character (latin1).
  [...`Cutplane: ${title}`.slice(0, 79)].forEach((ch, i) => (bytes[i] = ch.charCodeAt(0) & 0xff));
  const dv = new DataView(bytes.buffer);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    let at = 84 + 50 * i;
    for (const v of [t.n, ...t.p])
      for (const c of v) {
        dv.setFloat32(at, c, true);
        at += 4;
      }
  });
  return bytes;
}

/** A binary STL is exactly 84 bytes plus 50 per triangle; anything else is read as text. */
function isBinary(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false;
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
  return 84 + 50 * n === bytes.length;
}

/** Reads an STL (binary or ASCII), welding its triangles into solids: one per `solid` block. */
export function readStl(bytes: Uint8Array, opts: MeshOptions = {}): CutObject[] {
  const soups: Soup[] = [];
  if (isBinary(bytes)) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = dv.getUint32(80, true);
    const s: Soup = { name: null, positions: [], polygons: [] };
    for (let i = 0; i < n; i++) {
      const at = 84 + 50 * i + 12;
      const tri: number[] = [];
      for (let k = 0; k < 3; k++) {
        const o = at + 12 * k;
        s.positions.push([
          dv.getFloat32(o, true),
          dv.getFloat32(o + 4, true),
          dv.getFloat32(o + 8, true),
        ]);
        tri.push(s.positions.length - 1);
      }
      s.polygons.push(tri);
    }
    soups.push(s);
  } else {
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    let s: Soup | null = null;
    let tri: number[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const [k, ...rest] = raw.trim().split(/\s+/);
      if (k === 'solid')
        soups.push((s = { name: rest.join(' ') || null, positions: [], polygons: [] }));
      else if (k === 'vertex') {
        s ??= soups[soups.push({ name: null, positions: [], polygons: [] }) - 1]!;
        s.positions.push(rest.slice(0, 3).map(Number) as V3);
        tri.push(s.positions.length - 1);
      } else if (k === 'endloop') {
        if (s && tri.length >= 3) s.polygons.push(tri);
        tri = [];
      }
    }
  }
  return soupObjects(
    soups.filter((s) => s.polygons.length > 0),
    opts,
  );
}
