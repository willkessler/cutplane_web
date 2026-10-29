import { T, colorWord, first, offsetWord, type VM } from '@cutplane/cpl';
import { createCube, createObject, mat4, type CutObject, type Rgb } from '@cutplane/kernel';
import type { Runtime, V3 } from '../runtime.ts';

/**
 * The colour control (tools.c's create_color_control): a base (Goodies, so
 * goodies.cpl drags it), three bars (Colorbar: colorbar.cpl) whose top faces
 * are their Hotspots, and a white paint chip (Paint: paint.cpl). New here: a
 * glass chip beside it, a quarter as wide, paints the same colour half see-through
 * (opacity 0.5); the paint chip makes a thing solid again. And on the left, the
 * T chip (Letter: letter.cpl, tools/lettering.ts) letters a thing in the colour
 * its T shows, and left of that the sticker chip (Sticker: sticker.cpl) sticks
 * on the picture it shows. The C
 * routines it calls are here: control_color limits a bar's drag and works out
 * the colour, set_color_bars sets the bars to a picked thing's colour.
 *
 * Deliberate fix (as in M4): the original worked the dragged bar's channel out
 * as 255·h/95 and the others as 255·(h−5)/95, so a full bar could pass 255;
 * every bar uses the second here, clamped to 0–255.
 */

const PK = 10; // Pkboxsize
/** tools.h's Colorbarheight, Mincolorbarheight and Chipdepth. */
export const COLORBAR_HEIGHT = 100;
export const MIN_COLORBAR_HEIGHT = 5;
const CHIP_DEPTH = 5;
/** New: between the paint chip and the glass chip. */
const GLASS_GAP = 4;

/** New: the sticker chip's picture till one is chosen: a picture of a picture (sky, sun, hills). */
export const STICKER_PICTURE = {
  text: 'PICTURE',
  aspect: 1,
  image:
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 64 64">' +
        '<rect x="3" y="3" width="58" height="58" rx="4" fill="#bfe3ff" stroke="#fff" stroke-width="4"/>' + // prettier-ignore
        '<circle cx="44" cy="20" r="7" fill="#ffd34d"/>' +
        '<path d="M5 59 L24 30 L36 46 L44 38 L59 59 Z" fill="#3f8f4f"/>' +
        '</svg>',
    ),
};

export interface ColorControl {
  base: CutObject;
  chip: CutObject;
  /** New: the paint chip's see-through quarter (Glasschip). */
  glass: CutObject;
  /** New: the T chip, on the base's left (Letterchip): lettering in the colour of its T. */
  letter: CutObject;
  /** New: the sticker chip, left of the T chip (Stickerchip): the picture on it is what it sticks on. */
  sticker: CutObject;
  bars: [CutObject, CutObject, CutObject];
}

/** create_color_control(world, corner, width) in the environment. */
export function createColorControl(rt: Runtime, corner: V3, width = 120): ColorControl {
  const height = width / 3;
  const depth = width / 2;
  const barWidth = width / 3 - PK;
  const barHeight = width * 0.8;
  const env = rt.environment;
  const at = (x: number, y: number, z: number) =>
    mat4.translation(corner[0] + x, corner[1] + y, corner[2] + z);
  const make = (
    b: ReturnType<typeof createCube>,
    xform: Float64Array,
    color: Rgb,
    name: string | null,
  ) => {
    const o = createObject(b, { name, color, xform, attrs: { props: ['Visible'] } });
    rt.importObjects(env, [o]);
    return o;
  };
  const base = make(
    createCube(width + PK, height, depth),
    at(-PK, 0, 0),
    [150, 150, 150],
    'Colorcontrol',
  );
  const tilt = mat4.rotationAbout([0, 0, 0], [1, 0, 0], (-45 * Math.PI) / 180);
  // The glass chip comes first, and a little apart from the paint chip: a press takes the
  // first thing with an edge within 12 of it, and the glass, a quarter as wide, would be the
  // paint chip's nearly all over. So the paint chip gives up the 8 nearest the glass instead.
  const glass = make(
    createCube((height + PK) / 4, Math.hypot(depth, height), CHIP_DEPTH),
    mat4.multiply(tilt, at(width + height + PK + GLASS_GAP, 0, depth)),
    [255, 255, 255],
    'Glasschip',
  );
  glass.opacity = 0.5;
  rt.addProp(glass, 'Paint');
  rt.adopt(base, glass, true);
  const chip = make(
    createCube(height + PK, Math.hypot(depth, height), CHIP_DEPTH),
    mat4.multiply(tilt, at(width, 0, depth)),
    [255, 255, 255],
    'Paintchip',
  );
  rt.addProp(chip, 'Paint');
  rt.adopt(base, chip, true);
  // The T chip leans as the paint chip does, off the base's other end. Its T is lettering
  // (a TextDecal) on its face, the bars' colour; the chip itself stays grey.
  const letter = make(
    createCube(height + PK, Math.hypot(depth, height), CHIP_DEPTH),
    mat4.multiply(tilt, at(-PK - (height + PK) - GLASS_GAP, 0, depth)),
    [120, 120, 125],
    'Letterchip',
  );
  letter.decals = [
    {
      text: 'T',
      color: [255, 255, 255],
      height: (height + PK) * 0.6,
      at: [(height + PK) / 2, Math.hypot(depth, height) / 2, CHIP_DEPTH],
      normal: [0, 0, 1],
      along: [1, 0, 0],
    },
  ];
  rt.addProp(letter, 'Letter');
  rt.adopt(base, letter, true);
  // The sticker chip, left of it, shows its picture (a sticker on its face).
  const sticker = make(
    createCube(height + PK, Math.hypot(depth, height), CHIP_DEPTH),
    mat4.multiply(tilt, at(-PK - 2 * (height + PK + GLASS_GAP), 0, depth)),
    [120, 120, 125],
    'Stickerchip',
  );
  sticker.decals = [
    {
      ...STICKER_PICTURE,
      color: [255, 255, 255],
      height: (height + PK) * 0.7,
      at: [(height + PK) / 2, Math.hypot(depth, height) / 2, CHIP_DEPTH],
      normal: [0, 0, 1],
      along: [1, 0, 0],
    },
  ];
  rt.addProp(sticker, 'Sticker');
  rt.adopt(base, sticker, true);
  const colours: Rgb[] = [[255, 0, 0], [0, 255, 0], [0, 0, 255]]; // prettier-ignore
  const bars = [0, 1, 2].map((i) => {
    const bar = make(
      createCube(barWidth, barHeight, depth),
      at(i * (barWidth + PK), height, 0),
      colours[i]!,
      null,
    );
    // The top face is the bar's handle (find_face_given_normal(bar, y_axis)).
    const top = bar.brep.faces().find((f) => bar.brep.faceNormal(f)[1] > 0.99)!;
    rt.addProp(rt.features.face(bar, top), 'Hotspot');
    rt.addProp(bar, 'Colorbar');
    rt.adopt(base, bar, true);
    return bar;
  }) as [CutObject, CutObject, CutObject];
  rt.addProp(base, 'Goodies');
  for (const o of [base, chip, glass, letter, sticker, ...bars]) rt.addProp(o, 'Lockedgeometry');
  return { base, chip, glass, letter, sticker, bars };
}

/** The bars a base carries, in order (the children with no name: not the chips). */
function barsOf(base: CutObject): CutObject[] {
  return base.children.filter((c) => c.name === null);
}

const channel = (h: number) =>
  Math.round(
    Math.min(
      255,
      Math.max(0, (255 * (h - MIN_COLORBAR_HEIGHT)) / (COLORBAR_HEIGHT - MIN_COLORBAR_HEIGHT)),
    ),
  );

/** New: the colour a colour control's bars show, read off their heights. */
export function barsColor(rt: Runtime, base: CutObject): Rgb | null {
  const bars = barsOf(base);
  if (bars.length !== 3) return null;
  const rgb = bars.map((b) => {
    const box = rt.bbox(b);
    return box ? channel(box[1][1] - box[0][1]) : 0;
  });
  return [rgb[0]!, rgb[1]!, rgb[2]!];
}

/** New: the T chip's T shows `rgb` (what it letters in). */
export function showOnLetterChip(rt: Runtime, chip: CutObject, rgb: readonly number[]): void {
  const t = chip.decals?.[0];
  if (!t || t.color.every((c, i) => c === rgb[i])) return;
  chip.decals = [{ ...t, color: [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0] }];
  rt.changed(chip);
}

export const COLOR_CRTNS: Partial<Record<string, (rt: Runtime, vm: VM) => void>> = {
  /** CPL_control_color: (colorbar, y-move) → (colour, limited y-move). */
  control_color(rt, vm) {
    const move = vm.pop();
    const barRec = vm.pop();
    const bar = first(barRec);
    if (!bar || bar.type !== T.Obj) return;
    const colorbar = bar as CutObject;
    const base = colorbar.parent!;
    const bb = rt.bbox(base);
    const own = rt.bbox(colorbar);
    if (!bb || !own) return;
    const baseTop = bb[1][1];
    const barTop = own[1][1];
    let dy = move.offset[1] ?? 0;
    const to = barTop + dy;
    if (to < baseTop + MIN_COLORBAR_HEIGHT) dy = baseTop + MIN_COLORBAR_HEIGHT - barTop;
    else if (to > baseTop + COLORBAR_HEIGHT) dy = baseTop + COLORBAR_HEIGHT - barTop;
    const rgb = barsOf(base).map((b) => {
      const box = rt.bbox(b)!;
      const h = b === colorbar ? barTop + dy - baseTop : box[1][1] - box[0][1];
      return channel(h);
    });
    vm.push(colorWord(rgb));
    vm.push(offsetWord([move.offset[0] ?? 0, dy, move.offset[2] ?? 0]));
  },

  /** CPL_set_color_bars: (painted set, bars) — the bars show the first painted thing's colour. */
  set_color_bars(rt, vm) {
    const barsRec = vm.pop();
    const paintedRec = vm.pop();
    const painted = first(paintedRec);
    if (!painted || !barsRec.list) return;
    const rgb = rt.color(painted);
    let i = 0;
    let base: CutObject | null = null;
    for (const b of barsRec.list) {
      if (!b || b.type !== T.Obj || (b as CutObject).name !== null) continue;
      setBarHeight(rt, b as CutObject, rgb[i++] ?? 0);
      base = (b as CutObject).parent;
    }
    // New: the T chip shows what the bars now do.
    const letter = base?.children.find((o) => o.name === 'Letterchip');
    if (letter) showOnLetterChip(rt, letter, rgb);
  },
};

/** set_colorbar_height: the bar's top face goes to the height that shows `value`. */
function setBarHeight(rt: Runtime, bar: CutObject, value: number): void {
  const box = rt.bbox(bar);
  const top = rt.features.face(
    bar,
    bar.brep.faces().find((f) => bar.brep.faceNormal(f)[1] > 0.99) ?? -1,
  );
  if (!box || !bar.brep.isFace(top.id)) return;
  const want = MIN_COLORBAR_HEIGHT + (value / 255) * (COLORBAR_HEIGHT - MIN_COLORBAR_HEIGHT);
  const dy = want - (box[1][1] - box[0][1]);
  if (Math.abs(dy) < 1e-9) return;
  // The bars stand upright (placed by translation only), so a world y step is a local one.
  const b = bar.brep;
  const g = rt.world(bar);
  for (const v of b.vertices())
    if (Math.abs(g.y(v) - box[1][1]) < 1e-6) {
      const [x, y, z] = b.vertexPos(v);
      b.setVertexPos(v, x, y + dy, z);
    }
  rt.changed(bar);
}
