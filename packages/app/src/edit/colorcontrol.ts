import {
  createCube,
  createObject,
  duplicateTree,
  mat4,
  pickAt,
  transformTree,
  type CutObject,
  type ObjectSection,
  type Rgb,
} from '@cutplane/kernel';
import type { Model } from '../render/models.ts';
import type { Editor, V3 } from './editor.ts';

/**
 * The colour control (tools.c's create_color_control, colorbar.cpl,
 * paint.cpl, cplib.c's CPL_control_color): a goodie standing in the room,
 * a base with three bars on it, red, green and blue, and a white paint chip
 * leaning on its end. Like everything in the room it is picked through the
 * section, so the plane has to reach it (Space jumps there: it stands by the
 * back wall, where the Goodies toolbox keeps it).
 *
 * - Drag a bar's top up or down to set how much of its colour there is; what
 *   is picked takes the mixed colour as you go, and so does the chip.
 * - Drag the chip: a copy comes away with the crosshair, and wherever it is
 *   let go, the face or object there takes its colour.
 *
 * The goodies toolbox itself (opening it, taking goodies out) is the CPL
 * environment's (M5); until then the control stands where the box would be.
 *
 * Deliberate fix: the original worked the dragged bar's channel out as
 * 255 · h / 95 and the others as 255 · (h − 5) / 95, so a full bar could go
 * past 255; here every bar uses the second.
 */

/** tools.c: the goodies toolbox's spot, bottom right on the back wall, and the control's width. */
export const COLOR_CORNER: V3 = [510 - 212.5, -382 + 28.3, -499];
const WIDTH = 120;
const PK = 10; // Pkboxsize
const BASE_HEIGHT = WIDTH / 3;
const DEPTH = WIDTH / 2;
const BAR_WIDTH = WIDTH / 3 - PK;
/** colorbar.cpl's Mincolorbarheight and Colorbarheight above the base. */
const BAR_MIN = 5;
const BAR_MAX = 100;
const BAR_START = WIDTH * 0.8;

export type ColorPart = { kind: 'bar'; index: 0 | 1 | 2 } | { kind: 'chip' } | { kind: 'base' };

interface BarDrag {
  kind: 'bar';
  index: 0 | 1 | 2;
  fromY: number;
  height: number;
}
interface ChipDrag {
  kind: 'chip';
  copy: CutObject;
  from: V3;
  xform: Float64Array;
}

const channel = (h: number) => Math.round(Math.min(255, Math.max(0, (255 * (h - BAR_MIN)) / (BAR_MAX - BAR_MIN)))); // prettier-ignore

export class ColorControl {
  /** The control's objects, for the room to draw; the chip's copy joins them while it is carried. */
  readonly roots: CutObject[];
  readonly base: CutObject;
  readonly chip: CutObject;
  readonly bars: [CutObject, CutObject, CutObject];
  heights: [number, number, number] = [BAR_START, BAR_START, BAR_START];
  hover: ColorPart | undefined;
  version = 0;
  private drag: BarDrag | ChipDrag | undefined;

  constructor(
    private readonly editor: Editor,
    private readonly host: {
      models(): readonly Model[];
      section(m: Model): ObjectSection | undefined;
      changed(objects: CutObject[]): void;
      structureChanged(): void;
    },
  ) {
    const [cx, cy, cz] = COLOR_CORNER;
    const at = (x: number, y: number, z: number) => mat4.translation(cx + x, cy + y, cz + z);
    const locked = { props: ['Visible', 'Lockedgeometry'] };
    this.base = createObject(createCube(WIDTH + PK, BASE_HEIGHT, DEPTH), {
      name: 'Colorcontrol',
      color: [150, 150, 150],
      attrs: locked,
      xform: at(-PK, 0, 0),
    });
    const tilt = mat4.rotationAbout([0, 0, 0], [1, 0, 0], (-45 * Math.PI) / 180);
    this.chip = createObject(createCube(BASE_HEIGHT + PK, Math.hypot(DEPTH, BASE_HEIGHT), 5), {
      name: 'Paintchip',
      color: this.rgb,
      attrs: { props: ['Visible', 'Lockedgeometry', 'Paint'] },
      xform: mat4.multiply(tilt, at(WIDTH, 0, DEPTH)),
    });
    const colours: Rgb[] = [[255, 0, 0], [0, 255, 0], [0, 0, 255]]; // prettier-ignore
    this.bars = [0, 1, 2].map((i) =>
      createObject(createCube(BAR_WIDTH, BAR_START, DEPTH), {
        color: colours[i]!,
        attrs: { props: ['Visible', 'Lockedgeometry', 'Colorbar'] },
        xform: at(i * (BAR_WIDTH + PK), BASE_HEIGHT, 0),
      }),
    ) as [CutObject, CutObject, CutObject];
    for (const c of [this.chip, ...this.bars]) {
      c.parent = this.base;
      this.base.children.push(c);
    }
    this.roots = [this.base];
  }

  /** The colour the bars mix. */
  get rgb(): Rgb {
    return this.heights.map(channel) as Rgb;
  }

  get pressed(): boolean {
    return this.drag !== undefined;
  }

  /** What part of the control the crosshair is on, through the section. */
  partAt(cursor: V3): ColorPart | undefined {
    for (const m of this.host.models()) {
      if (m.object === (this.drag as ChipDrag | undefined)?.copy) continue;
      const s = this.host.section(m);
      if (!s || !pickAt(m.world, s, cursor[0], cursor[1], cursor[2])) continue;
      const i = this.bars.indexOf(m.object);
      if (i >= 0) return { kind: 'bar', index: i as 0 | 1 | 2 };
      if (m.object === this.chip) return { kind: 'chip' };
      return { kind: 'base' };
    }
    return undefined;
  }

  updateHover(cursor: V3): void {
    if (this.drag) return;
    const p = this.partAt(cursor);
    if (JSON.stringify(p) !== JSON.stringify(this.hover)) {
      this.hover = p;
      this.version++;
    }
  }

  press(cursor: V3): void {
    const p = this.partAt(cursor);
    if (!p || p.kind === 'base') return;
    this.hover = p;
    if (p.kind === 'bar') {
      this.drag = { kind: 'bar', index: p.index, fromY: cursor[1], height: this.heights[p.index] };
      this.editor.beginPaint();
    } else {
      // paint.cpl: a copy of the chip comes away with the crosshair.
      const copy = duplicateTree(this.chip);
      copy.attrs.props.push('Noshadow');
      this.roots.push(copy);
      this.host.structureChanged();
      this.drag = { kind: 'chip', copy, from: [...cursor], xform: copy.xform.slice() };
    }
    this.version++;
  }

  move(cursor: V3): void {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'bar') {
      const h = Math.min(BAR_MAX, Math.max(BAR_MIN, d.height + cursor[1] - d.fromY));
      if (h === this.heights[d.index]) return;
      this.setHeight(d.index, h);
      this.editor.setPaint(this.rgb);
    } else {
      const c = d.copy;
      c.xform = d.xform.slice();
      c.invXform = mat4.invert(c.xform) ?? c.invXform;
      transformTree(c, mat4.translation(cursor[0] - d.from[0], cursor[1] - d.from[1], cursor[2] - d.from[2])); // prettier-ignore
      this.host.changed([c]);
    }
    this.version++;
  }

  release(cursor: V3): void {
    const d = this.drag;
    if (!d) return;
    this.drag = undefined;
    if (d.kind === 'bar') this.editor.endPaint();
    else {
      this.roots.splice(this.roots.indexOf(d.copy), 1);
      this.host.structureChanged();
      this.editor.updateHover(cursor);
      const target = this.editor.paintTarget();
      if (target) {
        this.editor.beginPaint([target]);
        this.editor.setPaint(this.rgb);
        this.editor.endPaint();
      }
    }
    this.hover = this.partAt(cursor);
    this.version++;
  }

  /** Moves a bar's top face to height h above the base, and recolours the chip. */
  private setHeight(i: 0 | 1 | 2, h: number): void {
    const bar = this.bars[i];
    const b = bar.brep;
    const top = Math.max(...b.vertices().map((v) => b.vy(v)));
    for (const v of b.vertices()) {
      const [x, y, z] = b.vertexPos(v);
      if (y === top) b.setVertexPos(v, x, h, z);
    }
    this.heights[i] = b.vy(b.vertices().find((v) => b.vy(v) !== 0)!);
    this.chip.color = this.rgb;
    this.host.changed([bar, this.chip]);
  }
}
