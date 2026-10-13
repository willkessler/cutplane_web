import { describe, expect, it } from 'vitest';
import { P } from '@cutplane/cpl';
import { createCube, createObject, mat4 } from '@cutplane/kernel';
import { fitToRoom, grouper, readGltf, readStl, writeGlb, writeStl } from '@cutplane/formats';
import { world } from './world.ts';

/** A 100-unit box at (x, 0, 0) as an STL file and back: what an import hands the world. */
const imported = (x: number) => {
  const box = createObject(createCube(100, 100, 100), { xform: mat4.translation(x, -50, -50) });
  const objs = readStl(writeStl([box]));
  fitToRoom(objs);
  return objs;
};

describe('objects imported from mesh files', () => {
  it('join the world as one undoable step, and can be picked and moved like any other', () => {
    const { rt, controls, frame, at, move } = world();
    const edits = rt.journal.edits;
    const [box] = imported(250);
    rt.addObjects([box!]);
    expect(box!.parent).toBe(rt.primary.root);
    expect(rt.vm.props.has(box!, P.Visible)).toBe(true);
    expect(rt.journal.edits).toBe(edits + 1);
    // Grab it at its middle and move it.
    at(300, 0, 0);
    controls.pressPick(false);
    frame();
    expect(rt.picked()).toContain(box);
    move(3, 0);
    move(40, 0);
    controls.releasePick();
    frame();
    expect(rt.bbox(box!)![0][0]).toBeCloseTo(293);
    // Undo the move, then the import: it leaves; redo brings it back whole.
    rt.undo();
    rt.undo();
    expect(box!.parent?.children.includes(box!) ?? false).toBe(false);
    rt.redo();
    expect(box!.parent).toBe(rt.primary.root);
    expect(rt.vm.props.has(box!, P.Visible)).toBe(true);
  });

  it('a glTF group comes in under a grouper: picking one part picks the group', async () => {
    const { rt, controls, frame, at } = world();
    const a = createObject(createCube(60, 60, 60), { name: 'a', xform: mat4.translation(200, -30, -30) }); // prettier-ignore
    const b = createObject(createCube(60, 60, 60), { name: 'b', xform: mat4.translation(300, -30, -30) }); // prettier-ignore
    // Written as a node with no mesh holding two (as Blender writes a group), read back.
    const [g] = await readGltf(await writeGlb([grouper('Holder', [a, b])]));
    expect(g!.name).toBe('Holder');
    expect(g!.attrs.props).toContain('Grouper');
    expect(g!.children.map((c) => c.name)).toEqual(['a', 'b']);
    rt.addObjects([g!]);
    at(330, 0, 0);
    controls.pressPick(false);
    frame();
    expect(rt.picked()).toContain(g);
    controls.releasePick();
    frame();
  });
});
