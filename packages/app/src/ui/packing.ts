import { Brep, createObject, type BrepData, type CutObject } from '@cutplane/kernel';
import type { Imported } from './files.ts';

// What crosses between the page and the worker that reads model files (importer.ts).

/** An object as plain data, to cross between threads. */
export interface PackedObject {
  name: string | null;
  xform: Float64Array;
  color: CutObject['color'];
  attrs: CutObject['attrs'];
  linked: boolean | undefined;
  brep: BrepData;
  children: PackedObject[];
}

export function pack(roots: readonly CutObject[]): {
  packed: PackedObject[];
  transfer: ArrayBuffer[];
} {
  const transfer: ArrayBuffer[] = [];
  const one = (o: CutObject): PackedObject => {
    const brep = o.brep.data();
    transfer.push(...Brep.transfer(brep));
    return {
      name: o.name,
      xform: o.xform,
      color: o.color,
      attrs: o.attrs,
      linked: o.linked,
      brep,
      children: o.children.map(one),
    };
  };
  return { packed: roots.map(one), transfer };
}

export function unpack(packed: readonly PackedObject[]): CutObject[] {
  const one = (p: PackedObject, parent: CutObject | null): CutObject => {
    const o = createObject(Brep.fromData(p.brep), {
      name: p.name,
      xform: p.xform,
      color: p.color,
      attrs: p.attrs,
      parent,
      ...(p.linked === undefined ? {} : { linked: p.linked }),
    });
    o.children = p.children.map((k) => one(k, o));
    return o;
  };
  return packed.map((p) => one(p, null));
}

/** What the worker is sent, and what it sends back. */
export interface ImportRequest {
  files: File[];
  budget: number;
}
export type ImportReply =
  | { kind: 'progress'; fraction: number }
  | { kind: 'done'; imported: Omit<Imported, 'objects'> & { objects: PackedObject[] } }
  | { kind: 'error'; message: string };
