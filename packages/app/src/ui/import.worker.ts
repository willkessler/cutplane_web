import { readMeshFiles } from './files.ts';
import { pack, type ImportReply, type ImportRequest } from './packing.ts';

// The worker that reads model files (see importer.ts).
const post = (m: ImportReply, transfer: Transferable[] = []) => self.postMessage(m, { transfer });

onmessage = async (e: MessageEvent<ImportRequest>) => {
  try {
    let last = -1;
    const imported = await readMeshFiles(e.data.files, {
      budget: e.data.budget,
      progress: (fraction) => {
        // A hundred steps is plenty to show.
        if (Math.floor(fraction * 100) === last) return;
        last = Math.floor(fraction * 100);
        post({ kind: 'progress', fraction });
      },
    });
    const { packed, transfer } = pack(imported.objects);
    post({ kind: 'done', imported: { ...imported, objects: packed } }, transfer);
  } catch (err) {
    post({ kind: 'error', message: (err as Error).message });
  }
};
