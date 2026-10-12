import {
  CRTN_NAMES,
  P,
  PROPERTY_FILES,
  T,
  UF,
  VM,
  type Crtn,
  type Feature,
  type Host,
  type Vec3,
} from '@cutplane/cpl';
import {
  Brep,
  NONE,
  ROOM,
  betterPick,
  computeSection,
  createObject,
  deleteEdge,
  deleteFace,
  deleteVertex,
  duplicateTree,
  groupRoot,
  mat4,
  mvfs,
  mev,
  pickAt,
  planarizeForMotion,
  recombineSurfaces,
  subtree,
  transformTree,
  validate,
  volume,
  WorldGeometry,
  type CutObject,
  type ObjectSection,
  type Pick as KernelPick,
} from '@cutplane/kernel';
import { FeatureIndex, isObject, isSub, isWorld, type Sub, type WorldFeature } from './features.ts';
import { BUILTIN_CRTNS } from './crtns.ts';
import { Journal, restoreTree, type ObjectSnapshot, type Step } from './journal.ts';

/**
 * The world the CPL VM runs in: the original's worlds, objects and
 * features, its selection (select.c), drags (translate.c), updates
 * (update.c) and deletions, on the TypeScript kernel. This is the `Host` the
 * VM calls; all behaviour is in the CPL.
 */

export type V3 = [number, number, number];

/** The crosshair and room, which the app's input controller keeps. */
export interface Stage {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /**
   * compute_crosshair_move: moves the crosshair (and, for depth, the plane, snapping it)
   * by as much of `d` as the room allows. Returns how far it actually moved.
   */
  moveCrosshair(dx: number, dy: number, dz: number): V3;
  /** rotate_room_view, in tenths of a degree (fractions kept). */
  rotateRoom(dx: number, dy: number): void;
}

/** select.h's selectkind (lower picks first). */
export const SelectKind = {
  Nothing: 0,
  Vert: 1,
  Edge: 2,
  Face: 3,
  Inplaneface: 4,
  Shell: 5,
  Obj: 6,
} as const;

interface Selectable {
  feature: Feature | null;
  kind: number;
  at: V3;
}

const NOTHING: Selectable = { feature: null, kind: SelectKind.Nothing, at: [0, 0, 0] };

/** Properties that only mean something while the program runs; never saved. */
export const TRANSIENT_PROPS = new Set([
  'Selectable',
  'Picked',
  'Grabbed',
  'Msgpending',
  'Quickupdate',
  'Regularupdate',
  'Touched',
  'Killed',
  'Active',
  'Translated',
]);

interface DragPlan {
  /** Where each vertex was when the gesture first moved it (local). */
  start: Map<number, V3>;
  /** How far, in world units, each vertex has been moved this gesture. */
  moved: Map<number, V3>;
  health: { closed: boolean; degenerate: number };
}

function healthOf(b: Brep) {
  const r = validate(b, { maxIssuesPerCode: 0 });
  return {
    closed: r.ok && r.closedManifold,
    degenerate: (r.counts['zero-length-edge'] ?? 0) + (r.counts['degenerate-face'] ?? 0),
  };
}

/** A world vector in an object's local frame (row vectors, no translation). */
function toLocal(m: ArrayLike<number>, d: Vec3): V3 {
  const [x, y, z] = [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
  return [
    x * m[0]! + y * m[4]! + z * m[8]!,
    x * m[1]! + y * m[5]! + z * m[9]!,
    x * m[2]! + y * m[6]! + z * m[10]!,
  ];
}

/**
 * The vertices a picked feature drags (translate.c): a vertex itself; an
 * edge's ends; all of a face's vertices. A face of a surface, or an edge
 * inside one, drags the whole surface.
 */
export function movingVertices(b: Brep, type: number, id: number): number[] {
  if (type === T.Vfe) return [id];
  let faces: number[];
  if (type === T.Evf) {
    const h1 = b.edgeHe1(id);
    const h2 = b.edgeHe2(id);
    const s1 = b.faceSurface.get(b.heFace(h1));
    if (h2 === NONE || s1 === undefined || b.faceSurface.get(b.heFace(h2)) !== s1)
      return b.edgeVertices(id);
    faces = b.surfaceFaces(b.heFace(h1));
  } else faces = b.surfaceFaces(id);
  const out = new Set<number>();
  for (const f of faces)
    for (const l of b.faceLoops(f)) for (const h of b.loopHalfEdges(l)) out.add(b.heVertex(h));
  return [...out];
}

export interface RuntimeOptions {
  stage: Stage;
  /** CPL source by file name (rom.cpl, stamp.cpl, ...). */
  source(file: string): string;
  /** C routines, by name; missing ones do nothing. */
  crtns?: Partial<Record<string, Crtn>>;
  trace?: (line: string) => void;
}

export class Runtime implements Host {
  readonly vm: VM;
  readonly features = new FeatureIndex();
  readonly stage: Stage;
  readonly journal: Journal;

  readonly scratch: WorldFeature;
  readonly primary: WorldFeature;
  readonly environment: WorldFeature;
  readonly help: WorldFeature;
  readonly worlds: WorldFeature[];

  // init_environment's objects
  readonly cutplane: CutObject;
  readonly line: CutObject;
  readonly cursorObj: CutObject;
  readonly backwall: CutObject;
  readonly groupObj: CutObject;

  /** select.c's always_set_selectable (set by Crtn:always_set_select during drags). */
  alwaysSetSelectable = false;
  /** global_picksize. */
  picksize = 10;
  /** Bumped when objects come or go, or the tree changes. */
  treeVersion = 0;
  /** Bumped when anything worth redrawing changes (geometry, properties, selection). */
  version = 0;
  /** Asked to quit (QUIT). */
  quitRequested = false;
  /** Shading toggled (CPSHADE). */
  shaded = true;
  /** set_hiddenedge: draw hidden edges while the plane or room is being moved. */
  hiddenEdges = false;

  private readonly worldOfRoot = new Map<CutObject, WorldFeature>();
  private readonly geometry = new Map<CutObject, WorldGeometry>();
  private readonly sections = new Map<CutObject, { z: number; s: ObjectSection }>();
  private readonly selectables = new WeakMap<CutObject, Selectable>();
  /** Objects whose geometry or placement changed since the app last looked. */
  private readonly changedObjects = new Set<CutObject>();
  private readonly drags = new Map<CutObject, DragPlan>();
  /** Vertices already moved by the instruction now running (each moves once per sentence). */
  private readonly movedNow = new Set<string>();
  private readonly crtnTable: Partial<Record<string, Crtn>>;

  constructor(opts: RuntimeOptions) {
    this.stage = opts.stage;
    this.crtnTable = opts.crtns ?? {};
    const world = (name: string): WorldFeature => {
      const root = createObject(new Brep(), { name: null, attrs: { props: [] } });
      const w: WorldFeature = { type: T.World, name, root };
      this.worldOfRoot.set(root, w);
      return w;
    };
    // world_list order: scratch, primary, environment, help.
    this.scratch = world('Scratch_world');
    this.primary = world('Primary_world');
    this.environment = world('Environment_world');
    this.help = world('Help_world');
    this.worlds = [this.scratch, this.primary, this.environment, this.help];
    this.journal = new Journal(() => this.primary.root);

    this.vm = new VM({
      host: this,
      crtns: CRTN_NAMES.map((n) => [n, (vm: VM) => this.crtn(n, vm)] as const),
      ...(opts.trace ? { trace: opts.trace } : {}),
    });
    this.vm.working = this.primary;

    // init_environment.
    const env = this.environment;
    this.cutplane = this.makeObj(env, [0, 0, 0], 'Cutplane', ['Nonmanifold', 'Noshadow'], {
      selectTechnique: 'set_cutplane_selectable',
      drawTechnique: 'nodraw_technique',
    });
    this.line = this.makeObj(env, [0, 0, 0], 'Line', ['Nonmanifold', 'Noshadow'], {
      selectTechnique: 'set_always_selectable',
      drawTechnique: 'draw_scribble_technique',
    });
    this.addVertexEdge(this.line, this.line.brep.vertices()[0]!, [0, 0, 0]);
    this.vm.props.del(this.line, P.Visible);
    this.cursorObj = this.makeObj(
      env,
      [0, 0, 0],
      'Crosshair_Cursor',
      ['Nonmanifold', 'Noshadow', 'Background'],
      {
        selectTechnique: 'set_always_selectable',
        drawTechnique: 'nodraw_technique',
      },
    );
    this.cursorObj.color = [255, 0, 0];
    this.adopt(this.cutplane, this.cursorObj, true);
    this.backwall = this.makeObj(
      env,
      [0, 0, ROOM.min[2]],
      'Room_Backwall',
      ['Nonmanifold', 'Noshadow'],
      {
        selectTechnique: 'set_always_selectable',
        drawTechnique: 'nodraw_technique',
      },
    );
    this.vm.props.del(this.backwall, P.Visible);
    this.groupObj = this.makeObj(env, null, 'Groupobj', ['Nonmanifold', 'Noshadow']);
    this.vm.props.del(this.groupObj, P.Visible);
    this.placeEnvironment();
  }

  /** init_CPL_language and attach_otherworlds_CPLcode: ROM, property files, the cursor's code. */
  loadCode(source: (file: string) => string): void {
    this.vm.loadRom(source('rom.cpl'));
    for (const p of PROPERTY_FILES)
      this.vm.loadPropertyCode(source(`${p.toLowerCase()}.cpl`), `${p.toLowerCase()}.cpl`, p);
    this.vm.loadPrivateCode(this.cursorObj, source('cursor.cpl'), 'cursor.cpl');
    this.vm.resolveObjectRefs();
  }

  /** Puts the crosshair and plane objects where the stage says they are. */
  private placeEnvironment(): void {
    const { x, y, z } = this.stage;
    const set = (o: CutObject, p: V3) => {
      o.xform = mat4.translation(...p);
      o.invXform = mat4.translation(-p[0], -p[1], -p[2]);
    };
    set(this.cutplane, [0, 0, z]);
    set(this.cursorObj, [x, y, z]);
  }

  // ---- building objects ----

  /** make_obj: a new object (one vertex at `pos`, or none) at the top of `world`. */
  makeObj(
    world: WorldFeature,
    pos: V3 | null,
    name: string | null,
    props: string[] = [],
    techniques: Partial<Pick3> = {},
  ): CutObject {
    const b = new Brep();
    if (pos) mvfs(b, ...pos);
    const o = createObject(b, { name, attrs: { props: [] }, ...techniques });
    o.linked = true;
    o.parent = world.root;
    world.root.children.push(o);
    this.vm.props.add(o, P.Visible);
    for (const p of props) this.addProp(o, p);
    this.treeChanged();
    return o;
  }

  /** make_edge_vert: a new vertex at `to` (local), joined to `v` by a new edge. Returns it. */
  addVertexEdge(o: CutObject, v: number, to: V3): number {
    const b = o.brep;
    const h = b.vertexHe(v);
    return mev(b, h, h, ...to).vertex;
  }

  /** Adds a property by name, defining it if CPL hasn't. */
  addProp(f: Feature, name: string): void {
    let p = this.vm.props.find(name);
    if (p < 0) p = this.vm.props.defineNew(name);
    this.vm.props.add(f, p);
  }

  hasProp(f: Feature, name: string): boolean {
    const p = this.vm.props.find(name);
    return p >= 0 && this.vm.props.has(f, p);
  }

  /**
   * Puts loaded objects at the top of a world, registering their properties (and
   * their vertices', edges' and faces') with CPL.
   */
  importObjects(
    world: WorldFeature,
    roots: readonly CutObject[],
    parent: CutObject = world.root,
  ): void {
    for (const r of roots) {
      r.parent = parent;
      r.linked = true;
      parent.children.push(r);
      for (const o of subtree(r)) this.register(o);
    }
    this.treeChanged();
  }

  /** Gives CPL an object's properties, in the file's order. */
  private register(o: CutObject): void {
    const names = [...o.attrs.props];
    for (const n of names.reverse()) this.addProp(o, n);
    const b = o.brep;
    for (const [type, map] of [
      [T.Vfe, b.vertexAttrs],
      [T.Evf, b.edgeAttrs],
      [T.Fve, b.faceAttrs],
    ] as const)
      for (const [id, a] of map) {
        const h = this.features.of(o, type, id);
        for (const n of [...a.props].reverse()) this.addProp(h, n);
      }
  }

  /** Empties a world (a new model is loaded). */
  clearWorld(world: WorldFeature): void {
    for (const c of [...world.root.children]) this.forgetBranch(c);
    world.root.children = [];
    this.treeChanged();
  }

  private forgetBranch(o: CutObject): void {
    for (const x of subtree(o)) {
      this.vm.props.forget(x);
      for (const s of this.features.known(x)) this.vm.props.forget(s);
      this.geometry.delete(x);
      this.sections.delete(x);
    }
  }

  // ---- property mirror ----

  propertyChanged(f: Feature, p: number): void {
    const names = this.vm.propNames(f);
    if (isObject(f)) f.attrs.props = names;
    else if (isSub(f)) {
      const map =
        f.type === T.Vfe
          ? f.object.brep.vertexAttrs
          : f.type === T.Evf
            ? f.object.brep.edgeAttrs
            : f.type === T.Fve
              ? f.object.brep.faceAttrs
              : null;
      if (map) {
        const a = map.get(f.id);
        if (names.length === 0 && a && !a.decalFile && !a.privateCode) map.delete(f.id);
        else if (a) a.props = names;
        else map.set(f.id, { props: names });
      }
    }
    if (p === P.Visible || p === P.Killed) this.treeVersion++;
    this.version++;
  }

  // ---- the tree ----

  private treeChanged(): void {
    this.treeVersion++;
    this.version++;
  }

  /** The world whose tree contains `f`. */
  worldOf(f: Feature): WorldFeature | null {
    if (isWorld(f)) return f;
    const o = isObject(f) ? f : isSub(f) ? f.object : null;
    if (!o) return null;
    let x = o;
    while (x.parent) x = x.parent;
    return this.worldOfRoot.get(x) ?? null;
  }

  worldRoot(world: Feature): CutObject {
    return (world as WorldFeature).root;
  }

  findWorld(name: string): WorldFeature | null {
    return this.worlds.find((w) => w.name === name) ?? null;
  }

  findObject(name: string): CutObject | null {
    for (const w of this.worlds)
      for (const o of subtree(w.root)) if (o.name === name && o !== w.root) return o;
    return null;
  }

  larger(f: Feature, type: number): Feature | null {
    if (f.type === type) return f;
    if (type === T.World) return this.worldOf(f);
    if (isSub(f)) {
      if (type === T.Obj) return f.object;
      if (type === T.Shell) {
        const b = f.object.brep;
        const shell =
          f.type === T.Vfe
            ? b.vertexShell(f.id)
            : f.type === T.Evf
              ? b.vertexShell(b.edgeVertices(f.id)[0])
              : f.type === T.Fve
                ? b.faceShell(f.id)
                : NONE;
        return shell === NONE ? null : this.features.shell(f.object, shell);
      }
    }
    return null;
  }

  parent(obj: Feature): CutObject | null {
    return isObject(obj) ? obj.parent : null;
  }

  children(obj: Feature): CutObject[] {
    return isObject(obj) ? obj.children : [];
  }

  linked(obj: Feature): boolean {
    return isObject(obj) ? (obj.linked ?? obj.parent?.parent === null) : false;
  }

  unlinkedAncestor(obj: Feature): CutObject {
    return groupRoot(obj as CutObject);
  }

  subfeatures(obj: Feature): Sub[] {
    if (!isObject(obj)) return [];
    const b = obj.brep;
    const out: Sub[] = [];
    for (const s of b.shells()) {
      for (const v of b.vertices(s)) out.push(this.features.vertex(obj, v));
      for (const e of b.edges())
        if (b.vertexShell(b.edgeVertices(e)[0]) === s) out.push(this.features.edge(obj, e));
      for (const f of b.faces(s)) out.push(this.features.face(obj, f));
    }
    return out;
  }

  adopt(parent: Feature, child: Feature, linked: boolean): void {
    if (!isObject(parent) || !isObject(child) || parent === child) return;
    for (let a: CutObject | null = parent; a; a = a.parent) if (a === child) return; // no cycles
    const from = this.worldOf(child);
    const to = this.worldOf(parent);
    if (from === this.primary || to === this.primary) this.journal.touchTree();
    if (child.parent) {
      const i = child.parent.children.indexOf(child);
      if (i >= 0) child.parent.children.splice(i, 1);
    }
    child.parent = parent;
    child.linked = linked;
    parent.children.push(child);
    if (from && to && from !== to) this.vm.props.transfer(from, to);
    this.treeChanged();
  }

  makeChild(parent: Feature): CutObject {
    const p = parent as CutObject;
    const o = createObject(new Brep(), { attrs: { props: [] } });
    mvfs(o.brep, 0, 0, 0);
    if (this.worldOf(p) === this.primary) this.journal.touchTree();
    o.parent = p;
    o.linked = p.parent === null;
    p.children.push(o);
    this.vm.props.add(o, P.Visible);
    this.treeChanged();
    return o;
  }

  duplicate(obj: Feature): CutObject {
    const o = obj as CutObject;
    const copy = duplicateTree(o);
    const parent = o.parent ?? this.primary.root;
    if (this.worldOf(parent) === this.primary) this.journal.touchTree();
    copy.parent = parent;
    copy.linked = true;
    parent.children.push(copy);
    // The copy has the original's properties (duplicate_obj copies the proplist).
    const pairs: [CutObject, CutObject][] = [];
    const pair = (a: CutObject, b: CutObject) => {
      pairs.push([a, b]);
      a.children.forEach((c, i) => pair(c, b.children[i]!));
    };
    pair(o, copy);
    for (const [a, b] of pairs) {
      b.attrs.props = [];
      for (const p of this.vm.props.of(a).reverse())
        if (!TRANSIENT_PROPS.has(this.vm.props.names[p] ?? '')) this.vm.props.add(b, p);
      this.vm.sharePrivateCode(a, b);
    }
    this.treeChanged();
    return copy;
  }

  envObject(part: 'crosshair' | 'cutplane'): CutObject {
    return part === 'crosshair' ? this.cursorObj : this.cutplane;
  }

  // ---- geometry ----

  /** An object's world-space geometry (rebuilt after it changes). */
  world(o: CutObject): WorldGeometry {
    let g = this.geometry.get(o);
    if (!g || g.brep !== o.brep || g.xform !== o.xform) {
      g = new WorldGeometry(o.brep, o.xform);
      this.geometry.set(o, g);
      this.sections.delete(o);
    }
    return g;
  }

  /** An object's section at the plane, if the plane cuts it. */
  section(o: CutObject, z = this.stage.z): ObjectSection | undefined {
    const g = this.world(o);
    if (g.zMin > z + 1 || g.zMax < z - 1 || o.brep.numFaces === 0) return undefined;
    const c = this.sections.get(o);
    if (c && c.z === z) return c.s;
    const s = computeSection(g, z);
    this.sections.set(o, { z, s });
    return s;
  }

  /** The geometry or placement of `o` changed. */
  changed(o: CutObject): void {
    this.geometry.delete(o);
    this.sections.delete(o);
    this.changedObjects.add(o);
    this.version++;
  }

  /** Objects changed since the last call (for the renderer). */
  takeChanged(): Set<CutObject> {
    const s = new Set(this.changedObjects);
    this.changedObjects.clear();
    return s;
  }

  cursor(): V3 {
    return [this.stage.x, this.stage.y, this.stage.z];
  }

  firstVertex(f: Feature): V3 | null {
    const o = isObject(f) ? f : isSub(f) ? f.object : null;
    if (!o) return null;
    const b = o.brep;
    let v: number = NONE;
    if (isObject(f)) v = b.vertices()[0] ?? NONE;
    else if (isSub(f)) {
      if (f.type === T.Vfe) v = f.id;
      else if (f.type === T.Evf) v = b.edgeVertices(f.id)[0];
      else if (f.type === T.Fve) v = b.heVertex(b.loopHe(b.faceLoop(f.id)));
      else v = b.vertices(f.id)[0] ?? NONE;
    }
    if (v === NONE || !b.isVertex(v)) return null;
    const g = this.world(o);
    return [g.x(v), g.y(v), g.z(v)];
  }

  translateCrosshair(offset: Vec3): void {
    const moved = this.stage.moveCrosshair(offset[0] ?? 0, offset[1] ?? 0, offset[2] ?? 0);
    // The crosshair and plane objects (and whatever is adopted to them) come along.
    if (moved[0] || moved[1]) this.moveBranch(this.cursorObj, [moved[0], moved[1], 0]);
    if (moved[2]) this.moveBranch(this.cutplane, [0, 0, moved[2]]);
  }

  /** translate_obj_engine: an object and its whole branch, by a world offset. */
  private moveBranch(root: CutObject, d: V3): void {
    const m = mat4.translation(...d);
    for (const o of subtree(root)) {
      if (this.worldOf(o) === this.primary) this.journal.touch(o);
      o.xform = mat4.multiply(o.xform, m);
      o.invXform = mat4.invert(o.xform) ?? o.invXform;
      this.changed(o);
    }
  }

  translate(f: Feature, offset: Vec3): void {
    const d: V3 = [offset[0] ?? 0, offset[1] ?? 0, offset[2] ?? 0];
    if (isObject(f) || (isSub(f) && f.type === T.Shell)) {
      const o = isObject(f) ? f : (f as Sub).object;
      this.moveBranch(groupRoot(o), d);
      return;
    }
    if (!isSub(f)) return;
    const o = f.object;
    const b = o.brep;
    if (!this.features.alive(f)) return;
    if (this.worldOf(o) === this.primary) this.journal.touch(o);
    let plan = this.drags.get(o);
    if (!plan)
      this.drags.set(o, (plan = { start: new Map(), moved: new Map(), health: healthOf(b) }));
    const key = (v: number) => `${this.idOf(o)}:${v}`;
    const verts = movingVertices(b, f.type, f.id).filter((v) => !this.movedNow.has(key(v)));
    if (verts.length === 0) return;
    for (const v of verts) this.movedNow.add(key(v));
    const local = toLocal(o.invXform, d);
    planarizeForMotion(b, new Set(verts), local);
    for (const v of verts) {
      if (!plan.start.has(v)) plan.start.set(v, b.vertexPos(v));
      const m = plan.moved.get(v) ?? [0, 0, 0];
      const total: V3 = [m[0] + d[0], m[1] + d[1], m[2] + d[2]];
      plan.moved.set(v, total);
      const s = plan.start.get(v)!;
      const t = toLocal(o.invXform, total);
      b.setVertexPos(v, s[0] + t[0], s[1] + t[1], s[2] + t[2]);
    }
    this.changed(o);
  }

  private readonly ids = new WeakMap<CutObject, number>();
  private nextId = 1;
  private idOf(o: CutObject): number {
    let i = this.ids.get(o);
    if (!i) this.ids.set(o, (i = this.nextId++));
    return i;
  }

  rotateRoom(dx: number, dy: number): void {
    this.stage.rotateRoom(dx, dy);
    this.version++;
  }

  rotateObject(obj: Feature, axis: Vec3, point: Vec3, tenths: number): void {
    const o = groupRoot(obj as CutObject);
    const [ax, ay, az] = [axis[0] ?? 0, axis[1] ?? 0, axis[2] ?? 0];
    const len = Math.hypot(ax, ay, az);
    if (len === 0 || tenths === 0) return;
    const [px, py, pz] = [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0];
    const m = mat4.rotationAbout(
      [px, py, pz],
      [ax / len, ay / len, az / len],
      (tenths / 10) * (Math.PI / 180),
    );
    for (const x of subtree(o)) if (this.worldOf(x) === this.primary) this.journal.touch(x);
    transformTree(o, m);
    for (const x of subtree(o)) this.changed(x);
  }

  scaleObject(obj: Feature, factor: number): void {
    const o = obj as CutObject;
    const g = this.world(o);
    let lo: V3 = [Infinity, Infinity, Infinity];
    let hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const v of o.brep.vertices()) {
      const p: V3 = [g.x(v), g.y(v), g.z(v)];
      lo = lo.map((c, i) => Math.min(c, p[i]!)) as V3;
      hi = hi.map((c, i) => Math.max(c, p[i]!)) as V3;
    }
    if (!Number.isFinite(lo[0])) return;
    const c = lo.map((x, i) => (x + hi[i]!) / 2) as V3;
    const m = mat4.scaleAbout(c, [factor, factor, factor]);
    if (this.worldOf(o) === this.primary) this.journal.touch(o);
    transformTree(o, m);
    for (const x of subtree(o)) this.changed(x);
  }

  nudgeCrosshair(delta: Vec3): void {
    this.translateCrosshair(delta);
  }

  snapObject(obj: Feature, from: Vec3, to: Vec3): void {
    this.moveBranch(obj as CutObject, [
      (to[0] ?? 0) - (from[0] ?? 0),
      (to[1] ?? 0) - (from[1] ?? 0),
      (to[2] ?? 0) - (from[2] ?? 0),
    ]);
  }

  snapFeatures(): void {
    // The magnet (M6).
  }

  /** execute_WITHIN: obj2's section lies in obj1's box (z ±1), or all of obj2 does. */
  within(obj1: Feature, obj2: Feature): boolean {
    const a = obj1 as CutObject;
    const b = obj2 as CutObject;
    const box = this.bbox(a);
    if (!box) return false;
    const lo = [box[0][0], box[0][1], box[0][2] - 1];
    const hi = [box[1][0], box[1][1], box[1][2] + 1];
    const z = this.stage.z;
    const inside = (p: readonly number[], l = lo, h = hi) =>
      p.every((c, i) => c >= l[i]! && c <= h[i]!);
    const s = this.section(b);
    if (s) {
      for (const loop of s.loops) {
        let mn = [Infinity, Infinity];
        let mx = [-Infinity, -Infinity];
        for (let i = 0; i < loop.points.length; i += 3) {
          mn = [Math.min(mn[0]!, loop.points[i]!), Math.min(mn[1]!, loop.points[i + 1]!)];
          mx = [Math.max(mx[0]!, loop.points[i]!), Math.max(mx[1]!, loop.points[i + 1]!)];
        }
        if (inside([mn[0]!, mn[1]!, z]) && inside([mx[0]!, mx[1]!, z])) return true;
      }
    }
    const bb = this.bbox(b);
    return bb !== null && inside(bb[0], box[0], box[1]) && inside(bb[1], box[0], box[1]);
  }

  /** An object's world bounding box (its own vertices). */
  bbox(o: CutObject): [V3, V3] | null {
    const g = this.world(o);
    let lo: V3 = [Infinity, Infinity, Infinity];
    let hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const v of o.brep.vertices()) {
      const p: V3 = [g.x(v), g.y(v), g.z(v)];
      lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1]), Math.min(lo[2], p[2])];
      hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1]), Math.max(hi[2], p[2])];
    }
    return Number.isFinite(lo[0]) ? [lo, hi] : null;
  }

  boolean(): Feature[] {
    return []; // M6
  }

  // ---- names, labels, colours ----

  name(f: Feature): string | null {
    if (isWorld(f)) return f.name;
    return isObject(f) ? f.name : null;
  }

  setName(f: Feature, name: string | null): void {
    if (!isObject(f)) return;
    if (this.worldOf(f) === this.primary) this.journal.touch(f);
    f.name = name;
    this.vm.resolveObjectRefs();
  }

  private readonly labels = new WeakMap<CutObject, (string | null)[]>();

  label(obj: Feature, n: number): string | null {
    return this.labels.get(obj as CutObject)?.[n] ?? null;
  }

  setLabel(obj: Feature, n: number, text: string | null): void {
    const o = obj as CutObject;
    let l = this.labels.get(o);
    if (!l) this.labels.set(o, (l = []));
    l[n] = text;
    this.version++;
  }

  color(f: Feature): V3 {
    if (isSub(f) && f.type === T.Fve) {
      const c = f.object.brep.faceColors.get(f.id);
      return c ? [...c] : [...f.object.color];
    }
    const o = isObject(f) ? f : isSub(f) ? f.object : null;
    return o ? [...o.color] : [0, 0, 0];
  }

  /** set_feature_color: an object takes the colour (its faces keep their own); a face alone. */
  setColor(f: Feature, rgb: Vec3): void {
    const c: V3 = [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0];
    if (isSub(f) && f.type === T.Fve) {
      if (this.worldOf(f.object) === this.primary) this.journal.touch(f.object);
      f.object.brep.faceColors.set(f.id, c);
      this.changed(f.object);
    } else if (isObject(f)) {
      if (this.worldOf(f) === this.primary) this.journal.touch(f);
      f.color = c;
      this.changed(f);
    }
  }

  // ---- selection (select.c) ----

  /** What an object's selectechnique last found. */
  selectableOf(o: CutObject): Selectable {
    return this.selectables.get(o) ?? NOTHING;
  }

  setSelectable(f: Feature): void {
    if (isObject(f)) this.setFeatureSelectable(f, true);
  }

  /** unselect_obj. */
  unselect(obj: Feature): void {
    const o = obj as CutObject;
    const s = this.selectables.get(o);
    if (s?.feature && this.vm.props.has(s.feature, P.Selectable))
      this.vm.props.del(s.feature, P.Selectable);
    this.selectables.set(o, NOTHING);
  }

  /** select_obj: the whole object, unconditionally. */
  selectObj(o: CutObject): void {
    this.selectables.set(o, { feature: o, kind: SelectKind.Obj, at: this.cursor() });
    this.vm.props.add(o, P.Selectable);
  }

  /**
   * set_selectables(_definite): runs every visible object's selectechnique in the
   * environment, then in the world being edited.
   */
  setSelectables(): void {
    this.setWorldSelectables(this.environment);
    this.setWorldSelectables(
      this.vm.working === this.environment ? this.primary : (this.vm.working as WorldFeature),
    );
  }

  private setWorldSelectables(world: WorldFeature): void {
    const visible = this.vm.props.features(world, P.Visible);
    // Objects found by set_object_selectable compete: one best pick per world (M3).
    const candidates: { o: CutObject; s: Selectable; pick: KernelPick }[] = [];
    for (const f of visible) {
      if (!isObject(f) || this.vm.props.has(f, P.Nonselectable)) continue;
      if (f.selectTechnique === 'set_object_selectable') {
        const c = this.objectCandidate(f);
        if (c) candidates.push({ o: f, ...c });
        else this.applySelectable(f, NOTHING);
      } else this.setFeatureSelectable(f, false);
    }
    let best: (typeof candidates)[number] | undefined;
    for (const c of candidates) if (!best || betterPick(c.pick, best.pick)) best = c;
    for (const c of candidates) this.applySelectable(c.o, c === best ? c.s : NOTHING);
  }

  /** The other selectechniques (pads, scale boxes, rotate tool parts), by name. */
  private setFeatureSelectable(o: CutObject, forced: boolean): void {
    const fn = this.selectTechniques[o.selectTechnique];
    if (fn) fn(o, forced);
    else if (o.selectTechnique === 'set_object_selectable') {
      const c = this.objectCandidate(o);
      this.applySelectable(o, c?.s ?? NOTHING);
    }
  }

  /** Extra selectechniques (registered by the environment's tools). */
  readonly selectTechniques: Record<string, (o: CutObject, forced: boolean) => void> = {
    set_always_selectable: () => {},
    set_cutplane_selectable: () => {},
    set_room_selectable: () => {},
    set_systemcursor_selectable: () => {},
  };

  /** determine_selectable through the section, as pick.ts implements it. */
  private objectCandidate(o: CutObject): { s: Selectable; pick: KernelPick } | undefined {
    if (this.vm.props.has(o, P.Sectioninvisible) || o.brep.numFaces === 0) return undefined;
    const s = this.section(o);
    if (!s) return undefined;
    const [x, y, z] = this.cursor();
    const pick = pickAt(this.world(o), s, x, y, z, this.picksize);
    if (!pick) return undefined;
    let feature: Feature;
    let kind: number;
    if (pick.kind === 'object' || this.vm.props.has(o, P.Lockedgeometry)) {
      feature = o;
      kind = SelectKind.Obj;
    } else if (pick.kind === 'vertex') {
      feature = this.features.vertex(o, pick.id);
      kind = SelectKind.Vert;
    } else if (pick.kind === 'edge') {
      feature = this.features.edge(o, pick.id);
      kind = SelectKind.Edge;
    } else {
      feature = this.features.face(o, pick.id);
      kind = pick.kind === 'inPlaneFace' ? SelectKind.Inplaneface : SelectKind.Face;
    }
    return { s: { feature, kind, at: pick.at }, pick };
  }

  /** set_object_selectable's bookkeeping: move the Selectable property to the new feature. */
  applySelectable(o: CutObject, s: Selectable): void {
    const old = this.selectables.get(o) ?? NOTHING;
    if (s.kind === SelectKind.Nothing) {
      if (old.feature && this.vm.props.has(old.feature, P.Selectable))
        this.vm.props.del(old.feature, P.Selectable);
    } else if (s.feature !== old.feature) {
      if (old.feature && this.vm.props.has(old.feature, P.Selectable))
        this.vm.props.del(old.feature, P.Selectable);
      this.vm.props.add(s.feature!, P.Selectable);
    } else if (!this.vm.props.has(s.feature!, P.Selectable))
      this.vm.props.add(s.feature!, P.Selectable);
    this.selectables.set(o, s);
  }

  pick(f: Feature): void {
    this.vm.props.set(f, P.Picked, 0);
  }

  unpick(f: Feature): void {
    if (this.vm.props.has(f, P.Picked)) this.vm.props.del(f, P.Picked);
  }

  /** execute_RELEAS on a vertex, edge or face: the drag is done; faces merge back. */
  release(f: Feature): void {
    if (isSub(f)) this.finishDrag(f.object);
  }

  pickPlane(): void {
    this.pick(this.cutplane);
  }

  releasePlane(): void {
    this.unpick(this.cutplane);
  }

  // ---- drags ----

  /** Ends a drag of `o`'s features: merges faces split for it, or undoes it if the solid broke. */
  private finishDrag(o: CutObject): void {
    const plan = this.drags.get(o);
    if (!plan) return;
    this.drags.delete(o);
    const keep = new Set<number>();
    for (const s of this.features.known(o))
      if (s.type === T.Fve && this.vm.props.has(s, P.Picked) && o.brep.isFace(s.id)) keep.add(s.id);
    recombineSurfaces(o.brep, keep);
    const now = healthOf(o.brep);
    if ((plan.health.closed && !now.closed) || now.degenerate > plan.health.degenerate) {
      // Couldn't keep the solid sound: put it back as it was before the drag.
      const snap = this.journal.before(o);
      if (snap) this.restore(snap);
    }
    this.dropDeadFeatures(o);
    this.changed(o);
  }

  /** Finishes every drag in progress (the Pick button came up). */
  finishDrags(): void {
    for (const o of [...this.drags.keys()]) this.finishDrag(o);
  }

  /** Forgets properties of elements that no longer exist (after merges and deletes). */
  private dropDeadFeatures(o: CutObject): void {
    for (const s of this.features.known(o)) if (!this.features.alive(s)) this.vm.props.forget(s);
  }

  // ---- updates (update.c) ----

  logUpdate(f: Feature, flags: number, now: boolean): void {
    const prop = now ? P.Quickupdate : P.Regularupdate;
    const old = this.vm.props.has(f, prop) ? (this.vm.props.get(f, prop) as number) : 0;
    this.vm.props.set(f, prop, flags | old);
  }

  private globalFlags = 0;

  globalUpdate(flags: number, now: boolean): void {
    this.globalFlags |= flags;
    if (now) this.processGlobalUpdates();
  }

  afterInstruction(): void {
    this.movedNow.clear();
    this.processUpdates(this.environment, P.Quickupdate);
    this.processUpdates(this.vm.working, P.Quickupdate);
  }

  /** process_updates: acts on and clears every logged update in a world. */
  processUpdates(world: Feature, prop: number): void {
    for (;;) {
      const fs = this.vm.props.features(world, prop);
      if (fs.length === 0) return;
      const f = fs[0]!;
      const flags = this.vm.props.get(f, prop) as number;
      this.vm.props.del(f, prop);
      this.processFeatureUpdate(f, flags);
    }
  }

  private processFeatureUpdate(f: Feature, flags: number): void {
    const o = isObject(f) ? f : isSub(f) ? f.object : null;
    if (!o) return;
    const all = isObject(f) ? [...subtree(groupRoot(o))] : [o];
    for (const x of all) {
      if (
        flags &
        (UF.Transformflag |
          UF.Evfeqnsflag |
          UF.Cutevfsflag |
          UF.Makecutsectionflag |
          UF.Computebboxflag)
      )
        this.changed(x);
      if (
        flags & UF.Getselectableflag &&
        this.vm.props.has(x, P.Visible) &&
        x.selectTechnique === 'set_object_selectable'
      ) {
        const c = this.objectCandidate(x);
        this.applySelectable(x, c?.s ?? NOTHING);
      }
    }
  }

  /** process_global_updates (with remove_killed_features first). */
  processGlobalUpdates(): void {
    this.removeKilled();
    if (this.globalFlags & UF.Redrawflag) this.version++;
    this.globalFlags = 0;
  }

  /** The end of a frame: regular updates, then global ones. */
  endFrame(): void {
    this.processUpdates(this.environment, P.Quickupdate);
    this.processUpdates(this.environment, P.Regularupdate);
    this.processUpdates(this.vm.working, P.Quickupdate);
    this.processUpdates(this.vm.working, P.Regularupdate);
    this.processGlobalUpdates();
  }

  /** remove_killed_features: objects leave their worlds; vertices, edges and faces are deleted. */
  private removeKilled(): void {
    for (const w of this.worlds) {
      for (;;) {
        const doomed = this.vm.props.features(w, P.Killed);
        if (doomed.length === 0) break;
        const f = doomed[0]!;
        this.vm.props.forget(f);
        if (isObject(f)) this.killObject(f);
        else if (isSub(f)) this.killSub(f);
      }
    }
  }

  /** kill_obj: the object leaves the tree (its children go to its parent). */
  private killObject(o: CutObject): void {
    const p = o.parent;
    if (!p) return;
    if (this.worldOf(o) === this.primary) this.journal.touchTree();
    const i = p.children.indexOf(o);
    p.children.splice(i, 1, ...o.children);
    for (const c of o.children) {
      c.parent = p;
      c.linked = true;
    }
    o.children = [];
    o.parent = null;
    for (const s of this.features.known(o)) this.vm.props.forget(s);
    this.selectables.delete(o);
    this.treeChanged();
  }

  /** Deleting a vertex, edge or face; refused if it would break the solid (as in M4). */
  private killSub(s: Sub): void {
    const o = s.object;
    if (!this.features.alive(s)) return;
    if (this.worldOf(o) === this.primary) this.journal.touch(o);
    const before = o.brep.clone();
    const was = healthOf(o.brep);
    const vol = volume(o.brep);
    try {
      if (s.type === T.Vfe) deleteVertex(o.brep, s.id);
      else if (s.type === T.Evf) deleteEdge(o.brep, s.id);
      else if (s.type === T.Fve) deleteFace(o.brep, s.id);
      const now = healthOf(o.brep);
      const v = volume(o.brep);
      if ((was.closed && !now.closed) || now.degenerate > was.degenerate) throw new Error('broken');
      if (Math.sign(v) !== Math.sign(vol) || Math.abs(v) < 1e-3) throw new Error('flat');
    } catch {
      o.brep = before;
    }
    this.dropDeadFeatures(o);
    this.selectables.set(o, NOTHING);
    this.changed(o);
  }

  toggleShade(): void {
    this.shaded = !this.shaded;
    this.version++;
  }

  quit(): void {
    this.quitRequested = true;
  }

  // ---- C routines ----

  private crtn(name: string, vm: VM): void {
    const own = this.crtnTable[name];
    if (own) own(vm);
    else BUILTIN_CRTNS[name]?.(this, vm);
  }

  // ---- undo ----

  /** Puts an object back as a snapshot has it. */
  restore(s: ObjectSnapshot): void {
    const o = s.object;
    o.brep = s.brep.clone();
    o.xform = s.xform.slice();
    o.invXform = s.invXform.slice();
    o.color = [...s.color];
    o.name = s.name;
    this.vm.props.forget(o);
    for (const n of [...s.props].reverse()) this.addProp(o, n);
    for (const h of this.features.known(o)) this.vm.props.forget(h);
    this.changed(o);
  }

  /** Closes the step a gesture opened (as one undoable edit). */
  commit(): Step | undefined {
    return this.journal.commit();
  }

  undo(): boolean {
    return this.applyStep(this.journal.undo(), 'before');
  }

  redo(): boolean {
    return this.applyStep(this.journal.redo(), 'after');
  }

  private applyStep(s: Step | undefined, side: 'before' | 'after'): boolean {
    if (!s) return false;
    if (s.tree) restoreTree(this.primary.root, s.tree[side]);
    for (const snap of s[side]) this.restore(snap);
    // Nothing stays picked across an undo.
    for (const f of this.vm.props.features(this.primary, P.Picked)) this.vm.props.del(f, P.Picked);
    for (const o of subtree(this.primary.root)) this.selectables.set(o, NOTHING);
    this.treeChanged();
    return true;
  }

  // ---- views for the app ----

  /** The objects of a world that are drawn (Visible, not killed), parents first. */
  drawn(world: WorldFeature): CutObject[] {
    const out: CutObject[] = [];
    const walk = (p: CutObject) => {
      for (const c of p.children) {
        if (this.vm.props.has(c, P.Visible) && !this.vm.props.has(c, P.Killed)) out.push(c);
        walk(c);
      }
    };
    walk(world.root);
    return out;
  }

  /** Every picked feature in a world. */
  picked(world: WorldFeature = this.primary): Feature[] {
    return this.vm.props.features(world, P.Picked);
  }

  /** Every selectable feature in a world (what the crosshair would pick). */
  selected(world: WorldFeature = this.primary): Feature[] {
    return this.vm.props.features(world, P.Selectable);
  }

  /** Moves the crosshair's objects to the stage (after the app moved it without CPL). */
  syncStage(): void {
    const [x, y, z] = [
      this.cursorObj.xform[12]!,
      this.cursorObj.xform[13]!,
      this.cutplane.xform[14]!,
    ];
    const d: V3 = [this.stage.x - x, this.stage.y - y, this.stage.z - z];
    if (d[0] || d[1]) this.moveBranch(this.cursorObj, [d[0], d[1], 0]);
    if (d[2]) this.moveBranch(this.cutplane, [0, 0, d[2]]);
  }

  /** Is any primary-world object a picked whole object, or a feature of one? */
  pickedObjects(): CutObject[] {
    const out = new Set<CutObject>();
    for (const f of this.picked()) out.add(groupRoot(isObject(f) ? f : (f as Sub).object));
    return [...out];
  }

  get canUndo(): boolean {
    return this.journal.canUndo;
  }
  get canRedo(): boolean {
    return this.journal.canRedo;
  }

  /** Room limits (Mincrossx etc.). */
  static readonly ROOM = ROOM;
}

interface Pick3 {
  selectTechnique: string;
  drawTechnique: string;
  screenBBoxTechnique: string;
}
