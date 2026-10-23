import { describe, expect, it } from 'vitest';
import { filesOfEntries, type DropEntry } from './drop.ts';

const file = (name: string): DropEntry => ({
  name,
  isFile: true,
  isDirectory: false,
  file: (ok) => ok(new File(['x'], name)),
});
/** A folder whose reader hands its entries over two at a time, as browsers do in batches. */
const folder = (name: string, kids: DropEntry[]): DropEntry => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader: () => {
    let at = 0;
    return {
      readEntries: (ok) => {
        ok(kids.slice(at, at + 2));
        at += 2;
      },
    };
  },
});

describe('a folder dropped (new)', () => {
  it('opens as all its files, folders inside it too, hidden files left out', async () => {
    const dropped = [
      folder('MSL_Sol4176', [
        file('terrain.iv'),
        file('.DS_Store'),
        file('terrain.rgb'),
        folder('textures', [file('rock.png'), file('._rock.png')]),
        file('notes.txt'),
      ]),
      file('extra.stl'),
    ];
    const names = (await filesOfEntries(dropped)).map((f) => f.name);
    expect(names).toEqual(['terrain.iv', 'terrain.rgb', 'rock.png', 'notes.txt', 'extra.stl']);
  });
});
