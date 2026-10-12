import { describe, expect, it } from 'vitest';
import { P, T } from '@cutplane/cpl';
import { scaleBoxes } from '../src/index.ts';
import { world } from './world.ts';

/** The cube (200 across, centred) picked whole, so rom.cpl has put a scale box round it. */
function picked() {
  const w = world();
  w.at(0, 0, 0);
  w.controls.pressPick(false);
  w.frame();
  w.controls.releasePick();
  w.frame();
  return w;
}

const extent = (w: ReturnType<typeof world>, k: 0 | 1 | 2) => {
  const g = w.rt.world(w.cube);
  const xs = w.cube.brep.vertices().map((v) => [g.x(v), g.y(v), g.z(v)][k]!);
  return [Math.min(...xs), Math.max(...xs)];
};

describe('scale boxes through rom.cpl and scalebbox.cpl', () => {
  it('picking a whole object puts a box round it, 20 out; it is not an undoable step', () => {
    const w = picked();
    const [box] = scaleBoxes(w.rt, w.rt.primary.root);
    expect(box).toBeDefined();
    expect(w.cube.parent).toBe(box);
    expect(w.cube.linked).toBe(false);
    const bb = w.rt.bbox(box!)!;
    expect(bb[0]).toEqual([-120, -120, -120]);
    expect(bb[1]).toEqual([120, 120, 120]);
    expect(w.rt.canUndo).toBe(false);
    // Pressing again re-picks it (_Pickit: the old box goes, a new one comes), and
    // dragging the object brings its box along.
    w.controls.pressPick(false);
    w.frame();
    w.move(30, 0);
    w.controls.releasePick();
    w.frame();
    const boxes = scaleBoxes(w.rt, w.rt.primary.root);
    expect(boxes).toHaveLength(1);
    expect(w.rt.bbox(boxes[0]!)![0][0]).toBe(-90);
    expect(w.cube.parent).toBe(boxes[0]);
  });

  it('an edge handle (where a box edge pierces the plane) scales across the edge', () => {
    const w = picked();
    w.at(120, 120, 0);
    const sel = w.rt.selected();
    expect(sel.map((f) => f.type)).toEqual([T.Evf]);
    w.controls.pressPick(false);
    w.frame();
    w.move(15, 0);
    w.move(15, 0); // 30 out from the opposite edge's 240: x scales by 270/240
    w.controls.releasePick();
    w.frame();
    const [lo, hi] = extent(w, 0);
    expect(lo).toBeCloseTo(-120 + 20 * (270 / 240));
    expect(hi).toBeCloseTo(-120 + 220 * (270 / 240));
    expect(extent(w, 1)).toEqual([-100, 100]);
    // The crosshair stayed on the handle.
    expect(w.stage.x).toBeCloseTo(150);
    // One step; undo takes the box away and puts the cube back.
    expect(w.rt.undo()).toBe(true);
    expect(extent(w, 0)).toEqual([-100, 100]);
    expect(scaleBoxes(w.rt, w.rt.primary.root)).toHaveLength(0);
    expect(w.cube.parent).toBe(w.rt.primary.root);
    expect(w.rt.vm.props.has(w.cube, P.Picked)).toBe(false);
  });

  it('a corner scales about the opposite corner, and no side goes below 1', () => {
    const w = picked();
    w.at(120, 120, 120);
    expect(w.rt.selected().map((f) => f.type)).toEqual([T.Vfe]);
    w.controls.pressPick(false);
    w.frame();
    w.move(-30, 0);
    w.move(-30, 0); // x: 240 → 180
    expect(extent(w, 0)[1]).toBeCloseTo(-120 + 220 * 0.75);
    expect(extent(w, 1)).toEqual([-100, 100]);
    w.move(-400, 0); // past the opposite side: the box stops at 1 across
    const [box] = scaleBoxes(w.rt, w.rt.primary.root);
    const bb = w.rt.bbox(box!)!;
    expect(bb[1][0] - bb[0][0]).toBeCloseTo(1);
    expect(extent(w, 0)[1]).toBeGreaterThan(extent(w, 0)[0]);
    w.controls.releasePick();
    w.frame();
  });

  it('with Ctrl (cursor.cpl forwards Constraining to the handle) a corner scales uniformly about the centre', () => {
    const w = picked();
    w.at(120, 120, 120);
    w.controls.setConstrain(true);
    w.frame();
    w.controls.pressPick(false);
    w.frame();
    w.move(30, 0);
    w.move(30, 0);
    w.controls.releasePick();
    w.frame();
    w.controls.setConstrain(false);
    w.frame();
    // The push along the centre-to-corner diagonal (120, 120, 120): 60 in x.
    const s = 1 + (60 * 120) / (3 * 120 * 120);
    for (const k of [0, 1, 2] as const) {
      const [lo, hi] = extent(w, k);
      expect(lo).toBeCloseTo(-100 * s);
      expect(hi).toBeCloseTo(100 * s);
    }
  });
});
