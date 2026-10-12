import { describe, expect, it } from 'vitest';
import { readCut, writeCut } from '@cutplane/formats';
import { createCube, createObject, mat4, type CutObject } from '@cutplane/kernel';
import { COLOR_CRTNS, installToolboxes } from '../src/index.ts';
import { source, world } from './world.ts';

/** Picks a primitive out of the opened primitives box (the plane through the boxes). */
function stampCube(w: ReturnType<typeof world>, prims: CutObject): CutObject {
  const Z = -490;
  const click = (o: CutObject) => {
    const b = w.rt.bbox(o)!;
    w.at((b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, Z);
    w.controls.pressPick(false);
    w.frame();
    w.controls.releasePick();
    w.frame();
    w.frame();
  };
  if (!w.rt.hasProp(prims, 'Toolboxopen')) click(prims);
  const cube = prims.children.find((c) => w.rt.hasProp(c, 'Stamp'))!;
  const before = w.rt.bbox(cube)!;
  click(cube);
  const copy = w.rt.picked()[0] as CutObject;
  return Object.assign(copy, { _origin: before });
}

describe('CPL is live: code in the running world and in saved objects', () => {
  it('editing stamp.cpl while it runs changes stamping from the next pick on', () => {
    const w = world();
    w.rt.registerCrtns(COLOR_CRTNS);
    const { prims } = installToolboxes(w.rt, source);
    const first = stampCube(w, prims);
    const from = (first as CutObject & { _origin: [number[], number[]] })._origin;
    expect(w.rt.bbox(first)![0][1]).toBeCloseTo(from[0]![1]!);

    // Stamped copies now come out 300 higher.
    const text = w.rt.propertySource('stamp.cpl')!;
    const edited = text.replace(
      /(\tDUP\tA:R1\*,A:R2\s*\n)/,
      '$1\t\tTRANS\tA:R2*,Const:Normaltranslate,Const:V[0.0,300.0,0.0]\n',
    );
    expect(edited).not.toBe(text);
    expect(w.rt.setPropertyCode('stamp.cpl', edited)).toBeNull();
    expect(w.rt.propertySource('stamp.cpl')).toBe(edited);
    const second = stampCube(w, prims);
    const from2 = (second as CutObject & { _origin: [number[], number[]] })._origin;
    expect(w.rt.bbox(second)![0][1]).toBeCloseTo(from2[0]![1]! + 300);

    // A broken edit is refused, and stamping goes on as it was.
    const err = w.rt.setPropertyCode('stamp.cpl', `${edited}\n\t\tNOSUCHOP\tA:R1\n`);
    expect(err?.errors.length).toBeGreaterThan(0);
    const third = stampCube(w, prims);
    const from3 = (third as CutObject & { _origin: [number[], number[]] })._origin;
    expect(w.rt.bbox(third)![0][1]).toBeCloseTo(from3[0]![1]! + 300);
  });

  it('a saved object carries its private code into a fresh session', () => {
    // An object that hops up 50 when it is picked.
    const CODE = [
      'Hopper\tBWIPED\tAA:XOP*,A:_Hop_end&',
      '\t\tBNEQUAL\tAA:XOP*,Opcd:PICK,A:_Hop_end&',
      '\t\tOWNER\tA:R1,Const:Self',
      '\t\tTRANS\tA:R1*,Const:Normaltranslate,Const:V[0.0,50.0,0.0]',
      '\t\tWIPE\tA:XOP*',
      '_Hop_end\tRTS',
      '',
    ].join('\n');
    const a = world();
    const hopper = createObject(createCube(100, 100, 100), {
      name: 'Hopper',
      xform: mat4.translation(200, -50, -50),
    });
    a.rt.importObjects(a.rt.primary, [hopper]);
    expect(a.rt.setPrivateCode(hopper, CODE, 'hopper.cpl')).toBeNull();
    const text = writeCut({
      title: 'hop',
      contains: 'World',
      name: null,
      roots: a.rt.documentRoots(),
    });
    expect(text).toContain('Object CPL private code');

    // A new runtime, as a fresh session would have, loading the file.
    const b = world();
    const loaded = readCut(text).doc.roots.find((o) => o.name === 'Hopper')!;
    b.rt.importObjects(b.rt.primary, [loaded]);
    const y0 = b.rt.bbox(loaded)![0][1];
    b.at(250, 0, 0);
    b.controls.pressPick(false);
    b.frame();
    b.controls.releasePick();
    b.frame();
    expect(b.rt.bbox(loaded)![0][1]).toBeCloseTo(y0 + 50);
  });
});
