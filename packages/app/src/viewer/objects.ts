import * as THREE from 'three';
import { ROOM, mat4, preorder, type CutObject } from '@cutplane/kernel';
import type { CutDocument } from '@cutplane/formats';
import { CLASSIC, rgb } from './palette.ts';

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

/** Triangulates every face of an object in world coordinates, flat-shaded, coloured per face. */
export function objectGeometry(o: CutObject): THREE.BufferGeometry {
  const b = o.brep;
  const world = new Map<number, THREE.Vector3>();
  for (const v of b.vertices()) {
    const [x, y, z] = mat4.transformPoint(o.xform, b.vx(v), b.vy(v), b.vz(v));
    world.set(v, new THREE.Vector3(x, y, z));
  }
  const pos: number[] = [];
  const col: number[] = [];
  const base = new THREE.Color().setRGB(
    o.color[0] / 255,
    o.color[1] / 255,
    o.color[2] / 255,
    THREE.SRGBColorSpace,
  );
  for (const f of b.faces()) {
    const loops = b
      .faceLoops(f)
      .map((l) => b.loopHalfEdges(l).map((h) => world.get(b.heVertex(h))!));
    const outer = loops[0]!;
    if (outer.length < 3) continue;
    // Newell normal in world space picks the projection plane for triangulation.
    const n = new THREE.Vector3();
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i]!;
      const c = outer[(i + 1) % outer.length]!;
      n.x += (a.y - c.y) * (a.z + c.z);
      n.y += (a.z - c.z) * (a.x + c.x);
      n.z += (a.x - c.x) * (a.y + c.y);
    }
    if (n.lengthSq() === 0) continue;
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z); // prettier-ignore
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
    const fc = b.faceColors.get(f);
    const c = fc
      ? new THREE.Color().setRGB(fc[0] / 255, fc[1] / 255, fc[2] / 255, THREE.SRGBColorSpace)
      : base;
    for (const t of tris) {
      // triangulateShape may return either winding; keep the face's.
      const [p0, p1, p2] = t.map((i) => all[i]!) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      const tn = new THREE.Vector3()
        .subVectors(p1, p0)
        .cross(new THREE.Vector3().subVectors(p2, p0));
      const tri = tn.dot(n) >= 0 ? [p0, p1, p2] : [p0, p2, p1];
      for (const p of tri) {
        pos.push(p.x, p.y, p.z);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Builds the drawable scene for a document: shaded objects plus their
 * shadows, projected straight down onto the room floor as in the original.
 */
export function documentGroup(doc: CutDocument): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: rgb(CLASSIC.shadow),
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const floor = ROOM.min[1] + 0.5;
  for (const o of preorder(doc.roots)) {
    if (!isDrawn(o)) continue;
    const g = objectGeometry(o);
    group.add(new THREE.Mesh(g, material));
    if (!o.attrs.props.includes('Noshadow')) {
      const s = g.clone();
      const p = s.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setY(i, floor);
      group.add(new THREE.Mesh(s, shadowMaterial));
    }
  }
  return group;
}
