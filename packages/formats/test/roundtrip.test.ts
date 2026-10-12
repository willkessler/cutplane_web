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
  it('finds them', () => expect(samples.length).toBe(27));
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
