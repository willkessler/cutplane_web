import { describe, expect, it } from 'vitest';
import { P, T } from '@cutplane/cpl';
import { mat4 } from '@cutplane/kernel';
import {
  PERP_HOLD,
  ROTATE_DOCK,
  ROTATE_RADIUS,
  installRotateTool,
  rotateToolHeld,
} from '../src/index.ts';
import { source, world } from './world.ts';

function setup() {
  const w = world();
  const tool = installRotateTool(w.rt, source);
  w.frame();
  const center = () => w.rt.firstVertex(tool.inner)!;
  const tap = () => {
    w.controls.pressPick(false);
    w.frame();
    w.controls.releasePick();
    w.frame();
  };
  const r = () => {
    w.controls.snapRotateTool();
    w.frame();
    w.frame();
  };
  return { ...w, tool, center, tap, r };
}

/** The angle (degrees) between where the cube's +x face points and +x, about `axis`. */
function turned(w: ReturnType<typeof setup>, axis: 'y' | 'z') {
  const m = w.cube.xform;
  // Row vectors: the local x axis maps to the first row.
  return axis === 'z'
    ? (Math.atan2(m[1]!, m[0]!) * 180) / Math.PI
    : (Math.atan2(-m[2]!, m[0]!) * 180) / Math.PI;
}

describe('the rotate tool through rotatecircle, rotatexbar and rotatebauble.cpl', () => {
  it('starts at the dock, in the plane, squared up', () => {
    const { tool, center, stage, rt, at } = setup();
    const w_at = (z: number) => at(0, 0, z);
    expect(center()).toEqual([ROTATE_DOCK[0], ROTATE_DOCK[1], stage.z]);
    expect(tool.inner.parent).toBe(rt.cutplane);
    // It rides with the plane.
    w_at(-200);
    expect(center()[2]).toBe(-200);
  });

  it('R over a face crossing the plane brings the tool to its section line and picks the face', () => {
    const w = setup();
    w.at(100, 20, 0);
    w.r();
    const c = w.center();
    expect(c[0]).toBeCloseTo(100);
    expect(c[1]).toBeCloseTo(20);
    const picked = w.rt.picked();
    expect(picked.map((f) => f.type)).toEqual([T.Fve]);
    // The vertical bar lies along the section line and is hidden; the other crosses it.
    expect(
      w.rt.vm.props.has(w.rt.features.edge(w.tool.vbar, w.tool.vbar.brep.edges()[0]!), P.Visible),
    ).toBe(false);
    const g = w.rt.world(w.tool.hbar);
    const [a, b] = w.tool.hbar.brep.edgeVertices(w.tool.hbar.brep.edges()[0]!);
    expect(Math.abs(g.y(a) - g.y(b))).toBeLessThan(1e-9);
  });

  it('dragging along the bar rolls what is picked, 1° a unit, the crosshair on the bar; one undo step', () => {
    const w = setup();
    w.at(100, 20, 0);
    w.r();
    w.at(160, 20, 0); // on the horizontal bar, clear of the cube
    w.controls.pressPick(false);
    w.frame();
    w.move(10, 0);
    w.move(10, 8); // only the part along the bar counts
    expect(Math.abs(turned(w, 'y'))).toBeCloseTo(20);
    expect(w.stage.x).toBeCloseTo(180);
    expect(w.stage.y).toBeCloseTo(20);
    w.controls.releasePick();
    w.frame();
    expect(w.rt.undo()).toBe(true);
    expect(turned(w, 'y')).toBeCloseTo(0);
  });

  it('R on nothing squares the tool at the crosshair; a bauble dials what is picked about the plane normal', () => {
    const w = setup();
    w.at(0, 0, 0);
    w.tap(); // pick the cube
    w.at(-300, 0, 0);
    w.r();
    expect(w.center()[0]).toBeCloseTo(-300);
    expect(w.center()[1]).toBeCloseTo(0);
    // R picked what was selectable (nothing), and dropped the cube: pick it again.
    w.at(0, 0, 0);
    w.tap();
    expect(w.rt.picked()).toEqual([w.cube]);
    // The horizontal bar's right bauble.
    w.at(-300 + ROTATE_RADIUS, 0, 0);
    w.controls.pressPick(false);
    w.frame();
    w.move(0, 15);
    w.move(0, 15);
    const deg = (Math.atan2(30, ROTATE_RADIUS) * 180) / Math.PI;
    expect(turned(w, 'z')).toBeCloseTo(deg, 1);
    // The crosshair rides the dial, and the tool turned along.
    expect(Math.hypot(w.stage.x + 300, w.stage.y)).toBeCloseTo(ROTATE_RADIUS);
    const g = w.rt.world(w.tool.hbar);
    const [a, b] = w.tool.hbar.brep.edgeVertices(w.tool.hbar.brep.edges()[0]!);
    expect(
      Math.abs((Math.atan2(g.y(a) - g.y(b), g.x(a) - g.x(b)) * 180) / Math.PI) % 180,
    ).toBeCloseTo(deg, 1);
    w.controls.releasePick();
    w.frame();
  });

  it('R over the centre puts the tool away', () => {
    const w = setup();
    w.at(-300, 0, 0);
    w.r();
    expect(w.center()[0]).toBeCloseTo(-300);
    w.r();
    expect(w.center()[0]).toBeCloseTo(ROTATE_DOCK[0]);
    expect(w.center()[1]).toBeCloseTo(ROTATE_DOCK[1]);
  });
  it('a face nearly in the plane, rolled a little, snaps exactly into it and the rotation ends', () => {
    const w = setup();
    // Tip the cube 3° about x: its front face crosses the plane at z = 100 along y ≈ -2.62.
    const tilt = mat4.rotationAbout([0, 0, 0], [1, 0, 0], (3 * Math.PI) / 180);
    w.cube.xform = mat4.multiply(w.cube.xform, tilt);
    w.cube.invXform = mat4.invert(w.cube.xform)!;
    w.rt.changed(w.cube);
    w.at(0, -2.62, 100);
    w.r();
    const [face] = w.rt.picked();
    expect(face?.type).toBe(T.Fve);
    const n = () => w.rt.world(w.cube).faceNormal((face as { id: number }).id);
    expect(n()[2]).toBeLessThan(0.999);
    // The bar crossing the section line runs along y; roll it 2 units (2°, under the 7.5° limit).
    w.at(0, 60, 100);
    w.controls.pressPick(false);
    w.frame();
    w.move(0, 2);
    expect(n()[2]).toBeCloseTo(1, 9);
    expect(w.rt.picked()).toEqual([]);
    w.controls.releasePick();
    w.frame();
  });
  it('a face rolled to stand across the plane stops there, and holds until pushed on (new: firmer)', () => {
    const w = setup();
    // Tip the cube 20° about y: its +x face crosses the plane at z = 0 along x = 100/cos 20°.
    const tilt = mat4.rotationAbout([0, 0, 0], [0, 1, 0], (20 * Math.PI) / 180);
    w.cube.xform = mat4.multiply(w.cube.xform, tilt);
    w.cube.invXform = mat4.invert(w.cube.xform)!;
    w.rt.changed(w.cube);
    const x = 100 / Math.cos((20 * Math.PI) / 180);
    w.at(x, 0, 0);
    w.r();
    const [face] = w.rt.picked();
    expect(face?.type).toBe(T.Fve);
    const nz = () => w.rt.world(w.cube).faceNormal((face as { id: number }).id)[2];
    expect(nz()).toBeCloseTo(-Math.sin((20 * Math.PI) / 180), 9);
    // Roll along the bar across the section line, 1° a unit, toward standing.
    w.at(x + 60, 0, 0);
    w.controls.pressPick(false);
    w.frame();
    let i = 0;
    while (Math.abs(nz()) > 1e-9 && i++ < 30) w.move(-1, 0);
    expect(i).toBe(16); // caught 5° short of 90°
    const at = w.stage.x;
    // Five moves are the original's pause; then PERP_HOLD more units of push hold it.
    for (let k = 0; k < 5 + PERP_HOLD - 1; k++) w.move(-1, 0);
    expect(Math.abs(nz())).toBeLessThan(1e-9);
    expect(w.stage.x).toBe(at); // the crosshair held too
    w.move(-1, 0);
    w.move(-1, 0);
    expect(nz()).toBeGreaterThan(0.01); // through
    // Back the other way it stops again.
    for (let k = 0; k < 10; k++) w.move(1, 0);
    expect(Math.abs(nz())).toBeLessThan(1e-9);
    expect(rotateToolHeld(w.rt)).toBe(true);
    w.controls.releasePick();
    w.frame();
    // Let go at the stop, then dialled: not held (the baubles drawn as usual) until a dial stop.
    const b = w.rt.firstVertex(w.tool.inner)!;
    w.at(b[0] + ROTATE_RADIUS, b[1], 0);
    w.controls.pressPick(false);
    w.frame();
    w.move(0, 3);
    expect(rotateToolHeld(w.rt)).toBe(false);
    w.controls.releasePick();
    w.frame();
  });
  it('the dial stops every 45° and holds until pushed on (new: the original stopped only at level)', () => {
    const w = setup();
    w.at(0, 0, 0);
    w.tap(); // pick the cube
    w.at(-300, 0, 0);
    w.r();
    w.at(0, 0, 0);
    w.tap();
    w.at(-300 + ROTATE_RADIUS, 0, 0);
    w.controls.pressPick(false);
    w.frame();
    /** A step of `d` along the circle, from where the crosshair is. */
    const step = (d: number) => {
      const r = Math.hypot(w.stage.x + 300, w.stage.y);
      w.move((-w.stage.y / r) * d, ((w.stage.x + 300) / r) * d);
    };
    const toStop = (deg: number) => {
      let i = 0;
      while (!rotateToolHeld(w.rt) && i++ < 200) step(2);
      // At it, not past (to within the tool's grid: its baubles sit on 1/256ths).
      expect(turned(w, 'z')).toBeCloseTo(deg, 1);
      const a = (deg * Math.PI) / 180;
      expect(w.stage.x).toBeCloseTo(-300 + ROTATE_RADIUS * Math.cos(a), 1); // the crosshair on it
      expect(w.stage.y).toBeCloseTo(ROTATE_RADIUS * Math.sin(a), 1);
    };
    toStop(45);
    // rotatebauble.cpl's three-move pause, then PERP_HOLD more units of push hold it.
    for (let k = 0; k < 3; k++) step(2);
    for (let k = 0; k < PERP_HOLD / 2 - 1; k++) step(2);
    expect(turned(w, 'z')).toBeCloseTo(45, 1);
    step(2);
    step(2);
    expect(turned(w, 'z')).toBeGreaterThan(45.5); // through
    expect(rotateToolHeld(w.rt)).toBe(false);
    toStop(90);
    for (let k = 0; k < 3 + PERP_HOLD / 2 + 1; k++) step(2);
    expect(turned(w, 'z')).toBeGreaterThan(90.5);
    // Back the other way it stops again.
    for (let k = 0; k < 4; k++) step(-2);
    expect(rotateToolHeld(w.rt)).toBe(true);
    expect(turned(w, 'z')).toBeCloseTo(90, 1);
    w.controls.releasePick();
    w.frame();
  });

  it('a drag along a bar that runs onto its bauble in one move, and lets go there, lets go (cutplane_web)', () => {
    const w = setup();
    const active = () => w.rt.vm.props.features(w.rt.environment, P.Active);
    // The docked tool's vertical bar, 100 up from its lower bauble; one move past the bauble.
    w.at(ROTATE_DOCK[0], ROTATE_DOCK[1] - ROTATE_RADIUS + 30);
    w.controls.pressPick(false);
    w.frame();
    w.at(ROTATE_DOCK[0], ROTATE_DOCK[1] - ROTATE_RADIUS - 60);
    expect(w.stage.y).toBeCloseTo(ROTATE_DOCK[1] - ROTATE_RADIUS); // stopped at the bauble
    w.controls.releasePick();
    w.frame();
    // Nothing stays on (the bauble used to, after the release), and the crosshair is free.
    expect(active()).toEqual([]);
    w.at(-100, 300);
    expect([w.stage.x, w.stage.y]).toEqual([-100, 300]);
    expect(active()).toEqual([]);
  });
});
