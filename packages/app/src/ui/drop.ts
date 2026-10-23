/**
 * New here: a folder dropped on the page opens as its files would, all of them
 * (a model often comes as several: an OBJ with its .mtl and textures, a glTF
 * with its .bin, a terrain with its .rgb), the folders inside it too.
 */

/** As much of FileSystemEntry as a drop needs (so a test can stand one in). */
export interface DropEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (ok: (es: DropEntry[]) => void, fail: (e: unknown) => void) => void;
  };
}

/** Hidden files a folder carries along (.DS_Store, ._ resource forks): never models. */
const hidden = (name: string) => name.startsWith('.');

/** Every file in the entries, folders opened all the way down. */
export async function filesOfEntries(entries: readonly DropEntry[]): Promise<File[]> {
  const out: File[] = [];
  const walk = async (e: DropEntry): Promise<void> => {
    if (hidden(e.name)) return;
    if (e.isFile && e.file) out.push(await new Promise<File>((ok, fail) => e.file!(ok, fail)));
    else if (e.isDirectory && e.createReader) {
      const reader = e.createReader();
      // A reader hands a folder over a batch at a time, until it hands over none.
      for (;;) {
        const batch = await new Promise<DropEntry[]>((ok, fail) => reader.readEntries(ok, fail));
        if (batch.length === 0) break;
        for (const c of batch) await walk(c);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

/**
 * The files dropped, folders opened. The entries are taken at once: a drop's
 * items are gone once its handler returns.
 */
export function droppedFiles(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return Promise.resolve([]);
  const entries = [...dt.items]
    .map((i) => (i.kind === 'file' ? i.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  // (A browser without entries gives the files alone.)
  if (entries.length === 0) return Promise.resolve([...dt.files]);
  return filesOfEntries(entries as unknown as DropEntry[]);
}
