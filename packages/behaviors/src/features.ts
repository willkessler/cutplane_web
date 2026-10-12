import { T, type Feature } from '@cutplane/cpl';
import type { CutObject } from '@cutplane/kernel';

/**
 * Features below the object (vertices, edges, faces and shells) as CPL sees
 * them: each gets one handle object per (object, kind, id), kept for as long
 * as the object lives, so CPL can compare features by identity as the C
 * compared pointers. Brep element ids are stable (never reused), and undo
 * restores Breps with the same ids, so a handle keeps naming the same element.
 */
export interface Sub extends Feature {
  readonly type: typeof T.Vfe | typeof T.Evf | typeof T.Fve | typeof T.Shell;
  readonly object: CutObject;
  readonly id: number;
}

export type AnyFeature = CutObject | Sub | WorldFeature;

/** A world, as a feature (worlds can be iterated and passed around by CPL). */
export interface WorldFeature extends Feature {
  readonly type: typeof T.World;
  readonly name: string;
  /** The root object; the world's top-level objects are its children. */
  readonly root: CutObject;
}

export const isObject = (f: Feature | null | undefined): f is CutObject => f?.type === T.Obj;
export const isWorld = (f: Feature | null | undefined): f is WorldFeature => f?.type === T.World;
export const isSub = (f: Feature | null | undefined): f is Sub =>
  f?.type === T.Vfe || f?.type === T.Evf || f?.type === T.Fve || f?.type === T.Shell;

export class FeatureIndex {
  private readonly handles = new WeakMap<CutObject, Map<number, Sub>>();

  /** The handle of element `id` of kind `type` in `object`. */
  of(object: CutObject, type: Sub['type'], id: number): Sub {
    let m = this.handles.get(object);
    if (!m) this.handles.set(object, (m = new Map()));
    const key = id * 16 + type;
    let h = m.get(key);
    if (!h) m.set(key, (h = { type, object, id }));
    return h;
  }

  vertex(object: CutObject, id: number): Sub {
    return this.of(object, T.Vfe, id);
  }
  edge(object: CutObject, id: number): Sub {
    return this.of(object, T.Evf, id);
  }
  face(object: CutObject, id: number): Sub {
    return this.of(object, T.Fve, id);
  }
  shell(object: CutObject, id: number): Sub {
    return this.of(object, T.Shell, id);
  }

  /** Handles already made for an object (to forget their properties when it changes). */
  known(object: CutObject): Sub[] {
    return [...(this.handles.get(object)?.values() ?? [])];
  }

  /** Whether a sub-feature's element still exists. */
  alive(s: Sub): boolean {
    const b = s.object.brep;
    switch (s.type) {
      case T.Vfe:
        return b.isVertex(s.id);
      case T.Evf:
        return b.isEdge(s.id);
      case T.Fve:
        return b.isFace(s.id);
      default:
        return b.isShell(s.id);
    }
  }
}
