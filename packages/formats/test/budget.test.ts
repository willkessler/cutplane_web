import { describe, expect, it } from 'vitest';
import { readInventor, simplifierReady } from '../src/index.ts';

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
});
