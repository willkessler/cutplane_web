import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CutObject } from '@cutplane/kernel';
import { installToolbars, markRoom, restoreRoom, snapshotRoom } from '../src/index.ts';
import { world } from './world.ts';

/**
 * A padhandle clicked where it is stays on its rail. The rail is a flat lamina, and
 * near_toolbar once measured its depth as the rail's own (0), so every release (a click
 * included) floated the handle off with its pad, and the session kept it so: the rail
 * down to three pads, the pencil's pad left over the saw's.
 */

const ASSETS = resolve(import.meta.dirname, '../../../assets');
const read = (f: string) => {
  for (const dir of ['rsc', 'icons', 'original/rsc', 'original/icons']) {
    const p = join(ASSETS, dir, f);
    if (existsSync(p)) return readFileSync(p, 'latin1');
  }
  throw new Error(`${f}: not found`);
};

function setup() {
  const w = world();
  const [tools] = installToolbars(w.rt, read, ['toolpads.rsc', 'arrangepads.rsc']);
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
  const bar = tools!.children[0]!;
  return { ...w, tools: tools!, bar, center, click };
}

describe('a padhandle clicked where it is', () => {
  it('a click leaves it in its slot, and the room kept has all four', () => {
    const a = setup();
    markRoom(a.rt);
    a.click(a.tools); // open the rail
    const handles = a.bar.children.slice();
    const y = a.center(handles[0]!)[1];
    a.click(handles[0]!); // a plain click on the blue strip, no drag
    expect(a.bar.children).toEqual(handles);
    expect(a.center(handles[0]!)[1]).toBeCloseTo(y, 6);
    const b = setup();
    markRoom(b.rt);
    expect(restoreRoom(b.rt, JSON.parse(JSON.stringify(snapshotRoom(a.rt))))).toBe(true);
    expect(b.bar.children).toHaveLength(4);
  });

  it('a handle dragged off floats; dropped back on the rail, it goes back in its slot', () => {
    const w = setup();
    w.click(w.tools);
    const h = w.bar.children[0]!;
    const [x, y] = w.center(h);
    w.at(x, y);
    w.controls.pressPick(false);
    w.frame();
    w.move(200, 0);
    w.controls.releasePick();
    w.frame();
    expect(h.parent).toBe(w.rt.cutplane);
    expect(w.bar.children).toHaveLength(3);
    // Back to where it was, right on the rail.
    w.at(x + 200, y);
    w.controls.pressPick(false);
    w.frame();
    w.move(-200, 0);
    w.controls.releasePick();
    w.frame();
    expect(w.bar.children[0]).toBe(h);
  });
});
