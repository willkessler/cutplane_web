import { Brep, NONE } from './brep.ts';

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
}

export interface ShellStats {
  shell: number;
  vertices: number;
  edges: number;
  faces: number;
  loops: number;
  /** V − E + F − (L − F). Equals 2 − 2·genus for a closed orientable shell. */
  euler: number;
  closedManifold: boolean;
}

export interface ValidationReport {
  /** No structural (pointer/topology consistency) errors. */
  ok: boolean;
  /** ok, and every shell is a closed, consistently oriented 2-manifold. */
  closedManifold: boolean;
  issues: Issue[];
  shells: ShellStats[];
  counts: Record<string, number>;
}

export interface ValidateOptions {
  /** Max distance (local units) of a vertex from its face's plane. Default 0.05. */
  planarityTolerance?: number;
  /** Report at most this many issues of each code (counts are always complete). */
  maxIssuesPerCode?: number;
}

/**
 * Checks a Brep. Structural problems (broken links, dangling references,
 * loops that don't close) are errors: the model must never be left with one.
 * Manifold and geometric problems (open or misoriented edges, non-manifold
 * vertices, zero-length edges, degenerate or non-planar faces, impossible
 * Euler characteristic) are warnings: legacy files and laminas can have them,
 * and they are reported so booleans can refuse such shells.
 */
export function validate(b: Brep, opts: ValidateOptions = {}): ValidationReport {
  const tol = opts.planarityTolerance ?? 0.05;
  const cap = opts.maxIssuesPerCode ?? 20;
  const issues: Issue[] = [];
  const counts: Record<string, number> = {};
  const report = (severity: Severity, code: string, message: string) => {
    counts[code] = (counts[code] ?? 0) + 1;
    if (counts[code]! <= cap) issues.push({ severity, code, message });
  };
  const err = (code: string, msg: string) => report('error', code, msg);
  const warn = (code: string, msg: string) => report('warning', code, msg);

  // ---- structure ----
  for (const h of b.halfEdges()) {
    const n = b.heNext(h);
    const p = b.hePrev(h);
    if (!b.isHalfEdge(n) || !b.isHalfEdge(p)) {
      err('dangling-link', `half-edge ${h}: next/prev not alive`);
      continue;
    }
    if (b.hePrev(n) !== h || b.heNext(p) !== h)
      err('broken-link', `half-edge ${h}: next/prev mismatch`);
    if (!b.isLoop(b.heLoop(h))) err('dangling-loop', `half-edge ${h}: loop not alive`);
    else if (b.heLoop(n) !== b.heLoop(h))
      err('mixed-loop', `half-edge ${h}: next is in another loop`);
    if (!b.isVertex(b.heVertex(h))) err('dangling-vertex', `half-edge ${h}: vertex not alive`);
    const e = b.heEdge(h);
    if (e === NONE) {
      if (n !== h) err('missing-edge', `half-edge ${h}: no edge but not a lone half-edge`);
    } else if (!b.isEdge(e)) err('dangling-edge', `half-edge ${h}: edge not alive`);
    else if (b.edgeHe1(e) !== h && b.edgeHe2(e) !== h)
      err('edge-backlink', `half-edge ${h}: edge ${e} doesn't point back`);
  }
  for (const e of b.edges()) {
    const h1 = b.edgeHe1(e);
    const h2 = b.edgeHe2(e);
    if (!b.isHalfEdge(h1) || b.heEdge(h1) !== e) {
      err('edge-he', `edge ${e}: he1 invalid`);
      continue;
    }
    if (h2 === NONE) {
      warn('boundary-edge', `edge ${e}: has only one face (open shell)`);
      continue;
    }
    if (!b.isHalfEdge(h2) || b.heEdge(h2) !== e || h1 === h2) {
      err('edge-he', `edge ${e}: he2 invalid`);
      continue;
    }
    const a1 = b.heVertex(h1);
    const a2 = b.heVertex(b.heNext(h1));
    const c1 = b.heVertex(h2);
    const c2 = b.heVertex(b.heNext(h2));
    if (a1 === c2 && a2 === c1) {
      // properly opposed
    } else if (a1 === c1 && a2 === c2)
      warn('misoriented-edge', `edge ${e}: faces disagree on orientation`);
    else err('edge-endpoints', `edge ${e}: halves have different endpoints`);
    if (a1 === a2) warn('zero-length-edge', `edge ${e}: both ends are the same vertex`);
    else {
      const [x1, y1, z1] = b.vertexPos(a1);
      const [x2, y2, z2] = b.vertexPos(a2);
      if (x1 === x2 && y1 === y2 && z1 === z2)
        warn('zero-length-edge', `edge ${e}: endpoints coincide`);
    }
  }
  for (const l of b.loops()) {
    const f = b.loopFace(l);
    if (!b.isFace(f)) {
      err('loop-face', `loop ${l}: face not alive`);
      continue;
    }
    if (!b.faceLoops(f).includes(l)) err('loop-face', `loop ${l}: not listed by face ${f}`);
    const h0 = b.loopHe(l);
    if (!b.isHalfEdge(h0) || b.heLoop(h0) !== l) {
      err('loop-he', `loop ${l}: first half-edge invalid`);
      continue;
    }
    let h = h0;
    let n = 0;
    do {
      h = b.heNext(h);
      n++;
    } while (h !== h0 && b.isHalfEdge(h) && n <= b.numHalfEdges);
    if (h !== h0) err('open-loop', `loop ${l}: does not close`);
  }
  for (const f of b.faces()) {
    if (!b.isShell(b.faceShell(f))) err('face-shell', `face ${f}: shell not alive`);
    if (b.faceLoop(f) === NONE) err('empty-face', `face ${f}: no loops`);
  }
  for (const v of b.vertices()) {
    if (!b.isShell(b.vertexShell(v))) err('vertex-shell', `vertex ${v}: shell not alive`);
    const h = b.vertexHe(v);
    if (h === NONE) warn('isolated-vertex', `vertex ${v}: used by no face`);
    else if (!b.isHalfEdge(h) || b.heVertex(h) !== v)
      err('vertex-he', `vertex ${v}: half-edge invalid`);
  }
  for (const h of b.halfEdges()) {
    const v = b.heVertex(h);
    const s = b.faceShell(b.heFace(h));
    if (b.isVertex(v) && b.vertexShell(v) !== s)
      err('cross-shell', `half-edge ${h}: vertex in another shell`);
  }

  const structuralOk =
    issues.every((i) => i.severity !== 'error') && !Object.keys(counts).some(isErrorCode);

  // ---- manifold-ness and geometry (only meaningful if the structure holds) ----
  const shells: ShellStats[] = [];
  if (structuralOk) {
    const badShell = new Set<number>();
    const outgoing = new Map<number, number>();
    for (const h of b.halfEdges())
      outgoing.set(b.heVertex(h), (outgoing.get(b.heVertex(h)) ?? 0) + 1);
    for (const e of b.edges()) {
      const h1 = b.edgeHe1(e);
      const h2 = b.edgeHe2(e);
      const s = b.faceShell(b.heFace(h1));
      if (h2 === NONE || b.heVertex(h1) === b.heVertex(h2)) badShell.add(s);
    }
    for (const v of b.vertices()) {
      const h0 = b.vertexHe(v);
      if (h0 === NONE) continue;
      let h = h0;
      let n = 0;
      let open = false;
      do {
        const m = b.heMate(h);
        if (m === NONE || b.heVertex(m) === v) {
          open = true;
          break;
        }
        h = b.heNext(m);
        n++;
      } while (h !== h0 && n <= b.numHalfEdges);
      if (open) badShell.add(b.vertexShell(v));
      else if (n !== outgoing.get(v)) {
        warn('nonmanifold-vertex', `vertex ${v}: faces around it form more than one fan`);
        badShell.add(b.vertexShell(v));
      }
    }
    for (const f of b.faces()) {
      const n = b.loopNormal(b.faceLoop(f));
      const len = Math.hypot(...n);
      if (len < 1e-9) {
        warn('degenerate-face', `face ${f}: zero area`);
        continue;
      }
      const [nx, ny, nz] = [n[0] / len, n[1] / len, n[2] / len];
      const h0 = b.loopHe(b.faceLoop(f));
      const [ox, oy, oz] = b.vertexPos(b.heVertex(h0));
      let worst = 0;
      for (const l of b.faceLoops(f))
        for (const h of b.loopHalfEdges(l)) {
          const [x, y, z] = b.vertexPos(b.heVertex(h));
          worst = Math.max(worst, Math.abs((x - ox) * nx + (y - oy) * ny + (z - oz) * nz));
        }
      if (worst > tol) warn('nonplanar-face', `face ${f}: off its plane by ${worst.toFixed(3)}`);
    }
    for (const s of b.shells()) {
      const fs = b.faces(s);
      const vs = b.vertices(s).filter((v) => b.vertexHe(v) !== NONE);
      const es = new Set<number>();
      let loops = 0;
      for (const f of fs)
        for (const l of b.faceLoops(f)) {
          loops++;
          for (const h of b.loopHalfEdges(l)) if (b.heEdge(h) !== NONE) es.add(b.heEdge(h));
        }
      const euler = vs.length - es.size + fs.length - (loops - fs.length);
      let closed = !badShell.has(s) && fs.length > 0;
      if (closed && (euler > 2 || (2 - euler) % 2 !== 0)) {
        warn(
          'euler-characteristic',
          `shell ${s}: V−E+F−R = ${euler} is impossible for a closed shell`,
        );
        closed = false;
      }
      shells.push({
        shell: s,
        vertices: vs.length,
        edges: es.size,
        faces: fs.length,
        loops,
        euler,
        closedManifold: closed,
      });
    }
  }

  return {
    ok: structuralOk,
    closedManifold: structuralOk && shells.length > 0 && shells.every((s) => s.closedManifold),
    issues,
    shells,
    counts,
  };
}

const ERROR_CODES = new Set([
  'dangling-link', 'broken-link', 'dangling-loop', 'mixed-loop', 'dangling-vertex', 'missing-edge',
  'dangling-edge', 'edge-backlink', 'edge-he', 'edge-endpoints', 'loop-face', 'loop-he', 'open-loop',
  'face-shell', 'empty-face', 'vertex-shell', 'vertex-he', 'cross-shell',
]); // prettier-ignore

function isErrorCode(code: string): boolean {
  return ERROR_CODES.has(code);
}

/** Throws if the Brep has structural errors (use in tests and after every operation). */
export function assertValid(b: Brep): void {
  const r = validate(b);
  if (!r.ok) {
    const errs = r.issues.filter((i) => i.severity === 'error');
    throw new Error(`invalid Brep: ${errs.map((i) => i.message).join('; ')}`);
  }
}
