import { P, first, type Feature, type VM } from '@cutplane/cpl';
import {
  type DecalFrame,
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
import { barsColor, showOnLetterChip } from './colorcontrol.ts';
import { registerPadTechniques } from './toolbar.ts';

/**
 * New here: lettering by hand. The T chip (Letter: letter.cpl), beside the colour
 * bars, is dragged as the paint chip is; let go on a thing, it letters it there
 * ("TEXT", in the colour its T shows, starting where it was let go) and opens the
 * lettering plate, where what it says, its size and how far it leans are typed
 * (lettering.cpl: Tab goes on to the next, Return sets them, Esc leaves them; nothing
 * to say takes it off). Let go on lettering already there, or click on it, the plate
 * opens for that.
 *
 * The sticker chip (Sticker: sticker.cpl), left of it, let go on a thing, asks the host
 * for a picture (Runtime.chooseImage) and sticks it on (a sticker: a TextDecal with an
 * image), middle where it was let go, and opens the same plate for it, its name where
 * the lettering would be. Just clicked, it asks for a picture to show (and stick on
 * where no one can be asked). With the plate open, lettering or a sticker pressed on
 * slides along its surface with the crosshair (Controls).
 *
 * The note chip (Note: note.cpl), left of that, puts a note there instead: what it says
 * floating out from the surface on a tag (TextDecal's `note`), in the bars' colour; the
 * same plate says what it says, its size, and how far out it floats. A click on a
 * note's tag opens the plate for it (Runtime.noteUnder).
 */

/** What new lettering says until it's typed. */
export const LETTER_TEXT = 'TEXT';
const MAX_Y = 383;

const LETTERING_HINT = 'Tab: next. Return sets it (empty: takes it off). Esc leaves it. Lean: degrees, or up'; // prettier-ignore
const NOTE_HINT = 'Tab: next. Return sets it (empty: takes it off). Esc leaves it. Out: how far it floats'; // prettier-ignore

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
      label(LETTERING_HINT, 25, 15, 0.65),
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
  rt.vm.loadPropertyCode(source('sticker.cpl'), 'sticker.cpl', 'Sticker');
  rt.vm.loadPropertyCode(source('note.cpl'), 'note.cpl', 'Note');
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
  const f = decalFrame(object, d);
  const note = f.note !== undefined;
  const tenth = (x: number) => String(Math.round(x * 10) / 10);
  rt.setLabel(p.plate, 1, note ? 'Note:' : d.image ? 'Sticker:' : 'Lettering:');
  // A note doesn't lean: how far out it floats is said there instead.
  rt.setLabel(p.plate, 3, note ? 'Out:' : 'Lean:');
  rt.setLabel(p.plate, 4, note ? NOTE_HINT : LETTERING_HINT);
  rt.setLabel(p.text, 1, d.text);
  rt.setLabel(p.size, 1, tenth(f.height));
  rt.setLabel(p.lean, 1, note ? tenth(f.note!) : String(d.lean ?? 0));
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
  } else if (d.note !== undefined) {
    // A note: what it says, its size, and how far out it floats.
    const next = { ...d, text };
    const f = decalFrame(object, d);
    const size = Number((rt.label(p.size, 1) ?? '').trim());
    if (Number.isFinite(size) && size > 0) next.height = (d.height * size) / f.height;
    const out = Number(said);
    // (Said in the room; kept in the thing's own coordinates, as its height is.)
    const per = decalFrame(object, { ...d, note: 1 }).note!;
    if (said && Number.isFinite(out) && out >= 0 && per > 0) next.note = out / per;
    object.decals = object.decals!.map((x, i) => (i === index ? next : x));
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

/**
 * The colour the colour control's bars show, which new lettering takes (and the T shows):
 * read off the bars, as a picked thing's colour put on them doesn't reach the T by message.
 */
export function barsColorFor(rt: Runtime): Rgb | null {
  const home = [...subtree(rt.environment.root)].find(
    (o) => o.name === 'Letterchip' && !rt.hasProp(o, 'Active'),
  );
  const rgb = home?.parent ? barsColor(rt, home.parent) : null;
  if (home && rgb) showOnLetterChip(rt, home, rgb);
  return rgb;
}

/** A picture to stick on: a data: URL, its width over its height, and its name. */
export interface StickerPicture {
  image: string;
  aspect: number;
  name: string;
}

/** The sticker chip on the colour control (not a copy of it being carried). */
function stickerChip(rt: Runtime): CutObject | undefined {
  return [...subtree(rt.environment.root)].find(
    (o) => o.name === 'Stickerchip' && rt.hasProp(o, 'Sticker') && !rt.hasProp(o, 'Active'),
  );
}

/** The picture the sticker chip shows, which is what it sticks on. */
export function stickerPictureOf(rt: Runtime): StickerPicture | undefined {
  const d = stickerChip(rt)?.decals?.[0];
  return d?.image ? { image: d.image, aspect: d.aspect ?? 1, name: d.text } : undefined;
}

/** The sticker chip shows `picture` (the next one it sticks on). */
export function setStickerPicture(rt: Runtime, picture: StickerPicture): void {
  const chip = stickerChip(rt);
  const d = chip?.decals?.[0];
  if (!chip || !d) return;
  chip.decals = [{ ...d, image: picture.image, aspect: picture.aspect, text: picture.name }];
  rt.changed(chip);
}

/** How much bigger a sticker goes on than lettering would. */
const STICKER_SCALE = 3;

/**
 * `picture` stuck on `object` at `frame` (its middle there; three times lettering's
 * height), one undoable step, and the plate opened for it.
 */
export function stickOn(
  rt: Runtime,
  object: CutObject,
  frame: DecalFrame,
  picture: StickerPicture,
): void {
  rt.journal.touch(object);
  const f = { ...frame, height: frame.height * STICKER_SCALE };
  delete f.align;
  const d = { ...decalIn(object, f, picture.name, [255, 255, 255]), image: picture.image, aspect: picture.aspect }; // prettier-ignore
  object.decals = [...(object.decals ?? []), d];
  rt.changed(object);
  rt.commit();
  openLettering(rt, object, object.decals.length - 1);
}

/** A sticker's picture changed to `picture` (and its name), one undoable step. */
export function repicture(
  rt: Runtime,
  object: CutObject,
  index: number,
  picture: StickerPicture,
): void {
  // prettier-ignore
  const d = object.decals?.[index];
  if (!d?.image) return;
  rt.journal.touch(object);
  object.decals = object.decals!.map((x, i) =>
    i === index ? { ...x, image: picture.image, aspect: picture.aspect, text: picture.name } : x,
  );
  rt.changed(object);
  rt.commit();
}

/** A new note's capitals' height, and how far out it floats, in the room. */
export const NOTE_HEIGHT = 12;
export const NOTE_OUT = 40;

/**
 * A note on `object` floating out from `frame`'s point (in the bars' colour, saying
 * "NOTE"), one undoable step, and the plate opened for it.
 */
export function noteOn(rt: Runtime, object: CutObject, frame: DecalFrame): void {
  const color = barsColorFor(rt) ?? [255, 236, 140];
  rt.journal.touch(object);
  const f: DecalFrame = { ...frame, height: NOTE_HEIGHT, note: NOTE_OUT };
  delete f.align;
  delete f.lean;
  object.decals = [...(object.decals ?? []), decalIn(object, f, 'NOTE', color)];
  rt.changed(object);
  rt.commit();
  openLettering(rt, object, object.decals.length - 1);
}

/** The T chip's, the sticker chip's and the note chip's routines (letter.cpl, sticker.cpl, note.cpl, lettering.cpl). */
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
      const color = barsColorFor(rt) ?? chip.decals?.[0]?.color ?? [20, 20, 20];
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
  /** (what is under the crosshair, the chip let go): stick its picture on there; on nothing, choose one. */
  sticker_on(rt, vm) {
    const chip = objectOf(first(vm.pop()));
    const under = vm.pop().list ?? [];
    const objects = [...new Set(under.map(objectOf).filter((o): o is CutObject => !!o))];
    if (!chip) return;
    const at = objects.length && rt.letterer ? rt.letterer(objects, rt.cursor()) : null;
    if (!at) {
      // Only clicked (let go where it was taken): a picture for it to show. Let go on
      // nothing else, nothing.
      const home = stickerChip(rt);
      const b = home && rt.bbox(home);
      const c = rt.cursor();
      if (b && [0, 1].every((k) => c[k]! >= b[0][k]! && c[k]! <= b[1][k]!)) rt.chooseImage?.();
      return;
    }
    if (at.index !== undefined) return openLettering(rt, at.object, at.index);
    if (!at.frame) return;
    const { object, frame } = at;
    // Let go on a thing, the person picks the picture to stick on there; with no one to
    // ask, it's the one the chip shows.
    if (rt.chooseImage) return rt.chooseImage((p) => stickOn(rt, object, frame, p));
    const d = chip.decals?.[0];
    if (d?.image)
      stickOn(rt, object, frame, { image: d.image, aspect: d.aspect ?? 1, name: d.text });
  },
  /** (what is under the crosshair, the chip let go): a note floating off it there. */
  note_on(rt, vm) {
    const chip = objectOf(first(vm.pop()));
    const under = vm.pop().list ?? [];
    const objects = [...new Set(under.map(objectOf).filter((o): o is CutObject => !!o))];
    if (!chip || objects.length === 0 || !rt.letterer) return;
    // Over lettering or a sticker too: a note says something about what's there.
    const at = rt.letterer(objects, rt.cursor(), 'new');
    if (at?.frame) noteOn(rt, at.object, at.frame);
  },
  /** (chip, colour): the T shows the bars' colour, which is what it letters in. */
  letter_color(rt, vm) {
    const c = vm.pop().vec ?? [];
    const chip = objectOf(first(vm.pop()));
    if (chip) showOnLetterChip(rt, chip, c);
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
