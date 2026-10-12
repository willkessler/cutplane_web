import { describe, expect, it } from 'vitest';
import { P } from '@cutplane/cpl';
import type { CutObject } from '@cutplane/kernel';
import { COLOR_CRTNS, installToolboxes } from '../src/index.ts';
import { source, world } from './world.ts';

/** The plane through the boxes, standing by the back wall. */
const Z = -490;

function setup() {
  const w = world();
  w.rt.registerCrtns(COLOR_CRTNS);
  const boxes = installToolboxes(w.rt, source);
  w.at(0, 0, Z);
  const center = (o: CutObject): [number, number] => {
    const b = w.rt.bbox(o)!;
    return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  };
  const click = (o: CutObject) => {
    const [x, y] = center(o);
    w.at(x, y, Z);
    w.controls.pressPick(false);
    w.frame();
    w.controls.releasePick();
    w.frame();
    w.frame();
  };
  return { ...w, ...boxes, center, click };
}

const visible = (w: ReturnType<typeof setup>, o: CutObject) => w.rt.vm.props.has(o, P.Visible);

describe('toolboxes through toolbox.cpl, stamp.cpl and goodies.cpl', () => {
  it('stand closed by the back wall; a click opens one, its contents stacked above it', () => {
    const w = setup();
    const prims = w.prims.children.filter((c) => w.rt.hasProp(c, 'Stamp'));
    expect(prims).toHaveLength(5);
    expect(prims.some((p) => visible(w, p))).toBe(false);
    w.click(w.prims);
    expect(w.rt.hasProp(w.prims, 'Toolboxopen')).toBe(true);
    expect(prims.every((p) => visible(w, p))).toBe(true);
    const top = w.rt.bbox(w.prims)![1][1];
    const bottoms = prims.map((p) => w.rt.bbox(p)![0][1]);
    expect(Math.min(...bottoms)).toBeGreaterThan(top);
    // Stacked: each above the one before.
    for (let i = 1; i < bottoms.length; i++) expect(bottoms[i]!).toBeGreaterThan(bottoms[i - 1]!);
    w.click(w.prims);
    expect(prims.some((p) => visible(w, p))).toBe(false);
  });

  it('picking a primitive stamps a copy into the world, picked, and the box closes', () => {
    const w = setup();
    w.click(w.prims);
    const cube = w.prims.children.find((c) => w.rt.hasProp(c, 'Stamp'))!;
    const before = w.rt.primary.root.children.length;
    w.click(cube);
    const picked = w.rt.picked();
    expect(picked).toHaveLength(1);
    const copy = picked[0] as CutObject;
    expect(copy).not.toBe(cube);
    expect(w.rt.worldOf(copy)).toBe(w.rt.primary);
    expect(w.rt.hasProp(copy, 'Stamp')).toBe(false);
    expect(w.rt.hasProp(copy, 'Lockedgeometry')).toBe(false);
    expect(visible(w, copy)).toBe(true);
    expect(w.rt.primary.root.children.length).toBeGreaterThan(before);
    // The original stays in its box, which has closed.
    expect(cube.parent).toBe(w.prims);
    expect(visible(w, cube)).toBe(false);
    // The stamp is one undoable step.
    expect(w.rt.undo()).toBe(true);
    expect(w.rt.worldOf(copy)).not.toBe(w.rt.primary);
  });

  it('the goodies box holds the camera, light bulb and colour control; one comes out when dragged', () => {
    const w = setup();
    const names = w.goodies.children.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Nikon', 'Lightbulb', 'Colorcontrol']));
    w.click(w.goodies);
    const bulb = w.goodies.children.find((c) => c.name === 'Lightbulb')!;
    expect(visible(w, bulb)).toBe(true);
    const [x, y] = w.center(bulb);
    w.at(x, y, Z);
    w.controls.pressPick(false);
    w.frame();
    w.move(-150, 0);
    w.move(-100, 0);
    w.controls.releasePick();
    w.frame();
    w.frame();
    expect(bulb.parent).toBe(w.rt.environment.root);
    expect(w.center(bulb)[0]).toBeCloseTo(x - 250, 0);
  });
});
