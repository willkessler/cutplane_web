import {
  Brep,
  createObject,
  extrudeFace,
  makeLamina,
  subtree,
  type CutObject,
  type Rgb,
} from '@cutplane/kernel';
import { P } from '@cutplane/cpl';
import type { Runtime, V3 } from '../runtime.ts';
import { charWidth } from '../text/hershey.ts';
import { readPlate, type PlateSpec } from './plates.ts';
import { DECAL_GAP, DECAL_THICKNESS, applyFrontDecal, registerPadTechniques } from './toolbar.ts';

/**
 * The help pad (new): an orange pad marked "?" at the bottom right. Like the
 * storage pad it is a Dialog (dialog.cpl): a click opens its plate, the keys plate,
 * and another click puts it away. The keys plate lists the shortcut keys, the tools
 * and the files in headed groups, a key (or a tool's name) in yellow and what it does
 * in white beside it. It hangs off the plane's right side, just outside the room,
 * so nothing is laid over the room; it moves with the plane, and seen from far round
 * to a side it is seen edge on.
 */

export const HELP_SQUARE = 60; // as the storage pad (Storagesquare)
const MAX_X = 510;
const MIN_Y = -382;

const WHITE: Rgb = [255, 255, 255];
const YELLOW: Rgb = [255, 255, 0];
const ORANGE: Rgb = [255, 140, 40];

const KEYS_MARGIN = 14;
const KEYS_LINE = 15;
const KEYS_SCALE = 0.58;
/** A heading's: a little bigger, with a little room above it. */
const KEYS_HEADING_SCALE = 0.66;
const KEYS_HEADING_GAP = 6;
/** Clear of the room's right wall. */
const KEYS_GAP = 16;

/** A key and what it does, or a group's heading. */
export type KeysLine = readonly [string, string] | { readonly heading: string };

const textWidth = (s: string, scale = KEYS_SCALE) =>
  [...s].reduce((w, c) => w + charWidth(c.charCodeAt(0)), 0) * scale;
const isKey = (l: KeysLine): l is readonly [string, string] => !('heading' in l);

/** The keys plate's size: how wide (its widest line) and how tall. */
export function keysPlateSize(lines: readonly KeysLine[]): [number, number] {
  const keys = lines.filter(isKey);
  const keyColumn = Math.max(...keys.map(([k]) => textWidth(k))) + 10;
  const width =
    KEYS_MARGIN * 2 +
    Math.max(
      keyColumn + Math.max(...keys.map(([, a]) => textWidth(a))),
      ...lines.flatMap((l) => (isKey(l) ? [] : [textWidth(l.heading, KEYS_HEADING_SCALE)])),
    );
  const gaps = lines.filter((l, i) => !isKey(l) && i > 0).length;
  return [width, KEYS_MARGIN * 2 + lines.length * KEYS_LINE + gaps * KEYS_HEADING_GAP];
}

/** The keys plate, `offset` from its pad. */
function keysPlateSpec(
  lines: readonly KeysLine[],
  offset: (height: number) => V3,
  name = 'Keys_Plate',
): PlateSpec {
  const [width, height] = keysPlateSize(lines);
  const keyColumn = Math.max(...lines.filter(isKey).map(([k]) => textWidth(k))) + 10;
  // Each line's baseline, down from the top; a heading after the first has a gap above.
  const tops: number[] = [];
  let y = KEYS_MARGIN;
  lines.forEach((l, i) => {
    if (!isKey(l) && i > 0) y += KEYS_HEADING_GAP;
    y += KEYS_LINE;
    tops.push(y);
  });
  const label = (text: string, x: number, i: number, color: Rgb, scale = KEYS_SCALE) => ({
    text,
    offset: [x, height - tops[i]! + 4, 5] as V3,
    color,
    pen: 1,
    scale: [scale, scale * 1.2] as [number, number],
    style: 'Plain' as const,
  });
  return {
    name,
    size: [width, height],
    offset: offset(height),
    color: [40, 40, 60],
    code: '<none>',
    labels: lines.flatMap((l, i) =>
      isKey(l)
        ? [label(l[0], KEYS_MARGIN, i, YELLOW), label(l[1], KEYS_MARGIN + keyColumn, i, WHITE)]
        : [label(l.heading, KEYS_MARGIN, i, ORANGE, KEYS_HEADING_SCALE)],
    ),
    inputs: [],
  };
}

/**
 * The pad's picture: a "?" made solid, as the other icons are solids: its hook
 * an outline a stroke wide (offset either side, mitred at the bends) and its
 * dot a square, extruded.
 */
function questionMark(rt: Runtime): CutObject {
  const R = 1.25; // half a stroke's width
  const D = 3; // its depth
  const solid = (outline: [number, number][]) => {
    const brep = new Brep();
    const { front, back } = makeLamina(
      brep,
      outline.map(([x, y]) => [x, y, 0] as V3),
    );
    extrudeFace(brep, brep.faceNormal(front)[2] > 0 ? front : back, 0, 0, D);
    const o = createObject(brep, { color: [...WHITE], attrs: { props: ['Visible'] } });
    rt.importObjects(rt.environment, [o]);
    return o;
  };
  const parts: CutObject[] = [];
  // The hook: round over the top from the left, curling in to the stem; then the dot.
  const strokes: [number, number][][] = [[]];
  for (let k = 0; k <= 16; k++) {
    const t = Math.PI * (0.85 - (1.35 * k) / 16);
    strokes[0]!.push([5 * Math.cos(t), 13 + 5 * Math.sin(t)]);
  }
  strokes[0]!.push([0, 6.5], [0, 4.5]);
  strokes.push([[0, 0]]);
  for (const pts of strokes) {
    if (pts.length === 1) {
      const [x, y] = pts[0]!;
      const r = R * 1.3;
      parts.push(solid([[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]])); // prettier-ignore
      continue;
    }
    // Each point's offset: along the mean of its segments' normals, lengthened at a bend.
    const side = (k: number): [number, number] => {
      const dir = (i: number) => {
        const [a, b] = [pts[i]!, pts[i + 1]!];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      };
      const d0 = dir(Math.max(0, k - 1));
      const d1 = dir(Math.min(pts.length - 2, k));
      const [nx, ny] = [-(d0[1]! + d1[1]!), d0[0]! + d1[0]!];
      const l = Math.hypot(nx, ny) || 1;
      const cos = (nx / l) * -d1[1]! + (ny / l) * d1[0]!;
      const m = R / Math.max(0.5, cos);
      return [(nx / l) * m, (ny / l) * m];
    };
    const left = pts.map((p, k) => [p[0] + side(k)[0], p[1] + side(k)[1]] as [number, number]);
    const right = pts.map((p, k) => [p[0] - side(k)[0], p[1] - side(k)[1]] as [number, number]);
    parts.push(solid([...right, ...left.reverse()]));
  }
  const [root, ...rest] = parts;
  for (const o of rest) rt.adopt(root!, o, false);
  return root!;
}

/** The help pad, in the plane at the bottom right, and its keys plate. */
export function installHelpPad(rt: Runtime, lines: readonly KeysLine[]): CutObject {
  registerPadTechniques(rt);
  const pad = rt.makeObj(rt.environment, [0, 0, 0], 'HelpPad', ['Nonmanifold', 'Noshadow'], {
    selectTechnique: 'set_normalpad_selectable',
    drawTechnique: 'draw_plate_technique',
  });
  rt.addVertexEdge(pad, pad.brep.vertices()[0]!, [HELP_SQUARE, HELP_SQUARE, 0]);
  pad.color = [255, 110, 10];
  rt.translate(pad, [0, 0, 10]);
  const mark = questionMark(rt);
  applyFrontDecal(rt, mark, pad, DECAL_THICKNESS, DECAL_GAP, HELP_SQUARE / 6);
  rt.discard(mark);
  const at: V3 = [MAX_X - HELP_SQUARE * 1.5, MIN_Y + HELP_SQUARE * 0.5, 0];
  // The plate beside the room's right wall, its middle level with the room's, a
  // little in front of the plane (the pad stands 10 off it).
  readPlate(
    rt,
    pad,
    keysPlateSpec(lines, (height) => [MAX_X + KEYS_GAP - at[0], -height / 2 - at[1], -7]),
    () => '',
  );
  rt.adopt(rt.cutplane, pad, true);
  rt.translate(pad, [at[0], at[1], rt.cutplane.xform[14]!]);
  rt.addProp(pad, 'Dialog');
  for (const o of subtree(pad)) rt.addProp(o, 'Lockedgeometry');
  rt.vm.resolveObjectRefs();
  return pad;
}

/** The help pad's keys plate. */
export const keysPlateOf = (pad: CutObject): CutObject =>
  pad.children.find((c) => c.name === 'Keys_Plate')!;

/** The keys plate shown, or put out of sight (as the help pad's click does). */
export function showKeysPlate(rt: Runtime, plate: CutObject, shown: boolean): void {
  for (const o of subtree(plate))
    if (rt.vm.props.has(o, P.Visible) !== shown) {
      if (shown) rt.vm.props.add(o, P.Visible);
      else rt.vm.props.del(o, P.Visible);
      rt.changed(o);
    }
}

/**
 * New here: the hints plates, one for each kind of thing picked (`sets`), each the
 * keys that matter for it, as the keys plate has them. They hang where the keys plate
 * opens, off the plane's right side, moving with the plane; the app shows the one that
 * fits what is picked (showKeysPlate), none while nothing is, or while ? shows all.
 */
export function installHintPlates(
  rt: Runtime,
  sets: Readonly<Record<string, readonly KeysLine[]>>,
): Map<string, CutObject> {
  const plates = new Map<string, CutObject>();
  const plane = rt.cutplane;
  for (const [name, lines] of Object.entries(sets)) {
    // As the keys plate: clear of the right wall, its middle level with the room's,
    // a little in front of the plane.
    const plate = readPlate(
      rt,
      plane,
      keysPlateSpec(
        lines,
        (height) => [MAX_X + KEYS_GAP - plane.xform[12]!, -height / 2 - plane.xform[13]!, 3],
        `Hints_${name}`,
      ),
      () => '',
    );
    for (const o of subtree(plate)) rt.addProp(o, 'Lockedgeometry');
    plates.set(name, plate);
  }
  return plates;
}
