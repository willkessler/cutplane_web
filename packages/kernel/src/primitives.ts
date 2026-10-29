import { Brep } from './topology/brep.ts';
import { kemr, kfmrh, mef, mev } from './topology/euler.ts';
import { extrudeFace, makeLamina, revolve, splitFaceAtVertex } from './ops/sweep.ts';

/**
 * Primitives, after the original's primitives.c. Each returns a new Brep in
 * the primitive's local coordinates. (The chair and table are multi-object
 * groups; they arrive with the primitives palette.)
 */

type P3 = [number, number, number];

function polygon(pts: P3[]): { b: Brep; front: number; back: number } {
  const b = new Brep();
  const { front, back } = makeLamina(b, pts);
  return { b, front, back };
}

function oval(ra: number, rb: number, n: number, z = 0): P3[] {
  return Array.from({ length: n }, (_, i): P3 => {
    const t = (2 * Math.PI * i) / n;
    return [Math.cos(t) * ra, Math.sin(t) * rb, z];
  });
}

function mapPositions(b: Brep, f: (p: P3) => P3): Brep {
  for (const v of b.vertices()) {
    const [x, y, z] = f(b.vertexPos(v));
    b.setVertexPos(v, x, y, z);
  }
  return b;
}

/** Square lamina, corner at the origin, facing +z. */
export function createSquare(width: number, height: number): Brep {
  return polygon([[0, 0, 0], [width, 0, 0], [width, height, 0], [0, height, 0]]).b; // prettier-ignore
}

/** Cube with its near lower-left corner at the origin. */
export function createCube(width: number, height: number, length: number): Brep {
  const { b, front } = polygon([[0, 0, 0], [width, 0, 0], [width, height, 0], [0, height, 0]]); // prettier-ignore
  extrudeFace(b, front, 0, 0, length);
  return b;
}

export function createIsoscelesTriangle(size: number): Brep {
  return polygon([[-size, -size, 0], [size, -size, 0], [0, size, 0]]).b; // prettier-ignore
}

export function createIsoscelesPrism(size: number, depth: number): Brep {
  const { b, front } = polygon([[-size, -size, 0], [size, -size, 0], [0, size, 0]]); // prettier-ignore
  extrudeFace(b, front, 0, 0, depth);
  return b;
}

/** Elliptical lamina in the z = 0 plane, facing +z. */
export function createOval(radiusA: number, radiusB: number, segments: number): Brep {
  return polygon(oval(radiusA, radiusB, segments)).b;
}

export function createOvalCylinder(
  radiusA: number,
  radiusB: number,
  depth: number,
  segments: number,
): Brep {
  const { b, front } = polygon(oval(radiusA, radiusB, segments));
  extrudeFace(b, front, 0, 0, depth);
  return b;
}

export function createOvalCone(
  radiusA: number,
  radiusB: number,
  depth: number,
  segments: number,
): Brep {
  const { b, front } = polygon(oval(radiusA, radiusB, segments));
  splitFaceAtVertex(b, front, 0, 0, depth);
  return b;
}

/** Square-based pyramid: base in the y = 0 plane, apex at height y = height. */
export function createPyramid(width: number, height: number, depth: number): Brep {
  const { b, back } = polygon([[0, 0, 0], [width, 0, 0], [width, 0, depth], [0, 0, depth]]); // prettier-ignore
  splitFaceAtVertex(b, back, width / 2, height, depth / 2); // `back` faces +y
  return b;
}

/** Sphere centred on the origin: a half-circle wire revolved about the x axis. */
export function createSphere(radius: number, segments: number): Brep {
  const b = new Brep();
  const profile = Array.from({ length: segments + 1 }, (_, i): P3 => {
    const t = (Math.PI * i) / segments;
    return [Math.cos(t) * radius, Math.sin(t) * radius, 0];
  });
  revolve(b, profile, 'x', segments);
  return b;
}

/** Torus whose hole width equals the tube radius, about the y axis. */
export function createDonut(radius: number, segments: number): Brep {
  return createTorus(radius * 1.5, radius, segments);
}

/** New: a torus of any proportion, about the y axis: its tube's centre `ring` out, `tube` thick round. */
export function createTorus(ring: number, tube: number, segments: number): Brep {
  const b = new Brep();
  const profile = oval(tube, tube, segments).map(([x, y, z]): P3 => [x + ring, y, z]);
  revolve(b, profile, 'y', segments, true);
  return b;
}

/** A thick paraboloid dish, revolved about y and turned to face +z. */
export function createParaboloid(
  width: number,
  height: number,
  thickness: number,
  points: number,
): Brep {
  const xs = width / 2 / points;
  const ys = height / (points * points);
  const profile: P3[] = [];
  for (let i = 1; i < points; i++) profile.push([i * xs, i * i * ys, 0]);
  for (let i = points - 2; i >= 1; i--) profile.push([i * xs, i * i * ys + thickness, 0]);
  const b = new Brep();
  revolve(b, profile, 'y', points);
  return mapPositions(b, ([x, y, z]) => [x, -z, y]);
}

/** The original's vase: a cubic profile revolved about x, then stood upright. */
export function createVase(xscale: number, yscale: number, segments: number): Brep {
  const profile: P3[] = [];
  let x = 1;
  const xinc = 25 / segments;
  for (let i = 0; i < segments; i++) {
    x += xinc;
    profile.push([
      x * xscale,
      (x ** 3 * 3.3005e-3 + x * x * -0.16652 + x * 2.5245 - 1.0756) * yscale,
      0,
    ]);
  }
  const b = new Brep();
  revolve(b, profile, 'x', segments);
  return mapPositions(b, ([px, py, pz]) => [pz, py, -px]);
}

export function createLBeam(width: number, height: number, thickness: number, depth: number): Brep {
  const t = thickness;
  const { b, front } = polygon([[width, 0, 0], [width, t, 0], [t, t, 0], [t, height, 0], [0, height, 0], [0, 0, 0]]); // prettier-ignore
  extrudeFace(b, front, 0, 0, depth);
  return b;
}

export function createTBeam(width: number, height: number, thickness: number, depth: number): Brep {
  const t = thickness / 2;
  const w = width / 2;
  const s = height - thickness;
  const { b, front } = polygon([[t, 0, 0], [t, s, 0], [w, s, 0], [w, height, 0], [-w, height, 0], [-w, s, 0], [-t, s, 0], [-t, 0, 0]]); // prettier-ignore
  extrudeFace(b, front, 0, 0, depth);
  return b;
}

/**
 * The original's cube with a square hole through it (create_cubehole), built
 * with the same Euler sequence: lamina, strut + kemr to start a ring, a wire
 * around the hole, mef, kfmrh into the back face, then sweep.
 */
export function createCubeHole(): Brep {
  const b = new Brep();
  // Outer square at z = 100, facing −z (clockwise seen from +z).
  const { front, back } = makeLamina(b, [[-100, 100, 100], [100, 100, 100], [100, -100, 100], [-100, -100, 100]]); // prettier-ignore
  const outer = b.loopHe(b.faceLoop(front));
  const strut = mev(b, outer, outer, -50, 50, 100);
  kemr(b, strut.edge, strut.he); // the new vertex is now a ring of its own
  // The ring winds opposite to the outer loop: counter-clockwise seen from +z.
  const hole: P3[] = [
    [-50, -50, 100],
    [50, -50, 100],
    [50, 50, 100],
  ];
  let h = strut.he;
  for (const [x, y, z] of hole) h = mev(b, h, h, x, y, z).he;
  const { face: plug } = mef(b, h, strut.he);
  kfmrh(b, back, plug);
  extrudeFace(b, front, 0, 0, -200);
  return b;
}
