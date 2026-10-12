import { describe, expect, it } from 'vitest';
import { BOX_OUTDENT, ScaleBoxes } from './scalebox.ts';
import type { Model } from '../render/models.ts';
import { world } from './testworld.ts';

/** A cube from −100 to 100, picked whole, with its box. */
function picked() {
  const w = world([-100, -100, -100]);
  w.drag([0, 0, 0]);
  const boxes = new ScaleBoxes(w.editor, () => w.models);
  boxes.sync();
  return { ...w, boxes };
}

type Range = [number, number];
const span = (m: Model): [Range, Range, Range] => {
  const g = m.world;
  const vs = m.object.brep.vertices();
  const r = (f: (v: number) => number): Range => [
    +Math.min(...vs.map(f)).toFixed(6),
    +Math.max(...vs.map(f)).toFixed(6),
  ];
  return [r((v) => g.x(v)), r((v) => g.y(v)), r((v) => g.z(v))];
};

describe('scale boxes', () => {
  it('appear around picked objects, 20 out, and go when unpicked', () => {
    const { boxes, editor, drag } = picked();
    expect(boxes.boxes).toHaveLength(1);
    const b = boxes.boxes[0]!;
    expect(b.lo).toEqual([-100 - BOX_OUTDENT, -120, -120]);
    expect(b.hi).toEqual([120, 120, 120]);
    // Four vertical box edges pierce the plane at z = 0.
    expect(boxes.piercings(b, 0)).toHaveLength(4);
    drag([0, 400, 0]);
    expect(editor.picked).toEqual([]);
    boxes.sync();
    expect(boxes.boxes).toHaveLength(0);
  });

  it('an edge handle scales the two axes across it, about the opposite edge', () => {
    const { boxes, models } = picked();
    // The edge at (120, 120) running in z: pull it out to (220, 170).
    expect(boxes.handleAt([121, 118, 0])?.kind).toBe('edge');
    boxes.press([120, 120, 0]);
    boxes.move([220, 170, 0], false);
    boxes.release();
    // About (−120, −120): x grows 340/240, y 290/240; z unchanged.
    const [x, y, z] = span(models[0]!);
    expect(x[0]).toBeCloseTo(-120 + 20 * (340 / 240));
    expect(x[1]).toBeCloseTo(-120 + 220 * (340 / 240));
    expect(y[1]).toBeCloseTo(-120 + 220 * (290 / 240));
    expect(z).toEqual([-100, 100]);
  });

  it('a corner scales in depth when the plane carries it', () => {
    const { boxes, models, state } = picked();
    state.z = 120;
    expect(boxes.handleAt([118, 118, 118])).toMatchObject({ kind: 'corner', corner: 7 });
    boxes.press([120, 120, 120]);
    boxes.move([120, 120, 360], false);
    boxes.release();
    const [x, , z] = span(models[0]!);
    expect(x).toEqual([-100, 100]);
    // About the far corner (z = −120): 240 → 480, so the cube goes from −80 to 320.
    expect(z[0]).toBeCloseTo(-120 + 20 * 2);
    expect(z[1]).toBeCloseTo(-120 + 220 * 2);
  });

  it('Ctrl scales uniformly about the centre', () => {
    const { boxes, models } = picked();
    boxes.press([120, 120, 0]);
    boxes.move([240, 240, 0], true);
    boxes.release();
    const [x, y, z] = span(models[0]!);
    expect(x).toEqual([-200, 200]);
    expect(y).toEqual([-200, 200]);
    expect(z).toEqual([-200, 200]);
  });

  it('never turns the solid inside out', () => {
    const { boxes, models } = picked();
    boxes.press([120, 120, 0]);
    boxes.move([-400, -400, 0], false);
    boxes.release();
    const [x] = span(models[0]!);
    expect(x[1] - x[0]).toBeGreaterThan(0);
  });

  it('the box follows its object when it moves, and undo puts the scale back', () => {
    const { boxes, models, editor, drag } = picked();
    drag([0, 0, 0], [50, 0, 0]);
    boxes.sync();
    const corners = boxes.corners(boxes.boxes[0]!);
    expect(corners[7]).toEqual([170, 120, 120]);
    boxes.press([170, 120, 0]);
    boxes.move([270, 120, 0], false);
    boxes.release();
    expect(span(models[0]!)[0][1]).toBeGreaterThan(150);
    editor.undo();
    expect(span(models[0]!)[0]).toEqual([-50, 150]);
  });

  it('an edge handle slides along its edge with the plane, then its corner takes over', () => {
    const { boxes, models } = picked();
    boxes.press([120, 120, 0]);
    // The plane moves toward the viewer while held: the handle slides, nothing scales...
    boxes.move([120, 120, 50], false);
    expect(span(models[0]!)[2]).toEqual([-100, 100]);
    expect(boxes.dragged?.kind).toBe('edge');
    // ...until it reaches the front corner, which then scales in depth.
    boxes.move([120, 120, 115], false);
    expect(boxes.dragged).toMatchObject({ kind: 'corner', corner: 7 });
    boxes.move([120, 120, 235], false);
    boxes.release();
    const [x, , z] = span(models[0]!);
    expect(x).toEqual([-100, 100]);
    expect(z[1]).toBeGreaterThan(150);
  });
});
