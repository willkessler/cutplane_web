import { P, T, type Feature } from '@cutplane/cpl';
import {
  COLORBAR_HEIGHT,
  MIN_COLORBAR_HEIGHT,
  SelectKind,
  isObject,
  isSub,
  rotateToolHeld,
  scaleBoxes,
  type ColorControl,
  type RotateTool,
  type Runtime,
  type Sub,
  type V3,
} from '@cutplane/behaviors';
import { mat4, subtree, type CutObject, type Mat4 } from '@cutplane/kernel';
import type { HighlightState, Picked } from '../render/highlights.ts';
import type { Model } from '../render/models.ts';
import type { Bar, ToolDrawing, ToolPart } from '../render/rotatetool.ts';
import type { BoxDrawing, Handle } from '../render/scalebox.ts';

/**
 * What the renderers draw, read off the running world: the VM's properties
 * (Selectable, Picked, Active, Visible) and the objects' geometry. Nothing
 * here changes the world.
 */

const KIND: Record<number, 'vertex' | 'edge' | 'face' | 'inPlaneFace' | 'object'> = {
  [SelectKind.Vert]: 'vertex',
  [SelectKind.Edge]: 'edge',
  [SelectKind.Face]: 'face',
  [SelectKind.Inplaneface]: 'inPlaneFace',
  [SelectKind.Shell]: 'object',
  [SelectKind.Obj]: 'object',
};

/**
 * The hover (primary-world selectable), picks and marquee. `magnet`: a magnet drag's
 * face to snap to, which is the hover, and the ghost of what it drags there.
 */
export function highlightState(
  rt: Runtime,
  models: readonly Model[],
  magnet?: {
    target: { face: Sub; at: V3 } | null;
    ghost: Mat4 | null;
    dragged(): CutObject | null;
  },
): HighlightState {
  const modelOf = new Map(models.map((m) => [m.object, m]));
  let hover: HighlightState['hover'];
  let ghost: HighlightState['ghost'];
  const target = magnet?.target && modelOf.get(magnet.target.face.object);
  const dragged = magnet?.dragged();
  if (magnet?.target && magnet.ghost && target && dragged) {
    hover = { model: target, pick: { kind: 'face', id: magnet.target.face.id, at: magnet.target.at } }; // prettier-ignore
    const parts = [...subtree(dragged)].flatMap((o) => modelOf.get(o) ?? []);
    ghost = { models: parts, move: magnet.ghost };
  }
  // A tool or goodie under the crosshair takes it: its code eats the press (env runs first).
  const envBusy = rt.selected(rt.environment).length > 0;
  if (!envBusy && !hover)
    for (const m of models) {
      const s = rt.selectableOf(m.object);
      const kind = KIND[s.kind];
      if (!kind || !s.feature || !rt.vm.props.has(s.feature, P.Selectable)) continue;
      hover = { model: m, pick: { kind, id: isSub(s.feature) ? s.feature.id : -1, at: s.at } };
      break;
    }
  const picked: Picked[] = [];
  for (const f of rt.picked(rt.primary)) {
    if (isObject(f)) picked.push({ kind: 'object', object: f });
    else if (isSub(f)) {
      const m = modelOf.get(f.object);
      if (!m) continue;
      if (f.type === T.Vfe) picked.push({ kind: 'vertex', model: m, id: f.id });
      else if (f.type === T.Evf) picked.push({ kind: 'edge', model: m, id: f.id });
      else if (f.type === T.Fve) picked.push({ kind: 'face', model: m, id: f.id });
    }
  }
  return { hover, picked, marquee: marqueeOf(rt), ghost };
}

/** cursor.cpl's marquee: an environment object of two vertices, drawn as a box between them. */
function marqueeOf(rt: Runtime): { from: V3; to: V3 } | undefined {
  const m = rt.environment.root.children.find((o) => o.drawTechnique === 'draw_marquee_technique');
  if (!m) return undefined;
  const g = rt.world(m);
  const [a, b] = m.brep.vertices();
  if (a === undefined || b === undefined) return undefined;
  return { from: [g.x(a), g.y(a), g.z(a)], to: [g.x(b), g.y(b), g.z(b)] };
}

/** Environment objects under the crosshair, outlined as hovered; a goodie's base outlines the goodie. */
export function outlinedParts(rt: Runtime, envModels: readonly Model[]): Model[] {
  const out = new Set<CutObject>();
  for (const f of rt.selected(rt.environment)) {
    const o = isObject(f) ? f : isSub(f) ? f.object : null;
    if (!o) continue;
    if (rt.vm.props.has(o, P.Goodies)) for (const c of [o, ...o.children]) out.add(c);
    else out.add(o);
  }
  return envModels.filter((m) => out.has(m.object));
}

// ---- the rotate tool ----

const xy = (p: V3): [number, number] => [p[0], p[1]];

/** The rotate tool's parts as the renderer wants them. */
export function toolDrawing(rt: Runtime, t: RotateTool): ToolDrawing {
  const c = rt.firstVertex(t.inner)!;
  const ends = (bar: CutObject) => {
    const b = bar.brep;
    const [v1, v2] = b.edgeVertices(b.edges()[0]!);
    const g = rt.world(bar);
    return [v1, v2].map((v) => ({ v, p: [g.x(v), g.y(v), g.z(v)] as V3 }));
  };
  const bars = { h: t.hbar, v: t.vbar } as const;
  const shown = (f: Feature) => rt.vm.props.has(f, P.Visible);
  const edgeOf = (bar: CutObject) => rt.features.edge(bar, bar.brep.edges()[0]!);
  const show = {
    hbar: shown(edgeOf(t.hbar)),
    vbar: shown(edgeOf(t.vbar)),
    hbaubles: ends(t.hbar).some((e) => shown(rt.features.vertex(t.hbar, e.v))),
    vbaubles: ends(t.vbar).some((e) => shown(rt.features.vertex(t.vbar, e.v))),
  };
  /** The part the crosshair has: the one in use, else the one selectable. */
  const partOf = (prop: number): ToolPart | undefined => {
    if (rt.vm.props.has(t.inner, prop)) return { kind: 'center' };
    for (const bar of ['h', 'v'] as Bar[]) {
      const o = bars[bar];
      if (rt.vm.props.has(edgeOf(o), prop)) return { kind: 'bar', bar };
      const e = ends(o);
      for (let i = 0; i < 2; i++)
        if (rt.vm.props.has(rt.features.vertex(o, e[i]!.v), prop))
          return { kind: 'bauble', bar, end: i === 0 ? 1 : -1 };
    }
    return undefined;
  };
  return {
    center: xy(c),
    show,
    hover: partOf(P.Active) ?? partOf(P.Selectable),
    held: rotateToolHeld(rt) && toolActive(rt, t),
    barDir(bar) {
      const [a] = ends(bars[bar]);
      const d = [a!.p[0] - c[0], a!.p[1] - c[1]];
      const l = Math.hypot(d[0]!, d[1]!) || 1;
      return [d[0]! / l, d[1]! / l];
    },
    bauble(bar, end) {
      const e = ends(bars[bar]);
      return xy(e[end === 1 ? 0 : 1]!.p);
    },
  };
}

/** Is a part of the tool in use (a bar or bauble rolling, or the centre carried)? */
export function toolActive(rt: Runtime, t: RotateTool): boolean {
  const parts = new Set<CutObject>([t.inner, t.hbar, t.vbar]);
  return rt.vm.props
    .features(rt.environment, P.Active)
    .some((f) => parts.has(isObject(f) ? f : (f as Sub).object));
}

// ---- scale boxes ----

function localBox(box: CutObject): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const v of box.brep.vertices()) {
    const p = box.brep.vertexPos(v);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[k]!);
      hi[k] = Math.max(hi[k]!, p[k]!);
    }
  }
  return [lo, hi];
}

/** A box vertex's corner index: bit k set when it is on the high side of axis k. */
function cornerIndex(box: CutObject, v: number): number {
  const [lo, hi] = localBox(box);
  const p = box.brep.vertexPos(v);
  let i = 0;
  for (let k = 0; k < 3; k++) if (Math.abs(p[k]! - hi[k]!) < Math.abs(p[k]! - lo[k]!)) i |= 1 << k;
  return i;
}

/** The scale boxes, their corners and handles, for the renderer. */
export function boxDrawing(rt: Runtime): BoxDrawing<CutObject> {
  const boxes = scaleBoxes(rt, rt.primary.root);
  const corners = (b: CutObject): V3[] => {
    const [lo, hi] = localBox(b);
    return Array.from({ length: 8 }, (_, i) => {
      const p = [0, 1, 2].map((k) => (i & (1 << k) ? hi[k]! : lo[k]!));
      return mat4.transformPoint(b.xform, p[0]!, p[1]!, p[2]!);
    });
  };
  const piercings = (b: CutObject, z: number) => {
    const c = corners(b);
    const out: Extract<Handle<CutObject>, { kind: 'edge' }>[] = [];
    for (let i = 0; i < 8; i++)
      for (const axis of [0, 1, 2] as const) {
        if (i & (1 << axis)) continue;
        const p = c[i]!;
        const q = c[i | (1 << axis)]!;
        if ((p[2] - z) * (q[2] - z) > 0 || p[2] === q[2]) continue;
        const t = (z - p[2]) / (q[2] - p[2]);
        out.push({
          kind: 'edge',
          box: b,
          corner: i,
          axis,
          at: [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), z],
        });
      }
    return out;
  };
  const handleOf = (f: Feature | null | undefined, z: number): Handle<CutObject> | undefined => {
    if (!isSub(f) || !boxes.includes(f.object)) return undefined;
    const b = f.object;
    if (f.type === T.Vfe) return { kind: 'corner', box: b, corner: cornerIndex(b, f.id) };
    if (f.type !== T.Evf) return undefined;
    const [v1, v2] = b.brep.edgeVertices(f.id);
    const i1 = cornerIndex(b, v1);
    const i2 = cornerIndex(b, v2);
    const corner = Math.min(i1, i2);
    const axis = Math.log2(i1 ^ i2) as 0 | 1 | 2;
    const at = piercings(b, z).find((h) => h.corner === corner && h.axis === axis)?.at;
    return at ? { kind: 'edge', box: b, corner, axis, at } : undefined;
  };
  const z = rt.stage.z;
  const picked = rt.picked(rt.primary).find((f) => isSub(f) && boxes.includes((f as Sub).object));
  let hover: Handle<CutObject> | undefined;
  for (const b of boxes) hover ??= handleOf(rt.selectableOf(b).feature, z);
  return { boxes, corners, piercings, hover, dragged: handleOf(picked, z) };
}

// ---- test hooks ----

/** The colour the bars mix (255·(h−5)/95 each), the part under the crosshair, the base's place. */
export function colorState(rt: Runtime, cc: ColorControl) {
  const rgb = cc.bars.map((b) => {
    const bb = rt.bbox(b)!;
    const h = bb[1][1] - bb[0][1];
    return Math.round(
      Math.min(
        255,
        Math.max(0, (255 * (h - MIN_COLORBAR_HEIGHT)) / (COLORBAR_HEIGHT - MIN_COLORBAR_HEIGHT)),
      ),
    );
  });
  let hover: string | null = null;
  for (const f of rt.selected(rt.environment)) {
    const o = isObject(f) ? f : isSub(f) ? f.object : null;
    if (o === cc.base) hover = 'base';
    else if (o === cc.chip) hover = 'chip';
    else if (o && cc.bars.includes(o)) hover = 'bar';
  }
  return { rgb, hover, base: [...cc.base.xform.slice(12, 15)] };
}
