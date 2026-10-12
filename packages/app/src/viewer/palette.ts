/** Classic 3Form colours, from the original's rsc/cpcolors.rsc. */
export const CLASSIC = {
  background: [253, 153, 102],
  cutplane: [155, 180, 200],
  shadow: [118, 75, 45],
  roomEdges: [0, 0, 0],
} as const;

export const rgb = ([r, g, b]: readonly number[]) => ((r! << 16) | (g! << 8) | b!) >>> 0;
