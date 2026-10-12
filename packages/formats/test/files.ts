import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../../..');
export const ORIGINAL = join(REPO, 'assets/original');
/** Larry's full 1991–94 archive: local only, git-ignored (see docs). */
export const CORPUS = process.env['CUTPLANE_CORPUS'] ?? join(REPO, 'corpus/cut');

/** Files in `dir` (recursively one level) that are in .cut format. */
export function cutFormatFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile() && statSync(p).size > 0)
    .filter((p) => readFileSync(p, 'latin1').startsWith('** Start of file'))
    .sort();
}

export function read(path: string): string {
  // The originals are 8-bit text from 1991; latin1 maps every byte 1:1.
  return readFileSync(path, 'latin1');
}
