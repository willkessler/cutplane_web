import {
  copyDecal,
  type Brep,
  type CutObject,
  type Mat4,
  type Rgb,
  type TextDecal,
} from '@cutplane/kernel';

/**
 * Undo (new: the original had none). Everything a step changes in the world
 * being edited is snapshotted the first time it is touched; a step closes at
 * the end of a gesture. The object tree is snapshotted whole the first time
 * the step changes it.
 */
export interface ObjectSnapshot {
  object: CutObject;
  brep: Brep;
  xform: Mat4;
  invXform: Mat4;
  color: Rgb;
  opacity?: number;
  decals?: TextDecal[];
  props: string[];
  name: string | null;
}

export interface TreeSnapshot {
  /** Each object's parent and link, in the order they sit among their siblings. */
  entries: { object: CutObject; parent: CutObject; linked: boolean | undefined }[];
}

export interface Step {
  before: ObjectSnapshot[];
  after: ObjectSnapshot[];
  tree?: { before: TreeSnapshot; after: TreeSnapshot };
}

export function snapshotObject(o: CutObject): ObjectSnapshot {
  return {
    object: o,
    brep: o.brep.clone(),
    xform: o.xform.slice(),
    invXform: o.invXform.slice(),
    color: [...o.color],
    ...(o.opacity === undefined ? {} : { opacity: o.opacity }),
    ...(o.decals?.length ? { decals: o.decals.map(copyDecal) } : {}),
    props: [...o.attrs.props],
    name: o.name,
  };
}

/**
 * The tree under `root`. Objects `skip` names (scale boxes) are left out as
 * though their children sat where they do: linked, under their parent.
 */
export function snapshotTree(
  root: CutObject,
  skip: (o: CutObject) => boolean = () => false,
): TreeSnapshot {
  const entries: TreeSnapshot['entries'] = [];
  const walk = (p: CutObject, as: CutObject, through: boolean) => {
    for (const c of p.children) {
      if (skip(c)) {
        walk(c, as, true);
        continue;
      }
      entries.push({ object: c, parent: as, linked: through ? true : c.linked });
      walk(c, c, false);
    }
  };
  walk(root, root, false);
  return { entries };
}

/** Puts a tree back: every object under `root` goes back to its old parent, in order. */
export function restoreTree(root: CutObject, t: TreeSnapshot): void {
  const clear = (p: CutObject) => {
    for (const c of p.children) clear(c);
    p.children = [];
  };
  clear(root);
  for (const e of t.entries) {
    e.object.parent = e.parent;
    if (e.linked === undefined) delete e.object.linked;
    else e.object.linked = e.linked;
    e.parent.children.push(e.object);
  }
}

const sameSnap = (a: ObjectSnapshot, b: ObjectSnapshot) =>
  a.xform.every((v, i) => v === b.xform[i]) &&
  a.color.every((v, i) => v === b.color[i]) &&
  a.opacity === b.opacity &&
  JSON.stringify(a.decals) === JSON.stringify(b.decals) &&
  a.name === b.name &&
  sameBrep(a.brep, b.brep);

function sameBrep(a: Brep, b: Brep): boolean {
  if (a.numVertices !== b.numVertices || a.numFaces !== b.numFaces || a.numEdges !== b.numEdges)
    return false;
  const va = a.vertices();
  const vb = b.vertices();
  if (va.some((v, i) => v !== vb[i])) return false;
  for (const v of va)
    if (a.vx(v) !== b.vx(v) || a.vy(v) !== b.vy(v) || a.vz(v) !== b.vz(v)) return false;
  if (a.faceColors.size !== b.faceColors.size) return false;
  for (const [f, c] of a.faceColors)
    if (!b.faceColors.get(f)?.every((x, i) => x === c[i])) return false;
  return true;
}

/**
 * The same parents and links. Sibling order is left out: scale boxes coming and
 * going reorder siblings, and that alone is no edit.
 */
function sameTree(a: TreeSnapshot, b: TreeSnapshot): boolean {
  if (a.entries.length !== b.entries.length) return false;
  const at = new Map(a.entries.map((e) => [e.object, e]));
  return b.entries.every((f) => {
    const e = at.get(f.object);
    return e !== undefined && e.parent === f.parent && e.linked === f.linked;
  });
}

interface OpenStep {
  before: Map<CutObject, ObjectSnapshot>;
  tree?: TreeSnapshot;
}

export class Journal {
  private readonly undoStack: Step[] = [];
  private readonly redoStack: Step[] = [];
  private open: OpenStep | null = null;
  /** Counts edits made, undone and redone: it changes whenever the world does (autosave watches it). */
  edits = 0;
  /**
   * New, for an agent's call that takes several frames (a move glided): while held, the
   * frames' commits leave the step open, so the call is undone as one.
   */
  hold = false;

  constructor(
    private readonly root: () => CutObject,
    /** Objects that are never recorded (scale boxes: made and dissolved by picking). */
    private readonly ignore: (o: CutObject) => boolean = () => false,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get recording(): boolean {
    return this.open !== null;
  }

  private step(): OpenStep {
    return (this.open ??= { before: new Map() });
  }

  /** About to change `o` (its geometry, placement, colour or name). */
  touch(o: CutObject): void {
    if (this.ignore(o)) return;
    const s = this.step();
    if (!s.before.has(o)) s.before.set(o, snapshotObject(o));
  }

  /** About to change the tree (adopt, delete, a new object). */
  touchTree(): void {
    const s = this.step();
    s.tree ??= snapshotTree(this.root(), this.ignore);
  }

  /** Closes the step; returns it if anything actually changed. */
  commit(): Step | undefined {
    if (this.hold) return undefined;
    const s = this.open;
    this.open = null;
    if (!s) return undefined;
    const before = [...s.before.values()];
    const after = before.map((b) => snapshotObject(b.object));
    const changed = before.filter((b, i) => !sameSnap(b, after[i]!));
    const treeAfter = s.tree ? snapshotTree(this.root(), this.ignore) : undefined;
    const treeChanged = s.tree !== undefined && !sameTree(s.tree, treeAfter!);
    if (changed.length === 0 && !treeChanged) return undefined;
    const keep = new Set(changed.map((c) => c.object));
    const step: Step = {
      before: before.filter((b) => keep.has(b.object) || treeChanged),
      after: after.filter((a) => keep.has(a.object) || treeChanged),
      ...(treeChanged ? { tree: { before: s.tree!, after: treeAfter! } } : {}),
    };
    this.undoStack.push(step);
    this.redoStack.length = 0;
    this.edits++;
    return step;
  }

  /** Abandons the open step, putting everything it touched back. */
  rollback(apply: (s: ObjectSnapshot) => void): void {
    const s = this.open;
    this.open = null;
    if (!s) return;
    if (s.tree) restoreTree(this.root(), s.tree);
    for (const b of s.before.values()) apply(b);
  }

  /** The snapshot an open step holds for `o`, if it touched it. */
  before(o: CutObject): ObjectSnapshot | undefined {
    return this.open?.before.get(o);
  }

  undo(): Step | undefined {
    const s = this.undoStack.pop();
    if (s) this.redoStack.push(s);
    if (s) this.edits++;
    return s;
  }

  redo(): Step | undefined {
    const s = this.redoStack.pop();
    if (s) this.undoStack.push(s);
    if (s) this.edits++;
    return s;
  }

  /** The steps that undo and redo would take, oldest first (autosave keeps them). */
  stacks(): { undo: readonly Step[]; redo: readonly Step[] } {
    return { undo: this.undoStack, redo: this.redoStack };
  }

  /** Puts back steps a previous session kept: undo and redo carry on from there. */
  setStacks(undo: readonly Step[], redo: readonly Step[]): void {
    this.undoStack.splice(0, Infinity, ...undo);
    this.redoStack.splice(0, Infinity, ...redo);
    this.open = null;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.open = null;
  }
}
