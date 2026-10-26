import { describe, expect, it } from 'vitest';
import { P } from '@cutplane/cpl';
import { preorder, type CutObject } from '@cutplane/kernel';
import {
  COLOR_CRTNS,
  bulbLightOf,
  installHintPlates,
  installRotateTool,
  installToolboxes,
  markRoom,
  restoreRoom,
  snapshotRoom,
  type RoomSnapshot,
} from '../src/index.ts';
import { source, world } from './world.ts';

/** The plane through the boxes, standing by the back wall. */
const Z = -490;

function setup() {
  const w = world();
  w.rt.registerCrtns(COLOR_CRTNS);
  const tool = installRotateTool(w.rt, source);
  const boxes = installToolboxes(w.rt, source);
  markRoom(w.rt);
  w.at(0, 0, Z);
  const center = (o: CutObject): [number, number] => {
    const b = w.rt.bbox(o)!;
    return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  };
  const click = (o: CutObject) => {
    w.at(...center(o), Z);
    w.controls.pressPick(false);
    w.frame();
    w.controls.releasePick();
    w.frame();
    w.frame();
  };
  return { ...w, ...boxes, tool, center, click };
}

const visible = (w: ReturnType<typeof setup>, o: CutObject) => w.rt.vm.props.has(o, P.Visible);
const verts = (o: CutObject) => o.brep.vertices().map((v) => [...o.brep.vertexPos(v)]);

describe('the room kept for the next visit (new)', () => {
  it('a box left open, a goodie out, the rotate tool moved: all come back in a room built afresh', () => {
    const a = setup();
    a.click(a.goodies);
    const bulb = a.goodies.children.find((c) => c.name === 'Lightbulb')!;
    a.at(...a.center(bulb), Z);
    a.controls.pressPick(false);
    a.frame();
    a.move(-250, 0);
    a.controls.releasePick();
    a.frame();
    a.click(a.prims);
    // The rotate tool to the cube (in the plane at the cube's middle).
    a.at(0, 0, 0);
    a.controls.pressPick(false);
    a.frame();
    a.controls.releasePick();
    a.frame();
    a.controls.snapRotateTool();
    a.frame();
    expect(bulb.parent).toBe(a.rt.environment.root);
    expect(a.rt.hasProp(a.prims, 'Toolboxopen')).toBe(true);
    const snap = JSON.parse(JSON.stringify(snapshotRoom(a.rt))) as RoomSnapshot;

    const b = setup();
    const docked = (w: ReturnType<typeof setup>) => [...w.tool.inner.xform, ...verts(w.tool.inner).flat()]; // prettier-ignore
    expect(docked(a)).not.toEqual(docked(b)); // the tool came off its dock
    expect(restoreRoom(b.rt, snap)).toBe(true);
    const bBulb = b.rt.findObject('Lightbulb')!;
    expect(bBulb.parent).toBe(b.rt.environment.root);
    expect(b.center(bBulb)).toEqual(a.center(bulb));
    expect(bulbLightOf(b.rt)).toEqual(bulbLightOf(a.rt));
    expect(b.rt.hasProp(b.prims, 'Toolboxopen')).toBe(true);
    const stamps = (w: ReturnType<typeof setup>) => w.prims.children.filter((c) => w.rt.hasProp(c, 'Stamp')); // prettier-ignore
    expect(stamps(b).every((p) => visible(b, p))).toBe(true);
    expect(b.center(stamps(b)[0]!)).toEqual(a.center(stamps(a)[0]!));
    for (const k of ['inner', 'hbar', 'vbar'] as const) {
      expect([...b.tool[k].xform]).toEqual([...a.tool[k].xform]);
      expect(verts(b.tool[k])).toEqual(verts(a.tool[k]));
    }
    // Every object of the room hangs where it did, in the same order.
    const shape = (w: ReturnType<typeof setup>) =>
      [...preorder(w.rt.environment.root.children)].map((o) => `${o.name}<${o.parent?.name}`);
    expect(shape(b)).toEqual(shape(a));
    // And it works as before: a click shuts the box.
    b.click(b.prims);
    expect(b.rt.hasProp(b.prims, 'Toolboxopen')).toBe(false);
    expect(stamps(b).some((p) => visible(b, p))).toBe(false);
  });

  it('what hangs on the plane, made after the room was noted (the hints plates), comes with it', () => {
    const a = setup();
    a.rt.moveBranch(a.rt.cutplane, [0, 0, -300]);
    const snap = JSON.parse(JSON.stringify(snapshotRoom(a.rt))) as RoomSnapshot;
    const b = setup();
    const plate = installHintPlates(b.rt, { one: [['D', 'duplicate it']] }).get('one')!;
    const off = () => plate.xform[14]! - b.rt.cutplane.xform[14]!;
    const before = off();
    expect(restoreRoom(b.rt, snap)).toBe(true);
    expect(b.rt.cutplane.xform[14]).toBe(a.rt.cutplane.xform[14]);
    expect(off()).toBeCloseTo(before, 9);
  });

  it('a snapshot of another room is turned away, changing nothing', () => {
    const a = setup();
    const snap = snapshotRoom(a.rt)!;
    const b = setup();
    const before = b.rt.version;
    expect(restoreRoom(b.rt, { ...snap, names: `${snap.names}|More` })).toBe(false);
    expect(b.rt.version).toBe(before);
  });

  it('what was dropped in the primitives box comes back in it, and stamps out its own size', () => {
    const a = setup();
    // The cube dropped on the box, at the box's depth.
    a.at(0, 0, 0);
    a.controls.pressPick(false);
    a.frame();
    const [x, y] = a.center(a.prims);
    for (let i = 1; i <= 20; i++) a.move(x / 20, y / 20, Z / 20);
    a.controls.releasePick();
    for (let i = 0; i < 3; i++) a.frame();
    expect(a.cube.parent).toBe(a.prims);
    const snap = JSON.parse(JSON.stringify(snapshotRoom(a.rt))) as RoomSnapshot;
    expect(snap.prims).toHaveLength(1);
    const b = setup();
    expect(restoreRoom(b.rt, snap)).toBe(true);
    const back = b.prims.children.filter((c) => b.rt.hasProp(c, 'Stamp')).slice(5);
    expect(back).toHaveLength(1);
    const prim = back[0]!;
    expect(visible(b, prim)).toBe(false);
    expect(b.rt.hasProp(prim, 'Hideable')).toBe(true);
    expect(verts(prim)).toEqual(verts(a.cube));
    expect([...prim.xform]).toEqual([...a.cube.xform]);
    // Opened, picked: a copy the cube's own size.
    b.click(b.prims);
    expect(visible(b, prim)).toBe(true);
    b.click(prim);
    const copy = b.rt.picked()[0] as CutObject;
    expect(b.rt.worldOf(copy)).toBe(b.rt.primary);
    const bb = b.rt.branchBox(copy)!;
    for (const k of [0, 1, 2]) expect(bb[1][k]! - bb[0][k]!).toBeCloseTo(200, 6);
    // Kept again with nothing dropped in: none come back.
    const none = JSON.parse(JSON.stringify(snapshotRoom(setup().rt))) as RoomSnapshot;
    expect(restoreRoom(b.rt, none)).toBe(true);
    expect(b.prims.children.filter((c) => b.rt.hasProp(c, 'Stamp'))).toHaveLength(5);
  });
});
