import earcut from 'earcut';

/** A point in a drawing's plane. */
export type P2 = [number, number];

/** A region the lines of a drawing close round: its outline (counter-clockwise) and its holes (clockwise). */
export interface Region {
  outer: P2[];
  holes: P2[][];
  /** Its area, holes taken out. */
  area: number;
}

/** What a drawing's lines came to: the regions they close, and how many lines closed none. */
export interface Plan {
  regions: Region[];
  /** The lines (as given) none of which bounds a region: door swings left open, notes, strays. */
  loose: number;
}

const area2 = (l: readonly P2[]) => {
  let a = 0;
  for (let i = 0; i < l.length; i++) {
    const p = l[i]!;
    const q = l[(i + 1) % l.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

function inside(p: P2, l: readonly P2[]): boolean {
  let c = false;
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    const a = l[i]!;
    const b = l[j]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      c = !c;
  }
  return c;
}

/** Points within `tol` of each other made one, by a grid of cells `tol` wide. */
class Welder {
  readonly pts: P2[] = [];
  private readonly cells = new Map<string, number[]>();
  constructor(private readonly tol: number) {}
  private key(x: number, y: number) {
    return `${x},${y}`;
  }
  at(p: P2): number {
    const cx = Math.floor(p[0] / this.tol);
    const cy = Math.floor(p[1] / this.tol);
    let best = -1;
    let bd = this.tol * this.tol;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of this.cells.get(this.key(cx + dx, cy + dy)) ?? []) {
          const q = this.pts[i]!;
          const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
          if (d <= bd) [best, bd] = [i, d];
        }
    if (best >= 0) return best;
    const i = this.pts.push([p[0], p[1]]) - 1;
    const k = this.key(cx, cy);
    const c = this.cells.get(k);
    if (c) c.push(i);
    else this.cells.set(k, [i]);
    return i;
  }
}

/**
 * The regions a drawing's lines close round, as a plan's walls and rooms are.
 * The lines needn't be joined: ends that meet (to a millionth of the drawing's
 * size) are one point, lines crossing or ending on another are split there,
 * lines drawn twice count once, and an end left just short of a line (a
 * thousandth of the drawing's size) is carried on to meet it. What closes
 * nothing is passed over. A region inside another is a hole in it, and a region
 * of its own as well.
 */
export function planRegions(lines: readonly (readonly P2[])[], straight = true): Plan {
  const segs: [P2, P2][] = [];
  const lineOf: number[] = [];
  lines.forEach((l, n) => {
    for (let i = 0; i + 1 < l.length; i++) {
      segs.push([l[i]! as P2, l[i + 1]! as P2]);
      lineOf.push(n);
    }
  });
  if (segs.length === 0) return { regions: [], loose: 0 };
  let lo: P2 = [Infinity, Infinity];
  let hi: P2 = [-Infinity, -Infinity];
  for (const s of segs)
    for (const p of s) {
      lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
      hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
    }
  const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1]) || 1;
  const tol = size * 1e-6;
  const gap = size * 1e-3;

  // Every crossing, and every end on another line, splits the line there.
  const cuts: number[][] = segs.map(() => [0, 1]);
  const order = segs.map((_, i) => i).sort((a, b) => minX(segs[a]!) - minX(segs[b]!));
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi]!;
    const s = segs[i]!;
    const sx = maxX(s);
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj]!;
      const t = segs[j]!;
      if (minX(t) > sx + tol) break;
      if (Math.min(s[0][1], s[1][1]) > Math.max(t[0][1], t[1][1]) + tol) continue;
      if (Math.min(t[0][1], t[1][1]) > Math.max(s[0][1], s[1][1]) + tol) continue;
      crossings(s, t, tol, cuts[i]!, cuts[j]!);
    }
  }
  const weld = new Welder(tol);
  const edges = new Map<string, [number, number]>();
  // The lines each piece is of (a line drawn twice, two).
  const from = new Map<string, number[]>();
  segs.forEach((s, i) => {
    const ts = [...new Set(cuts[i]!)].sort((a, b) => a - b);
    let prev = weld.at(lerp(s, ts[0]!));
    for (const t of ts.slice(1)) {
      const v = weld.at(lerp(s, t));
      const k = link(edges, prev, v);
      if (k) (from.get(k) ?? from.set(k, []).get(k)!).push(lineOf[i]!);
      prev = v;
    }
  });
  const pts = weld.pts;

  closeGaps(pts, edges, gap, tol, weld, from);

  // Loose ends can bound nothing: off with them, and with the lines they hang on.
  const regions: Region[] = [];
  for (let pass = 0; pass < 100; pass++) {
    prune(edges, pts.length);
    const { cycles, bridges } = walk(pts, edges);
    if (bridges.length > 0) {
      // A line with the same region either side of it (one into an island) bounds nothing either.
      for (const k of bridges) edges.delete(k);
      continue;
    }
    collect(pts, edges, cycles, regions, straight);
    break;
  }
  const used = new Set<number>();
  for (const k of edges.keys()) for (const n of from.get(k) ?? []) used.add(n);
  const drawn = lines.filter((l) => l.length >= 2).length;
  return { regions: regions.sort((a, b) => b.area - a.area), loose: drawn - used.size };
}

/** Lines by their ends, each once whichever way it was drawn. Returns its key. */
function link(edges: Map<string, [number, number]>, a: number, b: number): string | null {
  if (a === b) return null;
  const k = a < b ? `${a} ${b}` : `${b} ${a}`;
  if (!edges.has(k)) edges.set(k, [a, b]);
  return k;
}

const minX = (s: readonly P2[]) => Math.min(s[0]![0], s[1]![0]);
const maxX = (s: readonly P2[]) => Math.max(s[0]![0], s[1]![0]);
const lerp = (s: readonly P2[], t: number): P2 => [
  s[0]![0] + (s[1]![0] - s[0]![0]) * t,
  s[0]![1] + (s[1]![1] - s[0]![1]) * t,
];

/** Where s and t cross or touch, as fractions along each, onto their cuts. */
function crossings(s: [P2, P2], t: [P2, P2], tol: number, cs: number[], ct: number[]): void {
  const r: P2 = [s[1][0] - s[0][0], s[1][1] - s[0][1]];
  const q: P2 = [t[1][0] - t[0][0], t[1][1] - t[0][1]];
  const rr = Math.hypot(...r);
  const qq = Math.hypot(...q);
  if (rr < tol || qq < tol) return;
  // An end of one on the other (overlapping lines, T-junctions).
  const onto = (p: P2, a: P2, d: P2, len: number, into: number[]) => {
    const u = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (len * len);
    if (u <= 0 || u >= 1) return;
    const off = Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / len;
    if (off <= tol) into.push(u);
  };
  onto(t[0], s[0], r, rr, cs);
  onto(t[1], s[0], r, rr, cs);
  onto(s[0], t[0], q, qq, ct);
  onto(s[1], t[0], q, qq, ct);
  // A proper crossing.
  const den = r[0] * q[1] - r[1] * q[0];
  if (Math.abs(den) < 1e-12 * rr * qq) return;
  const w: P2 = [t[0][0] - s[0][0], t[0][1] - s[0][1]];
  const u = (w[0] * q[1] - w[1] * q[0]) / den;
  const v = (w[0] * r[1] - w[1] * r[0]) / den;
  const eu = tol / rr;
  const ev = tol / qq;
  if (u > eu && u < 1 - eu && v > ev && v < 1 - ev) {
    cs.push(u);
    ct.push(v);
  }
}

/** Each loose end carried on, along its line, to a line just ahead of it; or else to a point near it. */
function closeGaps(
  pts: P2[],
  edges: Map<string, [number, number]>,
  gap: number,
  tol: number,
  weld: Welder,
  from: Map<string, number[]>,
): void {
  const degree = new Map<number, number[]>();
  for (const [a, b] of edges.values()) {
    (degree.get(a) ?? degree.set(a, []).get(a)!).push(b);
    (degree.get(b) ?? degree.set(b, []).get(b)!).push(a);
  }
  const ends = [...degree].filter(([, n]) => n.length === 1);
  for (const [v, [u]] of ends) {
    const p = pts[v]!;
    const back = pts[u!]!;
    const len = Math.hypot(p[0] - back[0], p[1] - back[1]);
    if (len < tol) continue;
    const d: P2 = [(p[0] - back[0]) / len, (p[1] - back[1]) / len];
    let best: { k: string; e: [number, number]; s: number; t: number } | null = null;
    for (const [k, e] of edges) {
      if (e[0] === v || e[1] === v) continue;
      const a = pts[e[0]]!;
      const b = pts[e[1]]!;
      const q: P2 = [b[0] - a[0], b[1] - a[1]];
      const den = d[0] * q[1] - d[1] * q[0];
      if (Math.abs(den) < 1e-9 * Math.hypot(...q)) continue;
      const w: P2 = [a[0] - p[0], a[1] - p[1]];
      const s = (w[0] * q[1] - w[1] * q[0]) / den; // how far ahead
      const t = (w[0] * d[1] - w[1] * d[0]) / den; // where on e
      if (s > 0 && s <= gap && t >= 0 && t <= 1 && (!best || s < best.s)) best = { k, e, s, t };
    }
    if (best) {
      const [a, b] = best.e;
      const at = weld.at([p[0] + d[0] * best.s, p[1] + d[1] * best.s]);
      if (at !== a && at !== b) {
        edges.delete(best.k);
        // The two halves are of the line the whole was.
        const was = from.get(best.k) ?? [];
        for (const k of [link(edges, a, at), link(edges, at, b)]) if (k) from.set(k, was);
      }
      link(edges, v, at);
      continue;
    }
    // No line ahead: the nearest point (but its own line's) close enough.
    let near = -1;
    let nd = gap;
    for (const [w] of degree) {
      if (w === v || w === u) continue;
      const q = pts[w]!;
      const dd = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (dd <= nd) [near, nd] = [w, dd];
    }
    if (near >= 0) link(edges, v, near);
  }
}

/** Takes off lines with an end on nothing else, until there are none. */
function prune(edges: Map<string, [number, number]>, n: number): void {
  const deg = new Int32Array(n);
  for (const [a, b] of edges.values()) {
    deg[a]!++;
    deg[b]!++;
  }
  for (let again = true; again;) {
    again = false;
    for (const [k, [a, b]] of edges)
      if (deg[a]! <= 1 || deg[b]! <= 1) {
        edges.delete(k);
        deg[a]!--;
        deg[b]!--;
        again = true;
      }
  }
}

/**
 * The lines' faces, each a cycle with its region on its left: counter-clockwise
 * round a region, clockwise round the outside of a connected drawing. Lines with
 * one face both sides are bridges.
 */
function walk(pts: readonly P2[], edges: Map<string, [number, number]>) {
  // Each point's lines out, by angle.
  const out = new Map<number, { to: number; ang: number }[]>();
  for (const [a, b] of edges.values())
    for (const [u, v] of [
      [a, b],
      [b, a],
    ] as const) {
      const p = pts[u]!;
      const q = pts[v]!;
      const list = out.get(u) ?? out.set(u, []).get(u)!;
      list.push({ to: v, ang: Math.atan2(q[1] - p[1], q[0] - p[0]) });
    }
  for (const l of out.values()) l.sort((x, y) => x.ang - y.ang);
  const seen = new Set<string>();
  const cycles: number[][] = [];
  const faceOf = new Map<string, number>();
  for (const [u, list] of out)
    for (const { to } of list) {
      if (seen.has(`${u} ${to}`)) continue;
      const cyc: number[] = [];
      let [a, b] = [u, to];
      while (!seen.has(`${a} ${b}`)) {
        seen.add(`${a} ${b}`);
        faceOf.set(`${a} ${b}`, cycles.length);
        cyc.push(a);
        // At b, the line out just clockwise of the way back: the sharpest turn left.
        const l = out.get(b)!;
        const back = l.findIndex((e) => e.to === a);
        const next = l[(back - 1 + l.length) % l.length]!.to;
        [a, b] = [b, next];
      }
      cycles.push(cyc);
    }
  const bridges: string[] = [];
  for (const [k, [a, b]] of edges)
    if (faceOf.get(`${a} ${b}`) === faceOf.get(`${b} ${a}`)) bridges.push(k);
  return { cycles, bridges };
}

/** The cycles as regions: counter-clockwise ones are regions, clockwise ones holes in the least region round them. */
function collect(
  pts: readonly P2[],
  edges: Map<string, [number, number]>,
  cycles: number[][],
  into: Region[],
  straight: boolean,
): void {
  // Which connected drawing each point is in.
  const root = pts.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
  for (const [a, b] of edges.values()) root[find(a)] = find(b);
  const loops = cycles.map((c) => {
    const l = c.map((i) => pts[i]!);
    return { l, a: area2(l), part: find(c[0]!) };
  });
  const regions = loops.filter((x) => x.a > 0).map((x) => ({ ...x, holes: [] as P2[][] }));
  for (const x of loops)
    if (x.a < 0) {
      let best: (typeof regions)[number] | null = null;
      for (const r of regions)
        if (r.part !== x.part && inside(x.l[0]!, r.l) && (!best || r.a < best.a)) best = r;
      best?.holes.push(x.l);
    }
  for (const r of regions) {
    const tidy = straight ? straighten : (l: P2[]) => l;
    const outer = tidy(r.l);
    if (outer.length < 3) continue;
    const holes = r.holes.map(tidy).filter((h) => h.length >= 3);
    const area = area2(outer) + holes.reduce((s, h) => s + area2(h), 0);
    into.push({ outer, holes, area });
  }
}

/** A loop without its points in the middle of straight runs (where other lines met it). */
function straighten(l: readonly P2[]): P2[] {
  const out = [...l];
  for (let changed = true; changed && out.length > 3;) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i - 1 + out.length) % out.length]!;
      const b = out[i]!;
      const c = out[(i + 1) % out.length]!;
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (Math.abs(cross) <= 1e-9 * len * len && dot > 0) {
        out.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return out;
}

/** A point well inside a region (out of its holes): the middle of its biggest triangle. */
function within(r: Region): P2 {
  const loops = [r.outer, ...r.holes];
  const all = loops.flat();
  const holes: number[] = [];
  let n = 0;
  for (const [i, l] of loops.entries()) {
    if (i > 0) holes.push(n);
    n += l.length;
  }
  const idx = earcut(all.flat(), holes);
  let best: P2 = r.outer[0]!;
  let most = -1;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [all[idx[t]!]!, all[idx[t + 1]!]!, all[idx[t + 2]!]!];
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (area > most) {
      most = area;
      best = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    }
  }
  return best;
}

/**
 * Faces lying in one plane joined into as few as can be (new: B on laminas, a plan's
 * rooms and walls made one): the lines between them go, overlaps count once, and
 * what doesn't touch stays apart. Each part's outline is counter-clockwise, its holes
 * clockwise; so are the regions given back.
 */
export function joinRegions(parts: readonly { outer: P2[]; holes: P2[][] }[]): Region[] {
  const closed = (l: readonly P2[]) => [...l, l[0]!];
  const lines = parts.flatMap((p) => [p.outer, ...p.holes].map(closed));
  // Every piece the parts' outlines cut the plane into, and which of them a part covers.
  const covered = (r: Region) => {
    const q = within(r);
    return parts.some((p) => inside(q, p.outer) && !p.holes.some((h) => inside(q, h)));
  };
  const pieces = planRegions(lines, false).regions.filter(covered);
  // Their sides, but those two of them share: what is left goes round the whole.
  const key = (a: P2, b: P2) => `${a[0]},${a[1]} ${b[0]},${b[1]}`;
  const sides = new Map<string, [P2, P2]>();
  for (const r of pieces)
    for (const l of [r.outer, ...r.holes])
      l.forEach((a, i) => {
        const b = l[(i + 1) % l.length]!;
        const back = key(b, a);
        if (sides.has(back)) sides.delete(back);
        else sides.set(key(a, b), [a, b]);
      });
  // (A hole left is a region of its own there too: not one of theirs.)
  return planRegions([...sides.values()]).regions.filter(covered);
}
