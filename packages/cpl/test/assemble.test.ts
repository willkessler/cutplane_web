import { describe, expect, it } from 'vitest';
import { CplAssemblyError, PROPERTY_FILES, W, Op } from '../src/index.ts';
import { bootVM } from './boot.ts';
import { allCplFiles, cplSource } from './files.ts';

/**
 * Files the original never loaded, which don't assemble: pre-version-3 syntax
 * (BEQ, BNE, ISWIPED in colorctrl, colorhandle, menu, toolbar, workgroup), a
 * C routine that was never written (calipers_object), and fragments that jump
 * to labels they don't have (delete, duplicate).
 */
const DEAD = new Set([
  'calipers.cpl',
  'colorctrl.cpl',
  'colorhandle.cpl',
  'delete.cpl',
  'duplicate.cpl',
  'menu.cpl',
  'toolbar.cpl',
  'workgroup.cpl',
]);

describe('CPL assembler', () => {
  it('loads rom.cpl: the frame registers, CPnormal and the main loop', () => {
    const { vm } = bootVM();
    expect(vm.COP).toBe(vm.systemBase);
    expect(vm.XNF).toBe(vm.COP + 11);
    expect(vm.cpnormal).toBeGreaterThan(vm.XNF);
    expect(vm.word(vm.romStart).n).toBe(Op.WORLD);
    expect(vm.word(vm.ramStart).type).toBe(W.Opcode);
    expect(vm.word(vm.ramStart).n).toBe(Op.ENDFR);
  });

  it('loads every property file in cplpropfiles.rsc and binds its code', () => {
    const { vm } = bootVM();
    for (const p of ['Stamp', 'Toolbox', 'Goodies', 'Scalebbox', 'Colorbar', 'Paint']) {
      const i = vm.props.find(p);
      expect(i, p).toBeGreaterThanOrEqual(0);
      expect(vm.props.code[i], p).toBeGreaterThan(0);
    }
  });

  it('assembles every other CPL file as private code, except the dead ones', () => {
    const { vm, host } = bootVM();
    const failures: string[] = [];
    const failed = new Set<string>();
    const props = new Set(PROPERTY_FILES.map((p) => `${p.toLowerCase()}.cpl`));
    for (const f of allCplFiles()) {
      if (f === 'rom.cpl' || props.has(f)) continue;
      const owner = host.obj(host.worlds[2]!.root, f);
      try {
        vm.loadPrivateCode(owner, cplSource(f), f);
      } catch (e) {
        if (!(e instanceof CplAssemblyError)) throw e;
        failed.add(f);
        if (!DEAD.has(f))
          failures.push(...e.errors.map((x) => `${x.file}:${x.line}: ${x.message}`));
      }
    }
    expect(failures).toEqual([]);
    expect([...failed].sort()).toEqual([...DEAD].sort());
  });

  it('reports bad lines with their line numbers and keeps the old code', () => {
    const { vm } = bootVM();
    const p = vm.props.find('Stamp');
    const before = vm.props.code[p];
    let err: CplAssemblyError | undefined;
    try {
      vm.loadPropertyCode('Stamp\t\tSTARTPROP\n\t\tBOGUS\tA:R1\n\t\tMOVE\tA:R1\n', 'stamp.cpl');
    } catch (e) {
      err = e as CplAssemblyError;
    }
    expect(err?.errors.map((e) => [e.line, e.message])).toEqual([
      [2, 'opcode BOGUS unknown'],
      [3, 'MOVE takes 2 arguments, got 1'],
    ]);
    expect(vm.props.code[p]).toBe(before);
  });
});
