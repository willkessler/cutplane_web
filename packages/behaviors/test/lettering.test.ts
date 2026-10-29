import { describe, expect, it } from 'vitest';
import { P } from '@cutplane/cpl';
import type { CutObject } from '@cutplane/kernel';
import {
  COLOR_CRTNS,
  charstreamOf,
  createColorControl,
  installLettering,
  letteringOf,
  letteringPlateOf,
} from '../src/index.ts';
import { source, world } from './world.ts';

const CR = 0x0d;
const ESC = 0x1b;

/**
 * The colour control and the lettering plate, with a letterer that letters the cube's
 * front (z = 100) where the crosshair is, or finds lettering already there.
 */
function setup() {
  const w = world();
  w.rt.registerCrtns(COLOR_CRTNS);
  const cc = createColorControl(w.rt, [200, -50, -30]);
  installLettering(w.rt, source);
  w.rt.letterer = (objects, at, there) => {
    const o = objects[0]!;
    // (The cube's own coordinates are the room's plus 100.)
    const i = (o.decals ?? []).findIndex((d) => Math.hypot(d.at[0] - 100 - at[0], d.at[1] - 100 - at[1]) < 30); // prettier-ignore
    if (i >= 0) return { object: o, index: i };
    if (there) return null;
    return {
      object: o,
      frame: { at: [at[0], at[1], 100], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], height: 20 },
    };
  };
  w.frame();
  const p = letteringPlateOf(w.rt)!;
  const center = (o: CutObject): [number, number] => {
    const b = w.rt.bbox(o)!;
    return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  };
  const click = (o: CutObject) => {
    w.at(...center(o));
    w.controls.pressPick(false);
    w.frame();
    w.controls.releasePick();
    w.frame();
    w.frame();
  };
  const type = (keys: (string | number)[]) => {
    for (const k of keys)
      for (const c of typeof k === 'number' ? [k] : [...k].map((x) => x.charCodeAt(0))) {
        w.controls.typeChar(c);
        w.frame();
        w.frame();
      }
  };
  /** The T chip taken (it leans off the base's left end, x 136–186) and let go at (x, y). */
  const drop = (x: number, y: number) => {
    w.at(161, -18, 0);
    w.controls.pressPick(false);
    w.frame();
    w.move(-100, 10);
    w.move(x - 61, y + 8);
    w.controls.releasePick();
    w.frame();
    w.frame();
  };
  const shown = () => w.rt.vm.props.has(p.plate, P.Visible);
  return { ...w, cc, p, click, type, drop, shown };
}

describe('the T chip and the lettering plate (new)', () => {
  it('sits on the colour control’s left, its T the bars’ colour', () => {
    const { rt, cc, controls, frame, at, move } = setup();
    const b = rt.bbox(cc.letter)!;
    expect(b[0][0]).toBeCloseTo(136);
    expect(b[1][0]).toBeCloseTo(186);
    expect(cc.letter.decals?.[0]?.text).toBe('T');
    // Red taken to nothing: the T is cyan, and the chip itself stays grey.
    at(215, 50, 0);
    controls.pressPick(false);
    frame();
    move(0, -300);
    controls.releasePick();
    frame();
    expect(cc.letter.decals![0]!.color).toEqual(cc.chip.color);
    expect(cc.letter.decals![0]!.color[0]).toBe(0);
    expect(cc.letter.color).toEqual([120, 120, 125]);
  });

  it('let go on a thing, letters it there and opens the plate; Return sets what it says', () => {
    const { rt, cube, cc, p, drop, type, shown } = setup();
    expect(shown()).toBe(false);
    drop(0, 20);
    expect(cube.decals).toHaveLength(1);
    const d = cube.decals![0]!;
    expect(d.text).toBe('TEXT');
    expect(d.color).toEqual(cc.letter.decals![0]!.color);
    expect(d.at).toEqual([100, 120, 200]); // the room's (0, 20, 100)
    expect(d.align).toBe('start'); // it starts where it was let go
    // The copy is gone; the chip stays on the control.
    expect(cc.letter.parent).toBe(cc.base);
    expect(rt.environment.root.children.filter((o) => rt.hasProp(o, 'Letter'))).toHaveLength(0);
    // The plate is open on it, the text field taking keys: the first replaces it.
    expect(shown()).toBe(true);
    expect(rt.label(p.text, 1)).toBe('TEXT');
    expect(rt.label(p.size, 1)).toBe('20');
    expect(rt.label(p.lean, 1)).toBe('0');
    expect(charstreamOf(rt)).toEqual([p.text]);
    type(['PAN AM', CR]);
    expect(cube.decals![0]!.text).toBe('PAN AM');
    expect(shown()).toBe(false);
    expect(charstreamOf(rt)).toEqual([]);
    expect(letteringOf(rt)).toBeUndefined();
    // Two steps: the lettering put on, then what it says.
    rt.undo();
    expect(cube.decals![0]!.text).toBe('TEXT');
    rt.undo();
    expect(cube.decals).toBeUndefined();
  });

  it('let go on lettering already there, opens the plate for it; the lean is typed', () => {
    const { rt, cube, p, drop, type, click, shown } = setup();
    drop(0, 20);
    type(['ORION', CR]);
    drop(5, 25);
    expect(cube.decals).toHaveLength(1);
    expect(shown()).toBe(true);
    expect(rt.label(p.text, 1)).toBe('ORION');
    click(p.lean);
    expect(charstreamOf(rt)).toContain(p.lean);
    type(['12', CR]);
    expect(cube.decals![0]!.lean).toBe(12);
    expect(cube.decals![0]!.text).toBe('ORION');
    expect(shown()).toBe(false);
  });

  it('Tab goes on from field to field (round to the first); the size is typed', () => {
    const { rt, cube, p, drop, type, shown } = setup();
    drop(0, 20);
    const TAB = 0x09;
    type([TAB]);
    expect(charstreamOf(rt)).toEqual([p.size]);
    type(['8', TAB]);
    expect(charstreamOf(rt)).toEqual([p.lean]);
    type([TAB]);
    expect(charstreamOf(rt)).toEqual([p.text]);
    type(['WING', CR]);
    expect(shown()).toBe(false);
    expect(cube.decals![0]!.text).toBe('WING');
    expect(cube.decals![0]!.height).toBeCloseTo(8);
    expect(cube.decals![0]!.lean).toBeUndefined();
  });

  it('Esc leaves it as it was; Return on nothing takes the lettering off', () => {
    const { rt, cube, p, drop, type, shown } = setup();
    drop(0, 20);
    type(['XYZ', ESC]);
    expect(cube.decals![0]!.text).toBe('TEXT');
    expect(shown()).toBe(false);
    expect(charstreamOf(rt)).toEqual([]);
    drop(0, 20);
    expect(rt.label(p.text, 1)).toBe('TEXT');
    type([0x08, CR]);
    expect(cube.decals).toBeUndefined();
  });

  it('a click on lettering opens the plate for it; a click elsewhere puts it away', () => {
    const { rt, cube, p, drop, type, controls, frame, at, shown } = setup();
    drop(0, 20);
    type(['ORION', CR]);
    expect(shown()).toBe(false);
    const click = (x: number, y: number) => {
      at(x, y, 0);
      controls.pressPick(false);
      frame();
      controls.releasePick();
      frame();
      frame();
    };
    click(5, 22);
    expect(shown()).toBe(true);
    expect(letteringOf(rt)).toEqual({ object: cube, index: 0 });
    expect(rt.label(p.text, 1)).toBe('ORION');
    type(['ORION III', CR]);
    expect(cube.decals![0]!.text).toBe('ORION III');
    // Open again, then a click on the cube away from it: put away, as it was.
    click(5, 22);
    expect(shown()).toBe(true);
    click(-60, -60);
    expect(shown()).toBe(false);
    expect(cube.decals![0]!.text).toBe('ORION III');
  });
});
