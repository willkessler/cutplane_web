import { readMeshFiles, FACE_BUDGET, type Imported, type ReadOptions } from './files.ts';
import { unpack, type ImportReply, type ImportRequest } from './packing.ts';

/**
 * Reading model files off the page's thread: a worker reads them (a file of
 * millions of triangles takes seconds), so the room keeps drawing, the read
 * can say how far it has got, and it can be cancelled. The objects come back
 * as plain data, their B-reps' arrays transferred rather than copied.
 */

/** A read under way: its result, and a way to stop it. */
export interface Reading {
  result: Promise<Imported>;
  cancel(): void;
}

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

/**
 * Reads mesh files in a worker (or here, where workers can't be had), telling
 * `progress` how far it has got. `cancel` stops it; the result then rejects
 * with Cancelled.
 */
export function readInBackground(files: readonly File[], opts: ReadOptions = {}): Reading {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    let cancelled = false;
    const result = readMeshFiles(files, opts).then((r) => {
      if (cancelled) throw new Cancelled();
      return r;
    });
    return { result, cancel: () => (cancelled = true) };
  }
  let stop = () => {};
  const result = new Promise<Imported>((resolve, reject) => {
    stop = () => {
      worker.terminate();
      reject(new Cancelled());
    };
    worker.onmessage = (e: MessageEvent<ImportReply>) => {
      const m = e.data;
      if (m.kind === 'progress') opts.progress?.(m.fraction);
      else {
        worker.terminate();
        if (m.kind === 'error') reject(new Error(m.message));
        else resolve({ ...m.imported, objects: unpack(m.imported.objects) });
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      // A worker that ran out of memory says little: say what it was.
      reject(new Error(e.message || 'it was too big to read (the browser ran out of memory)'));
    };
    const request: ImportRequest = { files: [...files], budget: opts.budget ?? FACE_BUDGET };
    worker.postMessage(request);
  });
  return { result, cancel: () => stop() };
}
