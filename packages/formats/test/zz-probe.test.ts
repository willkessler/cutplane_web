import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { preorder, validate } from '@cutplane/kernel';
import { holesClosed, readGltf } from '../src/index.ts';
import { REPO } from './files.ts';
it('probe', async () => {
  for (const n of ['car', 'ship']) {
    const t = performance.now();
    const objs = await readGltf(new Uint8Array(readFileSync(join(REPO, `.shots/glb/${n}.glb`))));
    console.log(n, 'read ms', Math.round(performance.now() - t));
    for (const o of preorder(objs)) {
      const r = validate(o.brep);
      console.log(
        n,
        o.name,
        'shells',
        o.brep.numShells,
        'faces',
        o.brep.numFaces,
        'holes closed',
        holesClosed.get(o) ?? 0,
        'closed',
        r.closedManifold,
        JSON.stringify(r.counts),
      );
    }
  }
});
