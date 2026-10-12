/**
 * 4x4 matrices in the original's convention: row vectors, p' = p · M, stored
 * row-major, so the translation is the bottom row (m[12], m[13], m[14]). This
 * matches the matrices written in .cut files.
 */
export type Mat4 = Float64Array;

export function identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function fromRows(rows: readonly (readonly number[])[]): Mat4 {
  const m = new Float64Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[r * 4 + c] = rows[r]?.[c] ?? 0;
  return m;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

/** a · b: apply a first, then b. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k]! * b[k * 4 + c]!;
      out[r * 4 + c] = s;
    }
  return out;
}

export function transformPoint(
  m: Mat4,
  x: number,
  y: number,
  z: number,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const w = x * m[3]! + y * m[7]! + z * m[11]! + m[15]!;
  out[0] = (x * m[0]! + y * m[4]! + z * m[8]! + m[12]!) / w;
  out[1] = (x * m[1]! + y * m[5]! + z * m[9]! + m[13]!) / w;
  out[2] = (x * m[2]! + y * m[6]! + z * m[10]! + m[14]!) / w;
  return out;
}

/** Inverse by Gauss-Jordan elimination with partial pivoting; null if singular. */
export function invert(m: Mat4): Mat4 | null {
  const a = Float64Array.from(m);
  const inv = identity();
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r * 4 + c]!) > Math.abs(a[p * 4 + c]!)) p = r;
    const pivot = a[p * 4 + c]!;
    if (pivot === 0 || !Number.isFinite(pivot)) return null;
    if (p !== c) {
      for (let k = 0; k < 4; k++) {
        [a[c * 4 + k], a[p * 4 + k]] = [a[p * 4 + k]!, a[c * 4 + k]!];
        [inv[c * 4 + k], inv[p * 4 + k]] = [inv[p * 4 + k]!, inv[c * 4 + k]!];
      }
    }
    for (let k = 0; k < 4; k++) {
      a[c * 4 + k]! /= pivot;
      inv[c * 4 + k]! /= pivot;
    }
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = a[r * 4 + c]!;
      if (f === 0) continue;
      for (let k = 0; k < 4; k++) {
        a[r * 4 + k]! -= f * a[c * 4 + k]!;
        inv[r * 4 + k]! -= f * inv[c * 4 + k]!;
      }
    }
  }
  return inv;
}
