import {
  CRTN_NAMES,
  CplAssemblyError,
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
  FINE,
  NONE,
  ROOM,
  betterPick,
  computeSection,
  createObject,
  deleteEdge,
  deleteFace,
  deleteVertex,
  duplicateTree,
  extrudeFace,
  groupRoot,
  mat4,
  mvfs,
  mev,
  pickAt,
  planarizeForMotion,
  planarizeForMoves,
  recombineSurfaces,
  subtree,
  transformTree,
  validate,
  volume,
  WorldGeometry,
  type CutObject,
  type FeatureAttrs,
  type Mat4,
  type ObjectSection,
  type Pick as KernelPick,
  type Rgb,
} from '@cutplane/kernel';
import { FeatureIndex, isObject, isSub, isWorld, type Sub, type WorldFeature } from './features.ts';
import { BUILTIN_CRTNS } from './crtns.ts';
import { faceFit } from './facefit.ts';
import { DUPLICATE_OFFSET } from './controls.ts';
import {
  SCALEBOX_CRTNS,
  createScaleBoxTemplate,
  scaleBoxes,
  setScaleBoxSelectable,
  syncFaceBox,
} from './tools/scalebox.ts';
import { booleansReady, solidMesh, solidsOverlap, type SolidMesh } from '@cutplane/booleans';
import { Journal, restoreTree, type ObjectSnapshot, type Step } from './journal.ts';
import { MODELING_CRTNS, booleanAll } from './modeling.ts';
import { PENCIL_CRTNS } from './tools/pencil.ts';

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

/** One string of an object's label (text.c's textstring). */
export interface TextItem {
  text: string | null;
  /** Where it starts, in the object's frame. */
  offset: V3;
  xscale: number;
  yscale: number;
  penWidth: number;
  color: V3;
  style: 'Plain' | 'Bold' | 'Shadow' | 'Underline' | 'Italic';
  /** The I-beam's place (characters from the start), or -1 for none. */
  insertion: number;
}

export interface Selectable {
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
  /** Extrude mode: the face pulled out on new walls, and its normal (world) at the start. */
  extruded?: { face: number; normal: V3 };
}

/**
 * How a dragged face moves its solid. 'stretch' is the original's: the face's vertices
 * move, and the faces around it stretch. 'extrude' (new here, to experiment with): a flat
 * face pulled outward first grows walls of its own, so the faces around it stay as they
 * were; one pushed inward stretches as before.
 */
export type FaceDrag = 'stretch' | 'extrude';

/**
 * New here: what a click on a group's part picks. 'parts' (the original's way): its
 * vertex, edge or face, and the whole group only from inside its section. 'whole':
 * the group, wherever it is clicked (an imported model is a group of many thin parts,
 * whose sections have little inside to click). In the world being edited only.
 */
export type GroupPick = 'parts' | 'whole';

/** The least an extruded face must stand out of its old place for its walls to stay. */
const EXTRUDE_MIN = 1;
/** How far out of a face's plane (a share of the move) a move along it may stray by rounding. */
const ALONG_FACE = 1e-6;

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
  /** CPL source by file name. */
  readonly source: (file: string) => string;
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
  readonly frontwall: CutObject;
  readonly groupObj: CutObject;
  /** create_scalebbox's template, which rom.cpl copies around picked objects. */
  readonly scaleBoxTemplate: CutObject;

  /** select.c's always_set_selectable (set by Crtn:always_set_select during drags). */
  alwaysSetSelectable = false;
  /** New here: the Pick button is held (set by Controls), so what's picked is in hand. */
  pickHeld = false;
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
  /** How a dragged face moves its solid. */
  faceDrag: FaceDrag = 'stretch';
  /** What a click on a part of a group picks. */
  groupPick: GroupPick = 'parts';
  /** Lets objects (group roots) fall to the floor: the app's physics (the globe, drop_objects). */
  dropper: ((roots: CutObject[]) => void) | null = null;
  /** New here: while R's snap is under way, a group's part is offered (selectPartsUnder). */
  offerParts = false;
  /** New here: features for CPL to take next (CRTN Crtn:handed_over). */
  handOver: Feature[] = [];
  /**
   * Objects that can't be picked for now (one falling isn't where the world has it).
   * Not a property: nothing of it is saved, copied or undone.
   */
  readonly outOfReach = new Set<CutObject>();
  /** Objects put out of sight (the 1 key): not drawn, so not pickable either. */
  readonly unseen = new Set<CutObject>();
  /**
   * New here: fine meshes being moved or turned (a terrain, a scan), drawn as
   * stand-ins until they settle and not pickable meanwhile: finding what's
   * under the crosshair would place and index all of one anew each frame. The
   * drawing takes them out once they have settled.
   */
  readonly moving = new Set<CutObject>();
  /**
   * New here: permanent gravity is on (a double click with the globe). With "Groups
   * pick whole", a click on any object picks it whole (it dangles from where it is
   * held, rather than being reshaped), and wholePicks says where that was.
   */
  dangling = false;
  /** Where each object picked whole was clicked: its vertex, edge or face, or inside it. */
  readonly wholePicks = new WeakMap<CutObject, KernelPick>();
  /**
   * New here: the magnet's release, given what it grabbed and what is under the
   * crosshair. True if it saw to the snap itself (its drag showed where it would go).
   */
  magnetSnap: ((source: Feature, under: Feature) => boolean) | null = null;
  /**
   * New here: what a boolean tool (the drill's cutter, what the union tool picked
   * up) carries out of the world. While it is carried, what it overlaps is what's
   * selectable in the world, so letting go acts on all of that, wherever the
   * crosshair is.
   */
  private readonly carried = new Set<CutObject>();
  private readonly solidMeshes = new Map<Brep, SolidMesh | null>();
  /** What each copy was duplicated from: a drill's cutter doesn't cut its own original. */
  private readonly copiedFrom = new WeakMap<CutObject, CutObject>();
  /** New here: what each copy D made was copied from (placeCopy goes on only from those). */
  private readonly duplicatedFrom = new WeakMap<CutObject, CutObject>();
  /** Last overlap found between a carried object and each object, while neither moved. */
  private readonly overlaps = new WeakMap<
    CutObject,
    { brep: Brep; xform: Mat4; cargo: CutObject; cBrep: Brep; cXform: Mat4; hit: boolean }
  >();

  private readonly worldOfRoot = new Map<CutObject, WorldFeature>();
  private readonly geometry = new Map<CutObject, WorldGeometry>();
  private readonly sections = new Map<CutObject, { z: number; s: ObjectSection }>();
  private readonly selectables = new WeakMap<CutObject, Selectable>();
  /** Objects whose geometry or placement changed since the app last looked. */
  private readonly changedObjects = new Set<CutObject>();
  private readonly drags = new Map<CutObject, DragPlan>();
  /** Vertices already moved by the instruction now running (each moves once per sentence). */
  private readonly movedNow = new Set<string>();
  /** Groups already turned by the instruction now running. */
  private readonly rotatedNow = new Set<CutObject>();
  private readonly crtnTable: Partial<Record<string, Crtn>>;

  constructor(opts: RuntimeOptions) {
    this.stage = opts.stage;
    this.source = opts.source;
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
    this.journal = new Journal(
      () => this.primary.root,
      (o) => this.vm.props.has(o, P.Scalebbox),
    );

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
    // cutplane_web: where every other plane jump goes (cursor.cpl).
    this.frontwall = this.makeObj(
      env,
      [0, 0, ROOM.max[2]],
      'Room_Frontwall',
      ['Nonmanifold', 'Noshadow'],
      {
        selectTechnique: 'set_always_selectable',
        drawTechnique: 'nodraw_technique',
      },
    );
    this.vm.props.del(this.frontwall, P.Visible);
    this.groupObj = this.makeObj(env, null, 'Groupobj', ['Nonmanifold', 'Noshadow']);
    this.vm.props.del(this.groupObj, P.Visible);
    this.scaleBoxTemplate = createScaleBoxTemplate(this);
    this.registerCrtns(SCALEBOX_CRTNS);
    this.frameHooks.push(() => syncFaceBox(this));
    this.registerCrtns(MODELING_CRTNS);
    this.registerCrtns(PENCIL_CRTNS);
    this.selectTechniques['set_scalebbox_selectable'] = (o) => setScaleBoxSelectable(this, o);
    this.placeEnvironment();
  }

  /** init_CPL_language and attach_otherworlds_CPLcode: ROM, property files, the cursor's code. */
  loadCode(source: (file: string) => string): void {
    this.vm.loadRom(source('rom.cpl'));
    for (const p of PROPERTY_FILES)
      this.vm.loadPropertyCode(source(`${p.toLowerCase()}.cpl`), `${p.toLowerCase()}.cpl`, p);
    this.vm.loadPrivateCode(this.cursorObj, source('cursor.cpl'), 'cursor.cpl');
    this.vm.resolveObjectRefs();
    this.codeLoaded = true;
  }

  private codeLoaded = false;

  private readonly triedPropertyFiles = new Set<string>();

  /**
   * read_feature_props: a property read without code gets its code from <name>.cpl
   * if there is one (read_CPL_propfile), as the grabber, magnet and pan tool do.
   */
  private loadPropertyFile(name: string): void {
    // Not before ROM and the property files are in (the constructor builds things first).
    if (!this.codeLoaded || this.triedPropertyFiles.has(name)) return;
    this.triedPropertyFiles.add(name);
    const p = this.vm.props.find(name);
    if (p >= 0 && this.vm.props.code[p]) return;
    const file = `${name.toLowerCase()}.cpl`;
    let text: string;
    try {
      text = this.source(file);
    } catch {
      return; // no such file: the property has no code
    }
    if (p < 0) this.vm.props.defineNew(name);
    this.vm.loadPropertyCode(text, file, name);
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
    if (name !== null) this.vm.resolveObjectRefs();
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
      for (const o of subtree(r)) {
        // Into the world being edited, nothing comes picked, selectable or the like: a
        // file (an autosave) kept what it was saved with, and a thing picked there would
        // come back picked but not in a scale box, dragged by a press on anything else.
        if (world === this.primary) {
          const lasting = (names: string[]) => names.filter((n) => !TRANSIENT_PROPS.has(n));
          o.attrs.props = lasting(o.attrs.props);
          for (const map of [o.brep.vertexAttrs, o.brep.edgeAttrs, o.brep.faceAttrs])
            for (const a of map.values()) a.props = lasting(a.props);
        }
        this.register(o);
      }
    }
    this.treeChanged();
    // Code loaded before these existed may name them (Obj:Paintchip).
    this.vm.resolveObjectRefs();
  }

  /** Objects brought in from a file (OBJ, STL, glTF) put into the world being edited: one undoable step. */
  addObjects(roots: readonly CutObject[]): void {
    this.journal.touchTree();
    this.importObjects(this.primary, roots);
    // The step keeps them with their properties, so a redo brings them back whole.
    for (const r of roots) for (const o of subtree(r)) this.journal.touch(o);
    this.commit();
  }

  /**
   * Gives CPL an object's properties as read_feature_props did: added in the file's
   * order, each to the front of the list, so the list (and the order JSRAT runs their
   * code in) is the file's reversed. The saw's Slice runs before its Tool code that way.
   */
  private register(o: CutObject): void {
    for (const n of o.attrs.props) {
      this.loadPropertyFile(n);
      this.addProp(o, n);
    }
    this.attachCode(o, o.attrs, o.name ?? 'object');
    const b = o.brep;
    for (const [type, map] of [
      [T.Vfe, b.vertexAttrs],
      [T.Evf, b.edgeAttrs],
      [T.Fve, b.faceAttrs],
    ] as const)
      for (const [id, a] of map) {
        const h = this.features.of(o, type, id);
        for (const n of a.props) this.addProp(h, n);
        this.attachCode(h, a, `${o.name ?? 'object'}:${id}`);
      }
  }

  /** Assembly errors in code that came with loaded objects, by feature. */
  readonly codeErrors = new Map<Feature, CplAssemblyError>();

  /**
   * read_CPL_privatecode for a loaded feature: its inline code (new), else the file
   * the original referred to. Code it already has (an undo putting it back) stays.
   */
  private attachCode(f: Feature, a: FeatureAttrs, name: string): void {
    if (this.vm.privateCode(f)) return;
    let text = a.privateSource;
    let file = `${name}.cpl`;
    if (text === undefined && a.privateCode) {
      file = a.privateCode.replace(/^.*\//, '');
      try {
        text = this.source(file);
      } catch {
        return; // the original's file isn't among ours
      }
    }
    if (text === undefined) return;
    this.setPrivateCode(f, text, file);
  }

  /**
   * Gives a feature new private code, live (the CPL editor, SETCODE, loading). On an
   * assembly error the feature keeps the code it had; the error is returned.
   */
  setPrivateCode(f: Feature, text: string, file = 'private.cpl'): CplAssemblyError | null {
    try {
      this.vm.loadPrivateCode(f, text, file);
      this.vm.resolveObjectRefs();
      this.codeErrors.delete(f);
      this.version++;
      return null;
    } catch (e) {
      if (!(e instanceof CplAssemblyError)) throw e;
      this.codeErrors.set(f, e);
      return e;
    }
  }

  /**
   * Reassembles a property file (stamp.cpl) live: the property's code is the new code
   * from the next frame on. On an assembly error nothing changes; the error is returned.
   */
  setPropertyCode(file: string, text: string): CplAssemblyError | null {
    const property = PROPERTY_FILES.find((p) => `${p.toLowerCase()}.cpl` === file);
    try {
      this.vm.loadPropertyCode(text, file, property);
      this.vm.resolveObjectRefs();
      this.version++;
      return null;
    } catch (e) {
      if (!(e instanceof CplAssemblyError)) throw e;
      return e;
    }
  }

  /** The code a property file runs now (as last loaded or edited). */
  propertySource(file: string): string | undefined {
    const property = PROPERTY_FILES.find((p) => `${p.toLowerCase()}.cpl` === file);
    return property ? this.vm.propertySources.get(property) : undefined;
  }

  /**
   * The primary world's objects, ready to save: scale boxes looked through, and each
   * object's and feature's private code put into its attributes (inline CPL).
   */
  documentRoots(): CutObject[] {
    const boxes = (o: CutObject) => this.vm.props.has(o, P.Scalebbox);
    const roots = this.primary.root.children.flatMap((o) => (boxes(o) ? o.children : [o]));
    for (const r of roots)
      for (const o of subtree(r)) {
        const src = this.vm.privateSources.get(o);
        if (src !== undefined) o.attrs.privateSource = src;
        for (const h of this.features.known(o)) {
          const hs = this.vm.privateSources.get(h);
          if (hs === undefined || !this.features.alive(h)) continue;
          const map =
            h.type === T.Vfe
              ? o.brep.vertexAttrs
              : h.type === T.Evf
                ? o.brep.edgeAttrs
                : h.type === T.Fve
                  ? o.brep.faceAttrs
                  : null;
          if (!map) continue;
          const a = map.get(h.id) ?? { props: [] };
          a.privateSource = hs;
          map.set(h.id, a);
        }
      }
    return roots;
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
    // Kept in the file's order (the list reversed), so register() rebuilds the same list.
    const names = this.vm.propNames(f).reverse();
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
    // find_largergrain: asking for a vertex gives back what you have (nothing is smaller).
    if (f.type === type || type === T.Vfe) return f;
    if (type === T.World) return this.worldOf(f);
    if (isSub(f)) {
      const b = f.object.brep;
      // A vertex's mother edge and face are those of its starting half-edge (startle).
      if (f.type === T.Vfe && (type === T.Evf || type === T.Fve)) {
        const h = b.vertexHe(f.id);
        if (h === NONE) return null;
        if (type === T.Evf) {
          const e = b.heEdge(h);
          return e === NONE ? null : this.features.edge(f.object, e);
        }
        const face = b.heFace(h);
        return face === NONE ? null : this.features.face(f.object, face);
      }
      if (f.type === T.Evf && type === T.Fve) {
        const face = b.heFace(b.edgeHe1(f.id));
        return face === NONE ? null : this.features.face(f.object, face);
      }
      // A face's "mother edge" was never set in find_largergrain (an uninitialised
      // pointer, not Nil): rom.cpl's edge test relies on getting something other
      // than the face back. Its first edge stands in.
      if (f.type === T.Fve && type === T.Evf) {
        const e = b.heEdge(b.loopHe(b.faceLoop(f.id)));
        return e === NONE ? null : this.features.edge(f.object, e);
      }
      if (type === T.Obj) return f.object;
      if (type === T.Shell) {
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
    const verts = b.verticesByShell();
    const faces = b.facesByShell();
    const edges = new Map(b.shells().map((s) => [s, [] as number[]]));
    for (const e of b.edges()) edges.get(b.vertexShell(b.edgeVertices(e)[0]))?.push(e);
    for (const s of b.shells()) {
      for (const v of verts.get(s)!) out.push(this.features.vertex(obj, v));
      for (const e of edges.get(s)!) out.push(this.features.edge(obj, e));
      for (const f of faces.get(s)!) out.push(this.features.face(obj, f));
    }
    return out;
  }

  adopt(parent: Feature, child: Feature, linked: boolean): void {
    if (!isObject(parent) || !isObject(child) || parent === child) return;
    for (let a: CutObject | null = parent; a; a = a.parent) if (a === child) return; // no cycles
    const from = this.worldOf(child);
    const to = this.worldOf(parent);
    if (from === this.primary || to === this.primary) this.journal.touchTree();
    // Carried off by a tool (the union tool): an undo puts it back where it was picked up.
    if (from === this.primary && to !== this.primary) this.journal.touch(child);
    if (to === this.primary) this.carried.delete(child);
    else if (
      from === this.primary &&
      (this.hasProp(parent, 'Drill') || this.hasProp(parent, 'Union'))
    )
      this.carried.add(child);
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

  /** What `o` was copied from (a drill's cutter: the object pressed), or `o` itself. */
  originalOf(o: CutObject): CutObject {
    return this.copiedFrom.get(o) ?? o;
  }

  duplicate(obj: Feature): CutObject {
    const o = obj as CutObject;
    const copy = duplicateTree(o);
    this.copiedFrom.set(copy, o);
    // duplicate_obj_branch: the copy goes to the top of the original's world, linked.
    const parent = (this.worldOf(o) ?? this.primary).root;
    if (parent === this.primary.root) this.journal.touchTree();
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
      const copyProps = (from: Feature, to: Feature) => {
        for (const p of this.vm.props.of(from).reverse())
          if (!TRANSIENT_PROPS.has(this.vm.props.names[p] ?? '')) this.vm.props.add(to, p);
        this.vm.sharePrivateCode(from, to);
      };
      copyProps(a, b);
      // ...and its vertices', edges' and faces' (the clone keeps element ids).
      for (const h of this.features.known(a))
        if (this.features.alive(h)) copyProps(h, this.features.of(b, h.type, h.id));
    }
    // The step records the copies with their properties, so redo brings them back whole.
    if (parent === this.primary.root) for (const [, b] of pairs) this.journal.touch(b);
    this.treeChanged();
    return copy;
  }

  /**
   * New here: where D puts a copy. A copy of a copy goes on from it as that went on from
   * its own original, turned as that was (so a turn each time makes a ring), but for a
   * half turn (a copy flipped to meet its original), which would bring it back: then just
   * moved as that was. A first copy goes DUPLICATE_OFFSET over, as controls.c put each.
   */
  placeCopy(copy: CutObject): void {
    const from = this.copiedFrom.get(copy);
    // Only D's copies go on: one the primitives box (stamp.cpl's DUP) or the drill made
    // was copied from something elsewhere, and starts afresh.
    const before = from && this.duplicatedFrom.get(from);
    if (from) this.duplicatedFrom.set(copy, from);
    if (!from || !before) {
      this.moveBranch(copy, DUPLICATE_OFFSET);
      return;
    }
    // The move that took the one before to the one copied: from = before · step.
    const step = mat4.multiply(mat4.invert(before.xform) ?? mat4.identity(), from.xform);
    if (step[0]! + step[5]! + step[10]! > -1 + 1e-6) {
      this.transformBranch(copy, step);
      return;
    }
    const a = this.branchBox(before);
    const b = this.branchBox(from);
    if (!a || !b) return;
    const mid = (x: typeof a, k: number) => (x[0][k]! + x[1][k]!) / 2;
    this.moveBranch(copy, [0, 1, 2].map((k) => mid(b, k) - mid(a, k)) as V3);
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

  /** `o` was moved or turned by hand (a drag, the rotate tool): a fine mesh is `moving`. */
  private placed(o: CutObject): void {
    this.changed(o);
    if (o.brep.numVertices > FINE) this.moving.add(o);
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
  moveBranch(root: CutObject, d: V3): void {
    const m = mat4.translation(...d);
    for (const o of subtree(root)) {
      if (this.worldOf(o) === this.primary) this.journal.touch(o);
      o.xform = mat4.multiply(o.xform, m);
      o.invXform = mat4.invert(o.xform) ?? o.invXform;
      this.placed(o);
    }
  }

  /** One object moved by `d`, without its children (a group's root moved apart from its parts). */
  moveOne(o: CutObject, d: V3): void {
    if (this.worldOf(o) === this.primary) this.journal.touch(o);
    o.xform = mat4.multiply(o.xform, mat4.translation(...d));
    o.invXform = mat4.invert(o.xform) ?? o.invXform;
    this.placed(o);
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
    if (!plan) {
      this.drags.set(o, (plan = { start: new Map(), moved: new Map(), health: healthOf(b) }));
      if (this.faceDrag === 'extrude') this.startExtrude(o, f, d, plan);
    }
    const key = (v: number) => `${this.idOf(o)}:${v}`;
    // (A lamina pulled by its other face, or an edge or corner of it, moves that face.)
    const [type, id] = plan.extruded ? [T.Fve, plan.extruded.face] : [f.type, f.id];
    const verts = movingVertices(b, type, id).filter((v) => !this.movedNow.has(key(v)));
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

  /**
   * New here: vertices of `o` taken by a world transform `m` (a face scaled in the plane
   * by its box), as a drag is: faces the move would bend are split first, and on
   * release merge back, or the solid is put back if it broke.
   */
  transformVertices(o: CutObject, verts: readonly number[], m: Mat4): void {
    const b = o.brep;
    if (this.worldOf(o) === this.primary) this.journal.touch(o);
    if (!this.drags.has(o))
      this.drags.set(o, { start: new Map(), moved: new Map(), health: healthOf(b) });
    const local = mat4.multiply(mat4.multiply(o.xform, m), o.invXform);
    const to = new Map<number, V3>();
    for (const v of verts) {
      const p = b.vertexPos(v);
      to.set(v, mat4.transformPoint(local, p[0], p[1], p[2]));
    }
    planarizeForMoves(b, to);
    for (const [v, p] of to) b.setVertexPos(v, p[0], p[1], p[2]);
    this.changed(o);
  }

  /**
   * Extrude mode, at a face drag's first move: a flat face (not part of a curved
   * surface) moving outward is extruded by nothing, so the drag moves its new cap.
   */
  private startExtrude(o: CutObject, f: Sub, d: V3, plan: DragPlan): void {
    const b = o.brep;
    let face = f.id;
    if (f.type !== T.Fve) {
      // An edge or corner of a lamina (a plan's wall, taken where it lies in the plane):
      // the lamina is pulled out, not bent up by it.
      if (f.type !== T.Evf && f.type !== T.Vfe) return;
      const he = f.type === T.Evf ? b.edgeHe1(f.id) : b.vertexHe(f.id);
      if (he === NONE) return;
      face = b.heFace(he);
      if (b.faces(b.faceShell(face)).length !== 2) return;
    }
    if (b.faceSurface.has(face)) return;
    // Outward by more than rounding: a move along the face's own plane (an agent's,
    // exactly) slides it as a stretch does. Taken as outward, it was extruded by
    // nothing and let go no further out, so the extrusion, and the move, were taken back.
    const length = Math.hypot(d[0], d[1], d[2]);
    const outward = (n: Vec3) => n[0]! * d[0] + n[1]! * d[1] + n[2]! * d[2] > ALONG_FACE * length;
    let n = this.world(o).faceNormal(face);
    if (!outward(n)) {
      // A lamina's two faces lie on each other: taken by the one facing away, the other is pulled.
      const twin = [...b.faces(b.faceShell(face))];
      if (twin.length !== 2) return;
      face = twin[0] === face ? twin[1]! : twin[0]!;
      n = this.world(o).faceNormal(face);
      if (!outward(n)) return;
    }
    extrudeFace(b, face, 0, 0, 0);
    plan.extruded = { face, normal: [n[0], n[1], n[2]] };
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
    // Several picked features of one group turn it once per sentence.
    if (this.rotatedNow.has(o)) return;
    this.rotatedNow.add(o);
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
    for (const x of subtree(o)) this.placed(x);
  }

  /** A branch moved by the world transform `m` (row vectors), as one edit (a fall, the globe). */
  transformBranch(root: CutObject, m: Mat4): void {
    for (const x of subtree(root)) if (this.worldOf(x) === this.primary) this.journal.touch(x);
    transformTree(root, m);
    for (const x of subtree(root)) this.changed(x);
  }

  /** A branch scaled along x, y and z by `s` about `about` (the measure pad's resizing). */
  scaleBranch(root: CutObject, about: V3, s: V3): void {
    const m = mat4.scaleAbout(about, s);
    for (const x of subtree(root)) if (this.worldOf(x) === this.primary) this.journal.touch(x);
    transformTree(root, m);
    for (const x of subtree(root)) this.changed(x);
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

  /**
   * snap_features_together (the magnet): `source`'s object turns and moves to meet
   * `target`. Face to face: the faces end up flush, facing each other. An edge to an
   * edge or a face: the edges line up, the grabbed edge's first end on the other's.
   */
  snapFeatures(source: Feature, target: Feature): void {
    if (this.magnetSnap?.(source, target)) return;
    if (!isSub(source) || !isSub(target)) return;
    const o = groupRoot(source.object);
    if (o === groupRoot(target.object)) {
      // New here: what's dragged is under the crosshair too; a face beyond it, if any.
      const beyond = source.type === T.Fve ? this.faceUnder((x) => groupRoot(x) === o) : null;
      if (beyond) this.snapFeatures(source, beyond.face);
      return;
    }
    const turn = (axis: V3, angle: number, about: V3) => {
      const len = Math.hypot(...axis);
      if (len < 1e-9 || Math.abs(angle) < 1e-9) return;
      this.transformBranch(o, mat4.rotationAbout(about, [axis[0] / len, axis[1] / len, axis[2] / len], angle)); // prettier-ignore
    };
    if (source.type === T.Fve && target.type === T.Fve) {
      const t = this.worldFace(target.object, target.id);
      const s0 = this.worldFace(source.object, source.id);
      if (!t || !s0) return;
      const want: V3 = [-t.normal[0], -t.normal[1], -t.normal[2]];
      const { axis, angle } = between(s0.normal, want);
      turn(axis, angle, s0.center);
      const s = this.worldFace(source.object, source.id)!;
      // Along the target's normal until the planes meet.
      const gap = dot(sub3(t.center, s.center), t.normal);
      this.moveBranch(o, [t.normal[0] * gap, t.normal[1] * gap, t.normal[2] * gap]);
      // New here: then settled in the plane (see faceFit).
      const pivot: V3 = [s.center[0] + t.normal[0] * gap, s.center[1] + t.normal[1] * gap, s.center[2] + t.normal[2] * gap]; // prettier-ignore
      const fit = this.settle(source, target, mat4.identity(), pivot);
      if (fit) this.transformBranch(o, fit);
      return;
    }
    if (source.type !== T.Evf || (target.type !== T.Evf && target.type !== T.Fve)) return;
    const s0 = this.worldEdge(source.object, source.id);
    // An edge onto a face: onto the face's section line, as the original did.
    const t = target.type === T.Evf ? this.worldEdge(target.object, target.id) : this.faceSectionLine(target.object, target.id); // prettier-ignore
    if (!s0 || !t) return;
    const { axis, angle } = between(sub3(s0[1], s0[0]), sub3(t[1], t[0]));
    turn(axis, angle, s0[0]);
    const s = this.worldEdge(source.object, source.id)!;
    this.moveBranch(o, sub3(t[0], s[0]));
  }

  /**
   * New here, for the magnet: the world move that turns `source`'s face about `about`
   * (a point on it) to face `target`'s, and carries `about` to `at` (a point on that
   * face), so the two lie flush.
   */
  faceSnap(source: Sub, target: Sub, about: V3, at: V3): Mat4 | null {
    const s = this.worldFace(source.object, source.id);
    const t = this.worldFace(target.object, target.id);
    if (!s || !t) return null;
    const { axis, angle } = between(s.normal, [-t.normal[0], -t.normal[1], -t.normal[2]]);
    const len = Math.hypot(...axis);
    const turn =
      len < 1e-9 || Math.abs(angle) < 1e-9
        ? mat4.identity()
        : mat4.rotationAbout(about, [axis[0] / len, axis[1] / len, axis[2] / len], angle);
    const m = mat4.multiply(turn, mat4.translation(...sub3(at, about)));
    const fit = this.settle(source, target, m, at);
    return fit ? mat4.multiply(m, fit) : m;
  }

  /**
   * New here, for the magnet: `source`'s face, moved by `m` to lie flush on `target`'s,
   * settled in their plane by faceFit (turning about `pivot`): the further move, if any.
   */
  private settle(source: Sub, target: Sub, m: Mat4, pivot: V3): Mat4 | null {
    const s = this.worldOutline(source.object, source.id);
    const t = this.worldOutline(target.object, target.id);
    const tf = this.worldFace(target.object, target.id);
    if (!s || !t || !tf) return null;
    const moved = s.map((p) => mat4.transformPoint(m, p[0], p[1], p[2]) as V3);
    return faceFit(moved, t, tf.normal, pivot, MAGNET_REACH);
  }

  /** A face's outer outline, in the world. */
  worldOutline(o: CutObject, f: number): V3[] | null {
    const b = o.brep;
    if (!b.faces().includes(f)) return null;
    const g = this.world(o);
    return b.loopHalfEdges(b.faceLoops(f)[0]!).map((h) => {
      const v = b.heVertex(h);
      return [g.x(v), g.y(v), g.z(v)] as V3;
    });
  }

  /**
   * New here, for the magnet: the face under the crosshair through the section (as it
   * would be highlighted), of any object in the world being edited but those `skip`ped.
   */
  faceUnder(skip: (o: CutObject) => boolean): { face: Sub; at: V3 } | null {
    let best: { o: CutObject; pick: KernelPick } | null = null;
    for (const f of this.vm.props.features(this.primary, P.Visible)) {
      if (!isObject(f) || skip(f) || this.vm.props.has(f, P.Nonselectable)) continue;
      if (this.outOfReach.has(f) || this.unseen.has(f) || this.moving.has(f) || this.vm.props.has(f, P.Sectioninvisible)) continue; // prettier-ignore
      if (f.brep.numFaces === 0 || this.vm.props.has(f, P.Lockedgeometry)) continue;
      const s = this.section(f);
      if (!s) continue;
      const [x, y, z] = this.cursor();
      const pick = pickAt(this.world(f), s, x, y, z, this.picksize);
      if (!pick || (pick.kind !== 'face' && pick.kind !== 'inPlaneFace')) continue;
      if (!best || betterPick(pick, best.pick)) best = { o: f, pick };
    }
    if (!best) return null;
    return { face: this.features.face(best.o, best.pick.id) as Sub, at: best.pick.at };
  }

  /** A face's world normal and centre. */
  worldFace(o: CutObject, f: number): { normal: V3; center: V3 } | null {
    const b = o.brep;
    if (!b.faces().includes(f)) return null;
    const g = this.world(o);
    const pts: V3[] = [];
    for (const h of b.loopHalfEdges(b.faceLoops(f)[0]!)) {
      const v = b.heVertex(h);
      pts.push([g.x(v), g.y(v), g.z(v)]);
    }
    const n: V3 = [0, 0, 0];
    const c: V3 = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[(i + 1) % pts.length]!;
      n[0] += (p[1] - q[1]) * (p[2] + q[2]);
      n[1] += (p[2] - q[2]) * (p[0] + q[0]);
      n[2] += (p[0] - q[0]) * (p[1] + q[1]);
      for (let k = 0; k < 3; k++) c[k]! += p[k]! / pts.length;
    }
    const len = Math.hypot(...n);
    if (len < 1e-12) return null;
    return { normal: [n[0] / len, n[1] / len, n[2] / len], center: c };
  }

  private worldEdge(o: CutObject, e: number): [V3, V3] | null {
    const g = this.world(o);
    try {
      const [a, b] = o.brep.edgeVertices(e);
      return [
        [g.x(a), g.y(a), g.z(a)],
        [g.x(b), g.y(b), g.z(b)],
      ];
    } catch {
      return null;
    }
  }

  /** Where the plane cuts a face: the line along the face at the plane's depth. */
  private faceSectionLine(o: CutObject, f: number): [V3, V3] | null {
    const face = this.worldFace(o, f);
    if (!face) return null;
    const n = face.normal;
    // The line's direction lies in the face and in the plane (z constant).
    const d: V3 = [-n[1], n[0], 0];
    const len = Math.hypot(d[0], d[1]);
    if (len < 1e-9) return null;
    const z = this.stage.z;
    // A point on the face at depth z, nearest the face's centre.
    const c = face.center;
    const k = n[0] * n[0] + n[1] * n[1];
    const t = (-(z - c[2]) * n[2]) / k;
    const p: V3 = [c[0] + n[0] * t, c[1] + n[1] * t, z];
    return [p, [p[0] + d[0] / len, p[1] + d[1] / len, z]];
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

  /** The box around an object and all under it (a group's, say), but a scale box on it. */
  branchBox(root: CutObject): [V3, V3] | null {
    let box: [V3, V3] | null = null;
    const parts: CutObject[] = [];
    const walk = (o: CutObject) => {
      if (this.vm.props.has(o, P.Scalebbox)) return;
      parts.push(o);
      o.children.forEach(walk);
    };
    walk(root);
    for (const o of parts) {
      const b = this.bbox(o);
      if (!b) continue;
      box = box
        ? [
            [
              Math.min(box[0][0], b[0][0]),
              Math.min(box[0][1], b[0][1]),
              Math.min(box[0][2], b[0][2]),
            ],
            [
              Math.max(box[1][0], b[1][0]),
              Math.max(box[1][1], b[1][1]),
              Math.max(box[1][2], b[1][2]),
            ],
          ]
        : b;
    }
    return box;
  }

  /** CPBOOLEAN (do_boolean): see modeling.ts. */
  boolean(a: Feature[], b: Feature, op: number): Feature[] {
    return booleanAll(this, a as CutObject[], b as CutObject, op);
  }

  // ---- modeling (used by modeling.ts) ----

  /** An object's solid replaced by a modeling operation's result (undoable). */
  reshape(o: CutObject, brep: Brep): void {
    if (this.worldOf(o) === this.primary) this.journal.touch(o);
    for (const s of this.features.known(o)) this.vm.props.forget(s);
    this.drags.delete(o);
    o.brep = brep;
    this.unselect(o); // its Selectable may be on the object itself, which outlives the reshape
    this.changed(o);
  }

  /**
   * A new object holding `brep` beside `like`: the same parent, frame, colour,
   * techniques and lasting properties (make_childobj_noshell, copy_feature_color).
   */
  spawnBeside(like: CutObject, brep: Brep): CutObject {
    const parent = like.parent ?? (this.worldOf(like) ?? this.primary).root;
    const primary = this.worldOf(like) === this.primary;
    if (primary) this.journal.touchTree();
    const o = createObject(brep, {
      name: null,
      xform: Float64Array.from(like.xform) as Mat4,
      color: [...like.color] as Rgb,
      attrs: { props: [] },
      selectTechnique: like.selectTechnique,
      drawTechnique: like.drawTechnique,
      screenBBoxTechnique: like.screenBBoxTechnique,
    });
    o.linked = like.linked ?? true;
    o.parent = parent;
    parent.children.splice(parent.children.indexOf(like) + 1, 0, o);
    for (const p of this.vm.props.of(like).reverse())
      if (!TRANSIENT_PROPS.has(this.vm.props.names[p] ?? '')) this.vm.props.add(o, p);
    this.vm.sharePrivateCode(like, o);
    if (primary) this.journal.touch(o);
    this.treeChanged();
    this.changed(o);
    return o;
  }

  /** How far the world has been zoomed in, all told (zoom.c's totalzoom). */
  totalZoom = 1;

  /** zoom_world: everything in `world` scales by `factor` about `center` (undoable). */
  zoomWorld(world: WorldFeature, center: V3, factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
    const m = mat4.scaleAbout(center, [factor, factor, factor]);
    for (const r of world.root.children) {
      for (const x of subtree(r)) if (world === this.primary) this.journal.touch(x);
      transformTree(r, m);
      for (const x of subtree(r)) this.changed(x);
    }
    if (world === this.primary) this.totalZoom *= factor;
  }

  /**
   * New here: everything in `world` scaled and moved (as one) to fit in the middle of
   * the room, `margin` of it across at most (the magnifier's double click; undoable).
   */
  fitWorld(world: WorldFeature, margin = 0.9): void {
    let lo: V3 = [Infinity, Infinity, Infinity];
    let hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const o of subtree(world.root)) {
      if (o === world.root || !this.vm.props.has(o, P.Visible)) continue;
      if (this.vm.props.has(o, P.Scalebbox)) continue;
      const b = this.bbox(o);
      if (!b) continue;
      lo = lo.map((v, k) => Math.min(v, b[0][k]!)) as V3;
      hi = hi.map((v, k) => Math.max(v, b[1][k]!)) as V3;
    }
    if (!Number.isFinite(lo[0])) return;
    const size = hi.map((v, k) => Math.max(v - lo[k]!, 1e-6));
    const room = [0, 1, 2].map((k) => ROOM.max[k]! - ROOM.min[k]!);
    const factor = margin * Math.min(...room.map((r, k) => r / size[k]!));
    const c = lo.map((v, k) => (v + hi[k]!) / 2) as V3;
    const to = [0, 1, 2].map((k) => (ROOM.max[k]! + ROOM.min[k]!) / 2);
    const m = mat4.multiply(
      mat4.scaleAbout(c, [factor, factor, factor]),
      mat4.translation(to[0]! - c[0], to[1]! - c[1], to[2]! - c[2]),
    );
    for (const r of world.root.children) {
      for (const x of subtree(r)) if (world === this.primary) this.journal.touch(x);
      transformTree(r, m);
      for (const x of subtree(r)) this.changed(x);
    }
    if (world === this.primary) this.totalZoom *= factor;
  }

  /** kill_obj, now: the object leaves its world (undoable). */
  killNow(o: CutObject): void {
    if (this.worldOf(o) === this.primary) this.journal.touch(o);
    this.vm.props.forget(o);
    this.killObject(o);
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

  private readonly labels = new WeakMap<CutObject, TextItem[]>();

  /** An object's label: its text items (text.c's textgroup), item 1 first. */
  labelItems(o: CutObject): TextItem[] {
    return this.labels.get(o) ?? [];
  }

  /** add_label_item (create_label for the first): black, plain, unit scale, pen 1. */
  addLabelItem(
    o: CutObject,
    text: string | null,
    offset: V3,
    init: Partial<TextItem> = {},
  ): TextItem {
    let l = this.labels.get(o);
    if (!l) this.labels.set(o, (l = []));
    const item: TextItem = {
      text,
      offset: [...offset],
      xscale: 1,
      yscale: 1,
      penWidth: 1,
      color: [0, 0, 0],
      style: 'Plain',
      insertion: -1,
      ...init,
    };
    l.push(item);
    this.vm.props.set(o, P.Haslabel, 1);
    this.version++;
    return item;
  }

  label(obj: Feature, n: number): string | null {
    return this.labels.get(obj as CutObject)?.[n - 1]?.text ?? null;
  }

  setLabel(obj: Feature, n: number, text: string | null): void {
    const item = this.labels.get(obj as CutObject)?.[n - 1];
    if (!item) return;
    item.text = text;
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
    if (this.offerParts) this.selectPartsUnder();
  }

  private setWorldSelectables(world: WorldFeature): void {
    const cargo = world === this.environment ? null : this.cargo();
    if (cargo) return this.setOverlapSelectables(world, cargo);
    if (world !== this.environment && this.solidMeshes.size > 0) this.dropSolidMeshes();
    const visible = this.vm.props.features(world, P.Visible);
    // Objects found by set_object_selectable compete in the world being edited: one best pick (M3).
    const candidates: { o: CutObject; s: Selectable; pick: KernelPick }[] = [];
    for (const f of visible) {
      if (!isObject(f) || this.vm.props.has(f, P.Nonselectable)) continue;
      if (this.outOfReach.has(f) || this.unseen.has(f) || this.moving.has(f)) {
        this.applySelectable(f, NOTHING);
        continue;
      }
      if (f.selectTechnique === 'set_object_selectable') {
        const c = this.objectCandidate(f);
        if (c) candidates.push({ o: f, ...c });
        else this.applySelectable(f, NOTHING);
      } else this.setFeatureSelectable(f, false);
    }
    // In the environment each object is selectable on its own, as select.c had it: a
    // goodie dragged over its toolbox leaves the box selectable too, so it can be dunked.
    let best: (typeof candidates)[number] | undefined;
    if (world !== this.environment)
      for (const c of candidates) if (!best || betterPick(c.pick, best.pick)) best = c;
    for (const c of candidates) this.applySelectable(c.o, !best || c === best ? c.s : NOTHING);
  }

  /** What a boolean tool carries now, if anything (still on the tool, out of the world). */
  private cargo(): CutObject | null {
    for (const c of this.carried) {
      const p = c.parent;
      if (
        p &&
        this.worldOf(c) === this.environment &&
        (this.hasProp(p, 'Drill') || this.hasProp(p, 'Union'))
      )
        return c;
      this.carried.delete(c);
    }
    return null;
  }

  /**
   * Every object in `world` that `cargo` overlaps is selectable, whole; nothing else
   * is. A drill's cutter leaves the object it was copied from alone.
   */
  private setOverlapSelectables(world: WorldFeature, cargo: CutObject): void {
    const at = this.cursor();
    for (const f of this.vm.props.features(world, P.Visible)) {
      if (!isObject(f)) continue;
      const hit =
        f !== this.copiedFrom.get(cargo) &&
        f.selectTechnique === 'set_object_selectable' &&
        !this.vm.props.has(f, P.Nonselectable) &&
        !this.vm.props.has(f, P.Lockedgeometry) &&
        !this.outOfReach.has(f) &&
        !this.unseen.has(f) &&
        this.overlapping(f, cargo);
      this.applySelectable(f, hit ? { feature: f, kind: SelectKind.Obj, at } : NOTHING);
    }
  }

  /** Whether `cargo` and `o` share some volume (remembered while neither moves). */
  private overlapping(o: CutObject, cargo: CutObject): boolean {
    if (o.brep.numFaces === 0 || cargo.brep.numFaces === 0 || !booleansReady()) return false;
    const c = this.overlaps.get(o);
    if (
      c &&
      c.brep === o.brep &&
      c.xform === o.xform &&
      c.cargo === cargo &&
      c.cBrep === cargo.brep &&
      c.cXform === cargo.xform
    )
      return c.hit;
    const a = this.bbox(o);
    const b = this.bbox(cargo);
    const hit =
      !!a &&
      !!b &&
      [0, 1, 2].every((i) => a[0][i]! < b[1][i]! && b[0][i]! < a[1][i]!) &&
      this.meshesOverlap(o, cargo);
    this.overlaps.set(o, {
      brep: o.brep,
      xform: o.xform,
      cargo,
      cBrep: cargo.brep,
      cXform: cargo.xform,
      hit,
    });
    return hit;
  }

  /**
   * The overlap test proper. Each solid is made ready for it once in a carry (what
   * is carried only moves; nothing is reshaped while the tool is held).
   */
  private meshesOverlap(o: CutObject, cargo: CutObject): boolean {
    const mesh = (b: Brep) => {
      if (!this.solidMeshes.has(b)) this.solidMeshes.set(b, solidMesh(b));
      return this.solidMeshes.get(b)!;
    };
    const a = mesh(o.brep);
    const b = mesh(cargo.brep);
    return !!a && !!b && solidsOverlap(a, o.xform, b, cargo.xform);
  }

  /** Lets go of the overlap tests' meshes, once nothing is carried. */
  private dropSolidMeshes(): void {
    for (const m of this.solidMeshes.values()) m?.dispose();
    this.solidMeshes.clear();
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
    // In a group: it has parts, or moves with something (a picked object's scale box,
    // which holds it as an unlinked child, isn't a group: its faces stay pickable).
    const root = groupRoot(o);
    const grouped = root !== o && !(root === o.parent && this.vm.props.has(root, P.Scalebbox));
    const wholeGroup =
      this.groupPick === 'whole' &&
      (o.children.length > 0 || grouped || this.dangling) &&
      this.worldOf(o) === this.primary;
    if (wholeGroup) this.wholePicks.set(o, pick);
    else this.wholePicks.delete(o);
    if (pick.kind === 'object' || wholeGroup || this.vm.props.has(o, P.Lockedgeometry))
      return { s: { feature: o, kind: SelectKind.Obj, at: pick.at }, pick };
    return { s: this.partSelectable(o, pick), pick };
  }

  /** The vertex, edge or face of `o` a pick found. */
  private partSelectable(o: CutObject, pick: KernelPick): Selectable {
    if (pick.kind === 'vertex')
      return { feature: this.features.vertex(o, pick.id), kind: SelectKind.Vert, at: pick.at };
    if (pick.kind === 'edge')
      return { feature: this.features.edge(o, pick.id), kind: SelectKind.Edge, at: pick.at };
    const kind = pick.kind === 'inPlaneFace' ? SelectKind.Inplaneface : SelectKind.Face;
    return { feature: this.features.face(o, pick.id), kind, at: pick.at };
  }

  /**
   * New here (R): a part of a group picked whole (Settings' group picking) under the
   * crosshair is made selectable itself, its face, edge or vertex, as one not in a
   * group would be: the rotate tool comes to it, and turns the whole group.
   */
  private selectPartsUnder(): void {
    for (const f of this.selected()) {
      if (!isObject(f) || this.worldOf(f) !== this.primary) continue;
      const pick = this.wholePicks.get(f);
      if (pick && pick.kind !== 'object' && !this.vm.props.has(f, P.Lockedgeometry))
        this.applySelectable(f, this.partSelectable(f, pick));
    }
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

  /**
   * Unpicks an object and its features now, and takes away the scale box around it
   * (rom.cpl's Msg:Unpick and _Destroy_scaler, without waiting for the message).
   */
  unpickNow(o: CutObject): void {
    for (const f of this.picked())
      if (f === o || (f as { object?: CutObject }).object === o) this.unpick(f);
    for (let p = o.parent; p; p = p.parent)
      if (this.vm.props.has(p, P.Scalebbox)) {
        this.dissolve(p);
        this.treeChanged();
        break;
      }
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

  /** New here: the objects whose features a drag is moving now (the guides leave them out). */
  dragging(): CutObject[] {
    return [...this.drags.keys()];
  }

  /** New here: the box around the vertices a drag of features has moved so far (world). */
  draggedBox(): [V3, V3] | null {
    let lo: V3 = [Infinity, Infinity, Infinity];
    let hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const [o, plan] of this.drags) {
      const g = this.world(o);
      for (const v of plan.moved.keys()) {
        const p: V3 = [g.x(v), g.y(v), g.z(v)];
        lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1]), Math.min(lo[2], p[2])];
        hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1]), Math.max(hi[2], p[2])];
      }
    }
    return Number.isFinite(lo[0]) ? [lo, hi] : null;
  }

  /** Ends a drag of `o`'s features: merges faces split for it, or undoes it if the solid broke. */
  private finishDrag(o: CutObject): void {
    const plan = this.drags.get(o);
    if (!plan) return;
    this.drags.delete(o);
    if (plan.extruded) {
      // Pulled back to where it started, or further in: the walls would be flat or
      // inside out, so the extrusion is taken back.
      const [d] = plan.moved.values();
      const n = plan.extruded.normal;
      if (!d || n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < EXTRUDE_MIN) {
        const snap = this.journal.before(o);
        if (snap) this.restore(snap);
        this.dropDeadFeatures(o);
        this.changed(o);
        return;
      }
    }
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
    this.rotatedNow.clear();
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
  /** Called at the end of every frame (things that follow the world, like the measure pad). */
  readonly frameHooks: (() => void)[] = [];

  endFrame(): void {
    for (const hook of this.frameHooks) hook();
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
        // Undo puts a killed object back with its properties.
        if (isObject(f) && this.worldOf(f) === this.primary) this.journal.touch(f);
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

  /** kill_obj_branch for things being built (no undo): the branch leaves the world. */
  discard(o: CutObject): void {
    const p = o.parent;
    if (p) p.children.splice(p.children.indexOf(o), 1);
    o.parent = null;
    for (const x of subtree(o)) {
      this.vm.props.forget(x);
      for (const h of this.features.known(x)) this.vm.props.forget(h);
      this.selectables.delete(x);
    }
    this.treeChanged();
  }

  /** A scale box leaves the tree unrecorded; its children go to its parent, linked. */
  private dissolve(box: CutObject): void {
    const p = box.parent;
    if (!p) return;
    p.children.splice(p.children.indexOf(box), 1, ...box.children);
    for (const c of box.children) {
      c.parent = p;
      c.linked = true;
    }
    box.children = [];
    box.parent = null;
    this.vm.props.forget(box);
    for (const h of this.features.known(box)) this.vm.props.forget(h);
    this.selectables.delete(box);
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
    this.unselect(o);
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

  private readonly toolCrtns: Partial<Record<string, (rt: Runtime, vm: VM) => void>> = {};

  /** Adds C routines (an environment tool's). */
  registerCrtns(table: Partial<Record<string, (rt: Runtime, vm: VM) => void>>): void {
    Object.assign(this.toolCrtns, table);
  }

  private crtn(name: string, vm: VM): void {
    const own = this.crtnTable[name];
    if (own) own(vm);
    else (this.toolCrtns[name] ?? BUILTIN_CRTNS[name])?.(this, vm);
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
    for (const h of this.features.known(o)) this.vm.props.forget(h);
    // The object's and its features' lasting properties, as the snapshot had them.
    const lasting = (names: readonly string[]) => names.filter((n) => !TRANSIENT_PROPS.has(n));
    o.attrs.props = lasting(s.props);
    for (const map of [o.brep.vertexAttrs, o.brep.edgeAttrs, o.brep.faceAttrs])
      for (const a of map.values()) a.props = lasting(a.props);
    this.register(o);
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
    // Scale boxes were never recorded: they go first (what they held stays where it is).
    for (const box of scaleBoxes(this, this.primary.root)) this.dissolve(box);
    const was = new Set(subtree(this.primary.root));
    if (s.tree) restoreTree(this.primary.root, s.tree[side]);
    for (const snap of s[side]) this.restore(snap);
    // Objects the step leaves out of the world take their properties with them.
    const inTree = new Set(subtree(this.primary.root));
    const gone = new Set([...was, ...s[side].map((x) => x.object)]);
    for (const o of gone) {
      if (inTree.has(o)) continue;
      if (o.parent && !o.parent.children.includes(o)) o.parent = null;
      this.vm.props.forget(o);
      for (const h of this.features.known(o)) this.vm.props.forget(h);
      this.selectables.delete(o);
    }
    // Nothing stays picked across an undo, and selectables are found afresh.
    for (const p of [P.Picked, P.Selectable])
      for (const f of this.vm.props.features(this.primary, p)) this.vm.props.del(f, p);
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

/** New here: how far (world units) the magnet reaches to a stop in the plane. */
export const MAGNET_REACH = 20;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** The turn taking direction `a` to direction `b` (snap_vector_to_vector). */
function between(a: V3, b: V3): { axis: V3; angle: number } {
  const la = Math.hypot(...a);
  const lb = Math.hypot(...b);
  if (la < 1e-12 || lb < 1e-12) return { axis: [0, 0, 0], angle: 0 };
  const u: V3 = [a[0] / la, a[1] / la, a[2] / la];
  const v: V3 = [b[0] / lb, b[1] / lb, b[2] / lb];
  const axis: V3 = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const c = Math.max(-1, Math.min(1, dot(u, v)));
  if (Math.hypot(...axis) < 1e-9) {
    if (c > 0) return { axis: [0, 0, 0], angle: 0 };
    // Opposite: any axis square to them.
    const p: V3 = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return {
      axis: [u[1] * p[2] - u[2] * p[1], u[2] * p[0] - u[0] * p[2], u[0] * p[1] - u[1] * p[0]],
      angle: Math.PI,
    };
  }
  return { axis, angle: Math.acos(c) };
}
