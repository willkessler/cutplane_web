import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preorder, validate } from '@cutplane/kernel';
import { readCut, writeCut } from '../src/index.ts';
import { CORPUS, ORIGINAL, REPO, cutFormatFiles, read } from './files.ts';

const original = [
  ...cutFormatFiles(join(ORIGINAL, 'rsc')),
  ...cutFormatFiles(join(ORIGINAL, 'icons')),
];
const samples = cutFormatFiles(join(REPO, 'assets/samples'));
const corpus = cutFormatFiles(CORPUS);

function check(path: string) {
  const text = read(path);
  const { doc } = readCut(text);
  const objects = [...preorder(doc.roots)];
  expect(objects.length).toBeGreaterThan(0);
  for (const o of objects) {
    const r = validate(o.brep);
    expect(
      r.issues.filter((i) => i.severity === 'error'),
      `${basename(path)} "${o.name}"`,
    ).toEqual([]);
  }
  // Round trip: write → read → write is a fixed point, so the model survives intact.
  const once = writeCut(doc);
  const twice = writeCut(readCut(once).doc);
  expect(twice).toBe(once);
}

describe('original resources (rsc/, icons/)', () => {
  it('finds them', () => expect(original.length).toBeGreaterThan(20));
  it.each(original.map((p) => [basename(p), p]))('%s loads, validates and round-trips', (_n, p) =>
    check(p),
  );
});

describe('bundled samples', () => {
  it('finds them', () => expect(samples.length).toBe(32));
  it.each(samples.map((p) => [basename(p), p]))('%s loads, validates and round-trips', (_n, p) =>
    check(p),
  );
});

describe.skipIf(corpus.length === 0)('1991–94 archive corpus', () => {
  it('has all 116 .cut files', () => expect(corpus.length).toBe(116));
  it.each(corpus.map((p) => [basename(p), p]))('%s loads, validates and round-trips', (_n, p) =>
    check(p),
  );
});

describe('a see-through object (new)', () => {
  it('keeps its opacity; a solid one writes none', async () => {
    const { createCube, createObject } = await import('@cutplane/kernel');
    const glass = createObject(createCube(10, 10, 10), { opacity: 0.5 });
    const solid = createObject(createCube(10, 10, 10));
    const text = writeCut({ title: 't', contains: 'World', name: null, roots: [glass, solid] });
    expect(text.match(/Object Opacity:/g)).toHaveLength(1);
    const [a, b] = readCut(text).doc.roots;
    expect(a!.opacity).toBe(0.5);
    expect(b!.opacity).toBeUndefined();
  });
});

describe('lettering on an object (new)', () => {
  it('keeps its decals, what they say last, bars and all, how they lean, where they start, stickers, and notes', async () => {
    const { createCube, createObject } = await import('@cutplane/kernel');
    const o = createObject(createCube(10, 10, 10), {
      decals: [
        { text: 'PAN AMERICAN', color: [20, 30, 40], height: 4.5, at: [1, 2.25, 3], normal: [0, 1, 0], along: [1, 0, 0] }, // prettier-ignore
        { text: 'A|B  C', color: [0, 0, 0], height: 1, at: [0, 0, 5], normal: [0, 0, 1], along: [0.6, 0.8, 0] }, // prettier-ignore
        { text: 'Lean 5|2001', color: [9, 9, 9], height: 2, at: [5, 5, 10], normal: [0, 0, 1], along: [1, 0, 0], lean: -8.13 }, // prettier-ignore
        { text: 'Lean 5|unleaned', color: [9, 9, 9], height: 2, at: [5, 5, 10], normal: [0, 0, 1], along: [1, 0, 0] }, // prettier-ignore
        { text: 'Lean 5', color: [9, 9, 9], height: 2, at: [5, 5, 10], normal: [0, 0, 1], along: [1, 0, 0] }, // prettier-ignore
        { text: 'NASA', color: [9, 9, 9], height: 2, at: [5, 5, 10], normal: [0, 0, 1], along: [1, 0, 0], align: 'start', lean: 4 }, // prettier-ignore
        { text: 'Start|here', color: [9, 9, 9], height: 2, at: [5, 5, 10], normal: [0, 0, 1], along: [1, 0, 0] }, // prettier-ignore
        { text: 'GLOBE', color: [255, 255, 255], height: 30, at: [5, 5, 10], normal: [0, 0, 1], along: [1, 0, 0], lean: 2, image: 'data:image/png;base64,iVBORw0KGgo=', aspect: 1.5 }, // prettier-ignore
        { text: 'Start|Lean 3|x', color: [9, 9, 9], height: 2, at: [5, 5, 10], normal: [0, 0, 1], along: [1, 0, 0], align: 'start' }, // prettier-ignore
        { text: 'Flange here is steel | 3mm', color: [40, 40, 40], height: 6, at: [5, 10, 5], normal: [0, 1, 0], along: [1, 0, 0], note: 25.5 }, // prettier-ignore
      ],
    });
    const text = writeCut({ title: 't', contains: 'World', name: null, roots: [o] });
    const back = readCut(text).doc.roots[0]!;
    expect(back.decals).toEqual(o.decals);
    expect(writeCut(readCut(text).doc)).toBe(text);
  });
});
