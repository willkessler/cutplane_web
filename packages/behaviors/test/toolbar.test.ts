import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { P } from '@cutplane/cpl';
import type { CutObject } from '@cutplane/kernel';
import { decalOf, installToolbars } from '../src/index.ts';
import { world } from './world.ts';

const ASSETS = resolve(import.meta.dirname, '../../../assets');
/** Resources by name, as the original's working directory had them (rsc/, icons/). */
const read = (f: string) => {
  // cutplane_web's own (the rails with the union pad) first, else the original's.
  for (const dir of ['rsc', 'icons', 'original/rsc', 'original/icons']) {
    const p = join(ASSETS, dir, f);
    if (existsSync(p)) return readFileSync(p, 'latin1');
  }
  throw new Error(`${f}: not found`);
};

function setup() {
  const w = world();
  const [tools, arrangers] = installToolbars(w.rt, read, ['toolpads.rsc', 'arrangepads.rsc']);
  w.frame();
  const center = (o: CutObject): [number, number] => {
    const b = w.rt.bbox(o)!;
    return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  };
  const click = (o: CutObject) => {
    const [x, y] = center(o);
    w.at(x, y);
    w.controls.pressPick(false);
    w.frame();
    w.controls.releasePick();
    w.frame();
    w.frame();
  };
  return { ...w, tools: tools!, arrangers: arrangers!, center, click };
}

const visible = (w: ReturnType<typeof setup>, o: CutObject) => w.rt.vm.props.has(o, P.Visible);

describe('toolbars through headpad, toolpad, padhandle and tool.cpl', () => {
  it('builds both rails closed: headpads in the plane with their icons painted on', () => {
    const w = setup();
    expect(w.tools.name).toBe('Toolpads');
    expect(w.tools.parent).toBe(w.rt.cutplane);
    expect(visible(w, w.tools)).toBe(true);
    expect(decalOf(w.rt, w.tools)?.length).toBeGreaterThan(0);
    const bar = w.tools.children[0]!;
    expect(w.rt.hasProp(bar, 'Toolbar')).toBe(true);
    expect(bar.children).toHaveLength(4); // pencil, saw, drill, union
    expect(w.arrangers.children[0]!.children).toHaveLength(5);
    expect(visible(w, bar)).toBe(false);
    // Each pad holds its tool, unseen, its picture on the pad.
    const pad = bar.children[0]!.children[0]!;
    expect(w.rt.hasProp(pad, 'Toolpad')).toBe(true);
    expect(w.rt.hasProp(pad.children[0]!, 'Tool')).toBe(true);
    expect(visible(w, pad.children[0]!)).toBe(false);
    expect(decalOf(w.rt, pad)?.length).toBeGreaterThan(0);
    // It rides with the plane.
    const z = w.rt.bbox(w.tools)![0][2];
    w.at(0, 0, 0);
    expect(w.rt.bbox(w.tools)![0][2]).toBeCloseTo(z - 500);
  });

  it('clicking the headpad opens its rail, pads stacked down it; clicking again closes it', () => {
    const w = setup();
    const bar = w.tools.children[0]!;
    w.click(w.tools);
    expect(visible(w, bar)).toBe(true);
    const handles = bar.children;
    expect(handles.every((h) => visible(w, h) && visible(w, h.children[0]!))).toBe(true);
    const ys = handles.map((h) => w.center(h)[1]);
    expect(ys[0]).toBeGreaterThan(ys[1]!);
    expect(ys[1]).toBeGreaterThan(ys[2]!);
    // The rail reaches down past the last pad.
    expect(w.rt.bbox(bar)![0][1]).toBeLessThan(w.rt.bbox(handles[2]!.children[0]!)![1][1]);
    w.click(w.tools);
    expect(visible(w, bar)).toBe(false);
  });

  it('a toolpad hands over its tool, which rides the crosshair; clicking the pad takes it back', () => {
    const w = setup();
    w.click(w.tools);
    const pad = w.tools.children[0]!.children[0]!.children[0]!;
    const tool = pad.children[0]!;
    w.click(pad);
    expect(w.rt.hasProp(tool, 'Active')).toBe(true);
    expect(visible(w, tool)).toBe(true);
    expect(tool.parent).toBe(w.rt.cursorObj);
    expect(w.rt.hasProp(pad, 'Toolpadempty')).toBe(true);
    expect(decalOf(w.rt, pad)).toBeUndefined();
    // Just in front of the plane, and it follows the crosshair.
    const before = w.rt.bbox(tool)!;
    expect(before[0][2]).toBeGreaterThan(w.stage.z);
    w.move(200, -100);
    const after = w.rt.bbox(tool)!;
    expect(after[0][0]).toBeCloseTo(before[0][0] + 200);
    // Back to the pad: the tool goes back on it and its picture comes back.
    w.click(pad);
    expect(w.rt.hasProp(tool, 'Active')).toBe(false);
    expect(tool.parent).toBe(pad);
    expect(visible(w, tool)).toBe(false);
    expect(decalOf(w.rt, pad)?.length).toBeGreaterThan(0);
    // (toolpad.cpl leaves it marked Toolpadempty here, as the original did: the pad
    // had no tool when it was clicked.) It hands the tool over again all the same.
    w.click(pad);
    expect(tool.parent).toBe(w.rt.cursorObj);
    expect(visible(w, tool)).toBe(true);
  });

  it('a padhandle pulled off the rail floats where it is let go', () => {
    const w = setup();
    w.click(w.arrangers);
    const bar = w.arrangers.children[0]!;
    const handle = bar.children[1]!;
    const [x, y] = w.center(handle);
    w.at(x, y);
    w.controls.pressPick(false);
    w.frame();
    w.move(150, -60);
    w.move(100, 0);
    w.controls.releasePick();
    w.frame();
    w.frame();
    expect(handle.parent).toBe(w.rt.cutplane);
    expect(bar.children).toHaveLength(4);
    expect(w.center(handle)[0]).toBeCloseTo(x + 250, 0);
  });
});
