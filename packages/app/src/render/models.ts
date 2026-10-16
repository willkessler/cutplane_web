import * as THREE from 'three';
import { ROOM, WorldGeometry, preorder, type Brep, type CutObject } from '@cutplane/kernel';
import type { CutDocument } from '@cutplane/formats';
import { CLASSIC, rgb, shadeFace, type PointLight } from '../viewer/palette.ts';

/** Objects the original would draw: Visible, not Killed, not a scale box or a group placeholder. */
export function isDrawn(o: CutObject): boolean {
  // The marquee is drawn as its box (Highlights), never as an object with a section.
  if (o.drawTechnique === 'draw_marquee_technique') return false;
  // A pencil stroke being drawn is a line (ScribbleView) until it closes into a solid.
  if (o.drawTechnique === 'draw_scribble_technique') return false;
  const p = o.attrs.props;
  return (
    p.includes('Visible') &&
    !p.includes('Killed') &&
    !p.includes('Scalebbox') &&
    !p.includes('Grouper')
  );
}

/** A drawn object and its world-space geometry, shared by the renderer, the section and plane snapping. */
export interface Model {
  object: CutObject;
  world: WorldGeometry;
  mesh?: THREE.Mesh | undefined;
  shadow?: THREE.Mesh | undefined;
  /** What the meshes were built from: the shape's key and the placement. */
  key?: string | undefined;
  built?: ArrayLike<number> | undefined;
}

/**
 * A key for what an object's meshes depend on besides its placement: its B-rep,
 * colour and shadow. Far cheaper than triangulating again, so an object that was
 * only told it changed (a pick, a release) is kept as drawn.
 */
export function shapeKey(o: CutObject): string {
  return `${o.brep.fingerprint()}:${o.color.join()}:${o.attrs.props.includes('Noshadow')}`;
}

/** How far `now` moves things from `then`, if that is all it does (no turn, no scaling). */
function shift(then: ArrayLike<number>, now: ArrayLike<number>): [number, number, number] | null {
  for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15]) if (then[i] !== now[i]) return null;
  return [now[12]! - then[12]!, now[13]! - then[13]!, now[14]! - then[14]!];
}

/**
 * Triangulates every face (holes included, via ShapeUtils) in world space.
 * `colorOf` gives each face's colour (0..1). Returns positions and colours.
 */
export function triangulate(
  b: Brep,
  g: WorldGeometry,
  faceFilter: (f: number) => boolean,
  colorOf: (f: number) => readonly number[],
  pos: number[],
  col: number[],
  flattenY?: number,
): void {
  const v3 = (v: number) => new THREE.Vector3(g.x(v), g.y(v), g.z(v));
  for (const f of b.faces()) {
    if (!faceFilter(f)) continue;
    const n = g.faceNormal(f);
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) continue;
    const loops = b.faceLoops(f).map((l) => b.loopHalfEdges(l).map((h) => v3(b.heVertex(h))));
    const outer = loops[0]!;
    if (outer.length < 3) continue;
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]); // prettier-ignore
    const flat = (p: THREE.Vector3) =>
      ax >= ay && ax >= az
        ? new THREE.Vector2(p.y, p.z)
        : ay >= az
          ? new THREE.Vector2(p.z, p.x)
          : new THREE.Vector2(p.x, p.y);
    const all = loops.flat();
    const tris = THREE.ShapeUtils.triangulateShape(
      outer.map(flat),
      loops.slice(1).map((l) => l.map(flat)),
    );
    const c = colorOf(f);
    const nv = new THREE.Vector3(...n);
    for (const t of tris) {
      const [p0, p1, p2] = t.map((i) => all[i]!) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      // triangulateShape may return either winding; keep the face's.
      const tn = new THREE.Vector3()
        .subVectors(p1, p0)
        .cross(new THREE.Vector3().subVectors(p2, p0));
      for (const p of tn.dot(nv) >= 0 ? [p0, p1, p2] : [p0, p2, p1]) {
        pos.push(p.x, flattenY ?? p.y, p.z);
        col.push(c[0]!, c[1]!, c[2]!);
      }
    }
  }
}

function geometry(pos: number[], col: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/**
 * The drawable world: flat-shaded objects (shade.c's lighting, fixed to the
 * room) and their shadows. As in draw_face_shadow, each up-facing face is
 * squashed straight down onto the floor.
 */
export class ModelView {
  readonly object = new THREE.Group();
  models: Model[] = [];
  private readonly material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    // Pushes faces back a little so section lines lying on them always win the depth test
    // (the original's shifted_zbuffer).
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    color: rgb(CLASSIC.shadow),
    side: THREE.DoubleSide,
  });

  /** The light bulb's light, when it's out of its box and on. */
  light: PointLight | undefined;

  /** A new light: every model is shaded again. */
  relight(light: PointLight | undefined): void {
    this.light = light;
    for (const m of this.models) {
      this.drop(m);
      this.build(m);
    }
  }

  load(doc: CutDocument): void {
    for (const m of this.models) this.drop(m);
    this.models = [...preorder(doc.roots)]
      .filter(isDrawn)
      .map((object) => ({ object, world: new WorldGeometry(object.brep, object.xform) }));
    for (const m of this.models) this.build(m);
  }

  /**
   * Catches up with objects added to or removed from the world (duplicate, delete, undo).
   * True if any were.
   */
  sync(roots: readonly CutObject[], wanted: (o: CutObject) => boolean = () => true): boolean {
    const now = [...preorder(roots)].filter((o) => isDrawn(o) && wanted(o));
    const keep = new Set(now);
    let any = now.length !== this.models.length;
    for (const m of this.models) if (!keep.has(m.object)) this.drop(m);
    const had = new Map(this.models.map((m) => [m.object, m]));
    this.models = now.map((object) => {
      const m = had.get(object);
      if (m) return m;
      any = true;
      const fresh: Model = { object, world: new WorldGeometry(object.brep, object.xform) };
      this.build(fresh);
      return fresh;
    });
    return any;
  }

  /**
   * Rebuilds what's drawn for objects whose geometry or placement changed. One only
   * moved is shifted (its shading is fixed to the room, so it looks the same, unless
   * the light bulb lights it); one that hasn't really changed is kept as it is.
   * True if any of them moved or changed.
   */
  rebuild(objects: Iterable<CutObject>): boolean {
    const set = new Set(objects);
    let any = false;
    for (const m of this.models) {
      if (!set.has(m.object)) continue;
      const o = m.object;
      if (m.mesh && m.built && m.world.brep === o.brep && m.key === shapeKey(o)) {
        const d = shift(m.built, o.xform);
        const still = d !== null && d[0] === 0 && d[1] === 0 && d[2] === 0;
        if (d && (!this.light || still)) {
          if (!still) {
            any = true;
            m.world = new WorldGeometry(o.brep, o.xform);
          }
          m.mesh.position.set(...d);
          m.shadow?.position.set(d[0], 0, d[2]); // a shadow lies on the floor
          continue;
        }
      }
      any = true;
      this.drop(m);
      m.world = new WorldGeometry(m.object.brep, m.object.xform);
      this.build(m);
    }
    return any;
  }

  private drop(m: Model): void {
    for (const mesh of [m.mesh, m.shadow]) {
      if (!mesh) continue;
      this.object.remove(mesh);
      mesh.geometry.dispose();
    }
    m.mesh = m.shadow = undefined;
  }

  private build(m: Model): void {
    const b = m.object.brep;
    m.key = shapeKey(m.object);
    m.built = [...m.object.xform];
    const pos: number[] = [];
    const col: number[] = [];
    triangulate(
      b,
      m.world,
      () => true,
      (f) =>
        shadeFace(
          m.world.faceNormal(f),
          b.faceColors.get(f) ?? m.object.color,
          this.light ? faceCenter(m, f) : undefined,
          this.light,
        ),
      pos,
      col,
    );
    m.mesh = new THREE.Mesh(geometry(pos, col), this.material);
    m.mesh.frustumCulled = false;
    this.object.add(m.mesh);
    if (!m.object.attrs.props.includes('Noshadow')) {
      const spos: number[] = [];
      const scol: number[] = [];
      triangulate(
        b,
        m.world,
        (f) => m.world.faceNormal(f)[1] > 0,
        () => [0, 0, 0],
        spos,
        scol,
        ROOM.min[1] + 0.5,
      );
      m.shadow = new THREE.Mesh(geometry(spos, scol), this.shadowMaterial);
      m.shadow.frustumCulled = false;
      m.shadow.renderOrder = -1;
      this.object.add(m.shadow);
    }
  }

  /** Every vertex depth in the world, for plane snapping. */
  *depths(): IterableIterator<number> {
    for (const m of this.models) for (const v of m.object.brep.vertices()) yield m.world.z(v);
  }
}

/** A face's centre (the mean of its outer loop's vertices). */
function faceCenter(m: Model, f: number): number[] {
  const b = m.object.brep;
  const g = m.world;
  const vs = b.loopHalfEdges(b.faceLoop(f)).map((h) => b.heVertex(h));
  let [x, y, z] = [0, 0, 0];
  for (const v of vs) {
    x += g.x(v);
    y += g.y(v);
    z += g.z(v);
  }
  const n = vs.length || 1;
  return [x / n, y / n, z / n];
}
