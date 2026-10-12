import { CRTN_NAMES, PROPERTY_FILES, VM, type Crtn } from '../src/index.ts';
import { cplSource } from './files.ts';
import { MockHost } from './mockhost.ts';

const noop: Crtn = () => {};

/** A VM with rom.cpl and the property files loaded, on three mock worlds. */
export function bootVM(): { vm: VM; host: MockHost } {
  const host = new MockHost();
  host.world('Scratch_world');
  const primary = host.world('Primary_world');
  host.world('Environment_world');
  const vm = new VM({ host, crtns: CRTN_NAMES.map((n) => [n, noop] as const) });
  host.vm = vm;
  vm.working = primary;
  vm.loadRom(cplSource('rom.cpl'));
  for (const p of PROPERTY_FILES) vm.loadPropertyCode(cplSource(p), `${p.toLowerCase()}.cpl`, p);
  return { vm, host };
}
