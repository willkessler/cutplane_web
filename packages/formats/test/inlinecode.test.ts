import { describe, expect, it } from 'vitest';
import { createCube, createObject } from '@cutplane/kernel';
import { readCut, writeCut } from '../src/index.ts';

const CODE = `; a comment, then a blank line

Mine\tOWNER\tA:R1,Const:Self
\t\tRTS
`;

describe('inline CPL private code (new)', () => {
  it('round-trips an object’s and a face’s code verbatim: tabs, labels, blank lines', () => {
    const o = createObject(createCube(10, 10, 10), { name: 'Coded' });
    o.attrs.privateSource = CODE;
    const face = o.brep.faces()[2]!;
    o.brep.faceAttrs.set(face, { props: [], privateSource: '\t\tRTS\n' });
    const text = writeCut({ title: 't', contains: 'World', name: null, roots: [o] });
    expect(text).toContain('Object CPL private code:4 lines');
    const back = readCut(text).doc.roots[0]!;
    expect(back.attrs.privateSource).toBe(CODE);
    const coded = [...back.brep.faceAttrs.values()].filter((a) => a.privateSource !== undefined);
    expect(coded.map((a) => a.privateSource)).toEqual(['\t\tRTS\n']);
    // And again, byte for byte.
    expect(writeCut(readCut(text).doc)).toBe(text);
  });

  it('still reads the original’s file references', () => {
    const o = createObject(createCube(10, 10, 10), { name: 'Old' });
    o.brep.vertexAttrs.set(o.brep.vertices()[0]!, {
      props: [],
      privateCode: './cpl/rotatebauble.cpl',
    });
    const back = readCut(writeCut({ title: 't', contains: 'World', name: null, roots: [o] })).doc
      .roots[0]!;
    expect([...back.brep.vertexAttrs.values()][0]!.privateCode).toBe('./cpl/rotatebauble.cpl');
  });
});
