import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readColors, readDecal, rampColor } from '../src/index.ts';
import { ORIGINAL, read } from './files.ts';

describe('decals (.dcl)', () => {
  const files = readdirSync(join(ORIGINAL, 'rsc')).filter((f) => f.endsWith('.dcl'));
  it.each(files)('%s reads', (f) => {
    const { decal } = readDecal(read(join(ORIGINAL, 'rsc', f)));
    expect(decal.polygons.length).toBeGreaterThan(0);
    for (const p of decal.polygons) expect(p.points.length).toBeGreaterThanOrEqual(3);
  });

  it('reads littleman.dcl fully', () => {
    const { decal, warnings } = readDecal(read(join(ORIGINAL, 'rsc/littleman.dcl')));
    expect(decal).toMatchObject({ name: 'littleman.dcl', scale: 0.5, origin: [0, 0, 0] });
    expect(decal.polygons).toHaveLength(2);
    expect(warnings).toEqual([]);
  });
});

describe('cpcolors.rsc', () => {
  const c = readColors(read(join(ORIGINAL, 'rsc/cpcolors.rsc')));
  it('has the classic background and cutplane colours', () => {
    expect(c.settings['Background Color']).toEqual([253, 153, 102]);
    expect(c.settings['Cutplane Color']).toEqual([155, 180, 200]);
    expect(c.settings['Number of Cutplane Hatches']).toBe(80);
  });
  it('has the eight colour ramps', () => {
    expect(c.ramps.map((r) => r.name)).toEqual([
      'Selectable',
      'Grey',
      'Yellow',
      'Purple',
      'Green',
      'Blue',
      'Orange',
      'Red',
    ]);
    const orange = c.ramps.find((r) => r.name === 'Orange')!;
    expect(rampColor(orange, 1)).toEqual([255, 110, 0]);
    expect(rampColor(orange, 0)).toEqual([30, 15, 0]);
  });
});
