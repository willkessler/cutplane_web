import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { P } from '@cutplane/cpl';
import { subtree, validate, type CutObject } from '@cutplane/kernel';
import {
  HAND_LONG,
  HAND_WIDE,
  TOOL_MOST,
  decalOf,
  installToolbars,
  markRoom,
  restoreRoom,
  snapshotRoom,
} from '../src/index.ts';
import { world } from './world.ts';

const ASSETS = resolve(import.meta.dirname, '../../../assets');
/** Resources by name, as the original's working directory had them (rsc/, icons/). */
const read = (f: string) => {
  // cutplane_web's own (the rails with the union pad) first, else the original's.
  for (const dir of ['rsc', 'icons', 'original/rsc', 'original/icons']) {
    const p = join(ASSETS, dir, f);
    if (existsSync(p)) return readFileSync(p, 'latin1');
  }
  throw new Error(`${f}: not found`);
};

function setup() {
  const w = world();
  const [tools, arrangers] = installToolbars(w.rt, read, ['toolpads.rsc', 'arrangepads.rsc']);
  w.frame();
  const center = (o: CutObject): [number, number] => {
    const b = w.rt.bbox(o)!;
    return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  };
  const click = (o: CutObject) => {
    const [x, y] = center(o);
    w.at(x, y);
    w.controls.pressPick(false);
    w.frame();
    w.controls.releasePick();
    w.frame();
    w.frame();
  };
  return { ...w, tools: tools!, arrangers: arrangers!, center, click };
}

const visible = (w: ReturnType<typeof setup>, o: CutObject) => w.rt.vm.props.has(o, P.Visible);

describe('toolbars through headpad, toolpad, padhandle and tool.cpl', () => {
  it('builds both rails closed: headpads in the plane with their icons painted on', () => {
    const w = setup();
    expect(w.tools.name).toBe('Toolpads');
    expect(w.tools.parent).toBe(w.rt.cutplane);
    expect(visible(w, w.tools)).toBe(true);
    expect(decalOf(w.rt, w.tools)?.length).toBeGreaterThan(0);
    const bar = w.tools.children[0]!;
    expect(w.rt.hasProp(bar, 'Toolbar')).toBe(true);
    expect(bar.children).toHaveLength(4); // pencil, saw, drill, union
    expect(w.arrangers.children[0]!.children).toHaveLength(7); // ... magnet, grabber, ruler, globe
    expect(visible(w, bar)).toBe(false);
    // Each pad holds its tool, unseen, its picture on the pad.
    const pad = bar.children[0]!.children[0]!;
    expect(w.rt.hasProp(pad, 'Toolpad')).toBe(true);
    expect(w.rt.hasProp(pad.children[0]!, 'Tool')).toBe(true);
    expect(visible(w, pad.children[0]!)).toBe(false);
    expect(decalOf(w.rt, pad)?.length).toBeGreaterThan(0);
    // It rides with the plane.
    const z = w.rt.bbox(w.tools)![0][2];
    w.at(0, 0, 0);
    expect(w.rt.bbox(w.tools)![0][2]).toBeCloseTo(z - 500);
  });

  it("the pan tool's hand (assets/icons/pan.icon, new): closed shells, every face flat", () => {
    const w = setup();
    const hand = w.rt.findObject('Pantool')!;
    expect(w.rt.hasProp(hand, 'Pan')).toBe(true);
    // Its cuff, a child: a tool with none is turned end for end going back on its pad.
    expect(hand.children.map((c) => c.name)).toEqual(['Pancuff']);
    for (const o of [hand, hand.children[0]!]) {
      const r = validate(o.brep, { planarityTolerance: 1e-3 });
      expect(r.closedManifold).toBe(true);
      expect(r.issues).toEqual([]);
    }
    // About 55 high, as small in hand as the other tools.
    const lo = Math.min(...[...subtree(hand)].map((o) => w.rt.bbox(o)![0][1]));
    const hi = Math.max(...[...subtree(hand)].map((o) => w.rt.bbox(o)![1][1]));
    expect(Math.round(hi - lo)).toBeGreaterThan(50);
    expect(Math.round(hi - lo)).toBeLessThanOrEqual(TOOL_MOST);
  });

  it("every tool is at most TOOL_MOST across in hand (the original's pencil, saw and drill were 150)", () => {
    const w = setup();
    const sizes = new Map<string, number>();
    for (const head of [w.tools, w.arrangers])
      for (const handle of head.children[0]!.children) {
        const tool = handle.children[0]!.children[0]!;
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (const o of subtree(tool)) {
          const b = w.rt.bbox(o);
          if (!b) continue;
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k]!, b[0][k]!);
            hi[k] = Math.max(hi[k]!, b[1][k]!);
          }
        }
        sizes.set(tool.name ?? '?', Math.max(...[0, 1, 2].map((k) => hi[k]! - lo[k]!)));
      }
    for (const name of ['Pencil', 'Saw', 'Bit', 'Magnifier', 'Grabberblock'])
      expect(sizes.get(name)).toBeCloseTo(TOOL_MOST, 3);
    expect(sizes.get('Globe')).toBeCloseTo(56, 0); // (small already: left as it is)
    for (const n of sizes.values()) expect(n).toBeLessThanOrEqual(TOOL_MOST + 1e-6);
  });

  it('clicking the headpad opens its rail, pads stacked down it; clicking again closes it', () => {
    const w = setup();
    const bar = w.tools.children[0]!;
    w.click(w.tools);
    expect(visible(w, bar)).toBe(true);
    const handles = bar.children;
    expect(handles.every((h) => visible(w, h) && visible(w, h.children[0]!))).toBe(true);
    const ys = handles.map((h) => w.center(h)[1]);
    expect(ys[0]).toBeGreaterThan(ys[1]!);
    expect(ys[1]).toBeGreaterThan(ys[2]!);
    // The rail reaches down past the last pad.
    expect(w.rt.bbox(bar)![0][1]).toBeLessThan(w.rt.bbox(handles[2]!.children[0]!)![1][1]);
    w.click(w.tools);
    expect(visible(w, bar)).toBe(false);
  });

  it('a toolpad hands over its tool, which rides the crosshair; clicking the pad takes it back', () => {
    const w = setup();
    w.click(w.tools);
    const pad = w.tools.children[0]!.children[0]!.children[0]!;
    const tool = pad.children[0]!;
    w.click(pad);
    expect(w.rt.hasProp(tool, 'Active')).toBe(true);
    expect(visible(w, tool)).toBe(true);
    expect(tool.parent).toBe(w.rt.cursorObj);
    expect(w.rt.hasProp(pad, 'Toolpadempty')).toBe(true);
    expect(decalOf(w.rt, pad)).toBeUndefined();
    // Just in front of the plane, and it follows the crosshair.
    const before = w.rt.bbox(tool)!;
    expect(before[0][2]).toBeGreaterThan(w.stage.z);
    w.move(200, -100);
    const after = w.rt.bbox(tool)!;
    expect(after[0][0]).toBeCloseTo(before[0][0] + 200);
    // Back to the pad: the tool goes back on it and its picture comes back.
    w.click(pad);
    expect(w.rt.hasProp(tool, 'Active')).toBe(false);
    expect(tool.parent).toBe(pad);
    expect(visible(w, tool)).toBe(false);
    expect(decalOf(w.rt, pad)?.length).toBeGreaterThan(0);
    // (The original left it marked Toolpadempty here: the pad had no tool when it
    // was clicked. Here the tool going back on its own pad fills it.)
    expect(w.rt.hasProp(pad, 'Toolpadempty')).toBe(false);
    w.click(pad);
    expect(tool.parent).toBe(w.rt.cursorObj);
    expect(visible(w, tool)).toBe(true);
  });

  it('holding a tool, clicking another pad: the held tool goes back to its own pad', () => {
    const w = setup();
    w.click(w.tools);
    const pads = w.tools.children[0]!.children.map((h) => h.children[0]!);
    const [pencil, saw] = [pads[0]!.children[0]!, pads[1]!.children[0]!];
    w.click(pads[0]!);
    expect(pencil.parent).toBe(w.rt.cursorObj);
    // The original swapped the pencil onto the saw's pad.
    w.click(pads[1]!);
    expect(saw.parent).toBe(w.rt.cursorObj);
    expect(pencil.parent).toBe(pads[0]);
    expect(w.rt.hasProp(pads[0]!, 'Toolpadempty')).toBe(false);
    expect(w.rt.hasProp(pads[1]!, 'Toolpadempty')).toBe(true);
    expect(decalOf(w.rt, pads[1]!)).toBeUndefined();
    // And the saw goes home too, from the pencil's pad or its own.
    w.click(pads[0]!);
    expect(pencil.parent).toBe(w.rt.cursorObj);
    expect(saw.parent).toBe(pads[1]);
    w.click(pads[0]!);
    expect(pencil.parent).toBe(pads[0]);
    expect(pads.every((p) => p.children[0]!.parent === p)).toBe(true);
  });

  it('a tool summoned by key sends the held one to its own pad, not the first empty one', () => {
    const w = setup();
    w.click(w.tools);
    const pads = w.tools.children[0]!.children.map((h) => h.children[0]!);
    const [pencil, union] = [pads[0]!.children[0]!, pads[3]!.children[0]!];
    w.click(pads[3]!);
    expect(union.parent).toBe(w.rt.cursorObj);
    w.controls.takeTool('Pencil');
    for (let i = 0; i < 4; i++) w.frame(); // a message to the pencil, then to its pad
    expect(pencil.parent).toBe(w.rt.cursorObj);
    expect(union.parent).toBe(pads[3]);
    expect(w.rt.hasProp(pads[0]!, 'Toolpadempty')).toBe(true);
  });

  it('every tool goes back on its own pad, whether the pad is clicked or its key pressed again', () => {
    const w = setup();
    const pads = [w.tools, w.arrangers].flatMap((head) => {
      w.click(head);
      return head.children[0]!.children.map((h) => h.children[0]!);
    });
    for (const pad of pads) {
      const tool = pad.children.find((c) => w.rt.hasProp(c, 'Tool'))!;
      w.click(pad);
      expect(tool.parent, tool.name!).toBe(w.rt.cursorObj);
      w.click(pad);
      expect(tool.parent, tool.name!).toBe(pad);
    }
    // H, and H again (the hand, once in one piece, was lost on the way back).
    const hand = w.rt.findObject('Pantool')!;
    const home = hand.parent;
    for (let n = 0; n < 2; n++) {
      w.controls.takeTool('Pantool');
      for (let i = 0; i < 4; i++) w.frame();
      expect(hand.parent).toBe(w.rt.cursorObj);
      w.controls.takeTool('Pantool');
      for (let i = 0; i < 4; i++) w.frame();
      expect(hand.parent).toBe(home);
    }
    for (const pad of pads)
      expect(pad.children.filter((c) => w.rt.hasProp(c, 'Tool'))).toHaveLength(1);
  });

  it(
    'in hand a long tool is HAND_LONG long, any other HAND_WIDE across; on its pad its own size (Esc too)',
    { timeout: 30_000 },
    () => {
      const w = setup();
      // Its spread: the widest two of its points apart, however it's turned.
      const across = (tool: CutObject) => {
        const pts: number[][] = [];
        for (const o of subtree(tool)) {
          const g = w.rt.world(o);
          for (const v of o.brep.vertices()) pts.push([g.x(v), g.y(v), g.z(v)]);
        }
        let most = 0;
        for (const a of pts)
          for (const b of pts)
            most = Math.max(most, Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!));
        return most;
      };
      const pads = [w.tools, w.arrangers].flatMap((head) => {
        w.click(head);
        return head.children[0]!.children.map((h) => h.children[0]!);
      });
      expect(w.controls.putToolInHandAway()).toBe(false);
      for (const pad of pads) {
        const tool = pad.children.find((c) => w.rt.hasProp(c, 'Tool'))!;
        const home = across(tool);
        const box = (() => {
          const lo = [Infinity, Infinity, Infinity];
          const hi = [-Infinity, -Infinity, -Infinity];
          for (const o of subtree(tool)) {
            const b = w.rt.bbox(o);
            if (!b) continue;
            for (let k = 0; k < 3; k++) {
              lo[k] = Math.min(lo[k]!, b[0][k]!);
              hi[k] = Math.max(hi[k]!, b[1][k]!);
            }
          }
          return [0, 1, 2].map((k) => hi[k]! - lo[k]!).sort((x, y) => y - x);
        })();
        const long = ['Pencil', 'Saw', 'Bit', 'Ruler'].includes(tool.name ?? '');
        expect(box[1]! / box[0]! <= 0.45, tool.name!).toBe(long);
        const f = (long ? HAND_LONG : HAND_WIDE) / box[0]!;
        w.click(pad);
        expect(across(tool), tool.name!).toBeCloseTo(home * f, 3);
        w.click(pad);
        expect(across(tool), tool.name!).toBeCloseTo(home, 3);
        // Esc: whatever is in hand goes home.
        w.click(pad);
        expect(w.controls.putToolInHandAway()).toBe(true);
        for (let i = 0; i < 4; i++) w.frame();
        expect(tool.parent, tool.name!).toBe(pad);
        expect(across(tool), tool.name!).toBeCloseTo(home, 3);
        expect(w.rt.hasProp(tool, 'Active')).toBe(false);
      }
    },
  );

  it('H pressed mid-marquee: the hand comes once the button is up, and pans', () => {
    const w = setup();
    const settle = () => {
      for (let i = 0; i < 4; i++) w.frame();
    };
    const drag = (from: [number, number], to: [number, number]) => {
      w.at(...from);
      w.controls.pressPick(false);
      w.frame();
      w.at(...to);
      w.frame();
    };
    const hand = w.rt.findObject('Pantool')!;
    drag([150, -250], [200, -200]);
    expect(w.rt.hasProp(w.rt.cursorObj, 'Marqueeing')).toBe(true);
    w.controls.takeTool('Pantool');
    settle();
    expect(hand.parent).not.toBe(w.rt.cursorObj); // not yet
    w.controls.releasePick();
    settle();
    expect(hand.parent).toBe(w.rt.cursorObj);
    // Taken mid-marquee, it was sent the marqueed set, which it never read, and never
    // saw a press again: every drag marqueed.
    expect(w.rt.vm.pending(hand)).toHaveLength(0);
    const x = w.cube.xform[12]!;
    drag([150, -250], [200, -200]);
    expect(w.rt.hasProp(w.rt.cursorObj, 'Marqueeing')).toBe(false);
    expect(w.cube.xform[12]! - x).toBeCloseTo(50, 6);
    w.controls.releasePick();
    settle();
  });

  it('a marquee dragged with the ruler in hand leaves it no message it would never read', () => {
    const w = setup();
    w.controls.takeTool('Ruler');
    for (let i = 0; i < 4; i++) w.frame();
    const ruler = w.rt.findObject('Ruler')!;
    expect(ruler.parent).toBe(w.rt.cursorObj);
    w.at(150, -250);
    w.controls.pressPick(false);
    w.frame();
    w.at(200, -200);
    w.frame();
    expect(w.rt.hasProp(w.rt.cursorObj, 'Marqueeing')).toBe(true);
    w.controls.releasePick();
    for (let i = 0; i < 4; i++) w.frame();
    expect(w.rt.vm.pending(ruler)).toHaveLength(0);
  });

  it('a tool left in hand comes back in hand on the next visit, and goes away again', () => {
    const a = setup();
    markRoom(a.rt);
    a.controls.takeTool('Pencil');
    for (let i = 0; i < 4; i++) a.frame();
    const snap = JSON.parse(JSON.stringify(snapshotRoom(a.rt)));
    const b = setup();
    markRoom(b.rt);
    expect(restoreRoom(b.rt, snap)).toBe(true);
    b.frame();
    const pencil = b.rt.findObject('Pencil')!;
    expect(pencil.parent).toBe(b.rt.cursorObj);
    expect(b.rt.hasProp(pencil, 'Active')).toBe(true);
    expect(b.controls.putToolInHandAway()).toBe(true);
    for (let i = 0; i < 4; i++) b.frame();
    expect(b.rt.hasProp(pencil.parent!, 'Toolpad')).toBe(true);
    // A room kept before Active was: not put back (its tool would be stuck in hand).
    const c = setup();
    markRoom(c.rt);
    expect(restoreRoom(c.rt, { ...snap, version: undefined })).toBe(false);
  });

  it('a padhandle pulled off the rail floats where it is let go', () => {
    const w = setup();
    w.click(w.arrangers);
    const bar = w.arrangers.children[0]!;
    const handle = bar.children[1]!;
    const [x, y] = w.center(handle);
    w.at(x, y);
    w.controls.pressPick(false);
    w.frame();
    w.move(150, -60);
    w.move(100, 0);
    w.controls.releasePick();
    w.frame();
    w.frame();
    expect(handle.parent).toBe(w.rt.cutplane);
    expect(bar.children).toHaveLength(6);
    expect(w.center(handle)[0]).toBeCloseTo(x + 250, 0);
  });
});
