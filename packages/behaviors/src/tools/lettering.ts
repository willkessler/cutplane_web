import { P, first, type Feature, type VM } from '@cutplane/cpl';
import {
  decalFrame,
  decalIn,
  subtree,
  uprightLean,
  type CutObject,
  type Rgb,
} from '@cutplane/kernel';
import { isObject, isSub } from '../features.ts';
import type { Runtime } from '../runtime.ts';
import {
  TEXT_CRTNS,
  charstreamOf,
  joinCharstream,
  leaveCharstream,
  readPlate,
  type PlateSpec,
} from './plates.ts';
import { registerPadTechniques } from './toolbar.ts';

/**
 * New here: lettering by hand. The T chip (Letter: letter.cpl), beside the colour
 * bars, is dragged as the paint chip is; let go on a thing, it letters it there
 * ("TEXT", in the colour its T shows, starting where it was let go) and opens the
 * lettering plate, where what it says, its size and how far it leans are typed
 * (lettering.cpl: Tab goes on to the next, Return sets them, Esc leaves them). Let go
 * on lettering already there, or click on it, the plate opens for that.
 */

/** What new lettering says until it's typed. */
export const LETTER_TEXT = 'TEXT';
const MAX_Y = 383;

/** The lettering plate: what it says, and its lean, as fields; hidden until wanted. */
function letteringSpec(): PlateSpec {
  const field = (name: string, width: number, x: number) => ({
    name,
    size: [width, 45] as [number, number],
    text: '',
    textOffset: [15, 10, 5] as [number, number, number],
    code: 'lettering.cpl',
    type: 'Asciiset',
    offset: [x, 45, 20] as [number, number, number],
    color: [253, 163, 163] as Rgb,
    textColor: [255, 255, 255] as Rgb,
    pen: 1,
    scale: [1.2, 1.6] as [number, number],
    style: 'Plain' as const,
  });
  const label = (text: string, x: number, y: number, s = 1.5) => ({
    text,
    offset: [x, y, 15] as [number, number, number],
    color: [255, 255, 255] as Rgb,
    pen: 1,
    scale: [s, s * 1.2] as [number, number],
    style: 'Shadow' as const,
  });
  return {
    name: 'Lettering_Plate',
    size: [600, 150],
    offset: [0, 0, 0],
    color: [100, 100, 130],
    code: '<none>',
    labels: [
      label('Lettering:', 25, 110),
      label('Size:', 345, 110),
      label('Lean:', 475, 110),
      label('Tab: next. Return sets it, Esc leaves it. Lean: degrees, or up', 25, 15, 0.8),
    ],
    inputs: [
      field('LetterText', 300, 25),
      field('LetterSize', 110, 345),
      field('LetterLean', 100, 475),
    ],
  };
}

interface Plate {
  plate: CutObject;
  text: CutObject;
  /** The capitals' height, in the room. */
  size: CutObject;
  lean: CutObject;
}
const plates = new WeakMap<Runtime, Plate>();
/** The lettering the plate is open for. */
const editing = new WeakMap<Runtime, { object: CutObject; index: number }>();

/** The lettering plate, in the plane at the top, a little right of the middle (clear of the rails). */
export function installLettering(rt: Runtime, source: (f: string) => string): CutObject {
  rt.registerCrtns({ ...TEXT_CRTNS, ...LETTER_CRTNS });
  registerPadTechniques(rt);
  // The T chip's code (the colour control was built before it was there to read).
  rt.vm.loadPropertyCode(source('letter.cpl'), 'letter.cpl', 'Letter');
  const plane = rt.cutplane;
  const spec = letteringSpec();
  spec.offset = [120 - spec.size[0] / 2 - plane.xform[12]!, MAX_Y - 40 - spec.size[1] - plane.xform[13]!, 3]; // prettier-ignore
  const plate = readPlate(rt, plane, spec, source);
  for (const o of subtree(plate)) rt.addProp(o, 'Lockedgeometry');
  const named = (n: string) => plate.children.find((c) => c.name === n)!;
  plates.set(rt, {
    plate,
    text: named('LetterText'),
    size: named('LetterSize'),
    lean: named('LetterLean'),
  });
  rt.vm.resolveObjectRefs();
  return plate;
}

/** The lettering plate's parts, once installed. */
export const letteringPlateOf = (rt: Runtime): Plate | undefined => plates.get(rt);
/** The lettering the plate is open for, if it is. */
export const letteringOf = (rt: Runtime) => editing.get(rt);

function show(rt: Runtime, plate: CutObject, shown: boolean): void {
  for (const o of subtree(plate))
    if (rt.vm.props.has(o, P.Visible) !== shown) {
      if (shown) rt.vm.props.add(o, P.Visible);
      else rt.vm.props.del(o, P.Visible);
      rt.changed(o);
    }
}

/** A field takes the keys, as a click on it does; the first key typed replaces it. */
function listen(rt: Runtime, field: CutObject, on: boolean): void {
  const item = rt.labelItems(field)[0];
  if (on) {
    rt.addProp(field, 'Active');
    rt.addProp(field, 'Startextinput');
    joinCharstream(rt, field);
    if (item) item.insertion = item.text?.length ?? 0;
  } else {
    for (const p of ['Active', 'Startextinput']) {
      const n = rt.vm.props.find(p);
      if (n >= 0) rt.vm.props.del(field, n);
    }
    leaveCharstream(rt, field);
    if (item) item.insertion = -1;
  }
  rt.version++;
}

const fieldsOf = (p: Plate) => [p.text, p.size, p.lean];

/** The plate opened for `object`'s lettering `index`: its text, size and lean in the fields, the text taking keys. */
export function openLettering(rt: Runtime, object: CutObject, index: number): void {
  const p = plates.get(rt);
  const d = object.decals?.[index];
  if (!p || !d) return;
  editing.set(rt, { object, index });
  rt.setLabel(p.text, 1, d.text);
  rt.setLabel(p.size, 1, String(Math.round(decalFrame(object, d).height * 10) / 10));
  rt.setLabel(p.lean, 1, String(d.lean ?? 0));
  show(rt, p.plate, true);
  for (const f of fieldsOf(p)) if (f !== p.text) listen(rt, f, false);
  listen(rt, p.text, true);
}

/** Tab: the next field (round to the first) takes the keys, the first typed replacing it. */
export function nextLetteringField(rt: Runtime, from?: CutObject): void {
  const p = plates.get(rt);
  if (!p) return;
  const fields = fieldsOf(p);
  const at = fields.findIndex((f) => f === from || (!from && charstreamOf(rt).includes(f)));
  const next = fields[(at + 1) % fields.length]!;
  for (const f of fields) if (f !== next) listen(rt, f, false);
  listen(rt, next, true);
}

/** The plate put away, the lettering as it is. */
export function closeLettering(rt: Runtime): void {
  const p = plates.get(rt);
  editing.delete(rt);
  if (!p) return;
  for (const f of fieldsOf(p)) listen(rt, f, false);
  show(rt, p.plate, false);
}

/**
 * What the plate's fields say, set on the lettering: its text (none, the lettering goes),
 * its size (the capitals' height in the room), and its lean, in degrees, or "up"
 * (standing straight up in the room). One undoable step.
 */
export function applyLettering(rt: Runtime): void {
  const p = plates.get(rt);
  const e = editing.get(rt);
  if (!p || !e) return closeLettering(rt);
  const { object, index } = e;
  const d = object.decals?.[index];
  if (!d) return closeLettering(rt);
  const text = (rt.label(p.text, 1) ?? '').trim();
  const said = (rt.label(p.lean, 1) ?? '').trim().toLowerCase();
  rt.journal.touch(object);
  if (!text) {
    const left = object.decals!.filter((_, i) => i !== index);
    if (left.length) object.decals = left;
    else delete object.decals;
  } else {
    const n = Number(said);
    const lean = said.startsWith('u')
      ? uprightLean({ ...decalFrame(object, d), lean: 0 })
      : Number.isFinite(n)
        ? Math.max(-60, Math.min(60, n))
        : (d.lean ?? 0);
    const next = { ...d, text };
    const size = Number((rt.label(p.size, 1) ?? '').trim());
    if (Number.isFinite(size) && size > 0) next.height = (d.height * size) / decalFrame(object, d).height; // prettier-ignore
    if (lean) next.lean = lean;
    else delete next.lean;
    object.decals = object.decals!.map((x, i) => (i === index ? next : x));
  }
  rt.changed(object);
  rt.commit();
  closeLettering(rt);
}

const objectOf = (f: Feature | null | undefined): CutObject | null =>
  isObject(f) ? f : isSub(f) ? f.object : null;

/** The T chip's routines (letter.cpl, lettering.cpl). */
export const LETTER_CRTNS: Partial<Record<string, (rt: Runtime, vm: VM) => void>> = {
  /** (what is under the crosshair, the chip let go): letter it there, and open the plate. */
  letter_on(rt, vm) {
    const chip = objectOf(first(vm.pop()));
    const under = vm.pop().list ?? [];
    const objects = [...new Set(under.map(objectOf).filter((o): o is CutObject => !!o))];
    if (!chip || objects.length === 0 || !rt.letterer) return;
    const at = rt.letterer(objects, rt.cursor());
    if (!at) return;
    const { object } = at;
    let index = at.index;
    if (index === undefined) {
      if (!at.frame) return;
      const color = chip.decals?.[0]?.color ?? [20, 20, 20];
      rt.journal.touch(object);
      // It starts where it was let go, so it stays there as what it says changes.
      const frame = { ...at.frame, align: 'start' as const };
      object.decals = [...(object.decals ?? []), decalIn(object, frame, LETTER_TEXT, color)];
      index = object.decals.length - 1;
      rt.changed(object);
      rt.commit();
    }
    openLettering(rt, object, index);
  },
  /** (chip, colour): the T shows the bars' colour, which is what it letters in. */
  letter_color(rt, vm) {
    const c = vm.pop().vec ?? [];
    const chip = objectOf(first(vm.pop()));
    const t = chip?.decals?.[0];
    if (!chip || !t) return;
    chip.decals = [{ ...t, color: [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0] }];
    rt.changed(chip);
  },
  /** (the field Tab was typed in) */
  next_lettering(rt, vm) {
    nextLetteringField(rt, objectOf(first(vm.pop())) ?? undefined);
  },
  apply_lettering(rt, vm) {
    vm.pop();
    applyLettering(rt);
  },
  close_lettering(rt, vm) {
    vm.pop();
    closeLettering(rt);
  },
};
