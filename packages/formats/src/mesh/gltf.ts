import { Document, Logger, WebIO, type Material, type Node } from '@gltf-transform/core';
import { mat4, type CutObject, type Mat4, type Rgb } from '@cutplane/kernel';
import { meshFaces, type V3 } from './faces.ts';
import { nameOf } from './objects.ts';
import { soupObjects, type Soup } from './polygonize.ts';

/** A room unit is a millimetre: glTF's metres are a thousand of them. */
export const UNITS_PER_METRE = 1000;
const M = 1 / UNITS_PER_METRE;
/** Cutplane's own vertex attribute: the face a vertex's triangle belongs to. */
const FACE = '_FACE';

const io = () => new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

// glTF colours are linear; Cutplane's are sRGB 0–255.
const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (l: number) => {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
};

/**
 * glTF binary (.glb): the world's tree as nodes, each object a mesh with flat
 * normals and a material per colour, in metres (a room unit is a millimetre).
 * A node sits at its object's origin, unturned, and its children under it.
 */
export async function writeGlb(
  roots: readonly CutObject[],
  title = 'Cutplane world',
): Promise<Uint8Array<ArrayBuffer>> {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'Cutplane';
  const buffer = doc.createBuffer();
  const scene = doc.createScene(title);
  doc.getRoot().setDefaultScene(scene);
  const materials = new Map<string, Material>();
  const material = (c: Rgb) => {
    const k = c.join(',');
    let m = materials.get(k);
    if (!m) {
      m = doc
        .createMaterial(
          `color_${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`,
        )
        .setBaseColorFactor([toLinear(c[0]), toLinear(c[1]), toLinear(c[2]), 1])
        .setMetallicFactor(0)
        .setRoughnessFactor(1);
      materials.set(k, m);
    }
    return m;
  };
  let count = 0;
  const origin = (o: CutObject): V3 => [o.xform[12]!, o.xform[13]!, o.xform[14]!];
  const add = (o: CutObject, parent: Node | null, at: V3) => {
    const here = origin(o);
    const node = doc
      .createNode(nameOf(o, count++))
      .setTranslation([(here[0] - at[0]) * M, (here[1] - at[1]) * M, (here[2] - at[2]) * M]);
    const byColor = new Map<string, { c: Rgb; pos: number[]; nrm: number[]; face: number[] }>();
    meshFaces(o).forEach((f, n) => {
      const k = f.color.join(',');
      let g = byColor.get(k);
      if (!g) byColor.set(k, (g = { c: f.color, pos: [], nrm: [], face: [] }));
      const all = f.loops.flat();
      for (const t of f.triangles)
        for (const i of t) {
          const p = all[i]!;
          g.pos.push((p[0] - here[0]) * M, (p[1] - here[1]) * M, (p[2] - here[2]) * M);
          g.nrm.push(...f.normal);
          g.face.push(n);
        }
    });
    if (byColor.size) {
      const mesh = doc.createMesh(node.getName());
      for (const g of byColor.values()) {
        const pos = doc
          .createAccessor()
          .setType('VEC3')
          .setArray(new Float32Array(g.pos))
          .setBuffer(buffer);
        const nrm = doc
          .createAccessor()
          .setType('VEC3')
          .setArray(new Float32Array(g.nrm))
          .setBuffer(buffer);
        // Which face each triangle is part of, so a face of several (bent, say) comes back whole.
        const face = doc
          .createAccessor()
          .setType('SCALAR')
          .setArray(new Float32Array(g.face))
          .setBuffer(buffer);
        mesh.addPrimitive(
          doc
            .createPrimitive()
            .setAttribute('POSITION', pos)
            .setAttribute('NORMAL', nrm)
            .setAttribute(FACE, face)
            .setMaterial(material(g.c)),
        );
      }
      node.setMesh(mesh);
    }
    if (parent) parent.addChild(node);
    else scene.addChild(node);
    for (const c of o.children) add(c, node, here);
  };
  for (const r of roots) add(r, null, [0, 0, 0]);
  return io().writeBinary(doc);
}

/** True when the 3×3 part of a row-major matrix is a uniform scale times a rotation. */
function similarity(m: Mat4): number | null {
  const rows = [0, 1, 2].map((r) => [m[r * 4]!, m[r * 4 + 1]!, m[r * 4 + 2]!]);
  const s = Math.hypot(...rows[0]!);
  if (!(s > 0)) return null;
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++) {
      const d =
        rows[a]![0]! * rows[b]![0]! + rows[a]![1]! * rows[b]![1]! + rows[a]![2]! * rows[b]![2]!;
      if (Math.abs(d - (a === b ? s * s : 0)) > 1e-6 * s * s) return null;
    }
  const [x, y, z] = rows as [number[], number[], number[]];
  const det =
    x[0]! * (y[1]! * z[2]! - y[2]! * z[1]!) - x[1]! * (y[0]! * z[2]! - y[2]! * z[0]!) + x[2]! * (y[0]! * z[1]! - y[1]! * z[0]!); // prettier-ignore
  return det > 0 ? s : null;
}

/**
 * Reads glTF: a .glb, or .gltf JSON with its buffers (embedded, or in `resources`
 * by URI). Every node with a mesh becomes an object, under the nearest such node
 * above it; triangles in one plane come back as one face, and each material's
 * base colour is its faces' colour. Units come back as room units.
 */
export async function readGltf(
  data: Uint8Array | string,
  resources: Record<string, Uint8Array<ArrayBuffer>> = {},
): Promise<CutObject[]> {
  const doc =
    typeof data === 'string'
      ? await io().readJSON({ json: JSON.parse(data), resources })
      : await io().readBinary(data);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) return [];
  const colorOf = (m: Material | null): Rgb | null => {
    if (!m) return null;
    const [r, g, b] = m.getBaseColorFactor();
    return [toSrgb(r!), toSrgb(g!), toSrgb(b!)];
  };
  const soupOf = (node: Node): Soup | null => {
    const mesh = node.getMesh();
    if (!mesh) return null;
    // The node's place in the room (glTF's column-major array is our row-major one).
    const w = Float64Array.from(node.getWorldMatrix());
    const s = similarity(w);
    let xform: Mat4 | undefined;
    let scale = UNITS_PER_METRE;
    let place = (p: V3): V3 => {
      const q = mat4.transformPoint(w, p[0], p[1], p[2]);
      return [q[0] * UNITS_PER_METRE, q[1] * UNITS_PER_METRE, q[2] * UNITS_PER_METRE];
    };
    let flip = false;
    if (s !== null) {
      xform = w.slice();
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) xform[r * 4 + c]! /= s;
      for (let c = 0; c < 3; c++) xform[12 + c]! *= UNITS_PER_METRE;
      scale *= s;
      place = (p) => [p[0] * scale, p[1] * scale, p[2] * scale];
    } else {
      // Sheared or mirrored: the positions go into the room as they are.
      const m3 = [0, 1, 2].map((r) => [w[r * 4]!, w[r * 4 + 1]!, w[r * 4 + 2]!]);
      const [x, y, z] = m3 as [number[], number[], number[]];
      flip = x[0]! * (y[1]! * z[2]! - y[2]! * z[1]!) - x[1]! * (y[0]! * z[2]! - y[2]! * z[0]!) + x[2]! * (y[0]! * z[1]! - y[1]! * z[0]!) < 0; // prettier-ignore
    }
    const soup: Soup = { name: node.getName() || mesh.getName() || null, positions: [], polygons: [], colors: [], ...(xform ? { xform } : {}) }; // prettier-ignore
    for (const prim of mesh.listPrimitives()) {
      const mode = prim.getMode();
      const pos = prim.getAttribute('POSITION');
      if (!pos || (mode !== 4 && mode !== 5 && mode !== 6)) continue;
      const base = soup.positions.length;
      const face = prim.getAttribute(FACE);
      // A face number per triangle, if every primitive has them.
      if (soup.polygons.length === 0 && face) soup.faces = [];
      else if (!face) delete soup.faces;
      const el: number[] = [];
      for (let i = 0; i < pos.getCount(); i++)
        soup.positions.push(place(pos.getElement(i, el) as V3));
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      const at = (i: number) => base + (idx ? idx.getScalar(i) : i);
      const tri = (a: number, b: number, c: number) => {
        soup.polygons.push(flip ? [at(a), at(c), at(b)] : [at(a), at(b), at(c)]);
        soup.faces?.push(face!.getScalar(idx ? idx.getScalar(a) : a));
        soup.colors!.push(colorOf(prim.getMaterial()));
      };
      if (mode === 4) for (let i = 0; i + 2 < n; i += 3) tri(i, i + 1, i + 2);
      else if (mode === 5)
        for (let i = 0; i + 2 < n; i++) {
          if (i % 2) tri(i + 1, i, i + 2);
          else tri(i, i + 1, i + 2);
        }
      else for (let i = 1; i + 1 < n; i++) tri(0, i, i + 1);
    }
    return soup;
  };
  const walk = (node: Node): Soup[] => {
    const kids = node.listChildren().flatMap(walk);
    // A node with no mesh that holds several is a group: it comes back with a grouper.
    const soup = soupOf(node) ?? (kids.length >= 2 ? { name: node.getName() || null, positions: [], polygons: [] } : null); // prettier-ignore
    if (!soup) return kids;
    soup.children = kids;
    return [soup];
  };
  return soupObjects(scene.listChildren().flatMap(walk));
}
