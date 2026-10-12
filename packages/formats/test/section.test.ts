import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorldGeometry, computeSection, preorder, validate } from '@cutplane/kernel';
import { readCut } from '../src/index.ts';
import { CORPUS, ORIGINAL, REPO, cutFormatFiles, read } from './files.ts';

/**
 * Sections every object of real 1991 models at many depths, including
 * exactly at vertex depths (where the plane parks when it snaps). Every
 * closed-manifold shell must give only closed loops.
 */
function sweep(path: string) {
  const { doc } = readCut(read(path));
  let loops = 0;
  for (const o of preorder(doc.roots)) {
    const report = validate(o.brep);
    const closed = new Set(report.shells.filter((s) => s.closedManifold).map((s) => s.shell));
    if (closed.size === 0) continue;
    const g = new WorldGeometry(o.brep, o.xform);
    const zs = new Set<number>();
    for (let i = 1; i < 16; i++) zs.add(g.zMin + ((g.zMax - g.zMin) * i) / 16);
    const verts = o.brep.vertices();
    for (let i = 0; i < verts.length; i += Math.max(1, Math.floor(verts.length / 24)))
      zs.add(g.z(verts[i]!));
    for (const z of zs) {
      for (const l of computeSection(g, z).loops) {
        if (!closed.has(l.shell)) continue;
        loops++;
        expect(l.closed, `${basename(path)} "${o.name}" at z=${z}`).toBe(true);
      }
    }
  }
  return loops;
}

const files = [
  ...cutFormatFiles(join(REPO, 'assets/samples')),
  ...cutFormatFiles(join(ORIGINAL, 'rsc')),
  ...cutFormatFiles(CORPUS),
];

describe('sections of real models', () => {
  it.each(files.map((p) => [basename(p), p]))('%s: closed shells give closed loops', (_n, p) => {
    sweep(p);
  });
});
