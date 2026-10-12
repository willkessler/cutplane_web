export type Vec3 = readonly [number, number, number];

/**
 * The original 3Form room, in room units. Kept unchanged so .cut/.rsc files,
 * tolerances and CPL constants work as written. The cutplane is always
 * z = planeZ in this space; room rotation only moves the camera.
 */
export const ROOM = {
  min: [-511, -382, -499] as Vec3,
  max: [510, 383, 500] as Vec3,
} as const;

export function isInRoom(p: Vec3): boolean {
  return ([0, 1, 2] as const).every((i) => p[i] >= ROOM.min[i] && p[i] <= ROOM.max[i]);
}

export function clampToRoom(p: Vec3): Vec3 {
  const c = (i: 0 | 1 | 2) => Math.min(ROOM.max[i], Math.max(ROOM.min[i], p[i]));
  return [c(0), c(1), c(2)];
}
