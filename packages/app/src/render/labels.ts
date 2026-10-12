import * as THREE from 'three';
import { P } from '@cutplane/cpl';
import { HERSHEY, charWidth, type Runtime } from '@cutplane/behaviors';
import { mat4, subtree, type CutObject } from '@cutplane/kernel';

/** text.h's Shadowoffset; hershey.c's X-height and descender. */
const SHADOW = 2;
const X_HEIGHT = 13.6383;
const DESCENDER = -3.81813;

/**
 * Labels in the Hershey stroke font, as draw_obj_label drew them: each text
 * item at its offset in its object's frame, scaled; a Shadow item gets a
 * black copy behind it; a text input being typed into shows a red I-beam.
 */
export class LabelView {
  readonly object: THREE.LineSegments;

  constructor() {
    this.object = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }),
    );
    this.object.frustumCulled = false;
    this.object.renderOrder = 50;
  }

  update(rt: Runtime): void {
    const pos: number[] = [];
    const col: number[] = [];
    for (const o of subtree(rt.environment.root)) {
      if (!rt.vm.props.has(o, P.Visible)) continue;
      for (const item of rt.labelItems(o)) {
        const [ox, oy, oz] = item.offset;
        const c = item.color.map((v) => v / 255);
        const text = item.text ?? '';
        if (item.style === 'Shadow')
          strokes(
            o,
            text,
            ox + SHADOW,
            oy - SHADOW,
            oz - SHADOW,
            item.xscale,
            item.yscale,
            [0, 0, 0],
            pos,
            col,
          );
        strokes(o, text, ox, oy, oz, item.xscale, item.yscale, c, pos, col);
        if (item.insertion >= 0) {
          let x = 0;
          for (let i = 0; i < item.insertion && i < text.length; i++)
            x += charWidth(text.charCodeAt(i));
          const at = (y: number) => place(o, ox + x * item.xscale, oy + y * item.yscale, oz);
          pos.push(...at(DESCENDER), ...at(X_HEIGHT));
          col.push(1, 0, 0, 1, 0, 0);
        }
      }
    }
    this.object.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.object.geometry = g;
  }
}

/** A point in an object's frame, in the room. */
const place = (o: CutObject, x: number, y: number, z: number): number[] => [
  ...mat4.transformPoint(o.xform, x, y, z),
];

/** objstr: a string's strokes, advancing by each character's width. */
function strokes(
  o: CutObject,
  text: string,
  x0: number,
  y0: number,
  z: number,
  sx: number,
  sy: number,
  color: readonly number[],
  pos: number[],
  col: number[],
): void {
  let x = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    for (const s of HERSHEY[code]?.[1] ?? [])
      for (let i = 0; i + 3 < s.length; i += 2) {
        pos.push(
          ...place(o, x0 + (x + s[i]!) * sx, y0 + s[i + 1]! * sy, z),
          ...place(o, x0 + (x + s[i + 2]!) * sx, y0 + s[i + 3]! * sy, z),
        );
        col.push(...color, ...color);
      }
    x += charWidth(code);
  }
}
