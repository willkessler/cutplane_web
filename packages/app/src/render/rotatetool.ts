import * as THREE from 'three';
import { BAUBLE_SIZE, CENTER_SIZE as ROTATE_CENTER, ROTATE_RADIUS } from '@cutplane/behaviors';
import { CLASSIC } from '../viewer/palette.ts';
import { Lines, circle, group } from './lines.ts';

type V2 = [number, number];
export type Bar = 'h' | 'v';
export type ToolPart =
  { kind: 'center' } | { kind: 'bar'; bar: Bar } | { kind: 'bauble'; bar: Bar; end: 1 | -1 };

/** The tool as drawn: its centre, which bars and baubles show, the part the crosshair has. */
export interface ToolDrawing {
  center: V2;
  show: { hbar: boolean; vbar: boolean; hbaubles: boolean; vbaubles: boolean };
  hover: ToolPart | undefined;
  /** Held at a stop (new): the baubles and the crosshair's ring are drawn half as big again. */
  held: boolean;
  barDir(bar: Bar): V2;
  bauble(bar: Bar, end: 1 | -1): V2;
}

/** Rotatetooldepth: the white copy sits this far right, down and toward the viewer of the black. */
const DEPTH = 2;
/** How much bigger the baubles are drawn while the tool is held at a stop (new). */
const HELD_SCALE = 1.5;

/**
 * The rotate tool as grafx.c drew it, in the plane: white with a black drop
 * shadow, a dashed copy in the plane's colour showing through models, and
 * yellow where the crosshair has hold of it.
 */
export class RotateToolView {
  readonly object: THREE.Group;
  private readonly through = new Lines({
    color: CLASSIC.cutplane,
    width: 1,
    dashed: true,
    dash: 4,
    depthTest: false,
    renderOrder: 38,
  });
  private readonly black = new Lines({ color: CLASSIC.black, width: 2, renderOrder: 39 });
  private readonly white = new Lines({ color: CLASSIC.white, width: 2, renderOrder: 40 });
  private readonly hot = new Lines({
    color: CLASSIC.yellow,
    width: 2,
    depthTest: false,
    renderOrder: 42,
  });
  private readonly hotShadow = new Lines({
    color: CLASSIC.black,
    width: 2,
    depthTest: false,
    renderOrder: 41,
  });

  constructor() {
    this.object = group(this.through, this.black, this.white, this.hotShadow, this.hot);
  }

  update(tool: ToolDrawing, z: number, crosshair: readonly [number, number]): void {
    const [cx, cy] = tool.center;
    const through: number[] = [];
    const black: number[] = [];
    const white: number[] = [];
    const hot: number[] = [];
    const hotShadow: number[] = [];
    const d = DEPTH;
    const bauble = BAUBLE_SIZE * (tool.held ? HELD_SCALE : 1);

    // The centre ring and the outer circle: black, with the white copy offset.
    const centerHot = tool.hover?.kind === 'center';
    circle(cx, cy, z, ROTATE_CENTER, 32, through);
    if (centerHot) {
      circle(cx, cy, z, ROTATE_CENTER, 32, hotShadow);
      circle(cx + d, cy - d, z + d, ROTATE_CENTER, 32, hot);
    } else {
      circle(cx, cy, z, ROTATE_CENTER, 32, black);
      circle(cx + d, cy - d, z + d, ROTATE_CENTER, 32, white);
    }
    circle(cx, cy, z, ROTATE_RADIUS + 4, 48, through);
    circle(cx, cy, z, ROTATE_RADIUS, 48, black);
    circle(cx + d, cy - d, z + d, ROTATE_RADIUS, 48, white);

    // The bars and their baubles: white, with the black copy offset.
    for (const bar of ['h', 'v'] as Bar[]) {
      const dir = tool.barDir(bar);
      if (tool.show[`${bar}bar`]) {
        const a = [cx - ROTATE_RADIUS * dir[0], cy - ROTATE_RADIUS * dir[1]];
        const b = [cx + ROTATE_RADIUS * dir[0], cy + ROTATE_RADIUS * dir[1]];
        through.push(a[0]!, a[1]!, z, b[0]!, b[1]!, z);
        white.push(a[0]!, a[1]!, z, b[0]!, b[1]!, z);
        black.push(a[0]! + d, a[1]! - d, z + d, b[0]! + d, b[1]! - d, z + d);
      }
      if (tool.show[`${bar}baubles`])
        for (const end of [1, -1] as const) {
          const [bx, by] = tool.bauble(bar, end);
          circle(bx, by, z, bauble, 16, through);
          circle(bx, by, z, bauble, 16, white);
          circle(bx + d, by - d, z + d, bauble, 16, black);
        }
    }

    // draw_big_circular_selectbox: a ring at the crosshair over a bar or bauble.
    if (tool.hover && tool.hover.kind !== 'center') {
      const [x, y] = crosshair;
      circle(x, y, z, bauble, 16, hotShadow);
      circle(x + d, y - d, z + d, bauble, 16, hot);
    }

    this.through.set(through);
    this.black.set(black);
    this.white.set(white);
    this.hot.set(hot);
    this.hotShadow.set(hotShadow);
  }
}
