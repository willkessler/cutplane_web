/** How far a long read has got, 0 to 1. */
export type Progress = (fraction: number) => void;

/** A part of a progress, from `a` to `b` of it. */
export const part = (p: Progress | undefined, a: number, b: number): Progress | undefined =>
  p && ((f) => p(a + (b - a) * Math.min(1, Math.max(0, f))));

/** How the mesh readers go about a file. */
export interface MeshOptions {
  /** Told how far the read has got. */
  progress?: Progress | undefined;
  /**
   * The most polygons a file may come in as: a file with more has its meshes
   * simplified, each in proportion, to fit (see simplify.ts).
   */
  budget?: number | undefined;
  /** Told, when the budget simplified the file, how many polygons it had and has now. */
  simplified?: ((from: number, to: number) => void) | undefined;
}
