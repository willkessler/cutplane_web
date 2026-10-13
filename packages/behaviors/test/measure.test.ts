import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { P } from '@cutplane/cpl';
import { createCube, createObject, mat4, type CutObject } from '@cutplane/kernel';
import { installMeasurePad } from '../src/index.ts';
import { source, world } from './world.ts';

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
  const pad = installMeasurePad(w.rt, read, source);
  w.at(0, 0, 0);
  w.frame();
  const find = (name: string) => w.rt.findObject(name)!;
  const shown = (name: string) => w.rt.vm.props.has(find(name), P.Visible);
  const label = (name: string) => w.rt.label(find(name), 1);
  const settle = () => {
    for (let i = 0; i < 6; i++) w.frame();
  };
  const click = (x: number, y: number, shift = false) => {
    w.at(x, y, 0);
    w.frame();
    w.controls.pressPick(shift);
    w.frame();
    w.controls.releasePick();
    settle();
  };
  const center = (o: CutObject): [number, number] => {
    const b = w.rt.bbox(o)!;
    return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  };
  const type = (s: string) => {
    for (const c of [...s].map((x) => x.charCodeAt(0))) {
      w.controls.typeChar(c);
      settle();
    }
  };
  return { ...w, pad, find, shown, label, click, center, type, settle };
}

describe('the measure pad (measurepad.cpl, cubeplate.cpl, distanceplate.cpl, sizer.cpl)', () => {
  it('sits bottom left in the plane, its plates hidden', () => {
    const w = setup();
    expect(w.pad.parent).toBe(w.rt.cutplane);
    expect(w.rt.bbox(w.pad)![0][0]).toBeCloseTo(-361);
    for (const p of ['Name_Plate', 'Cube_Plate', 'Length_Plate', 'Distance_Plate'])
      expect(w.shown(p)).toBe(false);
  });

  it('picking an object shows its size in inches and its name; typing a width resizes it', () => {
    const w = setup();
    w.click(0, 0);
    expect(w.rt.picked()).toEqual([w.cube]);
    expect(w.shown('Cube_Plate')).toBe(true);
    expect(w.shown('Name_Plate')).toBe(true);
    expect(w.label('Cube_length')).toBe('20.00');
    expect(w.label('Cube_width')).toBe('20.00');
    expect(w.label('Cube_height')).toBe('20.00');
    expect(w.label('Name_Field')).toBe('Cube');
    // Click the width field, clear it, type 30 and Return.
    w.click(...w.center(w.find('Cube_width')));
    expect(w.rt.picked()).toEqual([w.cube]); // the field took the click, the cube stays picked
    for (let i = 0; i < 6; i++) w.type('\b');
    w.type('30\r');
    const b = w.rt.bbox(w.cube)!;
    expect(b[1][0] - b[0][0]).toBeCloseTo(300, 3);
    expect(b[0][0]).toBeCloseTo(-100, 3); // grown from its low corner
    expect(b[1][1] - b[0][1]).toBeCloseTo(200, 3);
    expect(w.label('Cube_width')).toBe('30.00');
    // Its scale box fits it again.
    const box = w.cube.parent!;
    expect(w.rt.hasProp(box, 'Scalebbox')).toBe(true);
    const bb = w.rt.bbox(box)!;
    expect(bb[1][0] - bb[0][0]).toBeGreaterThan(300);
    expect(bb[1][0] - bb[0][0]).toBeLessThan(350); // outdented
    expect(w.rt.undo()).toBe(true);
    const u = w.rt.bbox(w.cube)!;
    expect(u[1][0] - u[0][0]).toBeCloseTo(200, 3);
  });

  it('two objects picked show the distance between them; a new X moves the second', () => {
    const w = setup();
    const other = createObject(createCube(100, 100, 100), { name: 'Other', xform: mat4.translation(250, -50, -50) }); // prettier-ignore
    other.attrs.props = ['Visible'];
    w.rt.importObjects(w.rt.primary, [other]);
    w.click(0, 0);
    w.click(300, 0, true);
    expect(new Set(w.rt.picked())).toEqual(new Set([w.cube, other]));
    expect(w.shown('Distance_Plate')).toBe(true);
    expect(w.shown('Cube_Plate')).toBe(false);
    // Centre to centre: 300 along x.
    expect(w.label('Delta_distance')).toBe('30.00');
    expect(w.label('Delta_xdistance')).toBe('30.00');
    expect(w.label('Delta_ydistance')).toBe('0.00');
    w.click(...w.center(w.find('Delta_xdistance')));
    for (let i = 0; i < 6; i++) w.type('\b');
    w.type('40\r');
    expect(w.rt.bbox(other)![0][0]).toBeCloseTo(350, 3); // the second picked moved
    expect(w.rt.bbox(w.cube)![0][0]).toBeCloseTo(-100, 3);
    expect(w.label('Delta_xdistance')).toBe('40');
  });

  it('picking an edge shows its length', () => {
    const w = setup();
    w.click(100, 100); // where the plane crosses one of the cube's z edges
    expect(w.shown('Length_Plate')).toBe(true);
    expect(w.label('Regular_length')).toBe('20.00');
  });
});
