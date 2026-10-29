import { readCut, writeCut } from '@cutplane/formats';
import { createObject, preorder, type CutObject } from '@cutplane/kernel';
import type { Journal, ObjectSnapshot, Step, TreeSnapshot } from './journal.ts';

/**
 * The undo history as data that outlasts the session (autosave keeps it with
 * the world). Objects are numbered: 0 is the world's root, then the world's
 * objects in the order its .cut file lists them, then any the history still
 * holds that are gone from the world (deleted, say), kept as "ghosts". Each
 * snapshot is its object as a one-object .cut text.
 */
export interface SavedHistory {
  version: 1;
  /** Objects gone from the world that steps bring back: their number and their .cut text. */
  ghosts: { id: number; cut: string }[];
  undo: SavedStep[];
  redo: SavedStep[];
}

interface SavedStep {
  before: { id: number; cut: string }[];
  after: { id: number; cut: string }[];
  tree?: { before: SavedTree; after: SavedTree };
}

/** Each entry: object, parent, linked (1, 0, or null when unset). */
type SavedTree = [number, number, 0 | 1 | null][];

// Snapshots never change once taken, so each is written once.
const written = new WeakMap<ObjectSnapshot, string>();

function cutOf(
  o: Pick<CutObject, 'brep' | 'xform' | 'invXform' | 'color' | 'opacity' | 'decals' | 'name'> & {
    props: readonly string[];
  },
  extra?: Partial<CutObject>,
): string {
  const one = createObject(o.brep, {
    ...extra,
    name: o.name,
    xform: o.xform,
    invXform: o.invXform,
    color: o.color,
    ...(o.opacity === undefined ? {} : { opacity: o.opacity }),
    ...(o.decals?.length ? { decals: o.decals } : {}),
    attrs: { ...(extra?.attrs ?? {}), props: [...o.props] },
    children: [],
    parent: null,
  });
  return writeCut({ title: 'snapshot', contains: 'World', name: null, roots: [one] });
}

const snapText = (s: ObjectSnapshot) => {
  let t = written.get(s);
  if (t === undefined) written.set(s, (t = cutOf(s)));
  return t;
};

const readOne = (cut: string): CutObject => {
  const o = readCut(cut).doc.roots[0];
  if (!o) throw new Error('history: an empty snapshot');
  return o;
};

/**
 * How much .cut text a saved history holds at most (characters): the newest
 * steps that fit. A big model's every move is the whole model twice over, and
 * a deleted one stays in the steps that bring it back: the history kept with an
 * autosave mustn't grow with each of them.
 */
export const HISTORY_BUDGET = 16_000_000;

/**
 * The journal's steps, numbered against `objects` (the world's, in its .cut
 * order) under `root`. At most `limit` undo steps are kept, the newest, and
 * only as many (undo first, then redo, nearest first) as fit in `budget`.
 */
export function saveHistory(
  journal: Journal,
  root: CutObject,
  objects: readonly CutObject[],
  limit = 200,
  budget = HISTORY_BUDGET,
): SavedHistory {
  const ids = new Map<CutObject, number>([[root, 0]]);
  for (const o of objects) ids.set(o, ids.size);
  const ghosts: SavedHistory['ghosts'] = [];
  const id = (o: CutObject): number => {
    let n = ids.get(o);
    if (n === undefined) {
      n = ids.size;
      ids.set(o, n);
      ghosts.push({ id: n, cut: ghostText(o) });
    }
    return n;
  };
  const tree = (t: TreeSnapshot): SavedTree =>
    t.entries.map((e) => [
      id(e.object),
      id(e.parent),
      e.linked === undefined ? null : e.linked ? 1 : 0,
    ]);
  const step = (s: Step): SavedStep => ({
    before: s.before.map((b) => ({ id: id(b.object), cut: snapText(b) })),
    after: s.after.map((a) => ({ id: id(a.object), cut: snapText(a) })),
    ...(s.tree ? { tree: { before: tree(s.tree.before), after: tree(s.tree.after) } } : {}),
  });
  // What a step costs: its snapshots, and the objects it holds that are gone from the world.
  let left = budget;
  const fits = (s: Step): boolean => {
    let n = 0;
    for (const b of [...s.before, ...s.after]) {
      n += snapText(b).length;
      if (!ids.has(b.object) && !counted.has(b.object)) {
        counted.add(b.object);
        n += ghostText(b.object).length;
      }
    }
    if (n > left) return false;
    left -= n;
    return true;
  };
  const counted = new Set<CutObject>();
  /** The newest steps of a stack (its last, the next to undo or redo) that fit. */
  const newest = (stack: readonly Step[]): Step[] => {
    let i = stack.length;
    while (i > 0 && fits(stack[i - 1]!)) i--;
    return stack.slice(i);
  };
  const { undo, redo } = journal.stacks();
  const keptUndo = newest(undo.slice(-limit));
  const keptRedo = newest(redo);
  return { version: 1, ghosts, undo: keptUndo.map(step), redo: keptRedo.map(step) };
}

// A ghost's text, written again only when it has changed.
const ghosts = new WeakMap<CutObject, { key: string; text: string }>();
function ghostText(o: CutObject): string {
  const key = `${o.brep.fingerprint()}|${o.xform.join()}|${o.color.join()}|${o.opacity}|${JSON.stringify(o.decals)}|${o.name}|${JSON.stringify(o.attrs)}`;
  const had = ghosts.get(o);
  if (had?.key === key) return had.text;
  const text = cutOf({ ...o, props: o.attrs.props }, { attrs: o.attrs });
  ghosts.set(o, { key, text });
  return text;
}

/**
 * Gives the journal back the steps `saveHistory` kept, against the same world
 * read back from its .cut text (`objects` in the file's order). False, and the
 * journal left empty, if they don't fit this world (or are far bigger than
 * `saveHistory` keeps).
 */
export function loadHistory(
  journal: Journal,
  saved: SavedHistory,
  root: CutObject,
  objects: readonly CutObject[],
): boolean {
  if (saved?.version !== 1) return false;
  // One kept before there was a budget can be hundreds of megabytes: reading it all back
  // would hang the page, so it's let go.
  const size = (xs: readonly { cut: string }[]) => xs.reduce((n, x) => n + x.cut.length, 0);
  let total = size(saved.ghosts);
  for (const s of [...saved.undo, ...saved.redo]) total += size(s.before) + size(s.after);
  if (total > HISTORY_BUDGET * 2) return false;
  try {
    const byId = new Map<number, CutObject>([[0, root]]);
    objects.forEach((o, i) => byId.set(i + 1, o));
    for (const g of saved.ghosts) byId.set(g.id, readOne(g.cut));
    const obj = (n: number) => {
      const o = byId.get(n);
      if (!o) throw new Error(`history: no object ${n}`);
      return o;
    };
    const snap = ({ id, cut }: { id: number; cut: string }): ObjectSnapshot => {
      const r = readOne(cut);
      return { object: obj(id), brep: r.brep, xform: r.xform, invXform: r.invXform, color: r.color, ...(r.opacity === undefined ? {} : { opacity: r.opacity }), ...(r.decals ? { decals: r.decals } : {}), props: r.attrs.props, name: r.name }; // prettier-ignore
    };
    const tree = (t: SavedTree): TreeSnapshot => ({
      entries: t.map(([o, p, l]) => ({
        object: obj(o),
        parent: obj(p),
        linked: l === null ? undefined : l === 1,
      })),
    });
    const step = (s: SavedStep): Step => ({
      before: s.before.map(snap),
      after: s.after.map(snap),
      ...(s.tree ? { tree: { before: tree(s.tree.before), after: tree(s.tree.after) } } : {}),
    });
    journal.setStacks(saved.undo.map(step), saved.redo.map(step));
    return true;
  } catch {
    journal.clear();
    return false;
  }
}

/** The world's objects in the order its .cut file lists them (what the numbers count). */
export const historyOrder = (roots: readonly CutObject[]): CutObject[] => [...preorder(roots)];
