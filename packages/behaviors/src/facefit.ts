import { mat4, type Mat4 } from '@cutplane/kernel';
import type { V3 } from './runtime.ts';

/** How near (radians) an edge must be to parallel for the magnet to square it up. */
export const TWIST_STOP = Math.PI / 36;

type P2 = [number, number];

/**
 * New here, for the magnet: once a face lies flush on another, where it settles in
 * their plane. `src` is the face's outline as it lies now, `tgt` the other's, `n` the
 * other's normal; both outlines are in its plane. Faces alike (a copy's, mirrored or
 * not) fit corner on corner, at the fit nearest the face's twist now. Others stop
 * where an edge comes square to one of the other's (within TWIST_STOP, turning about
 * `pivot`), then where the centres meet, a corner meets a corner, or edges fall in
 * line, if that is within `reach`. The world move that does it, or null to stay.
 */
export function faceFit(
  src: readonly V3[],
  tgt: readonly V3[],
  n: V3,
  pivot: V3,
  reach: number,
): Mat4 | null {
  if (src.length < 3 || tgt.length < 3) return null;
  // The plane's own axes, u × v = n, origin on the pivot.
  const a: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(a, n));
  const v = cross(n, u);
  const flat = (p: V3): P2 => {
    const d: V3 = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
    return [dot(d, u), dot(d, v)];
  };
  const s = src.map(flat);
  const t = tgt.map(flat);
  const fit = alike(s, t) ?? stops(s, t, reach);
  if (!fit) return null;
  const [angle, [dx, dy]] = fit;
  const turn = Math.abs(angle) < 1e-12 ? mat4.identity() : mat4.rotationAbout(pivot, n, angle);
  const move = mat4.translation(...add(scale(u, dx), scale(v, dy)));
  return mat4.multiply(turn, move);
}

/** A turn about the pivot and then a move, in the plane. */
type Fit = [number, P2];

/** Outlines alike: the fit, of all that lay one on the other, turning the least. */
function alike(s: P2[], t: P2[]): Fit | null {
  const n = s.length;
  if (n !== t.length) return null;
  const size = Math.max(diameter(t), 1e-9);
  const tol = size * 1e-4;
  if (Math.abs(Math.abs(area(s)) - Math.abs(area(t))) > size * tol) return null;
  let best: Fit | null = null;
  for (const order of [s, [...s].reverse()]) {
    for (let k = 0; k < n; k++) {
      const pairs = order.map((p, i) => [p, t[(i + k) % n]!] as const);
      const cs = mean(pairs.map((q) => q[0]));
      const ct = mean(pairs.map((q) => q[1]));
      let c = 0;
      let sn = 0;
      for (const [p, q] of pairs) {
        const px = p[0] - cs[0], py = p[1] - cs[1]; // prettier-ignore
        const qx = q[0] - ct[0], qy = q[1] - ct[1]; // prettier-ignore
        c += px * qx + py * qy;
        sn += px * qy - py * qx;
      }
      const angle = Math.atan2(sn, c);
      const r = rot(cs, angle);
      const d: P2 = [ct[0] - r[0], ct[1] - r[1]];
      const off = pairs.some(([p, q]) => {
        const m = rot(p, angle);
        return Math.hypot(m[0] + d[0] - q[0], m[1] + d[1] - q[1]) > tol;
      });
      if (off) continue;
      if (!best || Math.abs(angle) < Math.abs(best[0]) - 1e-9) best = [angle, d];
    }
  }
  return best;
}

/** Outlines not alike: square an edge up, then the nearest stop in reach. */
function stops(s0: P2[], t: P2[], reach: number): Fit | null {
  // The turn: the least that squares an edge up with one of the other's.
  let angle = 0;
  let least = TWIST_STOP;
  for (const es of edges(s0))
    for (const et of edges(t)) {
      let d = Math.atan2(et[1], et[0]) - Math.atan2(es[1], es[0]);
      d -= Math.PI * Math.round(d / Math.PI); // parallel either way
      if (Math.abs(d) < least) [least, angle] = [Math.abs(d), d];
    }
  const s = s0.map((p) => rot(p, angle));
  // Stops that fix both ways: the centres, a corner on a corner.
  const both: P2[] = [sub(centroid(t), centroid(s))];
  for (const p of s) for (const q of t) both.push(sub(q, p));
  // Stops that fix one way: an edge in line with one of the other's.
  const lines: { across: P2; by: number }[] = [];
  const se = sides(s);
  for (const [q0, dq] of sides(t)) {
    const across: P2 = [-dq[1], dq[0]];
    for (const [p0, dp] of se) {
      if (Math.abs(dp[0] * across[0] + dp[1] * across[1]) > 1e-6) continue;
      lines.push({ across, by: (q0[0] - p0[0]) * across[0] + (q0[1] - p0[1]) * across[1] });
    }
  }
  // Two lines not parallel fix both ways too, at the move that meets both.
  const near = lines.filter((l) => Math.abs(l.by) < reach).sort((x, y) => Math.abs(x.by) - Math.abs(y.by)); // prettier-ignore
  const first = near[0];
  if (first) {
    const second = near.find((l) => Math.abs(l.across[0] * first.across[1] - l.across[1] * first.across[0]) > 1e-6); // prettier-ignore
    if (second) both.push(meet(first, second));
  }
  const nearest = (ds: P2[]) => ds.filter((d) => Math.hypot(...d) < reach).sort((x, y) => Math.hypot(...x) - Math.hypot(...y))[0]; // prettier-ignore
  const d = nearest(both) ?? (first ? scale2(first.across, first.by) : undefined);
  if (!d && Math.abs(angle) < 1e-12) return null;
  return [angle, d ?? [0, 0]];
}

/** The move putting two edges' lines (each `by` along its unit `across`) in line at once. */
function meet(a: { across: P2; by: number }, b: { across: P2; by: number }): P2 {
  const det = a.across[0] * b.across[1] - a.across[1] * b.across[0];
  return [
    (a.by * b.across[1] - b.by * a.across[1]) / det,
    (a.across[0] * b.by - b.across[0] * a.by) / det,
  ];
}

/** Each edge's direction. */
const edges = (ps: P2[]): P2[] => sides(ps).map((e) => e[1]);

/** Each edge's start and unit direction (edges of no length left out). */
function sides(ps: P2[]): [P2, P2][] {
  const out: [P2, P2][] = [];
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    const d = sub(ps[(i + 1) % ps.length]!, p);
    const l = Math.hypot(...d);
    if (l > 1e-9) out.push([p, [d[0] / l, d[1] / l]]);
  }
  return out;
}

function area(ps: P2[]): number {
  let a = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    const q = ps[(i + 1) % ps.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** The centre of the area (the corners' mean, for an outline of no area). */
function centroid(ps: P2[]): P2 {
  const a = area(ps);
  if (Math.abs(a) < 1e-12) return mean(ps);
  let x = 0;
  let y = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    const q = ps[(i + 1) % ps.length]!;
    const c = p[0] * q[1] - q[0] * p[1];
    x += (p[0] + q[0]) * c;
    y += (p[1] + q[1]) * c;
  }
  return [x / (6 * a), y / (6 * a)];
}

function diameter(ps: P2[]): number {
  let d = 0;
  for (const p of ps) for (const q of ps) d = Math.max(d, Math.hypot(p[0] - q[0], p[1] - q[1]));
  return d;
}

const mean = (ps: readonly P2[]): P2 => [
  ps.reduce((s, p) => s + p[0], 0) / ps.length,
  ps.reduce((s, p) => s + p[1], 0) / ps.length,
];
const rot = (p: P2, a: number): P2 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)]; // prettier-ignore
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const scale2 = (a: P2, k: number): P2 => [a[0] * k, a[1] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; // prettier-ignore
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V3): V3 => scale(a, 1 / Math.hypot(...a));
