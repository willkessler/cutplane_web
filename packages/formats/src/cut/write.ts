import {
  Brep,
  canonicalEdges,
  preorder,
  type CutObject,
  type FeatureAttrs,
} from '@cutplane/kernel';
import type { CutDocument } from './document.ts';
import { fmtCoord, fmtF } from './numbers.ts';

const ESC = '\x1b';
const esc = (s: string) => s.replace(/[ \t]/g, ESC);

/**
 * Writes a document in the Sequoia format (storage_cutplane.c), line for
 * line, so the original C program can read it and files it wrote come back
 * unchanged.
 */
export function writeCut(doc: CutDocument): string {
  const out: string[] = [];
  const w = (s: string) => out.push(s);
  const objects = [...preorder(doc.roots)];
  const index = new Map(objects.map((o, i) => [o, i]));

  w(`** Start of file ${doc.title} **\n`);
  w(`Contains:${doc.contains}\n`);
  if (doc.contains === 'World') {
    w(`World Name:${doc.name === null ? '<none>' : esc(doc.name)}\n`);
    w(`\tTotal Number of Objects In World:${objects.length}\n`);
  } else {
    w(`Branch Name:${doc.name === null ? '<none>' : esc(doc.name)}\n`);
    w(`Branch Preferred Motherworld:${doc.preferredMotherworld ?? '<none>'}\n`);
    w(`\tTotal Number of Objects In Branch:${objects.length}\n`);
  }
  if (doc.zoomScale !== undefined) w(`\tZoom Scale:${fmtF(doc.zoomScale)}\n`);

  objects.forEach((o, i) => {
    const label = doc.contains === 'World' ? i + 1 : i;
    // A parent outside the document (a world's root, a scale box) makes a top-level object.
    const at = o.parent ? index.get(o.parent) : undefined;
    const parent = at === undefined ? 0 : at + 1;
    writeObject(w, o, label, parent);
  });
  w(`** End of file ${doc.title} **\n`);
  return out.join('');
}

function writeMatrix(w: (s: string) => void, m: Float64Array): void {
  for (let r = 0; r < 4; r++) {
    let line = ' [ ';
    for (let c = 0; c < 4; c++) line += ` ${fmtF(m[r * 4 + c]!)} `;
    w(`${line} ]\n`);
  }
}

function writeProps(w: (s: string) => void, a: FeatureAttrs): void {
  for (const p of a.props) w(`${p}\n`);
  if (a.props.includes('Hasdecal')) w(`Decal File:${a.decalFile ?? '***FILLMEIN!!***'}\n`);
}

/**
 * Inline CPL (new): each line of the code behind a `|`, so blank lines and the
 * label column survive the reader's trimming.
 */
function writeCode(w: (s: string) => void, code: string): void {
  for (const line of code.replace(/\r?\n$/, '').split(/\r?\n/)) w(`|${line}\n`);
}
const codeLines = (code: string) => code.replace(/\r?\n$/, '').split(/\r?\n/).length;

function writeObject(w: (s: string) => void, o: CutObject, label: number, parent: number): void {
  w(`\n\n\tObject ${label}:\n`);
  w(`Object Name:${o.name === null ? '<none>' : esc(o.name)}\n`);
  w(' Object Transform:\n');
  writeMatrix(w, o.xform);
  w(' Object Inverse Transform:\n');
  writeMatrix(w, o.invXform);
  w(`Object Parent:${parent}\n`);
  w(`Object Color:${o.color.join(' ')}\n`);
  w(`Object has ${o.attrs.props.length} properties:\n`);
  writeProps(w, o.attrs);
  if (o.primitive) {
    w('\tPrimitive Info:\n');
    w(`\tCube Length:${fmtF(o.primitive.length, 2)}\n`);
    w(`\tCube Width:${fmtF(o.primitive.width, 2)}\n`);
    w(`\tCube Height:${fmtF(o.primitive.height, 2)}\n`);
  }
  w(`Object Selectechnique:${o.selectTechnique}\n`);
  w(`Object Drawtechnique:${o.drawTechnique}\n`);
  w(`Object Screenbboxtechnique:${o.screenBBoxTechnique}\n`);
  if (o.attrs.privateSource !== undefined) {
    w(`Object CPL private code:${codeLines(o.attrs.privateSource)} lines\n`);
    writeCode(w, o.attrs.privateSource);
  }
  w(shellsText(o.brep));
}

/** Each B-rep's shells as last written, kept while it is unchanged (autosave writes often). */
const written = new WeakMap<Brep, { fingerprint: string; text: string }>();
function shellsText(b: Brep): string {
  const fingerprint = b.fingerprint();
  const had = written.get(b);
  if (had?.fingerprint === fingerprint) return had.text;
  const out: string[] = [];
  const w = (s: string) => out.push(s);
  const shells = b.shells();
  const verts = b.verticesByShell();
  const faces = b.facesByShell();
  w(`\nNumber of Shells:${shells.length}\n`);
  shells.forEach((s, i) => writeShell(w, b, s, i + 1, verts.get(s)!, faces.get(s)!));
  const text = out.join('');
  written.set(b, { fingerprint, text });
  return text;
}

function writeShell(
  w: (s: string) => void,
  b: Brep,
  shell: number,
  label: number,
  verts: readonly number[],
  faces: readonly number[],
): void {
  w(`Shell ${label}:\n`);
  const vIndex = new Map(verts.map((v, i) => [v, i + 1]));
  w(` Number of Vertices:${verts.length}\n`);
  w(' VFE List:\n');
  verts.forEach((v, i) => {
    w(`Vertex ${i + 1}:${fmtCoord(b.vx(v))} ${fmtCoord(b.vy(v))} ${fmtCoord(b.vz(v))}\n`);
  });
  w(` Number of Faces:${faces.length}\n`);
  w(' FVE List:\n');
  faces.forEach((f, i) => {
    const loops = b.faceLoops(f);
    w(`Face:${i + 1} (${loops.length} bounds)\n`);
    loops.forEach((l, j) => {
      const hs = b.loopHalfEdges(l);
      w(
        `\tBound ${j + 1} (${hs.length} le's):${hs.map((h) => `${vIndex.get(b.heVertex(h))} `).join('')}\n`,
      );
    });
  });

  const edges = canonicalEdges(b, shell, faces);
  const colored = faces.map((f, i) => [i + 1, b.faceColors.get(f)] as const).filter(([, c]) => c);
  w(`Faces with different colors:${colored.length}\n`);
  for (const [i, c] of colored) w(`\tFace ${i}:${c!.join(' ')}\n`);

  const sections = [
    ['Vertices', 'Vertex', verts, b.vertexAttrs],
    ['Edges', 'Edge', edges, b.edgeAttrs],
    ['Faces', 'Face', faces, b.faceAttrs],
  ] as const;
  for (const [plural, single, ids, map] of sections) {
    const rows = ids
      .map((id, i) => [i + 1, map.get(id)] as const)
      .filter(([, a]) => a && a.props.length > 0);
    w(`${plural} with properties:${rows.length}\n`);
    for (const [i, a] of rows) {
      w(`${single} ${i} has ${a!.props.length} properties:\n`);
      writeProps(w, a!);
    }
  }
  for (const [plural, single, ids, map] of sections) {
    const rows = ids
      .map((id, i) => [i + 1, map.get(id)] as const)
      .filter(([, a]) => a?.privateSource !== undefined || a?.privateCode);
    w(`${plural} with CPL private code:${rows.length}\n`);
    for (const [i, a] of rows) {
      if (a!.privateSource !== undefined) {
        w(`${single} ${i}: inline ${codeLines(a!.privateSource)}\n`);
        writeCode(w, a!.privateSource);
      } else w(`${single} ${i}: ${a!.privateCode}\n`);
    }
  }
}
