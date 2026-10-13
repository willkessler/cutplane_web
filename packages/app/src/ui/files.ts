import {
  fitToRoom,
  readGltf,
  readMtl,
  readObj,
  readStl,
  writeGlb,
  writeObj,
  writeStl,
} from '@cutplane/formats';
import type { CutObject, Rgb } from '@cutplane/kernel';

/** What a file is to Cutplane, by its extension. */
export type FileKind = 'cut' | 'obj' | 'mtl' | 'stl' | 'glb' | 'gltf' | 'bin' | 'other';

export function kindOf(name: string): FileKind {
  const ext = /\.([^.]+)$/.exec(name.toLowerCase())?.[1] ?? '';
  if (ext === 'cut' || ext === 'rsc' || ext === 'icon') return 'cut';
  if (['obj', 'mtl', 'stl', 'glb', 'gltf', 'bin'].includes(ext)) return ext as FileKind;
  return 'other';
}

/** Files Open and drag and drop take. */
export const ACCEPT = '.cut,.rsc,.icon,.obj,.mtl,.stl,.glb,.gltf,.bin';

const bytes = async (f: File) => new Uint8Array(await f.arrayBuffer());

/** What reading mesh files gives: the objects, already fitted into the room. */
export interface Imported {
  objects: CutObject[];
  /** The files they came from, and the scale they were fitted with. */
  names: string[];
  scale: number;
}

/**
 * Reads the mesh files among `files` (OBJ with any .mtl dropped alongside,
 * STL, GLB, glTF with its .bin buffers) into objects, then fits them into the
 * room together. A file that can't be read throws, naming it.
 */
export async function readMeshFiles(files: readonly File[]): Promise<Imported> {
  const byName = new Map(files.map((f) => [f.name, f]));
  const materials = new Map<string, Rgb>();
  for (const f of files) if (kindOf(f.name) === 'mtl') for (const [k, v] of readMtl(await f.text())) materials.set(k, v); // prettier-ignore
  const objects: CutObject[] = [];
  const names: string[] = [];
  for (const f of files) {
    const kind = kindOf(f.name);
    let got: CutObject[];
    try {
      if (kind === 'obj') got = readObj(await f.text(), materials);
      else if (kind === 'stl') got = readStl(await bytes(f));
      else if (kind === 'glb') got = await readGltf(await bytes(f));
      else if (kind === 'gltf') {
        const text = await f.text();
        // Buffers in separate files come along if they were dropped too.
        const uris: string[] = (
          (JSON.parse(text) as { buffers?: { uri?: string }[] }).buffers ?? []
        )
          .map((b) => b.uri ?? '')
          .filter((u) => u && !u.startsWith('data:'));
        const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
        for (const u of uris) {
          const r = byName.get(decodeURIComponent(u).split('/').pop()!);
          if (!r) throw new Error(`it needs ${u} as well: drop them together`);
          resources[u] = (await bytes(r)) as Uint8Array<ArrayBuffer>;
        }
        got = await readGltf(text, resources);
      } else continue;
    } catch (err) {
      throw new Error(`${f.name}: ${(err as Error).message}`, { cause: err });
    }
    if (got.length === 0) throw new Error(`${f.name}: nothing in it with faces`);
    const title = f.name.replace(/\.[^.]+$/, '');
    for (const o of got) o.name ??= title;
    objects.push(...got);
    names.push(f.name);
  }
  return { objects, names, scale: objects.length ? fitToRoom(objects) : 1 };
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
