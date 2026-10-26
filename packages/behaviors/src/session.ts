import {
  mat4,
  preorder,
  transformTree,
  type CutObject,
  type Mat4,
  type Rgb,
} from '@cutplane/kernel';
import { TRANSIENT_PROPS, type Runtime } from './runtime.ts';
import { bulbLightOf, setBulbLight, type BulbLight } from './tools/toolbox.ts';

/**
 * New here: the room as it was left, for the next visit. The environment is built
 * the same way every time, so each of its objects is known by its place in the
 * order it was built in; a snapshot keeps, for each, where it hangs in the tree,
 * where it is, its properties (shown or not, a toolbox open, a pad empty...) and
 * its shape where that changed (the rotate tool's bars). The rails open or shut,
 * the goodies out in the room, the rotate tool where it was left: all come back.
 */

/** One object of the environment, as it was. */
interface Kept {
  /** Its parent's place in the build order (-1: the environment itself). */
  parent: number;
  linked: boolean;
  xform: number[];
  color: number[];
  props: [string, PropValue][];
  /** Its vertices', edges' and faces' properties, by type and id. */
  subs: [number, number, [string, PropValue][]][];
  /** Its vertices, where they moved since it was built. */
  verts?: number[];
}
type PropValue = number | string | boolean;

/**
 * Not kept: what only means something while the program runs. A tool's Active is
 * kept, unlike in a .cut file: the tool comes back in hand, and in hand it must be
 * Active to be put away.
 */
const UNKEPT = new Set([...TRANSIENT_PROPS].filter((n) => n !== 'Active'));
/** Snapshots of another version (before Active was kept, tools in hand at pad size) don't fit. */
const VERSION = 2;

export interface RoomSnapshot {
  /** The built objects' names, in order: a snapshot fits only the room it came from. */
  names: string;
  version?: number;
  objects: (Kept | null)[];
  /** The light the bulb set, if it has been moved (it stays where it was set). */
  light?: BulbLight;
}

interface Built {
  objects: CutObject[];
  verts: Float64Array[];
}
const built = new WeakMap<Runtime, Built>();

const positions = (o: CutObject): Float64Array => {
  const vs = o.brep.vertices();
  const out = new Float64Array(vs.length * 3);
  vs.forEach((v, i) => out.set(o.brep.vertexPos(v), i * 3));
  return out;
};
const same = (a: Float64Array, b: Float64Array) => a.length === b.length && a.every((x, i) => x === b[i]); // prettier-ignore
const signature = (objects: CutObject[]) => objects.map((o) => o.name ?? '').join('|');

/** Takes note of the room as built: call once every tool and goodie is in it. */
export function markRoom(rt: Runtime): void {
  const objects = [...preorder(rt.environment.root.children)];
  built.set(rt, { objects, verts: objects.map(positions) });
}

function propsOf(
  rt: Runtime,
  f: Parameters<Runtime['vm']['props']['of']>[0],
): [string, PropValue][] {
  const out: [string, PropValue][] = [];
  for (const p of rt.vm.props.of(f).reverse()) {
    const name = rt.vm.props.names[p] ?? '';
    if (!name || UNKEPT.has(name)) continue;
    const v = rt.vm.props.get(f, p);
    out.push([name, typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : 0]); // prettier-ignore
  }
  return out;
}

function setProps(
  rt: Runtime,
  f: Parameters<Runtime['vm']['props']['of']>[0],
  want: [string, PropValue][],
): void {
  const names = new Set(want.map(([n]) => n));
  for (const p of rt.vm.props.of(f)) {
    const name = rt.vm.props.names[p] ?? '';
    if (!UNKEPT.has(name) && !names.has(name)) rt.vm.props.del(f, p);
  }
  for (const [name, v] of want) {
    let p = rt.vm.props.find(name);
    if (p < 0) p = rt.vm.props.defineNew(name);
    if (!rt.vm.props.has(f, p)) rt.vm.props.add(f, p, v);
    else if (rt.vm.props.get(f, p) !== v) rt.vm.props.set(f, p, v);
  }
}

/** The room as it is now (null before markRoom). */
export function snapshotRoom(rt: Runtime): RoomSnapshot | null {
  const b = built.get(rt);
  if (!b) return null;
  const index = new Map(b.objects.map((o, i) => [o, i]));
  const objects = b.objects.map((o, i): Kept | null => {
    // Gone from the room (killed, or carried off into the world being edited): left be.
    if (rt.worldOf(o) !== rt.environment) return null;
    const parent = o.parent === rt.environment.root ? -1 : (index.get(o.parent!) ?? null);
    if (parent === null) return null;
    const subs: Kept['subs'] = [];
    for (const s of rt.features.known(o)) {
      if (!rt.features.alive(s)) continue;
      const props = propsOf(rt, s);
      if (props.length) subs.push([s.type, s.id, props]);
    }
    const now = positions(o);
    return {
      parent,
      linked: o.linked ?? false,
      xform: [...o.xform],
      color: [...o.color],
      props: propsOf(rt, o),
      subs,
      ...(same(now, b.verts[i]!) ? {} : { verts: [...now] }),
    };
  });
  const light = bulbLightOf(rt);
  return { names: signature(b.objects), version: VERSION, objects, ...(light ? { light } : {}) };
}

/** Puts the room back as a snapshot had it. False (nothing changed) if it doesn't fit. */
export function restoreRoom(rt: Runtime, snap: RoomSnapshot): boolean {
  const b = built.get(rt);
  if (
    !b ||
    snap.version !== VERSION ||
    snap.names !== signature(b.objects) ||
    snap.objects.length !== b.objects.length
  )
    return false;
  const env = rt.environment.root;
  // The tree first: each object under its parent, in the order it had there.
  snap.objects.forEach((k, i) => {
    if (!k) return;
    const o = b.objects[i]!;
    const parent = k.parent < 0 ? env : b.objects[k.parent]!;
    if (o.parent !== parent) rt.adopt(parent, o, k.linked);
    o.linked = k.linked;
  });
  const known = new Set(b.objects);
  const order = new Map(snap.objects.map((k, i) => [b.objects[i]!, k ? i : Infinity]));
  for (const p of [env, ...b.objects])
    p.children.sort((x, y) => (order.get(x) ?? Infinity) - (order.get(y) ?? Infinity));
  snap.objects.forEach((k, i) => {
    if (!k) return;
    const o = b.objects[i]!;
    if (k.verts && k.verts.length === o.brep.numVertices * 3)
      o.brep
        .vertices()
        .forEach((v, j) =>
          o.brep.setVertexPos(v, k.verts![j * 3]!, k.verts![j * 3 + 1]!, k.verts![j * 3 + 2]!),
        );
    const was = o.invXform;
    o.xform = k.xform as unknown as Mat4;
    o.invXform = mat4.invert(o.xform) ?? o.invXform;
    // What was hung on it after the room was noted (the hints plates on the plane) goes with it.
    const move = mat4.multiply(was, o.xform);
    for (const c of o.children) if (!known.has(c)) transformTree(c, move);
    o.color = [...k.color] as Rgb;
    setProps(rt, o, k.props);
    const subs = new Map(k.subs.map(([t, id, props]) => [`${t}:${id}`, props]));
    for (const s of rt.features.known(o))
      if (rt.features.alive(s) && !subs.has(`${s.type}:${s.id}`)) setProps(rt, s, []);
    for (const [t, id, props] of k.subs)
      setProps(rt, rt.features.of(o, t as Parameters<Runtime['features']['of']>[1], id), props);
    rt.changed(o);
  });
  if (snap.light) setBulbLight(rt, snap.light);
  rt.version++;
  return true;
}
