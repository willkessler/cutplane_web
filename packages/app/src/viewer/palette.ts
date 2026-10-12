/**
 * Classic 3Form colours: the environment from the original's
 * rsc/cpcolors.rsc, the rest from globals.c. Values are the original 8-bit
 * framebuffer values; the renderer writes them out unconverted.
 */
export const CLASSIC = {
  background: [253, 153, 102],
  cutplane: [155, 180, 200],
  crosshair: [0, 255, 255],
  shadow: [118, 75, 45],
  roomEdges: [0, 0, 0],
  black: [0, 0, 0],
  white: [255, 255, 255],
  /** Section lines across faces. */
  mediumYellow: [210, 210, 0],
  /** Edges lying in the plane. */
  yellow: [255, 255, 0],
  /** The section seen through whatever is in front of it. */
  darkYellow: [100, 100, 0],
  orange: [255, 110, 10],
} as const;

export type Rgb8 = readonly [number, number, number];

export const rgb = ([r, g, b]: readonly number[]) => ((r! << 16) | (g! << 8) | b!) >>> 0;

/**
 * Flat face shading from shade.c's compute_reflected_color: ambient 80 plus
 * two directional lights fixed to the room, <1,1,1> at 125 and <-1,1,1> at
 * 50. Faces pointing down get ambient only. Returns 0..1 per channel.
 */
export function shadeFace(n: readonly number[], color: Rgb8): [number, number, number] {
  const [nx, ny, nz] = n as [number, number, number];
  let light = 80;
  if (ny >= 0) {
    const k = 1 / Math.sqrt(3);
    const d1 = Math.min(1, Math.max(0, (nx + ny + nz) * k));
    const d2 = Math.min(1, Math.max(0, (-nx + ny + nz) * k));
    light += 125 * d1 + 50 * d2;
  }
  const f = light / 255;
  return [
    Math.min(1, (color[0] * f) / 255),
    Math.min(1, (color[1] * f) / 255),
    Math.min(1, (color[2] * f) / 255),
  ];
}
