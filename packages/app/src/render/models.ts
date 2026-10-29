import * as THREE from 'three';
import {
  DEPTH_MERGE,
  FINE,
  ROOM,
  WorldGeometry,
  mat4,
  preorder,
  type Brep,
  type CutObject,
} from '@cutplane/kernel';
import type { CutDocument } from '@cutplane/formats';
import { CLASSIC, rgb, shadeFace, type PointLight } from '../viewer/palette.ts';
import { decalFrame, decalSize, decalTexture, projectDecal } from './decals.ts';

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
  /** Each of the mesh's triangles' face (to shade it again as it turns: a fall). */
  faces?: Int32Array | undefined;
  /** What the meshes were built from: the shape's key and the placement. */
  key?: string | undefined;
  built?: ArrayLike<number> | undefined;
  /** Its faces' edges, for when it's drawn as wire (built the first time it is). */
  wire?: THREE.LineSegments | undefined;
  /**
   * New here: a fine mesh being moved or turned is its mesh as built, put where
   * it now is by its matrix (turned, drawn in grey) till it settles (`world` is
   * still where it was built): when it last moved.
   */
  moving?: number | undefined;
}

/** How long a fine mesh moved is held still before it's built where it now is. */
export const SETTLE_MS = 1000;

/**
 * A turned stand-in's grey, lit from above as it lies (each pixel's face
 * from the screen's slopes), so its shape still reads without shading its
 * faces again each frame.
 */
function standInMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
    vertexShader: `
      varying vec3 at;
      void main() {
        at = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
      }`,
    fragmentShader: `
      varying vec3 at;
      void main() {
        vec3 n = normalize(cross(dFdx(at), dFdy(at)));
        if (dot(n, cameraPosition - at) < 0.0) n = -n;
        float light = 0.55 + 0.4 * max(dot(n, normalize(vec3(0.3, 1.0, 0.5))), 0.0);
        gl_FragColor = vec4(vec3(0.62 * light), 1.0);
      }`,
  });
}

/**
 * New: a see-through object (opacity under 1: the glass chip's paint), its faces
 * shaded as the solid ones are and blended over what is behind them. Glass shows
 * more of itself, and the room's light, where it is seen edge-on (Fresnel), and
 * takes a highlight where it faces halfway between the eye and the light above:
 * a pane reads as a pane, not only a tint. It writes no depth (what is behind it
 * still draws), and lies a little behind section lines as solids do.
 */
function glassMaterial(opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { opacity: { value: opacity } },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
    vertexShader: `
      varying vec3 at;
      varying vec3 tint;
      void main() {
        tint = color;
        at = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
      }`,
    fragmentShader: `
      uniform float opacity;
      varying vec3 at;
      varying vec3 tint;
      void main() {
        vec3 n = normalize(cross(dFdx(at), dFdy(at)));
        vec3 v = normalize(cameraPosition - at);
        if (dot(n, v) < 0.0) n = -n;
        float edge = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        float glint = pow(max(dot(n, normalize(v + normalize(vec3(-0.3, 1.0, 0.4)))), 0.0), 80.0);
        vec3 c = mix(tint, vec3(1.0), 0.5 * edge) + 0.6 * glint;
        gl_FragColor = vec4(min(c, 1.0), min(1.0, opacity + (1.0 - opacity) * 0.6 * edge + glint));
      }`,
  });
}

/**
 * A stand-in's section at depth `z`: where each of its triangles, as
 * its matrix now has them, crosses the plane (x y z pairs), straight from the
 * mesh, so a turn isn't held up placing and cutting the whole B-rep.
 */
export function standInSection(m: Model, z: number, out: number[]): void {
  const mesh = m.mesh;
  if (!mesh) return;
  const p = mesh.geometry.getAttribute('position').array;
  const e = mesh.matrix.elements;
  const at = (i: number, k: number) => e[k]! * p[i]! + e[k + 4]! * p[i + 1]! + e[k + 8]! * p[i + 2]! + e[k + 12]!; // prettier-ignore
  const d = [0, 0, 0];
  for (let t = 0; t < p.length; t += 9) {
    let above = 0;
    for (let k = 0; k < 3; k++) {
      d[k] = at(t + 3 * k, 2) - z;
      if (d[k]! > 0) above++;
    }
    if (above === 0 || above === 3) continue;
    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3;
      const a = d[k]!;
      const b = d[j]!;
      if (a > 0 === b > 0) continue;
      const s = a / (a - b);
      const i = t + 3 * k;
      const n = t + 3 * j;
      out.push(at(i, 0) + s * (at(n, 0) - at(i, 0)), at(i, 1) + s * (at(n, 1) - at(i, 1)), z);
    }
  }
}

/**
 * How an object is drawn (the 1 key): solid; as grey wire, only the edges of
 * the faces turned towards the viewer, or every edge; or not at all.
 */
export type DrawStyle = 'solid' | 'frontWire' | 'wire' | 'hidden';

/** The wire's grey: dark enough to see on the room's colours and through the plane. */
const WIRE = 0x5a5a5a;

/**
 * Lines along each face's edges (each edge twice: once for either face), each with its
 * face's normal: the shader leaves out those of faces turned away, when asked to.
 */
function wireGeometry(m: Model): THREE.BufferGeometry {
  const b = m.object.brep;
  // Where the mesh was built: it's shifted from there as the object moves (rebuild).
  const g = m.built ? new WorldGeometry(b, Float64Array.from(m.built)) : m.world;
  const pos: number[] = [];
  const nor: number[] = [];
  for (const f of b.faces()) {
    const n = g.faceNormal(f);
    for (const l of b.faceLoops(f))
      for (const h of b.loopHalfEdges(l)) {
        const v = b.heVertex(h);
        const w = b.heVertex(b.heNext(h));
        pos.push(g.x(v), g.y(v), g.z(v), g.x(w), g.y(w), g.z(w));
        nor.push(...n, ...n);
      }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

function wireMaterial(frontOnly: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(WIRE) } },
    defines: frontOnly ? { FRONT_ONLY: 1 } : {},
    vertexShader: `
      varying float facing;
      void main() {
        vec4 at = modelMatrix * vec4(position, 1.0);
        facing = dot(mat3(modelMatrix) * normal, cameraPosition - at.xyz);
        gl_Position = projectionMatrix * viewMatrix * at;
      }`,
    fragmentShader: `
      uniform vec3 color;
      varying float facing;
      void main() {
        #ifdef FRONT_ONLY
        if (facing <= 0.0) discard;
        #endif
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
}

/**
 * A key for what an object's meshes depend on besides its placement: its B-rep,
 * colour and shadow. Far cheaper than triangulating again, so an object that was
 * only told it changed (a pick, a release) is kept as drawn.
 */
export function shapeKey(o: CutObject): string {
  return `${o.brep.shapeFingerprint()}:${o.color.join()}:${o.opacity ?? 1}:${o.attrs.props.includes('Noshadow')}:${o.decals ? JSON.stringify(o.decals) : ''}`;
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
  faceOut?: number[],
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
      faceOut?.push(f);
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
  /** A mesh drawn as wire draws nothing itself (its wire is its child: it moves with it). */
  private readonly unseenMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
  });
  private readonly wireMaterials = { frontWire: wireMaterial(true), wire: wireMaterial(false) };
  private readonly standIn = standInMaterial();
  /** See-through objects' materials, one an opacity. */
  private readonly glass = new Map<number, THREE.ShaderMaterial>();
  private glassOf(opacity: number): THREE.ShaderMaterial {
    let g = this.glass.get(opacity);
    if (!g) this.glass.set(opacity, (g = glassMaterial(opacity)));
    return g;
  }
  /** How each object is drawn: `styleOf`, else solid. */
  private styleOf: (o: CutObject) => DrawStyle = () => 'solid';

  /** How objects are drawn from now on (the 1 key). */
  setStyle(styleOf: (o: CutObject) => DrawStyle): void {
    this.styleOf = styleOf;
    for (const m of this.models) this.applyStyle(m);
  }

  /** Is `o` drawn at all? */
  shows(o: CutObject): boolean {
    return this.styleOf(o) !== 'hidden';
  }

  private applyStyle(m: Model): void {
    const style = this.styleOf(m.object);
    const mesh = m.mesh;
    if (!mesh) return;
    mesh.visible = style !== 'hidden';
    const opacity = m.object.opacity ?? 1;
    mesh.material =
      style === 'solid' || style === 'hidden'
        ? opacity < 1
          ? this.glassOf(opacity)
          : this.material
        : this.unseenMaterial;
    if (style === 'frontWire' || style === 'wire') {
      if (!m.wire) {
        m.wire = new THREE.LineSegments(wireGeometry(m), this.wireMaterials[style]);
        m.wire.frustumCulled = false;
        // Built where the world has it; the mesh's own shift is the wire's too.
        mesh.add(m.wire);
      }
      m.wire.material = this.wireMaterials[style];
      m.wire.visible = true;
    } else if (m.wire) m.wire.visible = false;
    for (const c of mesh.children) if (c.userData['decal']) c.visible = style === 'solid';
    if (m.shadow) m.shadow.visible = style === 'solid' && mesh.matrixAutoUpdate;
    const shade = this.posed.get(m.object);
    if (shade) shade.visible = style === 'solid';
  }

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
      // A fine mesh moved is a stand-in till it settles (its shape, kept, isn't keyed again each frame).
      const same = m.mesh && m.built && m.world.brep === o.brep && (m.moving !== undefined || m.key === shapeKey(o)); // prettier-ignore
      if (same && o.brep.numVertices > FINE) {
        const d = shift(m.built!, o.xform);
        if (m.moving !== undefined || !d || d.some((k) => k !== 0)) {
          any = true;
          this.move(m, d);
          continue;
        }
      }
      if (m.moving !== undefined) this.unturn(m);
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

  /**
   * Draws a fine mesh where its object now is, as a stand-in (see `moving`):
   * only moved (`d`, from where it was built), as it is, its shadow along with
   * it; turned, in grey, without one.
   */
  private move(m: Model, d: [number, number, number] | null): void {
    const mesh = m.mesh!;
    const move = mat4.multiply(mat4.invert(Float64Array.from(m.built!))!, m.object.xform);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.fromArray(move);
    mesh.matrixWorldNeedsUpdate = true;
    this.applyStyle(m);
    if (d && !this.light) {
      if (m.shadow) {
        m.shadow.position.set(d[0], 0, d[2]); // a shadow lies on the floor
        m.shadow.visible = this.styleOf(m.object) === 'solid';
      }
    } else if (this.styleOf(m.object) === 'solid') mesh.material = this.standIn;
    m.moving = performance.now();
  }

  /** A stand-in put back as it was built, its matrix none. */
  private unturn(m: Model): void {
    m.moving = undefined;
    if (!m.mesh) return;
    m.mesh.matrixAutoUpdate = true;
    m.mesh.updateMatrix();
    this.applyStyle(m);
  }

  /** Is `o` drawn as a stand-in, moving? */
  isMoving(o: CutObject): boolean {
    return this.models.some((m) => m.object === o && m.moving !== undefined);
  }

  /**
   * Builds stand-ins where their objects now are: all of them once `holding` is
   * over (the drag or turn let go), else those still for SETTLE_MS. Returns the
   * objects built.
   */
  settle(holding: boolean, now = performance.now()): CutObject[] {
    const done: CutObject[] = [];
    for (const m of this.models) {
      if (m.moving === undefined || (holding && now - m.moving < SETTLE_MS)) continue;
      this.finish(m);
      done.push(m.object);
    }
    return done;
  }

  private finish(m: Model): void {
    m.moving = undefined;
    // Only moved: shifted, as any object moved is.
    const d = shift(m.built!, m.object.xform);
    if (d && !this.light && m.mesh) {
      m.mesh.matrixAutoUpdate = true;
      m.mesh.position.set(...d);
      m.mesh.updateMatrix();
      m.shadow?.position.set(d[0], 0, d[2]);
      this.applyStyle(m);
      m.world = new WorldGeometry(m.object.brep, m.object.xform);
      return;
    }
    this.drop(m);
    m.world = new WorldGeometry(m.object.brep, m.object.xform);
    this.build(m);
  }

  private drop(m: Model): void {
    for (const mesh of [m.mesh, m.shadow]) {
      if (!mesh) continue;
      for (const c of mesh.children) if (c instanceof THREE.Mesh) c.geometry.dispose();
      this.object.remove(mesh);
      mesh.geometry.dispose();
    }
    m.wire?.geometry.dispose();
    m.mesh = m.shadow = m.wire = undefined;
  }

  private build(m: Model): void {
    const b = m.object.brep;
    m.key = shapeKey(m.object);
    m.built = [...m.object.xform];
    const pos: number[] = [];
    const col: number[] = [];
    const faces: number[] = [];
    triangulate(
      b,
      m.world,
      () => true,
      (f) => this.shade(m, f),
      pos,
      col,
      undefined,
      faces,
    );
    m.faces = Int32Array.from(faces);
    m.mesh = new THREE.Mesh(geometry(pos, col), this.material);
    m.mesh.frustumCulled = false;
    this.object.add(m.mesh);
    if (m.object.decals?.length) this.letter(m, pos, faces);
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
    this.applyStyle(m);
  }

  /** Decals' materials, one a text's picture. */
  private readonly decalMaterials = new Map<THREE.Texture, THREE.MeshBasicMaterial>();

  /**
   * New: the object's lettering (TextDecal), each laid on the triangles it was just
   * built of (`pos`, each one's face in `faces`), lit as the face under it is. They
   * are the mesh's children, so they go where it goes till it is built again.
   */
  private letter(m: Model, pos: number[], faces: number[]): void {
    for (const d of m.object.decals ?? []) {
      // (A note floats off the surface: NoteView draws it.)
      if (d.note !== undefined) continue;
      const map = decalTexture(d);
      if (!map) continue;
      const f = decalFrame(m.object, d);
      const { w, h, depth } = decalSize(f, d);
      const p = projectDecal(pos, f, w, h, depth);
      if (p.from.length === 0) continue;
      const col: number[] = [];
      const lit = new Map<number, [number, number, number]>();
      for (const t of p.from) {
        const face = faces[t]!;
        let c = lit.get(face);
        // (A sticker's picture has its own colours: lit as white is.)
        if (!c) lit.set(face, (c = this.shade(m, face, undefined, d.image ? [255, 255, 255] : d.color))); // prettier-ignore
        col.push(...c, ...c, ...c);
      }
      const g = geometry(p.pos, col);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      let mat = this.decalMaterials.get(map);
      if (!mat)
        this.decalMaterials.set(
          map,
          (mat = new THREE.MeshBasicMaterial({
            map,
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            alphaTest: 0.02,
            side: THREE.DoubleSide,
          })),
        );
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      mesh.userData['decal'] = true;
      m.mesh!.add(mesh);
    }
  }

  /** A face's colour (or `color` on it), lit as it lies in the room; `turn`: turned so (a fall). */
  private shade(
    m: Model,
    f: number,
    turn?: THREE.Matrix4,
    color?: readonly [number, number, number],
  ): [number, number, number] {
    const n = new THREE.Vector3(...m.world.faceNormal(f));
    let at = this.light ? new THREE.Vector3(...faceCenter(m, f)) : undefined;
    if (turn) {
      n.transformDirection(turn);
      at = at?.applyMatrix4(turn);
    }
    color ??= m.object.brep.faceColors.get(f) ?? m.object.color;
    return shadeFace(n.toArray(), color, at?.toArray(), this.light, m.object.attrs.photo);
  }

  /** Shades a model's mesh again, turned by `turn` (or not: as built). */
  private reshade(m: Model, turn: THREE.Matrix4 | null): void {
    const faces = m.faces;
    const col = m.mesh?.geometry.getAttribute('color');
    if (!faces || !col) return;
    const of = new Map<number, [number, number, number]>();
    for (let t = 0; t < faces.length; t++) {
      const f = faces[t]!;
      let c = of.get(f);
      if (!c) of.set(f, (c = this.shade(m, f, turn ?? undefined)));
      for (let k = 0; k < 3; k++) col.setXYZ(t * 3 + k, c[0], c[1], c[2]);
    }
    col.needsUpdate = true;
  }

  /** The shadows of objects drawn somewhere else for now (pose). */
  private readonly posed = new Map<CutObject, THREE.Mesh>();
  private readonly squash = new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 0, 0, ROOM.min[1] + 0.5,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ); // prettier-ignore

  /**
   * Draws `o` moved by `m` (world → world) from where the world has it, without
   * building it again (a fall: the globe); null puts it back. Its shadow is the
   * whole object squashed onto the floor (for a solid, the same as its up-facing
   * faces squashed, as the built shadow is).
   */
  pose(o: CutObject, m: THREE.Matrix4 | null): void {
    const model = this.models.find((x) => x.object === o);
    if (model?.moving !== undefined) this.finish(model);
    const mesh = model?.mesh;
    let shade = this.posed.get(o);
    if (!model || !mesh || !m) {
      if (mesh) {
        if (!mesh.matrixAutoUpdate) this.reshade(model!, null);
        mesh.matrixAutoUpdate = true;
        mesh.updateMatrix();
      }
      if (model?.shadow) model.shadow.visible = this.styleOf(o) === 'solid';
      if (shade) {
        this.object.remove(shade);
        this.posed.delete(o);
      }
      return;
    }
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeTranslation(mesh.position.x, mesh.position.y, mesh.position.z).premultiply(m);
    mesh.matrixWorldNeedsUpdate = true;
    // Lit as it now lies: its faces turn to and from the room's lights as it tumbles.
    this.reshade(model, m);
    if (!model.shadow) return;
    model.shadow.visible = false;
    if (!shade || shade.geometry !== mesh.geometry) {
      if (shade) this.object.remove(shade);
      shade = new THREE.Mesh(mesh.geometry, this.shadowMaterial);
      shade.frustumCulled = false;
      shade.renderOrder = -1;
      shade.matrixAutoUpdate = false;
      this.object.add(shade);
      this.posed.set(o, shade);
    }
    shade.visible = this.styleOf(o) === 'solid';
    shade.matrix.copy(mesh.matrix).premultiply(this.squash);
    shade.matrixWorldNeedsUpdate = true;
  }

  /** An object's triangles in the world, as drawn now (x y z × 3 a triangle). */
  triangles(o: CutObject): Float32Array | null {
    const model = this.models.find((x) => x.object === o);
    if (model?.moving !== undefined) this.finish(model);
    const mesh = model?.mesh;
    if (!mesh) return null;
    const out = Float32Array.from(mesh.geometry.getAttribute('position').array);
    const d = mesh.position.toArray(); // moved since it was built
    if (d.some((k) => k !== 0)) for (let i = 0; i < out.length; i++) out[i] = out[i]! + d[i % 3]!;
    return out;
  }

  /**
   * Every vertex depth in the world, for plane snapping; of a mesh too fine to
   * stop at each (a scan's, a terrain's: its stops a fraction apart, the plane
   * would creep from one to the next), only its front and back (new).
   */
  *depths(): IterableIterator<number> {
    for (const m of this.models) {
      const b = m.object.brep;
      if (b.numVertices > FINE) yield* [m.world.zMin, m.world.zMax];
      else for (const v of b.vertices()) yield m.world.z(v);
    }
  }

  /**
   * The depths of faces parallel to the plane (all their corners at one depth,
   * the face turned along the plane's axis): where it sticks. (A tiny face's
   * corners are all at about one depth whichever way it faces; a fine mesh's
   * flat faces are its own small facets, too many to stop at (new).)
   */
  *flatDepths(): IterableIterator<number> {
    for (const m of this.models) {
      const b = m.object.brep;
      if (b.numVertices > FINE) continue;
      for (const f of b.faces()) {
        const zs = b.loopHalfEdges(b.faceLoop(f)).map((h) => m.world.z(b.heVertex(h)));
        if (zs.length < 3 || Math.max(...zs) - Math.min(...zs) >= DEPTH_MERGE) continue;
        if (Math.abs(m.world.faceNormal(f)[2]) >= FACING_PLANE) yield zs[0]!;
      }
    }
  }
}

/** How squarely a face faces along the plane's axis to hold it (about 8°). */
const FACING_PLANE = 0.99;

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
