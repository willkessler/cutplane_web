import type { Pixels } from './gltf.ts';

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
  /** Images dropped with the file, by name: the textures it names (an Inventor Texture2's). */
  images?: ((name: string) => Pixels | undefined) | undefined;
  /** Told the name of a texture the file names that didn't come with it. */
  missingImage?: ((name: string) => void) | undefined;
  /** Told when a terrain, made with Z up, was laid flat. */
  laidFlat?: (() => void) | undefined;
  /** Told, of a drawing (lines, no faces), how many regions its lines closed and how many lines closed none. */
  plan?: ((regions: number, loose: number) => void) | undefined;
}
