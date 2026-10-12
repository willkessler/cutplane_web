import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Brep,
  NONE,
  createCube,
  kef,
  kemr,
  kev,
  kfmrh,
  makeLamina,
  mef,
  mekr,
  mev,
  mfkrh,
  mvfs,
  kvfs,
  validate,
} from '../src/index.ts';

function counts(b: Brep) {
  return {
    V: b.numVertices,
    E: b.numEdges,
    F: b.numFaces,
    L: b.numLoops,
    S: b.numShells,
    H: b.numHalfEdges,
  };
}

/** V − E + F − (L − F) − 2S: constant (−2H) under every Euler operator except kfmrh/mfkrh. */
function eulerDefect(b: Brep): number {
  const { V, E, F, L, S } = counts(b);
  return V - E + F - (L - F) - 2 * S;
}

function expectValid(b: Brep, closed = true) {
  const r = validate(b);
  expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  expect(r.ok).toBe(true);
  if (closed) expect(r.closedManifold).toBe(true);
}

describe('mvfs / kvfs', () => {
  it('makes and kills a single-vertex shell', () => {
    const b = new Brep();
    const { shell } = mvfs(b, 1, 2, 3);
    expect(counts(b)).toEqual({ V: 1, E: 0, F: 1, L: 1, S: 1, H: 1 });
    expect(eulerDefect(b)).toBe(0);
    expectValid(b, false);
    kvfs(b, shell);
    expect(counts(b)).toEqual({ V: 0, E: 0, F: 0, L: 0, S: 0, H: 0 });
  });
});

describe('mev / kev', () => {
  it('grows a wire and shrinks it back', () => {
    const b = new Brep();
    const { he } = mvfs(b, 0, 0, 0);
    let h = he;
    const made: { edge: number; vertex: number }[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = mev(b, h, h, i * 10, 0, 0);
      made.push(r);
      h = r.he;
      expect(eulerDefect(b)).toBe(0);
      expectValid(b, false);
    }
    expect(counts(b)).toMatchObject({ V: 6, E: 5, F: 1, L: 1 });
    for (const { edge, vertex } of made.reverse()) {
      kev(b, edge, vertex);
      expectValid(b, false);
    }
    expect(counts(b)).toMatchObject({ V: 1, E: 0, F: 1, L: 1, H: 1 });
  });
});

describe('mef / kef', () => {
  it('closes a wire into a lamina, which is a closed 2-manifold', () => {
    const b = new Brep();
    const { front, back } = makeLamina(b, [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]); // prettier-ignore
    expect(counts(b)).toMatchObject({ V: 4, E: 4, F: 2, L: 2 });
    expectValid(b);
    expect(b.faceNormal(front)).toEqual([0, 0, 1]);
    expect(b.faceNormal(back)).toEqual([0, 0, -1]);
  });

  it('splits and re-merges a cube face', () => {
    const b = createCube(10, 10, 10);
    const before = counts(b);
    const f = b.faces()[0]!;
    const hs = b.loopHalfEdges(b.faceLoop(f));
    const { edge, face } = mef(b, hs[0]!, hs[2]!);
    expect(counts(b)).toMatchObject({ E: before.E + 1, F: before.F + 1 });
    expectValid(b);
    kef(b, edge, face);
    expect(counts(b)).toEqual(before);
    expectValid(b);
  });
});

describe('kemr / mekr and kfmrh / mfkrh', () => {
  it('turns a strut into a ring and back', () => {
    const b = createCube(10, 10, 10);
    const before = counts(b);
    const f = b.faces()[0]!;
    const h = b.loopHe(b.faceLoop(f));
    const strut = mev(b, h, h, 5, 5, 0);
    const ring = kemr(b, strut.edge, strut.he);
    expect(b.loopNext(b.faceLoop(f))).toBe(ring);
    expect(eulerDefect(b)).toBe(0);
    expectValid(b, false); // a lone ring vertex isn't a closed surface
    const e = mekr(b, b.loopHe(b.faceLoop(f)), b.loopHe(ring));
    expectValid(b);
    kev(b, e, strut.vertex);
    expect(counts(b)).toEqual(before);
    expectValid(b);
  });

  it('makes a face a hole of another and back', () => {
    const b = new Brep();
    const outer = makeLamina(b, [[0, 0, 0], [30, 0, 0], [30, 30, 0], [0, 30, 0]]); // prettier-ignore
    const h = b.loopHe(b.faceLoop(outer.front));
    const strut = mev(b, h, h, 10, 10, 0);
    const ring = kemr(b, strut.edge, strut.he);
    let w = b.loopHe(ring);
    for (const [x, y] of [[20, 10], [20, 20], [10, 20]] as const) w = mev(b, w, w, x, y, 0).he; // prettier-ignore
    const { face: plug } = mef(b, w, b.loopHe(ring));
    expectValid(b);
    const before = counts(b);
    kfmrh(b, outer.back, plug);
    expect(counts(b)).toMatchObject({ F: before.F - 1, L: before.L });
    expectValid(b);
    const holes = b.faceLoops(outer.back);
    expect(holes).toHaveLength(2);
    mfkrh(b, holes[1]!);
    expect(counts(b)).toEqual(before);
    expectValid(b);
  });
});

describe('random Euler sequences (property)', () => {
  type Step = { kind: 'strut' | 'split'; a: number; c: number };
  const step = fc.record({
    kind: fc.constantFrom<'strut' | 'split'>('strut', 'split'),
    a: fc.nat(),
    c: fc.nat(),
  });

  it('keep the Brep valid and are exactly undone by their inverses', () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 25 }), (steps: Step[]) => {
        const b = createCube(64, 64, 64);
        const start = counts(b);
        const undo: (() => void)[] = [];
        for (const s of steps) {
          const hes = b.halfEdges();
          const h = hes[s.a % hes.length]!;
          if (s.kind === 'strut') {
            const [x, y, z] = b.vertexPos(b.heVertex(h));
            const r = mev(b, h, h, x + 1, y + 1, z + 1);
            undo.push(() => kev(b, r.edge, r.vertex));
          } else {
            const ring = b.loopHalfEdges(b.heLoop(h));
            if (ring.length < 4) continue;
            const at = ring.indexOf(h);
            const other = ring[(at + 2 + (s.c % (ring.length - 3))) % ring.length]!;
            const r = mef(b, h, other);
            undo.push(() => kef(b, r.edge, r.face));
          }
          expect(eulerDefect(b)).toBe(0);
          expect(validate(b).ok).toBe(true);
        }
        for (const u of undo.reverse()) {
          u();
          expect(validate(b).ok).toBe(true);
        }
        expect(counts(b)).toEqual(start);
        expect(validate(b).closedManifold).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe('vertex bookkeeping', () => {
  it('every live vertex points at a half-edge that starts there', () => {
    const b = createCube(5, 5, 5);
    for (const v of b.vertices()) {
      const h = b.vertexHe(v);
      expect(h).not.toBe(NONE);
      expect(b.heVertex(h)).toBe(v);
    }
  });
});
