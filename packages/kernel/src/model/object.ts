import { identity, invert, multiply, type Mat4 } from '../math/mat4.ts';
import { Brep, type FeatureAttrs, type Rgb } from '../topology/brep.ts';

/** The original's cube record, saved with objects that have the Primitive property. */
export interface PrimitiveInfo {
  length: number;
  width: number;
  height: number;
}

/**
 * New: lettering laid on an object's surface, as a decal is (the original's decals
 * only ever showed on its own pads). All in the object's own coordinates, so it goes
 * where the object goes: the point on the surface it is centred on, the way out of
 * the surface there, and the way the text reads (across `normal`). `height` is the
 * capitals' height.
 */
export interface TextDecal {
  text: string;
  color: Rgb;
  height: number;
  at: [number, number, number];
  normal: [number, number, number];
  along: [number, number, number];
}

/** A decal's own copy (its vectors not shared). */
export const copyDecal = (d: TextDecal): TextDecal => ({
  ...d,
  color: [...d.color],
  at: [...d.at],
  normal: [...d.normal],
  along: [...d.along],
});

/**
 * An object in a world: a Brep (in local coordinates) placed by `xform`,
 * with a name, colour, properties and children. Mirrors objtype in the
 * original's topology.h, minus the runtime-only fields.
 */
export interface CutObject {
  /** topology.h's Obj_type: objects are features to CPL, which tells them apart by this id. */
  readonly type: typeof OBJ_TYPE;
  name: string | null;
  /** Local → world, row-vector convention (see mat4.ts). */
  xform: Mat4;
  /** World → local, kept alongside `xform` as the original does. */
  invXform: Mat4;
  color: Rgb;
  /** New: how much it hides what is behind it, 0..1; unset, all (a solid). The glass chip's 0.5. */
  opacity?: number;
  /** New: lettering on it (see TextDecal); unset, none. */
  decals?: TextDecal[];
  attrs: FeatureAttrs;
  primitive?: PrimitiveInfo;
  selectTechnique: string;
  drawTechnique: string;
  screenBBoxTechnique: string;
  brep: Brep;
  parent: CutObject | null;
  children: CutObject[];
  /**
   * objtype's `linked`: true when the object is a group root (moves on its own), false
   * when it moves with its parent. Unset means the original's defaults: an object at
   * the top of its world is linked, a child read from a file is not.
   */
  linked?: boolean;
}

export const OBJ_TYPE = 14;

/** get_unlinked_ancestor: the group root an object moves with. */
export function groupRoot(o: CutObject): CutObject {
  let x = o;
  while (x.parent && !(x.linked ?? false)) x = x.parent;
  return x;
}

export const DEFAULT_TECHNIQUES = {
  selectTechnique: 'set_object_selectable',
  drawTechnique: 'normal_draw_technique',
  screenBBoxTechnique: 'Normal',
} as const;

export function createObject(brep: Brep, init: Partial<Omit<CutObject, 'brep'>> = {}): CutObject {
  const xform = init.xform ?? identity();
  return {
    type: OBJ_TYPE,
    name: null,
    color: [100, 100, 100],
    attrs: { props: ['Visible'] },
    ...DEFAULT_TECHNIQUES,
    parent: null,
    children: [],
    ...init,
    xform,
    invXform: init.invXform ?? invert(xform) ?? identity(),
    brep,
  };
}

/** Makes `child` the last child of `parent` (or a root when parent is null). */
export function adopt(parent: CutObject | null, child: CutObject, roots?: CutObject[]): void {
  const from = child.parent ? child.parent.children : roots;
  if (from) {
    const i = from.indexOf(child);
    if (i >= 0) from.splice(i, 1);
  }
  child.parent = parent;
  if (parent) parent.children.push(child);
  else roots?.push(child);
}

/** Objects in preorder (parents before children), the order .cut files use. */
export function* preorder(roots: readonly CutObject[]): IterableIterator<CutObject> {
  for (const r of roots) {
    yield r;
    yield* preorder(r.children);
  }
}

/** An object and all its descendants, parents first. */
export function* subtree(o: CutObject): IterableIterator<CutObject> {
  yield o;
  for (const c of o.children) yield* subtree(c);
}

/**
 * Moves an object and its descendants by the world-space transform `m`
 * (rotateobj.c's axis_rot_obj, scale.c's postmult_tree_by_xform). Every
 * object's xform is its own local → world placement, so each one takes `m`
 * after its xform.
 */
export function transformTree(o: CutObject, m: Mat4): void {
  for (const x of subtree(o)) {
    x.xform = multiply(x.xform, m);
    x.invXform = invert(x.xform) ?? x.invXform;
  }
}

/**
 * duplicate.c's duplicate_obj_branch: a deep copy of an object and its
 * descendants — topology, properties, colours and placement — with no
 * parent. Private CPL code and the name stay with the original.
 */
export function duplicateTree(o: CutObject): CutObject {
  const copy: CutObject = {
    ...o,
    name: null,
    xform: o.xform.slice(),
    invXform: o.invXform.slice(),
    color: [...o.color],
    attrs: {
      props: [...o.attrs.props],
      ...(o.attrs.decalFile ? { decalFile: o.attrs.decalFile } : {}),
      ...(o.attrs.photo ? { photo: true } : {}),
    },
    brep: o.brep.clone(),
    parent: null,
    children: [],
  };
  if (o.primitive) copy.primitive = { ...o.primitive };
  if (o.decals) copy.decals = o.decals.map(copyDecal);
  for (const map of [copy.brep.vertexAttrs, copy.brep.edgeAttrs, copy.brep.faceAttrs])
    for (const a of map.values()) delete a.privateCode;
  for (const c of o.children) {
    const cc = duplicateTree(c);
    cc.parent = copy;
    copy.children.push(cc);
  }
  return copy;
}
