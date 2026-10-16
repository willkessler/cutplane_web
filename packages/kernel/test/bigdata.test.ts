import { describe, expect, it } from 'vitest';
import { Brep, PairMap, createDonut, validate } from '../src/index.ts';

// What reading big files leans on: an edge table without an object an edge, and
// a B-rep handed between threads as its arrays.

describe('PairMap', () => {
  it('maps pairs to values, in the order they were added, through growing', () => {
    const m = new PairMap(4);
    for (let i = 0; i < 5000; i++) m.set(i, i * 7 + 1, i);
    expect(m.size).toBe(5000);
    expect(m.get(1234, 1234 * 7 + 1)).toBe(1234);
    expect(m.get(1234 * 7 + 1, 1234)).toBe(-1); // (b, a) is another pair
    expect(m.has(4999, 4999 * 7 + 1)).toBe(true);
    expect([m.a[3], m.b[3], m.value[3]]).toEqual([3, 22, 3]);
    // add keeps what's there; set replaces it.
    expect(m.add(3, 22, 99)).toBe(3);
    expect(m.get(3, 22)).toBe(3);
    m.set(3, 22, 99);
    expect(m.get(3, 22)).toBe(99);
    expect(m.size).toBe(5000);
  });
});

describe('Brep data', () => {
  it('comes back the same B-rep from its arrays', () => {
    const b = createDonut(10, 8);
    const f = b.faces()[0]!;
    b.faceColors.set(f, [1, 2, 3]);
    const data = b.data();
    expect(Brep.transfer(data).every((x) => x instanceof ArrayBuffer)).toBe(true);
    // As a worker sends it: cloned, its arrays moved.
    const copy = Brep.fromData(structuredClone(data));
    expect(copy.fingerprint()).toBe(b.fingerprint());
    expect(copy.faceColors.get(f)).toEqual([1, 2, 3]);
    expect(validate(copy).closedManifold).toBe(true);
  });
});
