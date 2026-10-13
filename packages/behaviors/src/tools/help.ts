import {
  Brep,
  createObject,
  extrudeFace,
  makeLamina,
  subtree,
  type CutObject,
  type Rgb,
} from '@cutplane/kernel';
import type { Runtime, V3 } from '../runtime.ts';
import { charWidth } from '../text/hershey.ts';
import { readPlate, type PlateSpec } from './plates.ts';
import { DECAL_GAP, DECAL_THICKNESS, applyFrontDecal, registerPadTechniques } from './toolbar.ts';

/**
 * The help pad (new): an orange pad marked "?" at the bottom right. Like the
 * storage pad it is a Dialog (dialog.cpl): a click opens its plate, here lines of
 * help in the plane itself, and another click puts it away. Nothing flat is laid
 * over the room.
 */

export const HELP_SQUARE = 60; // as the storage pad (Storagesquare)
const MAX_X = 510;
const MIN_Y = -382;
/** The plate: how wide, its margin, and each line's height. */
export const HELP_WIDTH = 660;
const MARGIN = 20;
const LINE = 21;
const TEXT_SCALE = 0.95;

export interface HelpLine {
  text: string;
  /** A heading: yellow, a little bigger. */
  heading?: boolean;
}

const WHITE: Rgb = [255, 255, 255];
const YELLOW: Rgb = [255, 255, 0];

/** How wide a line is drawn (Hershey units times its scale). */
export const helpLineWidth = (l: HelpLine): number =>
  [...l.text].reduce((w, c) => w + charWidth(c.charCodeAt(0)), 0) * scaleOf(l);
const scaleOf = (l: HelpLine) => (l.heading ? 1.1 : TEXT_SCALE);

function plateSpec(lines: readonly HelpLine[]): PlateSpec {
  const height = MARGIN * 2 + lines.length * LINE;
  return {
    name: 'Help_Plate',
    size: [HELP_WIDTH, height],
    // Above the pad and leftward, so it stays in the room.
    offset: [HELP_SQUARE - HELP_WIDTH - 25, HELP_SQUARE + 10, 5],
    color: [40, 40, 60],
    code: '<none>',
    labels: lines.map((l, i) => ({
      text: l.text,
      offset: [MARGIN, height - MARGIN - (i + 1) * LINE + 6, 15] as V3,
      color: l.heading ? YELLOW : WHITE,
      pen: 1,
      scale: [scaleOf(l), scaleOf(l) * 1.2],
      style: 'Plain',
    })),
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

/** The help pad and its plate, in the plane at the bottom right. */
export function installHelpPad(rt: Runtime, lines: readonly HelpLine[]): CutObject {
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
  readPlate(rt, pad, plateSpec(lines), () => '');
  rt.adopt(rt.cutplane, pad, true);
  rt.translate(pad, [MAX_X - HELP_SQUARE * 1.5, MIN_Y + HELP_SQUARE * 0.5, rt.cutplane.xform[14]!]);
  rt.addProp(pad, 'Dialog');
  for (const o of subtree(pad)) rt.addProp(o, 'Lockedgeometry');
  rt.vm.resolveObjectRefs();
  return pad;
}
