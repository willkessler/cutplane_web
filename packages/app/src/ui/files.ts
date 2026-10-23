import {
  fitToRoom,
  grouper,
  holesClosed,
  readDxf,
  readGltf,
  readInventor,
  readMtl,
  readSgi,
  isSgiName,
  readObj,
  readStl,
  simplifierReady,
  writeGlb,
  writeObj,
  writeStl,
} from '@cutplane/formats';
import type { DecodeImage, MeshOptions, Pixels, Progress } from '@cutplane/formats';
import { preorder, type CutObject, type Rgb } from '@cutplane/kernel';

/** What a file is to Cutplane, by its extension. */
export type FileKind =
  'cut' | 'obj' | 'mtl' | 'stl' | 'glb' | 'gltf' | 'bin' | 'iv' | 'dxf' | 'image' | 'other';

/** A file's name without .gz: model.iv.gz is a model.iv, gzipped. */
const ungz = (name: string) => name.replace(/\.gz$/i, '');

export function kindOf(name: string): FileKind {
  const ext = /\.([^.]+)$/.exec(ungz(name).toLowerCase())?.[1] ?? '';
  if (ext === 'cut' || ext === 'rsc' || ext === 'icon') return 'cut';
  if (['obj', 'mtl', 'stl', 'glb', 'gltf', 'bin', 'dxf'].includes(ext)) return ext as FileKind;
  // VRML's own gzipped files are .wrz.
  if (ext === 'iv' || ext === 'wrl' || ext === 'vrml' || ext === 'wrz') return 'iv';
  // A model's textures, dropped with it: the SGI's own images, and the web's.
  if (isSgiName(name) || ['png', 'jpg', 'jpeg'].includes(ext)) return 'image';
  return 'other';
}

/** The kinds that are models to add to the world. */
export const MESH_KINDS: readonly FileKind[] = ['obj', 'stl', 'glb', 'gltf', 'iv', 'dxf'];

/** Files Open and drag and drop take. */
export const ACCEPT =
  '.cut,.rsc,.icon,.obj,.mtl,.stl,.glb,.gltf,.bin,.iv,.wrl,.vrml,.wrz,.dxf,.gz,.rgb,.rgba,.bw,.sgi,.png,.jpg,.jpeg';

/** A file's bytes, unzipped if it was gzipped (by its first two bytes, whatever its name). */
async function bytes(f: File): Promise<Uint8Array<ArrayBuffer>> {
  const b = new Uint8Array(await f.arrayBuffer());
  if (b[0] !== 0x1f || b[1] !== 0x8b) return b;
  const out = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}
/** Old text formats are 8-bit: latin1 maps every byte. */
const latin1 = async (f: File) => new TextDecoder('latin1').decode(await bytes(f));
const utf8 = async (f: File) => new TextDecoder().decode(await bytes(f));

/** A texture's pixels, decoded by the browser (models colour themselves with these). */
const decodeImage: DecodeImage = async (data, mimeType) => {
  const bitmap = await createImageBitmap(
    new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeType }),
  );
  const { width, height } = bitmap;
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null; // prettier-ignore
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
};

/** An SGI image's pixels, or null if it can't be read (its model then comes in uncoloured). */
function readSgiOrNull(b: Uint8Array): Pixels | null {
  try {
    return readSgi(b);
  } catch {
    return null;
  }
}

/** What reading mesh files gives: the objects, already fitted into the room. */
export interface Imported {
  objects: CutObject[];
  /** The files they came from, and the scale they were fitted with. */
  names: string[];
  scale: number;
  /** Holes closed to make solids of surfaces that weren't. */
  holes: number;
  /** When there were more faces than the budget: how many, and how many came in. */
  simplified: { from: number; to: number } | null;
  /** Textures the files name that weren't dropped with them. */
  missing: string[];
  /** Whether a terrain made with Z up was laid on the floor. */
  laidFlat: boolean;
}

/**
 * The most faces (polygons, as the file has them) one import comes in as.
 * Every face is drawn, cut by the plane and kept in the undo history, so
 * beyond this the room stops being quick to work in; a bigger file is
 * simplified to fit.
 */
export const FACE_BUDGET = 400_000;

export interface ReadOptions {
  /** Told how far the read has got, 0 to 1. */
  progress?: Progress | undefined;
  /** The most faces to come in as (Infinity for every one). */
  budget?: number | undefined;
}

/**
 * Reads the mesh files among `files` (OBJ with any .mtl dropped alongside,
 * STL, GLB, glTF with its .bin buffers) into objects, then fits them into the
 * room together. A file that can't be read throws, naming it.
 */
export async function readMeshFiles(
  files: readonly File[],
  { progress, budget = FACE_BUDGET }: ReadOptions = {},
): Promise<Imported> {
  const byName = new Map(files.map((f) => [f.name, f]));
  await simplifierReady();
  // Each file's part of the progress is its share of the bytes.
  const meshFiles = files.filter((f) => MESH_KINDS.includes(kindOf(f.name)));
  const total = Math.max(
    1,
    meshFiles.reduce((n, f) => n + f.size, 0),
  );
  let before = 0;
  let simplified: Imported['simplified'] = null;
  // The budget is for the whole drop: each file gets its share.
  const opts = (f: File): MeshOptions => {
    const share = f.size / total;
    const from = before / total;
    before += f.size;
    return {
      progress: progress && ((x) => progress(from + share * x)),
      budget: Number.isFinite(budget) ? Math.max(1000, Math.round(budget * share)) : undefined,
      simplified: (a, b) => {
        simplified = { from: (simplified?.from ?? 0) + a, to: (simplified?.to ?? 0) + b };
      },
      images: (name) => pictures.get(name.toLowerCase()) ?? undefined,
      missingImage: (name) => missing.add(name),
      laidFlat: () => (laidFlat = true),
    };
  };
  // Images dropped with the models, by name, decoded when a model asks for one.
  const pictures = new Map<string, Pixels | null>();
  for (const f of files) {
    if (kindOf(f.name) !== 'image') continue;
    const b = await bytes(f);
    const type = /\.png$/i.test(f.name) ? 'image/png' : 'image/jpeg';
    pictures.set(f.name.toLowerCase(), isSgiName(f.name) ? readSgiOrNull(b) : await decodeImage(b, type).catch(() => null)); // prettier-ignore
  }
  const missing = new Set<string>();
  let laidFlat = false;
  const materials = new Map<string, Rgb>();
  for (const f of files) if (kindOf(f.name) === 'mtl') for (const [k, v] of readMtl(await utf8(f))) materials.set(k, v); // prettier-ignore
  const objects: CutObject[] = [];
  const names: string[] = [];
  for (const f of files) {
    const kind = kindOf(f.name);
    let got: CutObject[];
    try {
      if (kind === 'obj') got = readObj(await utf8(f), materials, opts(f));
      else if (kind === 'stl') got = readStl(await bytes(f), opts(f));
      else if (kind === 'iv')
        got = readInventor(await bytes(f), opts(f)); // text or binary
      else if (kind === 'dxf') got = readDxf(await latin1(f), opts(f));
      else if (kind === 'glb') got = await readGltf(await bytes(f), {}, decodeImage, opts(f));
      else if (kind === 'gltf') {
        const text = await utf8(f);
        // Buffers and textures in separate files come along if they were dropped too.
        const json = JSON.parse(text) as {
          buffers?: { uri?: string }[];
          images?: { uri?: string }[];
        };
        const uris = [...(json.buffers ?? []), ...(json.images ?? [])]
          .map((b) => b.uri ?? '')
          .filter((u) => u && !u.startsWith('data:'));
        const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
        for (const u of uris) {
          const r = byName.get(decodeURIComponent(u).split('/').pop()!);
          if (!r) throw new Error(`it needs ${u} as well: drop them together`);
          resources[u] = await bytes(r);
        }
        got = await readGltf(text, resources, decodeImage, opts(f));
      } else continue;
    } catch (err) {
      throw new Error(`${f.name}: ${(err as Error).message}`, { cause: err });
    }
    if (got.length === 0)
      throw new Error(`${f.name}: nothing in it with faces (only lines or points?)`);
    const title = ungz(f.name).replace(/\.[^.]+$/, '');
    for (const o of got) o.name ??= title;
    // A file's parts (a car's body, glass and wheels) come in as one group, named after it.
    objects.push(...(got.length > 1 ? [grouper(title, got)] : got));
    names.push(f.name);
  }
  let holes = 0;
  for (const o of preorder(objects)) holes += holesClosed.get(o) ?? 0;
  progress?.(1);
  return { objects, names, scale: objects.length ? fitToRoom(objects) : 1, holes, simplified, missing: [...missing], laidFlat }; // prettier-ignore
}

export type ExportFormat = 'glb' | 'obj' | 'stl';

export const EXPORTS: Record<ExportFormat, { label: string; type: string; description: string }> = {
  glb: { label: 'glTF binary (.glb)', type: 'model/gltf-binary', description: 'glTF binary' },
  obj: { label: 'Wavefront OBJ (.obj)', type: 'model/obj', description: 'Wavefront OBJ' },
  stl: { label: 'STL (.stl)', type: 'model/stl', description: 'STL' },
};

/** The world's objects in a mesh format, as a file's contents. */
export async function exportWorld(
  format: ExportFormat,
  roots: readonly CutObject[],
  title: string,
): Promise<Blob> {
  const type = EXPORTS[format].type;
  if (format === 'glb') return new Blob([await writeGlb(roots, title)], { type });
  if (format === 'stl') return new Blob([writeStl(roots, title)], { type });
  return new Blob([writeObj(roots, title)], { type });
}

/** A file name made from a world's title. */
export const fileName = (title: string, ext: string) =>
  `${title.replace(/[^\w-]+/g, '_').toLowerCase() || 'world'}.${ext}`;

/**
 * Saves a file: through File System Access where the browser has it, else as
 * a download. False if the person cancelled.
 */
export async function saveFile(name: string, blob: Blob, description: string): Promise<boolean> {
  const picker = (window as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> })
    .showSaveFilePicker;
  const ext = name.slice(name.lastIndexOf('.'));
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description, accept: { [blob.type || 'application/octet-stream']: [ext] } }],
      });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return true;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return false;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}
