import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createCube,
  createOvalCone,
  createOvalCylinder,
  createPyramid,
  createSphere,
  mat4,
  snap,
  validate,
  volume,
  type Brep,
  type Mat4,
} from '@cutplane/kernel';
import {
  booleanSolids,
  initBooleans,
  shellsToBrep,
  sliceSolid,
  solidsOf,
  type BoolOp,
  type Solid,
} from '../src/index.ts';

beforeAll(() => initBooleans());

/** How many random chains to run: BOOL_CHAINS=10000 for the M6 acceptance run. */
const CHAINS = Number(process.env['BOOL_CHAINS'] ?? 300);

const PRIMS: ((s: number) => Brep)[] = [
  (s) => createCube(s, s * 0.8, s * 1.2),
  (s) => createOvalCylinder(s / 2, s / 3, s, 12),
  (s) => createOvalCone(s / 2, s / 2, s, 10),
  (s) => createPyramid(s, s, s),
  (s) => createSphere(s / 2, 8),
];

const solid = fc
  .record({
    kind: fc.integer({ min: 0, max: PRIMS.length - 1 }),
    size: fc.integer({ min: 20, max: 120 }),
    x: fc.integer({ min: -80, max: 80 }),
    y: fc.integer({ min: -80, max: 80 }),
    z: fc.integer({ min: -80, max: 80 }),
    axis: fc.constantFrom<[number, number, number]>(
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
      [1, 1, 0],
      [1, 2, 3],
    ),
    // Mostly square to the room (as most models are), sometimes at any angle.
    turn: fc.oneof(fc.constantFrom(0, 90, 180), fc.integer({ min: 0, max: 359 })),
  })
  .map(({ kind, size, x, y, z, axis, turn }) => {
    const n = Math.hypot(...axis);
    const xform: Mat4 = mat4.multiply(
      mat4.rotationAbout(
        [0, 0, 0],
        [axis[0] / n, axis[1] / n, axis[2] / n],
        (turn * Math.PI) / 180,
      ),
      mat4.translation(snap(x), snap(y), snap(z)),
    );
    return { brep: PRIMS[kind]!(size), xform } as Solid;
  });

const step = fc.oneof(
  fc.record({ op: fc.constantFrom<BoolOp>('union', 'subtract', 'intersect'), with: solid }),
  fc.record({ op: fc.constant('slice' as const), z: fc.integer({ min: -100, max: 100 }) }),
);

/** Corrupt: anything but closed, sound shells (the boolean must refuse rather than give that). */
function corrupt(b: Brep): string | null {
  const r = validate(b);
  if (!r.ok) return 'structure';
  if (!r.closedManifold) return 'not closed';
  const bad = r.issues.find((i) =>
    ['degenerate-face', 'zero-length-edge', 'nonplanar-face', 'nonmanifold-vertex'].includes(
      i.code,
    ),
  );
  return bad ? bad.code : null;
}

describe('property: random boolean chains never leave a corrupt model', () => {
  it(`${CHAINS} chains of 2 to 6 operations on random primitives`, () => {
    let ops = 0;
    let refused = 0;
    let checked = 0;
    let faces = 0;
    fc.assert(
      fc.property(solid, fc.array(step, { minLength: 2, maxLength: 6 }), (start, steps) => {
        let cur: Solid | null = start;
        for (const s of steps) {
          if (!cur) break;
          ops++;
          if (s.op === 'slice') {
            const r = sliceSolid(cur, s.z);
            if (!r) {
              refused++;
              continue; // refused: the model stays as it was
            }
            for (const piece of [...r.back, ...r.front]) {
              const b = shellsToBrep([piece]).brep;
              const why = corrupt(b);
              if (why) throw new Error(`slice gave a ${why} piece`);
              checked++;
              faces += b.faces().length;
            }
            const keep = solidsOf(r.back)[0] ?? solidsOf(r.front)[0];
            cur = keep ? { brep: shellsToBrep(keep).brep, xform: cur.xform } : null;
            continue;
          }
          const r = booleanSolids(cur, s.with, s.op);
          if (!r) {
            refused++;
            continue;
          }
          const before = volume(cur.brep);
          for (const group of solidsOf(r)) {
            const b = shellsToBrep(group).brep;
            const why = corrupt(b);
            if (why) throw new Error(`${s.op} gave a ${why} solid`);
            checked++;
            faces += b.faces().length;
          }
          const after = r.reduce((v, sh) => v + sh.volume, 0);
          // Volume sense: union never shrinks, subtract and intersect never grow (give or
          // take rounding: slivers come back to well under a grid step).
          const slack = 0.1 + 1e-3 * before;
          if (s.op === 'union') expect(after).toBeGreaterThanOrEqual(before - slack);
          else expect(after).toBeLessThanOrEqual(before + slack);
          const first = solidsOf(r)[0];
          cur = first ? { brep: shellsToBrep(first).brep, xform: cur.xform } : null;
        }
      }),
      { numRuns: CHAINS, seed: Number(process.env['BOOL_SEED'] ?? 1991) },
    );
    console.log(
      `boolean chains: ${CHAINS}, operations: ${ops}, refused: ${refused}, solids checked: ${checked}, faces per solid: ${(faces / Math.max(1, checked)).toFixed(1)}`,
    );
    // Refusals are rollbacks, not corruption, but they should be rare.
    expect(refused / ops).toBeLessThan(0.02);
  }, 600_000);
});
