import { describe, expect, it } from 'vitest';
import {
  CRTN_NAMES,
  P,
  VM,
  W,
  envWord,
  opcodeWord,
  Op,
  propWord,
  offsetWord,
  boolWord,
  type Crtn,
  Env,
} from '../src/index.ts';
import { cplSource } from './files.ts';
import { MockHost, type MockObj } from './mockhost.ts';
import { bootVM } from './boot.ts';

const REGS = ['COP', 'CAS', 'CAT', 'CAR', 'CAD', 'CNF', 'XOP', 'XAS', 'XAT', 'XAR', 'XAD', 'XNF']
  .map((r) => `${r}\t\tCPLPTR`)
  .join('\n');
const DATA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `R${i}\t\tCPLDATA`).join('\n');

/** A machine whose ROM is just `program` (run once per frame), with R0–R9. */
function machine(program: string, crtns: Record<string, Crtn> = {}) {
  const host = new MockHost();
  const primary = host.world('Primary_world');
  host.world('Environment_world');
  const vm = new VM({ host, crtns: CRTN_NAMES.map((n) => [n, crtns[n] ?? (() => {})] as const) });
  host.vm = vm;
  vm.working = primary;
  vm.loadRom(
    `${REGS}\n${DATA}\nROM_start\tNOP\n${program}\n\t\tJUMP\tA:RAM_start&\nRAM_start\tENDFR\n`,
  );
  const reg = (i: number) => vm.word(vm.symbol(`R${i}`));
  return { vm, host, primary, reg };
}

describe('CPL VM: opcodes', () => {
  it('MOVE, ADD and CLEAR on registers', () => {
    const { vm, reg } = machine(`
\t\tMOVE\tConst:I40,A:R1
\t\tADD\tA:R1,Const:I2,A:R2
\t\tADD\tConst:V[1.0,2.0,3.0],Const:V[10.0,20.0,30.0],A:R3
\t\tMOVE\tA:R2,A:R4
\t\tCLEAR\tA:R4`);
    vm.run();
    expect(reg(1).int).toBe(40);
    expect(reg(2).int).toBe(42);
    expect(reg(3).offset.slice(0, 3)).toEqual([11, 22, 33]);
    expect(reg(4).type).toBe(W.Blank);
  });

  it('branches: BEQUAL/BNEQUAL compare words, BTRUE reads a Boolean, a fresh CPLDATA is false', () => {
    const { vm, reg } = machine(`
\t\tBTRUE\tA:R9,A:_skip1&
\t\tMOVE\tConst:I1,A:R1
_skip1\t\tBEQUAL\tConst:I3,Const:I3,A:_skip2&
\t\tMOVE\tConst:I1,A:R2
_skip2\t\tBNEQUAL\tMsg:Pick,Msg:Unpick,A:_skip3&
\t\tMOVE\tConst:I1,A:R3
_skip3\t\tMOVE\tConst:TRUE,A:R8
\t\tBTRUE\tA:R8,A:_skip4&
\t\tMOVE\tConst:I1,A:R4
_skip4\t\tNOP`);
    vm.run();
    expect(reg(1).int).toBe(1); // R9 is int 0: not TRUE
    expect(reg(2).type).toBe(W.Aux);
    expect(reg(2).int).toBe(0); // skipped
    expect(reg(3).int).toBe(0); // skipped
    expect(reg(4).int).toBe(0); // skipped
  });

  it('JSR and RTS, with the owner kept across the call', () => {
    const { vm, reg } = machine(`
\t\tJSR\tA:Sub&
\t\tMOVE\tConst:I7,A:R2
\t\tJUMP\tA:_out&
Sub\t\tMOVE\tConst:I5,A:R1
\t\tRTS
_out\t\tNOP`);
    vm.run();
    expect(reg(1).int).toBe(5);
    expect(reg(2).int).toBe(7);
  });

  it('PUSH and POP through the stack, last in first out', () => {
    const { vm, reg } = machine(`
\t\tPUSH\tConst:I1
\t\tPUSH\tConst:I2
\t\tPOP\tA:R1
\t\tPOP\tA:R2`);
    vm.run();
    expect([reg(1).int, reg(2).int]).toEqual([2, 1]);
  });

  it('iterates Prop:X* over the features with the property, newest first, collecting results', () => {
    const { vm, host, primary, reg } = machine(`
\t\tHASPROP\tProp:Selectable*,Prop:Hideable,A:R1,Const:Self
\t\tCOUNT\tA:R1,A:R2
\t\tMOVE\tProp:Selectable*,A:R3`);
    const a = host.obj(primary.root, 'a');
    const b = host.obj(primary.root, 'b');
    const c = host.obj(primary.root, 'c');
    for (const o of [a, b, c]) vm.props.add(o, P.Selectable);
    vm.props.add(a, P.Hideable);
    vm.props.add(c, P.Hideable);
    vm.run();
    expect(reg(1).list).toEqual([c, a]);
    expect(reg(2).int).toBe(2);
    expect(reg(3).list).toEqual([c, b, a]);
  });

  it('iterates AS, AT and AD like an odometer, AD fastest', () => {
    const seen: string[] = [];
    const { vm, host, primary } = machine(`
\t\tMOVE\tProp:Selectable*,A:R1
\t\tMOVE\tProp:Hideable*,A:R2
\t\tSETCOLOR\tA:R1*,Const:C[1,2,3]
\t\tWITHIN\tA:R1*,A:R2*,A:R3`);
    const [a, b] = ['a', 'b'].map((n) => host.obj(primary.root, n));
    const [x, y] = ['x', 'y'].map((n) => host.obj(primary.root, n));
    vm.props.add(b!, P.Selectable);
    vm.props.add(a!, P.Selectable);
    vm.props.add(y!, P.Hideable);
    vm.props.add(x!, P.Hideable);
    host.within = (o1, o2) => {
      seen.push(`${(o1 as MockObj).name}${(o2 as MockObj).name}`);
      return false;
    };
    vm.run();
    expect(seen).toEqual(['ax', 'ay', 'bx', 'by']);
    expect(host.log.filter((l) => l.startsWith('color'))).toEqual([
      'color a 1,2,3',
      'color b 1,2,3',
    ]);
  });

  it('messages: QMSG queues a built message, UNQMSG takes it off in order, BMSGS sees it', () => {
    const { vm, host, primary, reg } = machine(`
\t\tBNEMPTY\tA:R9,A:_second&
\t\tMOVE\tObj:Box,A:R9
\t\tMAKEMSG\tMsg:Hello
\t\tMAKEMSG\tConst:I42
\t\tQMSG\tA:R9*,Const:Noprioritymsg
\t\tJUMP\tA:_done&
_second\t\tSETOWN\tConst:Codeowner
\t\tOWNER\tA:R1,Const:Self
\t\tBNOMSGS\tA:R1,A:_done&
\t\tUNQMSG\tA:R2
\t\tUNQMSG\tA:R3
_done\t\tNOP`);
    const box = host.obj(primary.root, 'Box');
    vm.resolveObjectRefs();
    vm.run();
    expect(vm.props.has(box, P.Msgpending)).toBe(true);
    expect(vm.restartParser).toBe(true);
    // Second frame: own the box (as JSRAT would) and read its queue.
    vm.word(vm.symbol('R9')).list = [box];
    vm.currentOwner = box;
    vm.run();
    expect(vm.messages[reg(2).n]).toBe('Hello');
    expect(reg(3).int).toBe(42);
    expect(vm.props.has(box, P.Msgpending)).toBe(false);
  });

  it('a C routine gets its arguments from the stack', () => {
    const got: number[] = [];
    const { vm } = machine(
      `
\t\tPUSH\tConst:I3
\t\tCRTN\tCrtn:set_picksize`,
      {
        set_picksize: (m) => got.push(m.pop().int),
      },
    );
    vm.run();
    expect(got).toEqual([3]);
  });
});

describe('CPL VM: rom.cpl on input events', () => {
  function world() {
    const { vm, host } = bootVM();
    const primary = host.worlds[1]!;
    const env = host.worlds[2]!;
    const cube = host.obj(primary.root, 'Cube');
    const cursor = host.obj(env.root, 'Crosshair_Cursor');
    vm.props.add(cursor, P.Background);
    vm.loadPrivateCode(cursor, cplSource('cursor.cpl'), 'cursor.cpl');
    vm.resolveObjectRefs();
    return { vm, host, cube, cursor, primary, env };
  }

  const pickEvent = (vm: VM, op = Op.PICK) =>
    vm.storeInstruction(opcodeWord(op), propWord(P.Selectable, true));

  it('PICK on a selectable object: CPnormal picks it (and its group root) and wipes the event', () => {
    const { vm, host, cube } = world();
    vm.props.add(cube, P.Selectable);
    pickEvent(vm);
    vm.step();
    expect(host.log).toContain('pick Cube');
    expect(vm.props.has(cube, P.Picked)).toBe(true);
    expect(vm.props.has(cube, P.Grabbed)).toBe(true);
    // The event was wiped, so RAM didn't pick again (pick logs once).
    expect(host.log.filter((l) => l === 'pick Cube')).toHaveLength(1);
  });

  it('a drag: TRANS Prop:Picked* nobody wipes runs from RAM and moves what is picked', () => {
    const { vm, host, cube } = world();
    vm.props.add(cube, P.Selectable);
    pickEvent(vm);
    vm.step();
    vm.storeInstruction(
      opcodeWord(Op.TRANS),
      propWord(P.Picked, true),
      boolWord(true),
      offsetWord([5, 0, 0]),
    );
    vm.storeInstruction(
      opcodeWord(Op.TRANS),
      envWord(Env.Crosshair_part),
      boolWord(false),
      offsetWord([5, 0, 0]),
    );
    vm.step();
    expect(cube.pos).toEqual([5, 0, 0]);
    expect(host.cursorAt).toEqual([5, 0, 0]);
    // Release: CPnormal takes Grabbed away again.
    pickEvent(vm, Op.RELEAS);
    vm.step();
    expect(vm.props.has(cube, P.Grabbed)).toBe(false);
  });

  it('PICK on nothing: the crosshair starts a marquee (cursor.cpl) and becomes Active', () => {
    const marquees: unknown[] = [];
    const { vm, cursor } = world();
    // start_marquee: pops the cursor, pushes a marquee object.
    const i = vm.crtnIndex('start_marquee');
    (vm as unknown as { crtnFns: Crtn[] }).crtnFns[i] = (m) => {
      marquees.push(m.pop().list?.[0]);
      m.pushFeatures([cursor]);
    };
    pickEvent(vm);
    vm.step();
    expect(marquees).toEqual([cursor]);
    expect(vm.props.has(cursor, vm.props.find('Marqueeing'))).toBe(true);
    expect(vm.props.has(cursor, P.Active)).toBe(true);
  });

  it('a message to a feature with no property code runs CPnormal: Delete deletes it', () => {
    const { vm, cube } = world();
    vm.encodeInstruction(' MAKEMSG Msg:Delete');
    vm.encodeInstruction(' QMSG Obj:Cube,Const:Noprioritymsg');
    vm.step(); // RAM queues the message
    expect(vm.props.has(cube, P.Msgpending)).toBe(true);
    vm.step(); // ROM runs the cube's code for its message
    expect(vm.props.has(cube, P.Killed)).toBe(true);
  });
});
