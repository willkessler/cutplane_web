/**
 * New: pictures made ready to stick on things (stickers: TextDecal's image). However
 * big it came, it is kept at no more than PICTURE_SIDE a side, as a data: URL in the
 * world (and its file), webp where the browser writes it, else png.
 */

export const PICTURE_SIDE = 512;

export interface Picture {
  /** A data: URL. */
  image: string;
  /** Width over height. */
  aspect: number;
  /** What it was called (its file's name, less the extension). */
  name: string;
}

/** A file, or a URL (data: or not), as a picture ready to stick on. */
export async function readyPicture(from: Blob | string, name?: string): Promise<Picture> {
  const img = new Image();
  img.decoding = 'async';
  const url = typeof from === 'string' ? from : URL.createObjectURL(from);
  if (typeof from === 'string' && !from.startsWith('data:')) img.crossOrigin = 'anonymous';
  try {
    img.src = url;
    await img.decode();
  } catch {
    throw new Error('image: not a picture this browser can read');
  } finally {
    if (typeof from !== 'string') URL.revokeObjectURL(url);
  }
  const w0 = img.naturalWidth || img.width || 1;
  const h0 = img.naturalHeight || img.height || 1;
  const s = Math.min(1, PICTURE_SIDE / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w0 * s));
  canvas.height = Math.max(1, Math.round(h0 * s));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  let image = canvas.toDataURL('image/webp', 0.9);
  if (!image.startsWith('data:image/webp')) image = canvas.toDataURL('image/png');
  const called =
    name ?? (from instanceof File ? from.name.replace(/\.[^.]*$/, '') : undefined) ?? 'STICKER';
  return { image, aspect: w0 / h0, name: called.trim() || 'STICKER' };
}
