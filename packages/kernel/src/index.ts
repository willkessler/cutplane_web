export { ROOM, clampToRoom, isInRoom } from './room.ts';
export type { Vec3 } from './room.ts';

export { GRID, snap, isSnapped } from './math/snap.ts';
export * as mat4 from './math/mat4.ts';
export type { Mat4 } from './math/mat4.ts';

export { Brep, NONE } from './topology/brep.ts';
export type { FeatureAttrs, Rgb } from './topology/brep.ts';
export * from './topology/euler.ts';
export { buildShell, canonicalEdges } from './topology/build.ts';
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
export * from './primitives.ts';

export { createObject, adopt, preorder, DEFAULT_TECHNIQUES } from './model/object.ts';
export type { CutObject, PrimitiveInfo } from './model/object.ts';
