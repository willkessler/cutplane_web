export { ROOM, clampToRoom, isInRoom } from './room.ts';
export type { Vec3 } from './room.ts';

export { GRID, snap, isSnapped } from './math/snap.ts';
export * as mat4 from './math/mat4.ts';
export type { Mat4 } from './math/mat4.ts';

export { Brep, NONE } from './topology/brep.ts';
export type { BrepData, FeatureAttrs, Rgb } from './topology/brep.ts';
export * from './topology/euler.ts';
export { buildShell, canonicalEdges } from './topology/build.ts';
export { PairMap } from './topology/pairmap.ts';
export type { BuiltShell, PolygonShell } from './topology/build.ts';
export { validate, assertValid } from './topology/validate.ts';
export type {
  Issue,
  Severity,
  ShellStats,
  ValidationReport,
  ValidateOptions,
} from './topology/validate.ts';

export * from './ops/sweep.ts';
export { drawAcrossFace, splitEdge, type Spot } from './ops/split.ts';
export * from './primitives.ts';

export {
  createObject,
  adopt,
  preorder,
  subtree,
  transformTree,
  duplicateTree,
  groupRoot,
  DEFAULT_TECHNIQUES,
  OBJ_TYPE,
} from './model/object.ts';
export type { CutObject, PrimitiveInfo } from './model/object.ts';

export { computeSection, loopArea, WorldGeometry, ON_PLANE } from './section/section.ts';
export type { ObjectSection, SectionLoop, SectionSegment } from './section/section.ts';
export { PlaneSnapper, DEPTH_MERGE, MIN_SNAP_MOVE } from './section/planesnap.ts';

export {
  flattenFace,
  planarizeFace,
  planarizeForMotion,
  recombineSurfaces,
} from './ops/planarize.ts';
export { deleteVertex, deleteEdge, deleteFace, volume } from './ops/delete.ts';
export { pickAt, betterPick, PICK_SIZE, ON_PLANE_PICK, PICK_PRIORITY } from './select/pick.ts';
export type { Pick, PickKind } from './select/pick.ts';
