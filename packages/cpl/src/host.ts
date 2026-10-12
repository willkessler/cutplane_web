import type { Feature } from './word.ts';

/** A point or vector [x, y, z]. */
export type Vec3 = readonly [number, number, number] | number[];

/**
 * What the VM needs from the modeler it runs in. The opcodes themselves —
 * which arguments they take, what they test, what they put in AR — are in
 * the VM; these are the C routines they called (find_largergrain,
 * translate_feature, pick_feature...), named after them.
 *
 * Features are opaque: the host decides what a vertex, edge, face, shell,
 * object or world is, and gives each a stable identity and a `type` id.
 */
export interface Host {
  // ---- worlds and the object tree (objtree.c) ----

  /** The world a feature's object is in (motherworld), or null. */
  worldOf(f: Feature): Feature | null;
  /** A world's root object. */
  worldRoot(world: Feature): Feature;
  /** find_world. */
  findWorld(name: string): Feature | null;
  /** find_object_in_any_world: the first object with this name, worlds in order. */
  findObject(name: string): Feature | null;
  /** find_largergrain: the vertex/edge/face/shell/object/world containing `f` (or `f` itself). */
  larger(f: Feature, type: number): Feature | null;
  /** An object's parent object (a world's root counts), or null for a root. */
  parent(obj: Feature): Feature | null;
  /** An object's children, in order. */
  children(obj: Feature): Feature[];
  /** obj->linked. */
  linked(obj: Feature): boolean;
  /** get_unlinked_ancestor. */
  unlinkedAncestor(obj: Feature): Feature;
  /** An object's vertices, edges and faces, shell by shell: vertices, then edges, then faces. */
  subfeatures(obj: Feature): Feature[];
  /** adopt_obj_branch: `child` (with its branch) becomes the last child of `parent`. */
  adopt(parent: Feature, child: Feature, linked: boolean): void;
  /** make_childobj(parent, origin): a new, empty object. */
  makeChild(parent: Feature): Feature;
  /** duplicate_obj_branch. */
  duplicate(obj: Feature): Feature;
  /** The environment's crosshair and plane objects (cursor_obj, cutplane_obj). */
  envObject(part: 'crosshair' | 'cutplane'): Feature;

  // ---- geometry ----

  /** state->cursor. */
  cursor(): [number, number, number];
  /** get_first_vert. */
  firstVertex(f: Feature): [number, number, number] | null;
  /**
   * execute_TRANS on the crosshair: move it (and the plane, for depth) by as
   * much of `offset` as the room allows, snapping the plane.
   */
  translateCrosshair(offset: Vec3): void;
  /** translate_feature, with planarize_affected_fves first for anything but a whole object. */
  translate(f: Feature, offset: Vec3, quick: boolean): void;
  /** rotate_room_view (tenths of degrees, as the original's state). */
  rotateRoom(dx: number, dy: number): void;
  /** axis_rot_obj: tenths of degrees about `axis` through `point`. */
  rotateObject(obj: Feature, axis: Vec3, point: Vec3, tenths: number): void;
  /** execute_SCALE: scale_feature about the bbox centre. */
  scaleObject(obj: Feature, factor: number): void;
  /** compute_crosshair_move then add: move the crosshair, kept in the room, toward `delta`. */
  nudgeCrosshair(delta: Vec3): void;
  /** execute_SNAP's feature-to-point case: move `obj` so `from` lands on `to`. */
  snapObject(obj: Feature, from: Vec3, to: Vec3): void;
  /** snap_features_together (the magnet). */
  snapFeatures(source: Feature, target: Feature): void;
  /** execute_WITHIN's test: is `obj2` inside `obj1`'s bbox (its section, or all of it)? */
  within(obj1: Feature, obj2: Feature): boolean;
  /** do_boolean. */
  boolean(a: Feature, b: Feature, op: number): Feature[];

  // ---- names, labels, colours ----

  name(obj: Feature): string | null;
  setName(obj: Feature, name: string | null): void;
  label(obj: Feature, n: number): string | null;
  setLabel(obj: Feature, n: number, text: string | null): void;
  color(f: Feature): [number, number, number];
  setColor(f: Feature, rgb: Vec3): void;

  // ---- selection (select.c) ----

  /** set_feature_selectable. */
  setSelectable(f: Feature): void;
  /** unselect_obj. */
  unselect(obj: Feature): void;
  /** pick_feature. */
  pick(f: Feature): void;
  /** unpick_feature. */
  unpick(f: Feature): void;
  /** execute_RELEAS on a vertex/edge/face: find_obj_normals, recombine_coplanar_faces, log updates. */
  release(f: Feature): void;
  /** PICK/RELEAS of Env:Cutplane_part. */
  pickPlane(): void;
  releasePlane(): void;

  // ---- updates (update.c) ----

  /** log_update. */
  logUpdate(f: Feature, flags: number, now: boolean): void;
  /** log_global_update, and process_global_updates when `now`. */
  globalUpdate(flags: number, now: boolean): void;
  /** After every instruction (CPL_parse's process_updates calls). */
  afterInstruction(): void;
  /** CPSHADE: toggle_zbuffering. */
  toggleShade(): void;
  /** QUIT. */
  quit(): void;
  /** A property was added to or taken from a feature (Visible, Picked... have side effects). */
  propertyChanged?(f: Feature, p: number, added: boolean): void;
}

/** A C routine CPL can call (cplib.c); arguments and results go on the CPL stack. */
export type Crtn = (vm: import('./vm.ts').VM) => void;
