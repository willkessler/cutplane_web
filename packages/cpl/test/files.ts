import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const CPL_DIR = resolve(import.meta.dirname, '../../../assets/original/cpl');

/** The original's CPL sources are 8-bit text; latin1 keeps every byte. */
export function cplSource(name: string): string {
  return readFileSync(
    join(CPL_DIR, name.toLowerCase().endsWith('.cpl') ? name : `${name.toLowerCase()}.cpl`),
    'latin1',
  );
}

export function allCplFiles(): string[] {
  return readdirSync(CPL_DIR)
    .filter((f) => f.endsWith('.cpl'))
    .sort();
}
