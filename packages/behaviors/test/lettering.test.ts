import { describe, expect, it } from 'vitest';
import { P, featuresWord } from '@cutplane/cpl';
import type { CutObject } from '@cutplane/kernel';
import {
  COLOR_CRTNS,
  charstreamOf,
  createColorControl,
  installLettering,
  letteringOf,
  letteringPlateOf,
  NOTE_HEIGHT,
  NOTE_OUT,
  setStickerPicture,
  stickerPictureOf,
} from '../src/index.ts';
import { source, world } from './world.ts';

const CR = 0x0d;
const ESC = 0x1b;
const TAB = 0x09;

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
  /** The T chip (it leans off the base's left end, x 136–186), or the sticker chip, taken and let go at (x, y). */
  const drop = (x: number, y: number, chip = 161) => {
    w.at(chip, -18, 0);
    w.controls.pressPick(false);
    w.frame();
    w.move(-100, 10);
    w.move(x - chip + 100, y + 8);
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

  it('letters in the colour the bars show, and the T shows it, however the bars came to it', () => {
    const { rt, cube, cc, drop } = setup();
    // The bars set to a picked thing's colour (no bar dragged, no message to the T).
    const T_ = cc.letter.decals![0]!.color;
    cube.color = [200, 30, 60];
    rt.vm.push(featuresWord(cube));
    rt.vm.push(featuresWord(...cc.bars));
    COLOR_CRTNS.set_color_bars!(rt, rt.vm);
    expect(cc.letter.decals![0]!.color).not.toEqual(T_);
    const shown = cc.letter.decals![0]!.color;
    shown.forEach((c, i) => expect(Math.abs(c - cube.color[i]!)).toBeLessThanOrEqual(3));
    drop(0, 20);
    expect(cube.decals![0]!.color).toEqual(shown);
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

  it('with the plate open, lettering pressed on slides along its surface, one step; shut, the press picks', () => {
    const { rt, cube, drop, type, controls, frame, at, move, shown } = setup();
    drop(0, 20);
    type(['ORION']);
    expect(shown()).toBe(true);
    at(5, 22, 0);
    controls.pressPick(false);
    frame();
    move(40, -10);
    controls.releasePick();
    frame();
    // Where it was taken hold of (5 in from its start) stays under the crosshair.
    expect(cube.decals![0]!.at).toEqual([140, 110, 200]); // the room's (40, 10, 100)
    expect(rt.picked()).toEqual([]);
    expect(shown()).toBe(true);
    rt.undo();
    expect(cube.decals![0]!.at).toEqual([100, 120, 200]);
    // Put away, a press on it picks the cube, as ever.
    type([0x1b]);
    at(5, 22, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    expect(rt.picked().length).toBeGreaterThan(0);
    expect(cube.decals![0]!.at).toEqual([100, 120, 200]);
  });

  it('the sticker chip, let go on a thing, asks for a picture and sticks it on, its middle there; just clicked, asks for one for it', () => {
    const { rt, cube, cc, p, drop, type, shown, controls, frame, at } = setup();
    const b = rt.bbox(cc.sticker)!;
    expect(b[0][0]).toBeCloseTo(82);
    expect(b[1][0]).toBeCloseTo(132);
    expect(stickerPictureOf(rt)?.image).toMatch(/^data:image\/svg/);
    const globe = { image: 'data:image/png;base64,AAAA', aspect: 2, name: 'GLOBE' };
    setStickerPicture(rt, globe);
    expect(stickerPictureOf(rt)).toEqual(globe);
    const moon = { image: 'data:image/png;base64,BBBB', aspect: 1.5, name: 'MOON' };
    let asked = 0;
    rt.chooseImage = (then) => {
      asked++;
      then?.(moon);
    };
    drop(0, 20, 107);
    expect(asked).toBe(1);
    expect(cube.decals).toHaveLength(1);
    const d = cube.decals![0]!;
    expect(d).toMatchObject({ image: moon.image, aspect: 1.5, text: 'MOON', height: 60 });
    expect(d.align).toBeUndefined();
    // The plate is open on it, its name where lettering's would be.
    expect(shown()).toBe(true);
    expect(rt.label(p.plate, 1)).toBe('Sticker:');
    expect(rt.label(p.text, 1)).toBe('MOON');
    type([0x08, CR]);
    expect(cube.decals).toBeUndefined();
    // Let go on nothing: nothing.
    drop(-400, 300, 107);
    expect(asked).toBe(1);
    expect(cube.decals).toBeUndefined();
    // Only clicked: asks for a picture for it.
    at(125, -18, 0); // (on the chip, clear of the cube's edge)
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    frame();
    expect(asked).toBe(2);
    expect(cube.decals).toBeUndefined();
    // No one to ask: the picture the chip shows.
    rt.chooseImage = null;
    drop(0, 20, 107);
    expect(cube.decals![0]).toMatchObject({ image: globe.image, aspect: 2, text: 'GLOBE' });
  });

  it('the note chip puts a note floating off it there; the plate says it, its size, how far out', () => {
    const { rt, cube, cc, p, drop, type, controls, frame, at, shown } = setup();
    const b = rt.bbox(cc.note)!;
    expect(b[0][0]).toBeCloseTo(28);
    expect(b[1][0]).toBeCloseTo(78);
    drop(0, 20, 53);
    expect(cube.decals).toHaveLength(1);
    expect(cube.decals![0]).toMatchObject({ text: 'NOTE', height: NOTE_HEIGHT, note: NOTE_OUT });
    expect(shown()).toBe(true);
    expect(rt.label(p.plate, 1)).toBe('Note:');
    expect(rt.label(p.plate, 3)).toBe('Out:');
    expect(rt.label(p.lean, 1)).toBe(String(NOTE_OUT));
    type(['Flange here is steel', TAB, '10', TAB, '60', CR]);
    expect(cube.decals![0]).toMatchObject({ text: 'Flange here is steel', height: 10, note: 60 });
    expect(cube.decals![0]!.lean).toBeUndefined();
    // A click with the crosshair over its tag (wherever that is) opens the plate for it.
    rt.noteUnder = () => ({ object: cube, index: 0 });
    at(-400, 300, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    frame();
    expect(shown()).toBe(true);
    expect(letteringOf(rt)).toEqual({ object: cube, index: 0 });
    expect(rt.label(p.text, 1)).toBe('Flange here is steel');
    type([ESC]);
    rt.noteUnder = () => null;
    // Lettering's plate says Lean again.
    drop(-60, -60);
    expect(rt.label(p.plate, 1)).toBe('Lettering:');
    expect(rt.label(p.plate, 3)).toBe('Lean:');
  });
});
