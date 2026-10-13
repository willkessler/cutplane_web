import { subtree, type CutObject, type Rgb } from '@cutplane/kernel';
import type { Runtime, V3 } from '../runtime.ts';
import { charWidth } from '../text/hershey.ts';
import { readPlate, type PlateSpec } from './plates.ts';
import { registerPadTechniques } from './toolbar.ts';

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

/** The help pad and its plate, in the plane at the bottom right. */
export function installHelpPad(rt: Runtime, lines: readonly HelpLine[]): CutObject {
  registerPadTechniques(rt);
  const pad = rt.makeObj(rt.environment, [0, 0, 0], 'HelpPad', ['Nonmanifold', 'Noshadow'], {
    selectTechnique: 'set_normalpad_selectable',
    drawTechnique: 'draw_plate_technique',
  });
  rt.addVertexEdge(pad, pad.brep.vertices()[0]!, [HELP_SQUARE, HELP_SQUARE, 0]);
  pad.color = [255, 110, 10];
  rt.addLabelItem(pad, '?', [17, 9, 12], {
    color: [...WHITE],
    penWidth: 3,
    xscale: 2.6,
    yscale: 2.4,
  });
  rt.translate(pad, [0, 0, 10]);
  readPlate(rt, pad, plateSpec(lines), () => '');
  rt.adopt(rt.cutplane, pad, true);
  rt.translate(pad, [MAX_X - HELP_SQUARE * 1.5, MIN_Y + HELP_SQUARE * 0.5, rt.cutplane.xform[14]!]);
  rt.addProp(pad, 'Dialog');
  for (const o of subtree(pad)) rt.addProp(o, 'Lockedgeometry');
  rt.vm.resolveObjectRefs();
  return pad;
}

/** New help text (another input profile): the plate's lines are rewritten in place. */
export function setHelpText(rt: Runtime, pad: CutObject, lines: readonly HelpLine[]): void {
  const plate = pad.children.find((c) => c.name === 'Help_Plate');
  if (!plate) return;
  const items = rt.labelItems(plate);
  items.length = 0;
  for (const l of plateSpec(lines).labels)
    rt.addLabelItem(plate, l.text, l.offset, {
      color: [...l.color],
      penWidth: l.pen,
      xscale: l.scale[0],
      yscale: l.scale[1],
    });
}
