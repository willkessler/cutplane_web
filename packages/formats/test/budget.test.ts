import { describe, expect, it } from 'vitest';
import { readCut, readInventor, readStl, simplifierReady, writeCut } from '../src/index.ts';

/** An Inventor terrain of n × n points in quads, rolling so few of them lie flat. */
function terrain(n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) pts.push(`${i} ${(Math.sin(i * 0.37) * Math.cos(j * 0.23) * 4).toFixed(4)} ${j},`); // prettier-ignore
  const idx: string[] = [];
  for (let i = 0; i + 1 < n; i++)
    for (let j = 0; j + 1 < n; j++) {
      const a = i * n + j;
      idx.push(`${a} ${a + n} ${a + n + 1} ${a + 1} -1`);
    }
  return `#Inventor V2.1 ascii\nSeparator { Coordinate3 { point [ ${pts.join('\n')} ] }\nIndexedFaceSet { coordIndex [ ${idx.join('\n')} ] } }\n`;
}

/** A binary STL ball of 2·n·(n−1) triangles, each with its own three corners, as STLs are. */
function ball(n: number): Uint8Array {
  const at = (i: number, j: number) => {
    const t = (Math.PI * i) / n;
    const f = (2 * Math.PI * j) / n;
    return [Math.sin(t) * Math.cos(f) * 100, Math.sin(t) * Math.sin(f) * 100, Math.cos(t) * 100];
  };
  const tris: number[][][] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const [a, b, c, d] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      if (i > 0) tris.push([a, b, d]);
      if (i < n - 1) tris.push([b, c, d]);
    }
  const bytes = new Uint8Array(84 + 50 * tris.length);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, k) => t.flat().forEach((x, m) => dv.setFloat32(84 + 50 * k + 12 + 4 * m, x, true))); // prettier-ignore
  return bytes;
}

describe('a face budget', () => {
  it('simplifies a file with more faces than it to about that many, and says so', async () => {
    await simplifierReady();
    const text = terrain(80); // 79² = 6241 quads
    let told: [number, number] | null = null;
    const progress: number[] = [];
    const [o] = readInventor(text, {
      budget: 2000,
      simplified: (from, to) => (told = [from, to]),
      progress: (f) => progress.push(f),
    });
    expect(told![0]).toBe(6241);
    expect(told![1]).toBeLessThanOrEqual(2000 * 2); // as triangles: about two to a quad
    expect(o!.brep.numFaces).toBeLessThan(6241);
    // Progress only goes forward, and gets to the end.
    expect(progress.every((f, i) => i === 0 || f >= progress[i - 1]!)).toBe(true);
    expect(progress.at(-1)).toBe(1);
  });

  it('leaves a file within it as it is', async () => {
    await simplifierReady();
    let told = false;
    const [o] = readInventor(terrain(20), { budget: 2000, simplified: () => (told = true) });
    expect(told).toBe(false);
    expect(o!.brep.numFaces).toBeGreaterThan(300);
  });

  it("brings a big STL down too (its corners, three a triangle, aren't all handed over)", async () => {
    await simplifierReady();
    let told: [number, number] | null = null;
    const [o] = readStl(ball(400), { budget: 20_000, simplified: (from, to) => (told = [from, to]) }); // prettier-ignore
    expect(told![0]).toBe(2 * 400 * 399);
    expect(told![1]).toBeLessThanOrEqual(20_000 * 1.05);
    expect(o!.brep.numFaces).toBeLessThanOrEqual(20_000 * 1.05);
  });

  it('a big solid saved in a .cut reads back (its million indices not spread into a call)', () => {
    const [o] = readStl(ball(260)); // 134,680 triangles: 404,040 indices
    const text = writeCut({ title: 'ball', contains: 'World', name: null, roots: [o!] });
    const [back] = readCut(text).doc.roots;
    expect(back!.brep.numFaces).toBe(o!.brep.numFaces);
  });
});
