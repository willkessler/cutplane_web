import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { P } from '@cutplane/cpl';
import { writeCut } from '@cutplane/formats';
import { createCube, createObject, mat4, type CutObject } from '@cutplane/kernel';
import {
  charstreamOf,
  decalOf,
  installHelpPad,
  installStoragePad,
  type PlateFiles,
} from '../src/index.ts';
import { source, world } from './world.ts';

const ASSETS = resolve(import.meta.dirname, '../../../assets');
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
  const saved = new Map<string, string>();
  const files: PlateFiles = {
    read: async (name) => saved.get(name) ?? null,
    write: (name, text) => void saved.set(name, text),
  };
  const pad = installStoragePad(w.rt, read, source, files);
  w.frame();
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
  const plate = pad.children.find((c) => c.name === 'StoragePlate')!;
  const field = (name: string) => plate.children.find((c) => c.name === name)!;
  return { ...w, pad, plate, field, click, type, saved, center };
}

const BS = 0x08;
const CR = 0x0d;
const ESC = 0x1b;

describe('the storage pad through dialog.cpl, textinput.cpl, load.cpl and save.cpl', () => {
  it('opens its Load/Save plate, with Hershey-text labels and two fields', () => {
    const w = setup();
    expect(w.rt.vm.props.has(w.plate, P.Visible)).toBe(false);
    w.click(w.pad);
    expect(w.rt.vm.props.has(w.plate, P.Visible)).toBe(true);
    expect(w.rt.labelItems(w.plate).map((l) => l.text)).toEqual(['Load from:', 'Save to:']);
    expect(w.rt.label(w.field('LoadObject'), 1)).toBe('disc5');
    expect(w.rt.label(w.field('SaveObject'), 1)).toBe('Untitled');
    w.click(w.pad);
    expect(w.rt.vm.props.has(w.plate, P.Visible)).toBe(false);
  });

  it('a field takes typed keys: the I-beam, backspace, arrows; Esc puts the old text back', () => {
    const w = setup();
    w.click(w.pad);
    const load = w.field('LoadObject');
    w.click(load);
    expect(charstreamOf(w.rt)).toEqual([load]);
    expect(w.controls.typing).toBe(true);
    const item = w.rt.labelItems(load)[0]!;
    expect(item.insertion).toBe(5); // at the end of "disc5"
    // Just clicked, the first key replaces it all (Backspace clears it)...
    w.type(['s']);
    expect(item.text).toBe('s');
    w.type([ESC]);
    expect(item.text).toBe('disc5');
    w.click(load);
    // ...unless an arrow comes first: then it is edited in place.
    w.type([0x06, BS, '4']);
    expect(item.text).toBe('disc4');
    w.type([0x02, 0x02, 'X']); // left twice, then type
    expect(item.text).toBe('disXc4');
    w.type([ESC]);
    expect(item.text).toBe('disc5');
    expect(charstreamOf(w.rt)).toEqual([]);
    expect(item.insertion).toBe(-1);
  });

  it('Save to: keeps the world under the typed name; Load from: brings it back', async () => {
    const w = setup();
    const extra = createObject(createCube(50, 50, 50), {
      name: 'Extra',
      xform: mat4.translation(200, 0, 0),
    });
    w.rt.importObjects(w.rt.primary, [extra]);
    w.click(w.pad);
    w.click(w.field('SaveObject'));
    w.type([...Array(8).fill(BS), 'mine', CR]);
    expect(w.saved.has('mine')).toBe(true);
    expect(w.saved.get('mine')).toContain('Object Name:Extra');

    // Into a world that doesn't have it.
    const before = w.rt.primary.root.children.length;
    w.saved.set(
      'other',
      writeCut({
        title: 'o',
        contains: 'World',
        name: null,
        roots: [createObject(createCube(10, 10, 10), { name: 'Other' })],
      }),
    );
    w.click(w.pad); // the dialog closed after the save; open it again
    if (!w.rt.vm.props.has(w.plate, P.Visible)) w.click(w.pad);
    w.click(w.field('LoadObject'));
    w.type([...Array(5).fill(BS), 'other', CR]);
    await new Promise((r) => setTimeout(r, 0));
    expect(w.rt.primary.root.children.length).toBe(before + 1);
    expect(w.rt.primary.root.children.some((o) => o.name === 'Other')).toBe(true);
    expect(w.rt.canUndo).toBe(true);
  });
});

describe('the help pad (new): a Dialog like the storage pad', () => {
  it('a click opens its plate of help lines in the plane; another puts it away', () => {
    const w = setup();
    const help = installHelpPad(w.rt, [{ text: 'Moving', heading: true }, { text: 'Move: the crosshair' }]); // prettier-ignore
    w.frame();
    const plate = help.children.find((c) => c.name === 'Help_Plate')!;
    expect(decalOf(w.rt, help)?.length).toBe(2); // the ? in solid: its hook and its dot
    expect(w.rt.vm.props.has(plate, P.Visible)).toBe(false);
    // At the bottom right, in the plane.
    expect(help.parent).toBe(w.rt.cutplane);
    expect(w.rt.bbox(help)![0][0]).toBeGreaterThan(400);
    w.click(help);
    expect(w.rt.vm.props.has(plate, P.Visible)).toBe(true);
    expect(w.rt.labelItems(plate).map((l) => l.text)).toEqual(['Moving', 'Move: the crosshair']);
    expect(w.rt.labelItems(plate)[0]!.color).toEqual([255, 255, 0]);
    w.click(help);
    expect(w.rt.vm.props.has(plate, P.Visible)).toBe(false);
    // Nothing in the world was picked or changed by it.
    expect(w.rt.picked()).toEqual([]);
  });
});
