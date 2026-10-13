import { preorder, type CutObject } from '@cutplane/kernel';

/** The objects a mesh format writes: every one in the tree with faces (a group's grouper has none). */
export function exportable(roots: readonly CutObject[]): CutObject[] {
  return [...preorder(roots)].filter(
    (o) => o.brep.numFaces > 0 && !o.attrs.props.includes('Grouper'),
  );
}

/** Names that mean none: 1991 files wrote "(none)", ours write "<none>". */
const UNNAMED = new Set(['', '(none)', '<none>']);

/** A name a mesh format can carry: the object's, else what it is and its place in the list. */
export const nameOf = (o: CutObject, i: number): string => {
  const n = o.name?.trim() ?? '';
  if (!UNNAMED.has(n)) return n;
  return `${o.attrs.props.includes('Grouper') ? 'group' : 'object'}_${i + 1}`;
};
