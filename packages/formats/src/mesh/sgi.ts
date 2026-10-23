import type { Pixels } from './gltf.ts';

/**
 * SGI image files (.rgb, .rgba, .bw, .sgi, .int, .inta): the IRIS's own
 * format, which Inventor's Texture2 names. A 512-byte big-endian header, then
 * each channel's rows, bottom row first, as they are or run-length encoded.
 * Read here (not by the browser, which knows nothing of them) as RGBA from the
 * top row, as a decoded PNG is.
 */
export function readSgi(bytes: Uint8Array): Pixels {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 512 || dv.getUint16(0) !== 474) throw new Error('not an SGI image');
  const rle = bytes[2] === 1;
  const bpc = bytes[3]!;
  if (bpc !== 1 && bpc !== 2) throw new Error(`SGI image of ${bpc} bytes a channel`);
  const dim = dv.getUint16(4);
  const width = dv.getUint16(6);
  const height = dim < 2 ? 1 : dv.getUint16(8);
  const channels = dim < 3 ? 1 : dv.getUint16(10);
  const plane = width * height;
  const values = new Uint8Array(plane * channels); // channel by channel, bottom row first
  const value = (at: number): number => bytes[at]!; // (of two bytes, the high one: big-endian)
  if (!rle) {
    for (let i = 0; i < values.length; i++) values[i] = value(512 + i * bpc);
  } else {
    // Where each row (of each channel) starts, in the order rows go: y + z·height.
    const rows = height * channels;
    for (let r = 0; r < rows; r++) {
      let at = dv.getUint32(512 + r * 4);
      let out = r * width;
      const end = out + width;
      while (out < end && at < bytes.length) {
        const count = (bpc === 1 ? bytes[at]! : dv.getUint16(at)) & 0x7f;
        const copy = (bpc === 1 ? bytes[at]! : bytes[at + 1]!) & 0x80;
        at += bpc;
        if (count === 0) break;
        const n = Math.min(count, end - out);
        if (copy) for (let k = 0; k < n; k++, at += bpc) values[out++] = value(at);
        else {
          values.fill(value(at), out, out + n);
          out += n;
          at += bpc;
        }
      }
    }
  }
  const data = new Uint8ClampedArray(plane * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from = (height - 1 - y) * width + x; // top row first
      const o = (y * width + x) * 4;
      const c = (z: number) => values[z * plane + from]!;
      const grey = channels < 3;
      data[o] = c(0);
      data[o + 1] = grey ? c(0) : c(1);
      data[o + 2] = grey ? c(0) : c(2);
      data[o + 3] = channels === 2 ? c(1) : channels === 4 ? c(3) : 255;
    }
  return { width, height, data };
}

/** A file name SGI images go by. */
export const isSgiName = (name: string): boolean => /\.(rgb|rgba|bw|sgi|int|inta)$/i.test(name);
