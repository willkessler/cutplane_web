// Summarises how faithfully the .cut reader handles a directory of files.
// Usage (in the dev container): node packages/formats/scripts/report.ts <dir>...
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { preorder, validate } from '@cutplane/kernel';
import { readCut, writeCut } from '../src/index.ts';

const totals: Record<string, number> = {};
let files = 0, identical = 0, objects = 0, closed = 0, verts = 0, faces = 0; // prettier-ignore
const notIdentical: string[] = [];
const fileWarnings: string[] = [];

for (const dir of process.argv.slice(2)) {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (!statSync(p).isFile() || statSync(p).size === 0) continue;
    const text = readFileSync(p, 'latin1');
    if (!text.startsWith('** Start of file')) continue;
    files++;
    const { doc, warnings } = readCut(text);
    for (const w of warnings) fileWarnings.push(`${basename(p)}: ${w}`);
    const out = writeCut(doc);
    if (out === text || out === text + '\n') identical++;
    else notIdentical.push(basename(p));
    for (const o of preorder(doc.roots)) {
      objects++;
      verts += o.brep.numVertices;
      faces += o.brep.numFaces;
      const r = validate(o.brep);
      if (r.closedManifold) closed++;
      for (const [k, v] of Object.entries(r.counts)) totals[k] = (totals[k] ?? 0) + v;
    }
  }
}
console.log(`files: ${files}, byte-identical rewrites: ${identical}`);
console.log(`objects: ${objects}, closed manifold: ${closed}, vertices: ${verts}, faces: ${faces}`);
console.log('validation findings:', totals);
console.log('reader warnings:', fileWarnings.length);
for (const w of fileWarnings) console.log('  ', w);
console.log('not byte-identical:', notIdentical.join(' '));
