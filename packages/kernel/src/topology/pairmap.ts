/**
 * A map from pairs of non-negative 32-bit integers (an edge's two vertices) to
 * integers, in flat typed arrays: millions of edges without a JS object, or a
 * boxed number key, for each. Entries are numbered in the order they were
 * added and are never removed; `entry` finds one, and the entry arrays read it.
 */
export class PairMap {
  /** Each entry's pair and value, in the order they were added. */
  a: Int32Array;
  b: Int32Array;
  value: Int32Array;
  size = 0;
  private table: Int32Array;
  private mask: number;

  constructor(expected = 16) {
    let cap = 16;
    while (cap < expected * 2) cap *= 2;
    this.table = new Int32Array(cap).fill(-1);
    this.mask = cap - 1;
    const n = Math.max(8, expected);
    this.a = new Int32Array(n);
    this.b = new Int32Array(n);
    this.value = new Int32Array(n);
  }

  private slot(a: number, b: number): number {
    let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b ^ (b >>> 15), 0x85ebca77);
    h ^= h >>> 13;
    const t = this.table;
    for (let i = h & this.mask; ; i = (i + 1) & this.mask) {
      const e = t[i]!;
      if (e < 0 || (this.a[e] === a && this.b[e] === b)) return i;
    }
  }

  /** The entry for (a, b), or -1. */
  entry(a: number, b: number): number {
    return this.table[this.slot(a, b)]!;
  }

  /** The value for (a, b), or `missing`. */
  get(a: number, b: number, missing = -1): number {
    const e = this.entry(a, b);
    return e < 0 ? missing : this.value[e]!;
  }

  has(a: number, b: number): boolean {
    return this.entry(a, b) >= 0;
  }

  /** The entry for (a, b), added with `value` if it wasn't there (an existing one keeps its value). */
  add(a: number, b: number, value = 0): number {
    const i = this.slot(a, b);
    const e = this.table[i]!;
    if (e >= 0) return e;
    if (this.size === this.a.length) this.growEntries();
    const n = this.size++;
    this.a[n] = a;
    this.b[n] = b;
    this.value[n] = value;
    this.table[i] = n;
    if (this.size * 2 > this.table.length) this.rehash();
    return n;
  }

  /** Sets (a, b)'s value, adding it if need be; its entry. */
  set(a: number, b: number, value: number): number {
    const e = this.add(a, b, value);
    this.value[e] = value;
    return e;
  }

  private growEntries(): void {
    const grow = (x: Int32Array) => {
      const y = new Int32Array(x.length * 2);
      y.set(x);
      return y;
    };
    this.a = grow(this.a);
    this.b = grow(this.b);
    this.value = grow(this.value);
  }

  private rehash(): void {
    this.table = new Int32Array(this.table.length * 2).fill(-1);
    this.mask = this.table.length - 1;
    for (let e = 0; e < this.size; e++) this.table[this.slot(this.a[e]!, this.b[e]!)] = e;
  }
}
