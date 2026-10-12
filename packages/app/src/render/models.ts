import * as THREE from 'three';
import { ROOM, WorldGeometry, preorder, type CutObject } from '@cutplane/kernel';
import type { CutDocument } from '@cutplane/formats';
import { CLASSIC, rgb, shadeFace } from '../viewer/palette.ts';

/** Objects the original would draw: Visible, not Killed, not a scale box or a group placeholder. */
export function isDrawn(o: CutObject): boolean {
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
}

/**
 * Triangulates every face (holes included, via ShapeUtils) in world space.
 * `colorOf` gives each face's colour (0..1). Returns positions and colours.
 */
function triangulate(
  m: Model,
  faceFilter: (f: number) => boolean,
  colorOf: (f: number) => readonly number[],
  pos: number[],
  col: number[],
  flattenY?: number,
): void {
  const b = m.object.brep;
  const g = m.world;
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

  load(doc: CutDocument): void {
    for (const m of this.models) this.drop(m);
    this.models = [...preorder(doc.roots)]
      .filter(isDrawn)
      .map((object) => ({ object, world: new WorldGeometry(object.brep, object.xform) }));
    for (const m of this.models) this.build(m);
  }

  /** Catches up with objects added to or removed from the world (duplicate, delete, undo). */
  sync(roots: readonly CutObject[]): void {
    const now = [...preorder(roots)].filter(isDrawn);
    const keep = new Set(now);
    for (const m of this.models) if (!keep.has(m.object)) this.drop(m);
    const had = new Map(this.models.map((m) => [m.object, m]));
    this.models = now.map((object) => {
      const m = had.get(object);
      if (m) return m;
      const fresh: Model = { object, world: new WorldGeometry(object.brep, object.xform) };
      this.build(fresh);
      return fresh;
    });
  }

  /** Rebuilds what's drawn for objects whose geometry or placement changed. */
  rebuild(objects: Iterable<CutObject>): void {
    const set = new Set(objects);
    for (const m of this.models) {
      if (!set.has(m.object)) continue;
      this.drop(m);
      m.world = new WorldGeometry(m.object.brep, m.object.xform);
      this.build(m);
    }
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
    const pos: number[] = [];
    const col: number[] = [];
    triangulate(
      m,
      () => true,
      (f) => shadeFace(m.world.faceNormal(f), b.faceColors.get(f) ?? m.object.color),
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
        m,
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
