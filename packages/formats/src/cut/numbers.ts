import { snap } from '@cutplane/kernel';

const FLOAT = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

export function floats(s: string): number[] {
  return (s.match(FLOAT) ?? []).map(Number);
}

export function ints(s: string): number[] {
  return (s.match(/[-+]?\d+/g) ?? []).map(Number);
}

/** C's %f for values read from a file, falling back to the exact shortest form. */
export function fmtF(v: number, digits = 6): string {
  const s = v.toFixed(digits);
  return Number(s) === v ? (Object.is(v, -0) ? `-${s}` : s) : String(v);
}

/**
 * A snapped coordinate: the shortest decimal that snaps back to exactly the
 * same grid value. One decimal is padded like the original's %5.1f, so files
 * the original wrote come back byte for byte.
 */
export function fmtCoord(v: number): string {
  for (let k = 1; k <= 10; k++) {
    const s = v.toFixed(k);
    if (snap(Number(s)) === v) return k === 1 ? s.padStart(5) : s;
  }
  return String(v);
}
