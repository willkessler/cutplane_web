import { P, boolWord, first, type Feature, type VM } from '@cutplane/cpl';
import { readCut, writeCut } from '@cutplane/formats';
import {
  Brep,
  createObject,
  createSquare,
  extrudeFace,
  makeLamina,
  subtree,
  type CutObject,
  type Rgb,
} from '@cutplane/kernel';
import { isObject, isSub } from '../features.ts';
import type { Runtime, TextItem, V3 } from '../runtime.ts';
import { charWidth } from '../text/hershey.ts';
import { DECAL_GAP, DECAL_THICKNESS, applyFrontDecal, registerPadTechniques } from './toolbar.ts';

/**
 * Plates (storage_cutplane.c's read_plate; tools.c's create_storage_pad),
 * run by the original dialog.cpl, inputplate.cpl, textinput.cpl, save.cpl and
 * load.cpl, with the C routines they call (cplib.c's charstream and label
 * routines, read_from_file, write_to_file).
 *
 * A plate is a flat panel with Hershey-text labels and text inputs on it. The
 * storage pad (a floppy disk) opens its plate: "Load from:" and "Save to:",
 * each a field you click and type a name into; Return loads or saves.
 * Typed keys go, as Incomingchar messages, to whatever has asked for them
 * (add_obj_charstream) instead of being commands.
 *
 * Files: "saving" keeps the world in the browser under the typed name;
 * "loading" looks there first, then among the bundled samples (the host
 * supplies both, as `PlateFiles`).
 *
 * Deviation: the original left the storage pad by the back wall (and only
 * a drag brought it into the plane); here it starts in the plane, bottom
 * left, like the measure pad, so it can be reached.
 */

const STORAGE_SQUARE = 60; // Storagesquare = Normalpadsquare
const MIN_X = -511;
const MIN_Y = -382;

export interface PlateFiles {
  /** A saved or bundled world by name, or null. */
  read(name: string): Promise<string | null>;
  write(name: string, text: string): void;
}

// ---- plate resources ----

interface LabelSpec {
  text: string;
  offset: V3;
  color: Rgb;
  pen: number;
  scale: [number, number];
  style: TextItem['style'];
}
interface InputSpec {
  name: string;
  size: [number, number];
  text: string;
  textOffset: V3;
  code: string;
  type: string;
  offset: V3;
  color: Rgb;
  textColor: Rgb;
  pen: number;
  scale: [number, number];
  style: TextItem['style'];
}
export interface PlateSpec {
  name: string;
  size: [number, number];
  offset: V3;
  color: Rgb;
  code: string;
  labels: LabelSpec[];
  inputs: InputSpec[];
}

/** A plate resource (storageplate.rsc, nameplate.rsc, ...). */
export function parsePlateRsc(text: string): PlateSpec {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let i = 0;
  const field = (name: string) => {
    while (i < lines.length && !lines[i]!.startsWith(`${name}:`)) i++;
    if (i >= lines.length) throw new Error(`plate resource: no ${name}`);
    return lines[i++]!.slice(name.length + 1).trim();
  };
  const nums = (s: string) => s.replace(/[[\]]/g, '').split(',').map(Number);
  const v3 = (s: string) => nums(s).slice(0, 3) as V3;
  const quoted = (s: string) => s.replace(/^"|"$/g, '');
  const style = (s: string) => s as TextItem['style'];
  const name = field('Plate Name');
  const size = nums(field('Plate Width,Height')) as [number, number];
  const offset = v3(field('Plate Offset'));
  const color = nums(field('Plate Color')) as Rgb;
  const code = field('Plate Privatecode File');
  const nl = Number(field('Number of Plate Labels'));
  const ni = Number(field('Number of Plate Text Inputs'));
  const labels: LabelSpec[] = [];
  for (let k = 0; k < nl; k++)
    labels.push({
      text: quoted(field('Label Text')),
      offset: v3(field('Label Offset')),
      color: nums(field('Label Color')) as Rgb,
      pen: Number(field('Label Pen Width')),
      scale: nums(field('Label Scale')) as [number, number],
      style: style(field('Label Style')),
    });
  const inputs: InputSpec[] = [];
  for (let k = 0; k < ni; k++)
    inputs.push({
      name: field('Textinput Field Name'),
      size: nums(field('Textinput Size')) as [number, number],
      text: quoted(field('Textinput Default')),
      textOffset: v3(field('Textinput Text Offset')),
      code: field('Textinput Privatecode File'),
      type: field('Textinput Type'),
      offset: v3(field('Textinput Offset')),
      color: nums(field('Textinput Color')) as Rgb,
      textColor: nums(field('Textinput Text Color')) as Rgb,
      pen: Number(field('Textinput Pen Width')),
      scale: nums(field('Textinput Scale')) as [number, number],
      style: style(field('Textinput Style')),
    });
  return { name, size, offset, color, code, labels, inputs };
}

const baseName = (f: string) => f.replace(/^.*\//, '');

/** read_plate: a plate under `parent`, its labels and text inputs; hidden until opened. */
export function readPlate(
  rt: Runtime,
  parent: CutObject,
  spec: PlateSpec,
  source: (f: string) => string,
): CutObject {
  const env = rt.environment;
  const plate = rt.makeObj(
    env,
    [0, 0, 0],
    spec.name,
    ['Nonmanifold', 'Nonselectable', 'Inputplate'],
    {
      selectTechnique: 'set_normalpad_selectable',
      drawTechnique: 'draw_plate_technique',
    },
  );
  plate.color = [...spec.color];
  rt.addVertexEdge(plate, plate.brep.vertices()[0]!, [spec.size[0], spec.size[1], 0]);
  spec.labels.forEach((l) =>
    rt.addLabelItem(plate, l.text, l.offset, {
      color: [...l.color],
      penWidth: l.pen,
      xscale: l.scale[0],
      yscale: l.scale[1],
      style: l.style,
    }),
  );
  for (const t of spec.inputs) {
    const pad = createObject(createSquare(t.size[0], t.size[1]), {
      name: t.name === '<none>' ? null : t.name,
      color: [...t.color],
      attrs: { props: ['Visible', 'Nonmanifold'] },
    });
    rt.importObjects(env, [pad]);
    // The text sits up and off the pad a little (read_plate hardwires it).
    rt.addLabelItem(pad, t.text || null, [10, 10, 10], {
      color: [...t.textColor],
      penWidth: t.pen,
      xscale: t.scale[0],
      yscale: t.scale[1],
      style: t.style,
    });
    if (t.code !== '<none>') rt.setPrivateCode(pad, source(baseName(t.code)), baseName(t.code));
    rt.vm.props.set(pad, rt.vm.props.find('Textinput'), t.type);
    pad.selectTechnique = 'set_normalpad_selectable';
    rt.translate(pad, t.offset);
    rt.adopt(plate, pad, false);
  }
  rt.translate(plate, spec.offset);
  rt.adopt(parent, plate, false);
  for (const o of subtree(plate)) if (rt.vm.props.has(o, P.Visible)) rt.vm.props.del(o, P.Visible);
  if (spec.code !== '<none>')
    rt.setPrivateCode(plate, source(baseName(spec.code)), baseName(spec.code));
  return plate;
}

/** create_floppy: the storage pad's picture. */
function createFloppy(rt: Runtime, floppy: Rgb, label: Rgb, door: Rgb): CutObject {
  const S = 100;
  const C = S / 40;
  const N = S / 14;
  const D = S / 20;
  const obj = (pts: V3[], color: Rgb, extrude = 0) => {
    const b = new Brep();
    const { front, back } = makeLamina(b, pts);
    if (extrude) extrudeFace(b, b.faceNormal(front)[2] < 0 ? front : back, 0, 0, extrude);
    const o = createObject(b, { color: [...color], attrs: { props: ['Visible'] } });
    rt.importObjects(rt.environment, [o]);
    return o;
  };
  const disk = obj(
    [[N, 0, 0], [S - C, 0, 0], [S, C, 0], [S, S - C, 0], [S - C, S, 0], [C, S, 0], [0, S - C, 0], [0, N, 0]], // prettier-ignore
    floppy,
    -D,
  );
  const parts: [V3[], Rgb][] = [
    [
      [
        [N, S, D],
        [N, S / 3 + N, D],
        [S - N, S / 3 + N, D],
        [S - N, S, D],
      ],
      label,
    ],
    [[[N * 3, 0, D], [N * 3, S / 3 - C, D], [N * 3 + C, S / 3, D], [S - N * 3 - C, S / 3, D], [S - N * 3, S / 3 - C, D], [S - N * 3, 0, D]], door], // prettier-ignore
    [[[N * 4, N, D * 2], [N * 4, S / 3 - C, D * 2], [N * 6.5, S / 3 - C, D * 2], [N * 6.5, N, D * 2]], floppy], // prettier-ignore
  ];
  for (const [pts, color] of parts) rt.adopt(disk, obj(pts, color), false);
  return disk;
}

/** create_storage_pad: the floppy disk pad and its Load/Save plate. */
export function createStoragePad(
  rt: Runtime,
  read: (f: string) => string,
  source: (f: string) => string,
): CutObject {
  const pad = rt.makeObj(rt.environment, [0, 0, 0], 'StoragePad', ['Nonmanifold', 'Noshadow'], {
    selectTechnique: 'set_normalpad_selectable',
    drawTechnique: 'draw_plate_technique',
  });
  rt.addVertexEdge(pad, pad.brep.vertices()[0]!, [STORAGE_SQUARE, STORAGE_SQUARE, 0]);
  pad.color = [255, 110, 10];
  rt.translate(pad, [0, 0, 10]);
  const floppy = createFloppy(rt, [255, 0, 255], [255, 150, 255], [255, 255, 255]);
  applyFrontDecal(rt, floppy, pad, DECAL_THICKNESS, DECAL_GAP, STORAGE_SQUARE / 8);
  rt.discard(floppy);
  const plate = readPlate(rt, pad, parsePlateRsc(read('storageplate.rsc')), source);
  rt.setName(plate, 'StoragePlate');
  rt.adopt(rt.cutplane, pad, true);
  rt.translate(pad, [
    MIN_X + STORAGE_SQUARE * 0.5,
    MIN_Y + STORAGE_SQUARE * 0.5,
    rt.cutplane.xform[14]!,
  ]);
  rt.addProp(pad, 'Dialog');
  for (const o of subtree(pad)) rt.addProp(o, 'Lockedgeometry');
  return pad;
}

// ---- the C routines ----

const objectOf = (f: Feature | null): CutObject | null =>
  isObject(f) ? f : isSub(f) ? f.object : null;
/** The first label item of each object in a feature list (the routines use item 1 only). */
function firstItems(
  rt: Runtime,
  list: readonly (Feature | null)[] | null | undefined,
): [CutObject, TextItem][] {
  const out: [CutObject, TextItem][] = [];
  for (const f of list ?? []) {
    const o = objectOf(f);
    const item = o ? rt.labelItems(o)[0] : undefined;
    if (o && item) out.push([o, item]);
  }
  return out;
}
const width = (s: string, xscale: number) =>
  [...s].reduce((w, c) => w + charWidth(c.charCodeAt(0)) * xscale, 0);

/** Who is listening to the keyboard (obj_charstream_list). */
const streams = new WeakMap<Runtime, Feature[]>();
export const charstreamOf = (rt: Runtime): readonly Feature[] => streams.get(rt) ?? [];

/** The text inputs' routines (any plate with fields needs them). */
export const TEXT_CRTNS: Partial<Record<string, (rt: Runtime, vm: VM) => void>> = {
  add_obj_charstream(rt, vm) {
    const f = first(vm.pop());
    if (!f) return;
    const l = streams.get(rt) ?? [];
    if (!l.includes(f)) l.push(f);
    streams.set(rt, l);
  },
  rem_obj_charstream(rt, vm) {
    const f = first(vm.pop());
    const l = streams.get(rt);
    if (f && l)
      streams.set(
        rt,
        l.filter((x) => x !== f),
      );
  },
  /** (insertion point, objects): -1 hides the I-beam, 10000 puts it at the end. */
  set_insertion_pt(rt, vm) {
    const rec = vm.pop();
    const at = vm.pop().int;
    for (const [, item] of firstItems(rt, rec.list))
      item.insertion = at === 10000 ? (item.text?.length ?? 0) : at;
    rt.version++;
  },
  move_insertion_pt(rt, vm) {
    const rec = vm.pop();
    const by = vm.pop().int;
    for (const [, item] of firstItems(rt, rec.list)) {
      const len = item.text?.length ?? 0;
      item.insertion =
        item.text === null && by > 0 ? 0 : Math.max(0, Math.min(len, item.insertion + by));
    }
    rt.version++;
  },
  /** (set, char) → whether the char is in the set. */
  filter_char(_rt, vm) {
    const c = vm.pop().char;
    const set = vm.pop().str ?? '';
    vm.push(boolWord(set.includes(String.fromCharCode(c))));
  },
  /** (char, objects) → whether one more char still fits on the pad. */
  label_fits(rt, vm) {
    const rec = vm.pop();
    const c = String.fromCharCode(vm.pop().char);
    let fits = true;
    for (const [o, item] of firstItems(rt, rec.list)) {
      if (item.text === null) continue;
      const bb = rt.bbox(o);
      const w = width(item.text, item.xscale) + width(c, item.xscale) + item.offset[0];
      if (bb && w > bb[1][0] - bb[0][0]) fits = false;
    }
    vm.push(boolWord(fits));
  },
  add_to_label(rt, vm) {
    const rec = vm.pop();
    const c = String.fromCharCode(vm.pop().char);
    for (const [, item] of firstItems(rt, rec.list)) {
      if (item.text === null) {
        item.text = c;
        item.insertion = 1;
      } else {
        const at = Math.max(0, Math.min(item.text.length, item.insertion));
        item.text = item.text.slice(0, at) + c + item.text.slice(at);
        item.insertion = at + 1;
      }
    }
    rt.version++;
  },
  backspace_label(rt, vm) {
    const rec = vm.pop();
    for (const [, item] of firstItems(rt, rec.list)) {
      if (item.text === null) continue;
      if (item.text.length === 1) item.text = null;
      else if (item.insertion > 0)
        item.text = item.text.slice(0, item.insertion - 1) + item.text.slice(item.insertion);
      item.insertion = Math.max(0, item.insertion - 1);
    }
    rt.version++;
  },
};

export function plateCrtns(
  files: PlateFiles,
): Partial<Record<string, (rt: Runtime, vm: VM) => void>> {
  return {
    ...TEXT_CRTNS,
    /** (name) → the world or file of that name is read into the world being edited. */
    read_from_file(rt, vm) {
      const name = vm.pop().str;
      if (!name) return;
      void files.read(name).then((text) => {
        if (text === null) return;
        const { doc } = readCut(text);
        rt.journal.touchTree();
        rt.importObjects(rt.primary, doc.roots);
        rt.commit();
      });
    },
    /** (what, name): the world being edited is kept under `name`. */
    write_to_file(rt, vm) {
      const name = vm.pop().str;
      vm.pop(); // the world (the primary world, as save.cpl passes it)
      if (!name) return;
      files.write(
        name,
        writeCut({ title: name, contains: 'World', name, roots: rt.documentRoots() }),
      );
    },
  };
}

/** The storage pad and its plate, with the routines they need. */
export function installStoragePad(
  rt: Runtime,
  read: (f: string) => string,
  source: (f: string) => string,
  files: PlateFiles,
): CutObject {
  rt.registerCrtns(plateCrtns(files));
  registerPadTechniques(rt);
  const pad = createStoragePad(rt, read, source);
  rt.vm.resolveObjectRefs();
  return pad;
}
