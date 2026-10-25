import {
  SUBFEATURES,
  assemble,
  assembleLine,
  CplAssemblyError,
  type AsmEnv,
  type AssembleResult,
  type SymbolRec,
  type SymbolRef,
} from './assembler.ts';
import { disassembleSentence } from './disasm.ts';
import type { Crtn, Host } from './host.ts';
import { OPCODE_ARGS, AS_ARG, AT_ARG, AR_ARG, AD_ARG, Op } from './opcodes.ts';
import { P, Properties, type PropNode } from './props.ts';
import {
  Aux,
  Code,
  Env,
  T,
  W,
  Word,
  assignWord,
  blankout,
  clearWord,
  cloneWord,
  copyWord,
  first,
  firstProp,
  NOPROPERTY,
  setupAux,
  setupWord,
  setupWordBlank,
  type Address,
  type Feature,
} from './word.ts';

/**
 * The CPL virtual machine (cplcore.c, cplops.c, cplib.c's stacks and
 * queues).
 *
 * Memory is an array of words addressed from 1 (0 is Nil). The system block
 * holds ROM — the frame registers, R0–R9, CPnormal and the main loop from
 * rom.cpl — followed by RAM, where input events are written as instruction
 * sentences each frame. Property and private code go in blocks of their own,
 * and JSRAT builds its call lists in a block it reuses from the start each
 * time, exactly as the original did.
 *
 * Running a frame (CPL_parse): the current frame (COP...) starts at
 * ROM_start and the examination frame (XOP...) at RAM's first sentence. ROM
 * calls the code of every feature with messages, every active, picked and
 * selectable feature, and the background objects; their code looks at the
 * sentence under examination and may act on it, change its arguments, or
 * wipe it. ROM then moves the examination frame on, and when it reaches the
 * end of RAM it falls into RAM itself, so the sentences nobody wiped run.
 */

/** Sizes of the original's code blocs (cpl_cutplane.h); the system bloc is roomier. */
export const SYSTEM_SIZE = 8000;
export const JSRAT_SIZE = 1000;
export const CONTROL_STACK_SIZE = 50;
export const OWNER_STACK_SIZE = CONTROL_STACK_SIZE;
export const MAX_MESSAGE_LENGTH = 50;

const NONE = 0;
const ACC_AS = 1;
const ACC_AT = 2;
const ACC_AD = 3;

/** iteraterec: walking a featurelist or a property's features, one per pass. */
interface Iterate {
  on: boolean;
  mode: 'features' | 'props';
  // features: a snapshot of the list and positions in it
  list: (Feature | null)[];
  pos: number;
  next: number;
  // props: nodes of world proplists, and positions in the list of properties
  props: number[];
  node: PropNode | null;
  nextNode: PropNode | null;
  prop: number;
  nextProp: number;
}

function newIterate(): Iterate {
  return {
    on: false,
    mode: 'features',
    list: [],
    pos: 0,
    next: 0,
    props: [],
    node: null,
    nextNode: null,
    prop: 0,
    nextProp: 0,
  };
}

/** add_to_featurelist: appends unless already there (Nil included). */
function addFeature(list: (Feature | null)[], f: Feature | null): void {
  if (!list.includes(f)) list.push(f);
}

export interface VMOptions {
  host: Host;
  /** The C routines CPL can call, by name (Crtn:name), in table order. */
  crtns?: readonly (readonly [string, Crtn])[];
  /** Called with each sentence as it executes when debugging is on. */
  trace?: (line: string) => void;
  /**
   * Fixes for bugs in the original VM (PLAN.md §8.3). Off, it behaves as it did:
   * - getpropReadsAS: GETPROP read the property value from AR instead of AS.
   */
  fixes?: { getpropReadsAS?: boolean };
}

export class VM implements AsmEnv {
  readonly host: Host;
  readonly props: Properties;
  readonly mem: Word[] = [new Word()];
  readonly symbols: SymbolRec[] = [];
  readonly localSymbols: SymbolRec[] = [];
  readonly symbolRefs: SymbolRef[] = [];
  readonly objectRefs: { address: Address; name: string }[] = [];
  readonly messages: string[] = [];
  readonly crtnNames: string[] = [];
  private readonly crtnFns: Crtn[] = [];
  trace: ((line: string) => void) | undefined;
  debug = false;
  readonly fixes: { getpropReadsAS: boolean };

  /** The loop registers: one CPL word each (OP points at the opcode word). */
  OP: Address = 0;
  readonly AS = new Word();
  readonly AT = new Word();
  readonly AR = new Word();
  readonly AD = new Word();

  // Frame registers (words in ROM).
  COP: Address = 0;
  CAS: Address = 0;
  CAT: Address = 0;
  CAR: Address = 0;
  CAD: Address = 0;
  CNF: Address = 0;
  XOP: Address = 0;
  XAS: Address = 0;
  XAT: Address = 0;
  XAR: Address = 0;
  XAD: Address = 0;
  XNF: Address = 0;
  romStart: Address = 0;
  ramStart: Address = 0;
  cpnormal: Address = 0;

  readonly systemBase: Address;
  private nextFreeSystem: Address;
  nextFreeRAM: Address = 0;
  readonly jsratBase: Address;
  private nextFreeJSRAT: Address;
  private startJSRAT = false;
  private finishJSRAT = false;
  private startOfJsrList: Address = 0;
  private codedOneJSR = false;

  /** The general stack (PUSH/POP), top last. */
  readonly stack: Word[] = [];
  private readonly control: Word[] = [];
  private readonly owners: (Feature | null)[] = [];
  currentOwner: Feature | null = null;

  /** The message being built by MAKEMSG. */
  readonly messageBlock: Word[] = [];
  private resetMessageBlock = false;
  private readonly queues = new Map<Feature, Word[]>();
  private readonly privateCodes = new Map<Feature, Address>();
  /** Where each feature's private code came from (its source, for saving and editing). */
  readonly privateSources = new Map<Feature, string>();
  /** Property code sources by property name. */
  readonly propertySources = new Map<string, string>();

  /** Set when there is RAM or messages to process: run a frame. */
  restartParser = false;
  updateOn = true;
  working!: Feature;
  quit = false;

  private readonly ASit = newIterate();
  private readonly ATit = newIterate();
  private readonly ADit = newIterate();

  constructor(opts: VMOptions) {
    this.host = opts.host;
    this.trace = opts.trace;
    this.fixes = { getpropReadsAS: opts.fixes?.getpropReadsAS ?? false };
    for (const [name, fn] of opts.crtns ?? []) {
      this.crtnNames.push(name);
      this.crtnFns.push(fn);
    }
    this.props = new Properties({
      worldOf: (f) => (f.type === T.World ? f : this.host.worldOf(f)),
      working: () => this.working,
      changed: (f, p, added) => this.host.propertyChanged?.(f, p, added),
    });
    this.systemBase = this.alloc(SYSTEM_SIZE);
    this.nextFreeSystem = this.systemBase;
    this.jsratBase = this.alloc(JSRAT_SIZE);
    this.nextFreeJSRAT = this.jsratBase;
  }

  // ---- memory ----

  /** A fresh run of `n` blank words; returns the first address. */
  alloc(n: number): Address {
    const a = this.mem.length;
    for (let i = 0; i < n; i++) this.mem.push(new Word());
    return a;
  }

  word(a: Address): Word {
    let w = this.mem[a];
    if (!w) {
      while (this.mem.length <= a) this.mem.push(new Word());
      w = this.mem[a]!;
    }
    return w;
  }

  /** inc_CPL_blocptr: the next word, wrapping to the start when fewer than five remain. */
  private incBloc(a: Address, base: Address, size: number): Address {
    a++;
    if (base + size - a < 5) return base;
    return a;
  }

  // ---- assembler environment ----

  message(name: string): number {
    const i = this.messages.indexOf(name);
    if (i >= 0) return i;
    this.messages.push(name);
    return this.messages.length - 1;
  }

  crtnIndex(name: string): number {
    return this.crtnNames.indexOf(name);
  }

  findWorld(name: string): Feature | null {
    return this.host.findWorld(name);
  }

  findObject(name: string): Feature | null {
    return this.host.findObject(name);
  }

  /** find_symbol on the global table. */
  symbol(name: string): Address {
    return this.symbols.find((s) => s.name === name)?.address ?? 0;
  }

  /** The label at an address, for disassembly. */
  labelAt(a: Address): string | undefined {
    return (
      this.symbols.find((s) => s.address === a)?.name ??
      this.localSymbols.find((s) => s.address === a)?.name
    );
  }

  // ---- loading code (cplread.c) ----

  /** init_CPL_language: loads rom.cpl into the system bloc and sets up the frames. */
  loadRom(source: string, file = 'rom.cpl'): void {
    const r = assemble(this, source, { file, at: this.nextFreeSystem });
    this.nextFreeSystem = r.end;
    const need = (n: string) => {
      const a = this.symbol(n);
      if (!a) throw new CplAssemblyError([{ file, line: 0, message: `ROM must define ${n}` }]);
      return a;
    };
    this.COP = need('COP');
    this.CAS = need('CAS');
    this.CAT = need('CAT');
    this.CAR = need('CAR');
    this.CAD = need('CAD');
    this.CNF = need('CNF');
    this.XOP = need('XOP');
    this.XAS = need('XAS');
    this.XAT = need('XAT');
    this.XAR = need('XAR');
    this.XAD = need('XAD');
    this.XNF = need('XNF');
    this.romStart = need('ROM_start');
    this.ramStart = need('RAM_start');
    this.cpnormal = this.symbol('CPnormal');
    this.resetFrames();
    this.resetRam();
    blankout(this.AS);
    blankout(this.AT);
    blankout(this.AD);
  }

  /**
   * read_CPLcode_into_property: assembles a property's code into a block of its
   * own. The property is the one its STARTPROP names (or `property`). Loading it
   * again replaces the code: features with the property run the new code from
   * their next event, and a bad edit leaves the old code in place.
   */
  loadPropertyCode(source: string, file: string, property?: string): AssembleResult {
    const r = this.loadBlock(source, file, null);
    const name = r.lastProperty ?? property;
    if (name) {
      const p = this.props.find(name);
      if (p >= 0 && !r.lastProperty) this.props.code[p] = this.symbol(name) || r.start;
      this.propertySources.set(name, source);
    }
    return r;
  }

  /** read_CPL_privatecode: a feature's own code (Const:Codeowner is the feature). */
  loadPrivateCode(feature: Feature, source: string, file: string): AssembleResult {
    const r = this.loadBlock(source, file, feature);
    this.privateCodes.set(feature, r.start);
    this.privateSources.set(feature, source);
    return r;
  }

  /** The address of a feature's private code, or 0. */
  privateCode(f: Feature): Address {
    return this.privateCodes.get(f) ?? 0;
  }

  /** Detaches a feature's private code. */
  clearPrivateCode(f: Feature): void {
    this.privateCodes.delete(f);
    this.privateSources.delete(f);
  }

  /** Gives `to` the same private code as `from` (shared, as a duplicate's copied pointer would). */
  sharePrivateCode(from: Feature, to: Feature): void {
    const a = this.privateCodes.get(from);
    if (a === undefined) return;
    this.privateCodes.set(to, a);
    const s = this.privateSources.get(from);
    if (s !== undefined) this.privateSources.set(to, s);
  }

  private loadBlock(source: string, file: string, owner: Feature | null): AssembleResult {
    const start = this.mem.length;
    try {
      const r = assemble(this, source, { file, at: start, owner });
      // Reserve the words (assembling grew memory lazily) and a little slack for frame lookahead.
      this.word(r.end + 4);
      return r;
    } catch (e) {
      this.mem.length = start;
      throw e;
    }
  }

  /** resolve_CPL_forward_object_refs: fills in Obj: words whose objects exist now. */
  resolveObjectRefs(): void {
    for (let i = this.objectRefs.length - 1; i >= 0; i--) {
      const r = this.objectRefs[i]!;
      const o = this.host.findObject(r.name);
      if (!o) continue;
      const w = this.word(r.address);
      if (w.type === W.Features && w.list) w.list[0] = o;
      this.objectRefs.splice(i, 1);
    }
  }

  // ---- RAM: input events (cplread.c's store routines) ----

  /** close_RAM: an ENDFR after the last sentence. */
  private closeRam(): void {
    const w = this.word(this.nextFreeRAM);
    clearWord(w);
    w.type = W.Opcode;
    w.n = Op.ENDFR;
  }

  private storeRamWord(w: Word): void {
    const at = this.word(this.nextFreeRAM);
    clearWord(at);
    assignWord(w, at);
    if (at.list) at.list = [...at.list];
    if (at.props) at.props = [...at.props];
    this.nextFreeRAM = this.incBloc(this.nextFreeRAM, this.systemBase, SYSTEM_SIZE);
  }

  /** store_CPL_RAM_instruction: an opcode word and its argument words, in order. */
  storeInstruction(op: Word, ...args: Word[]): void {
    this.storeRamWord(op);
    const need = OPCODE_ARGS[op.n] ?? 0;
    let i = 0;
    for (const bit of [AS_ARG, AT_ARG, AR_ARG, AD_ARG])
      if (need & bit) this.storeRamWord(args[i++]!);
    this.closeRam();
    this.restartParser = true;
  }

  /** store_simple_RAM_instruction. */
  storeSimple(op: number): void {
    const w = new Word();
    w.type = W.Opcode;
    w.n = op;
    this.storeInstruction(w);
  }

  /** encode_CPL_RAM_instruction: one line of CPL source, assembled into RAM. */
  encodeInstruction(line: string): void {
    this.nextFreeRAM = assembleLine(this, line, this.nextFreeRAM);
    this.closeRam();
    this.restartParser = true;
  }

  /** reset_CPL_RAM: two ENDFRs, so a frame with no events still runs ROM once. */
  resetRam(): void {
    this.nextFreeRAM = this.ramStart;
    const a = this.word(this.nextFreeRAM);
    setupWord(a, W.Opcode);
    a.n = Op.ENDFR;
    const b = this.word(this.nextFreeRAM + 1);
    setupWord(b, W.Opcode);
    b.n = Op.ENDFR;
  }

  /** reset_CPL_frames. */
  resetFrames(): void {
    this.word(this.COP).n = this.romStart;
    this.word(this.XOP).n = this.ramStart;
  }

  // ---- running ----

  /** restart_CPL_parse: one frame of CPL. */
  run(): void {
    this.restartParser = false;
    this.resetFrames();
    this.setFrame(this.COP);
    this.setFrame(this.XOP);
    this.parse();
    this.resetRam();
  }

  /** The update loop's step: run a frame if there is anything to run. */
  step(): boolean {
    if (!this.restartParser) return false;
    this.run();
    return true;
  }

  /** CPL_parse. */
  private parse(): void {
    let guard = 0;
    do {
      this.resolver();
      this.host.afterInstruction();
      this.advanceFrame();
      if (this.resetMessageBlock) this.messageBlockReset();
      if (this.quit) break;
      if (++guard > 5_000_000) throw new Error('CPL: runaway frame (no ENDFR reached)');
    } while (this.word(this.word(this.COP).n).n !== Op.ENDFR);
  }

  /** CPL_set_frame: points the frame's argument registers at the words after its opcode. */
  setFrame(opReg: Address): void {
    const opAddr = this.word(opReg).n;
    const op = this.word(opAddr);
    const args = op.type === W.Opcode ? (OPCODE_ARGS[op.n] ?? 0) : 0;
    let next = opAddr + 1;
    for (const [bit, off] of [
      [AS_ARG, 1],
      [AT_ARG, 2],
      [AR_ARG, 3],
      [AD_ARG, 4],
    ] as const) {
      if (args & bit) this.word(opReg + off).n = next++;
      else this.word(opReg + off).n = 0;
    }
    this.word(opReg + 5).n = next;
  }

  private advanceFrame(): void {
    this.word(this.COP).n = this.word(this.CNF).n;
    this.setFrame(this.COP);
  }

  /** resolve_indirection: the word a pointer (one hop) or handle (two hops) leads to. */
  resolve(a: Address): Address {
    if (!a) return 0;
    const w = this.word(a);
    let r: Address;
    if (w.type === W.Ptr) r = w.addressOf ? a : w.n;
    else if (w.type === W.Handle) r = w.addressOf ? a : w.n ? this.word(w.n).n : 0;
    else r = a;
    return r || a;
  }

  /** initialize_iterate. */
  private initIterate(it: Iterate, arg: Address, reg: Word): boolean {
    if (!arg) {
      it.on = false;
      return false;
    }
    const actual = this.word(this.resolve(arg));
    const contents = this.word(arg).contentsOf;
    if (actual.type === W.Features && contents) {
      setupWord(reg, W.Features);
      reg.list!.push(null);
      const list = actual.list ?? [];
      if (list.length === 0) {
        it.on = false;
        return false;
      }
      it.on = true;
      it.mode = 'features';
      it.list = [...list];
      it.pos = 0;
      it.next = 1;
      return true;
    }
    if (actual.type === W.Props && contents) {
      setupWord(reg, W.Features);
      reg.list!.push(null);
      const props = actual.props ?? [NOPROPERTY];
      const pl = this.props.worldList(this.working, props[0] ?? NOPROPERTY);
      if (pl.count === 0) {
        it.on = false;
        return false;
      }
      it.on = true;
      it.mode = 'props';
      it.props = [...props];
      it.node = pl.first;
      it.nextNode = it.node?.next ?? null;
      it.prop = 0;
      it.nextProp = 1;
      return true;
    }
    // Immediate data, pointers, and lists taken whole: copied into the register.
    it.on = false;
    copyWord(actual, reg);
    return false;
  }

  private lookup(it: Iterate): Feature | null {
    if (it.mode === 'features') return it.list[it.pos] ?? null;
    return it.node ? it.node.owner : null;
  }

  /** The iterate_advance functions: true when the walk has run off the end (a reset is due). */
  private advance(it: Iterate): boolean {
    if (it.mode === 'features') {
      it.pos = it.next;
      if (it.pos < it.list.length) {
        it.next = it.pos + 1;
        return false;
      }
      return true;
    }
    it.node = it.nextNode;
    if (!it.node) {
      it.prop = it.nextProp;
      if (it.prop >= it.props.length) return true;
      it.nextProp = it.prop + 1;
      it.node = this.props.worldList(this.working, it.props[it.prop]!).first;
    }
    if (it.node) it.nextNode = it.node.next;
    return false;
  }

  private reset(it: Iterate): void {
    if (it.mode === 'features') {
      it.pos = 0;
      it.next = 1;
      return;
    }
    it.prop = 0;
    it.nextProp = 1;
    it.node = this.props.worldList(this.working, it.props[0]!).first;
    if (it.node) it.nextNode = it.node.next;
  }

  /** CPL_iterate: true if the register now holds the next feature. */
  private iterate(reg: Word, it: Iterate, setupOnly: boolean): boolean {
    if (!it.on) return false;
    if (setupOnly) {
      reg.list![0] = this.lookup(it);
      return true;
    }
    const resetNeeded = this.advance(it);
    if (resetNeeded) this.reset(it);
    const found = this.lookup(it);
    reg.list![0] = found;
    return !resetNeeded && found !== null;
  }

  /**
   * CPL_resolver: runs the current sentence once for every combination of the
   * features in AS, AT and AD (AD fastest, like the digits of an odometer),
   * stopping when the first of AS, AT, AD that iterates runs out. Each pass's AR
   * is collected into the sentence's result word.
   */
  private resolver(): void {
    const opAddr = this.word(this.COP).n;
    const opWord = this.word(opAddr);
    if (this.debug && this.trace) this.trace(this.disassembleCurrent());
    if (opWord.wiped) return;
    this.OP = opAddr;
    const op = opWord.type === W.Opcode ? opWord.n : Op.NOP;

    let lead = NONE;
    if (this.initIterate(this.ADit, this.word(this.CAD).n, this.AD)) lead = ACC_AD;
    if (this.initIterate(this.ATit, this.word(this.CAT).n, this.AT)) lead = ACC_AT;
    if (this.initIterate(this.ASit, this.word(this.CAS).n, this.AS)) lead = ACC_AS;
    const atLeastOne = this.ASit.on || this.ATit.on || this.ADit.on;
    const resultsAddr = this.resolve(this.word(this.CAR).n);
    if (resultsAddr) clearWord(this.word(resultsAddr));
    if (op === Op.JSRAT) this.startJSRAT = true;

    let first = true;
    let ASi = false;
    let ATi = false;
    let ADi: boolean;
    let still: boolean;
    do {
      if (first) {
        ADi = this.iterate(this.AD, this.ADit, true);
        ATi = this.iterate(this.AT, this.ATit, true);
        ASi = this.iterate(this.AS, this.ASit, true);
        first = false;
      } else {
        ADi = this.iterate(this.AD, this.ADit, false);
        if (!ADi) {
          ATi = this.iterate(this.AT, this.ATit, false);
          if (!ATi) ASi = this.iterate(this.AS, this.ASit, false);
        }
      }
      still = (lead === ACC_AS && ASi) || (lead === ACC_AT && ATi) || (lead === ACC_AD && ADi);
      this.finishJSRAT = !still && atLeastOne;
      // JSRAT runs one extra time to close its call list.
      if (this.finishJSRAT && op !== Op.JSRAT) break;
      this.execute(op);
      if (resultsAddr) {
        if (lead === NONE) copyWord(this.AR, this.word(resultsAddr));
        else this.addWord(this.AR, this.word(resultsAddr));
      }
    } while (still);
  }

  /** add_wordA_to_wordB: results of each pass accumulate as a list. */
  private addWord(a: Word, b: Word): void {
    if (b.type !== W.Features && b.type !== W.Props) {
      if (b.type !== W.Blank) clearWord(b);
      copyWord(a, b);
    } else if (b.type === W.Features && a.type === W.Features) {
      b.list!.push(...(a.list ?? []));
    } else if (b.type === W.Features && a.type === W.Props) {
      b.list!.push(...this.propFeatures(a.props ?? []));
    } else if (b.type === W.Props && a.type === W.Features) {
      b.type = W.Features;
      b.props = null;
      b.list = [...(a.list ?? [])];
    } else if (b.type === W.Props && a.type === W.Props) {
      b.props!.push(...(a.props ?? []));
    }
  }

  /** proplist_to_featurelist: the working world's features with any of the properties. */
  private propFeatures(props: number[]): Feature[] {
    const out: Feature[] = [];
    for (const p of props) for (const f of this.props.features(this.working, p)) out.push(f);
    return out;
  }

  /** The current sentence, disassembled (for traces and the debugger). */
  disassembleCurrent(): string {
    return disassembleSentence(this, this.word(this.COP).n, [
      this.word(this.CAS).n,
      this.word(this.CAT).n,
      this.word(this.CAR).n,
      this.word(this.CAD).n,
    ]);
  }

  // ---- stacks (cplib.c) ----

  push(w: Word): void {
    const c = new Word();
    copyWord(w, c);
    this.stack.push(c);
  }

  /** pop_off_CPL_stack. An empty stack was fatal in the original; here it gives a blank word. */
  pop(into?: Word, clearTarget = true): Word {
    const top = this.stack.pop();
    const out = into ?? new Word();
    if (clearTarget) setupWordBlank(out, W.Blank);
    else setupWord(out, W.Blank);
    if (top) copyWord(top, out);
    return out;
  }

  private pushControl(w: Word): void {
    if (this.control.length < CONTROL_STACK_SIZE - 1) this.control.push(cloneWord(w));
  }

  private popControl(into: Word): void {
    const w = this.control.pop();
    if (!w) throw new Error('CPL: empty control stack (JSR/RTS imbalance)');
    assignWord(w, into);
  }

  private pushOwner(): void {
    if (this.owners.length >= OWNER_STACK_SIZE) throw new Error('CPL: too many call levels deep');
    this.owners.push(this.currentOwner);
  }

  private popOwner(): void {
    if (this.owners.length === 0) throw new Error('CPL: empty owner stack (JSR/RTS imbalance)');
    this.currentOwner = this.owners.pop()!;
  }

  // ---- messages ----

  /** A feature's message queue (created on first use). */
  queue(f: Feature): Word[] {
    let q = this.queues.get(f);
    if (!q) this.queues.set(f, (q = []));
    return q;
  }

  /** The messages waiting for a feature, as words (for the inspector). */
  pending(f: Feature): readonly Word[] {
    return this.queues.get(f) ?? [];
  }

  /** enter_in_temp_message_block. */
  enterMessage(w: Word): void {
    const c = new Word();
    copyWord(w, c);
    if (this.messageBlock.length < MAX_MESSAGE_LENGTH) this.messageBlock.push(c);
  }

  /** queue_feature_message: the built message goes to the front or back of the feature's queue. */
  queueMessage(f: Feature | null, priority: boolean): void {
    if (f) {
      const q = this.queue(f);
      this.props.add(f, P.Msgpending);
      const words = this.messageBlock.map((w) => {
        const c = new Word();
        copyWord(w, c);
        return c;
      });
      if (priority) q.unshift(...words);
      else q.push(...words);
      this.restartParser = true;
    }
    this.resetMessageBlock = true;
  }

  /** message_block_reset. */
  messageBlockReset(): void {
    this.resetMessageBlock = false;
    this.messageBlock.length = 0;
  }

  /** A message straight to a feature, as stream_char_to_objects does. */
  send(f: Feature, words: Word[], priority: boolean): void {
    for (const w of words) this.enterMessage(w);
    this.queueMessage(f, priority);
    this.messageBlockReset();
  }

  // ---- opcodes (cplops.c) ----

  private execute(op: number): void {
    const fn = OPS[op];
    if (fn) fn(this);
  }

  /** execute_JUMP: the next frame starts at AD's address. */
  jump(): void {
    if (this.AD.type === W.Ptr) this.word(this.CNF).n = this.AD.n;
  }

  /** execute_JSR. */
  jsr(): void {
    const ret = new Word();
    ret.type = W.Ptr;
    ret.n = this.word(this.CNF).n;
    this.pushControl(ret);
    this.pushOwner();
    this.jump();
  }

  private emitJSRAT(op: number, data?: (w: Word) => void): void {
    const w = this.word(this.nextFreeJSRAT);
    blankout(w);
    if (data) data(w);
    else {
      w.type = W.Opcode;
      w.n = op;
    }
    this.nextFreeJSRAT = this.incBloc(this.nextFreeJSRAT, this.jsratBase, JSRAT_SIZE);
  }

  /** encode_one_JSR_pair: SETOWN feature; JSR code. */
  private encodeJsrPair(f: Feature, code: Address): void {
    this.emitJSRAT(Op.SETOWN);
    this.emitJSRAT(0, (w) => {
      setupAux(w, Aux.Owner);
      w.owner = f;
    });
    this.emitJSRAT(Op.JSR);
    this.emitJSRAT(0, (w) => {
      w.type = W.Ptr;
      w.n = code;
      w.addressOf = true;
    });
  }

  /** execute_JSRAT: builds a list of SETOWN/JSR pairs, one per feature with code, then calls it. */
  jsrat(): void {
    if (this.startJSRAT) {
      this.startOfJsrList = this.nextFreeJSRAT;
      this.startJSRAT = false;
    }
    if (this.AS.type !== W.Features || this.AD.type !== W.Aux) return;
    const f = first(this.AS);
    if (!f) return;
    if (this.codedOneJSR && this.finishJSRAT) {
      const w = this.word(this.nextFreeJSRAT);
      w.type = W.Opcode;
      w.n = Op.RTS;
      this.nextFreeJSRAT = this.jsratBase;
      this.codedOneJSR = false;
      setupWord(this.AD, W.Ptr);
      this.AD.n = this.startOfJsrList;
      this.jsr();
      return;
    }
    const kind = this.AD.int;
    if (kind === Code.Private) {
      const pc = this.privateCode(f);
      if (pc) {
        this.codedOneJSR = true;
        this.encodeJsrPair(f, pc);
      }
    } else if (kind === Code.Property) {
      let coded = false;
      for (const p of this.props.of(f)) {
        const code = this.props.code[p];
        if (code) {
          this.encodeJsrPair(f, code);
          this.codedOneJSR = true;
          coded = true;
        }
      }
      // Features no property code claimed run CPnormal.
      if (!coded || this.props.has(f, P.Forcedcpnormal)) {
        this.codedOneJSR = true;
        this.encodeJsrPair(f, this.cpnormal);
      }
    }
  }

  /** execute_RTS. */
  rts(): void {
    this.popControl(this.AD);
    this.popOwner();
    this.jump();
  }

  /** The motherobj of a feature (find_largergrain(f, Obj_type)). */
  mother(f: Feature): Feature | null {
    return f.type === T.Obj ? f : this.host.larger(f, T.Obj);
  }

  /** find_largergrain, with Const:Self (negative) meaning the feature itself. */
  larger(f: Feature, type: number): Feature | null {
    if (type < 0 || f.type === type) return f;
    return this.host.larger(f, type);
  }

  /** A feature's name for disassembly: its object's name. */
  featureName(f: object): string {
    const x = f as Feature;
    if (x.type === T.World) return this.host.name(x) ?? 'world';
    const o = this.mother(x);
    const n = o ? this.host.name(o) : null;
    return x.type === T.Obj ? (n ?? 'object') : `${n ?? 'object'}/${x.type}`;
  }

  /** Message names for disassembly. */
  messageName(n: number): string {
    return this.messages[n] ?? `#${n}`;
  }

  /** The names of a feature's properties, most recent first. */
  propNames(f: Feature): string[] {
    return this.props.of(f).map((p) => this.props.names[p] ?? `#${p}`);
  }

  /** Calls a C routine by index. */
  callCrtn(i: number): void {
    const fn = this.crtnFns[i];
    if (fn) fn(this);
  }

  /** Pops into a fresh word. */
  popWord(): Word {
    return this.pop();
  }

  /** Pushes a featurelist of these features ([Nil] if none). */
  pushFeatures(fs: (Feature | null)[]): void {
    const w = new Word();
    setupWord(w, W.Features);
    if (fs.length === 0) w.list!.push(null);
    for (const f of fs) addFeature(w.list!, f);
    this.push(w);
  }
}

// ---- the opcode routines ----

type OpFn = (vm: VM) => void;

const vec3 = (w: Word): [number, number, number] => {
  const v = w.offset;
  return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
};

/** aux_records_equal. */
function auxEqual(a: Word, b: Word): boolean {
  if (a.aux !== b.aux) return false;
  switch (a.aux) {
    case Aux.Int:
    case Aux.Crtn:
    case Aux.Codekind:
      return a.int === b.int;
    case Aux.Char:
      return a.char === b.char;
    case Aux.String:
      return (a.str ?? '') === (b.str ?? '');
    case Aux.Float:
      return a.float === b.float;
    case Aux.Boolean:
      return a.bool === b.bool;
    case Aux.Address:
    case Aux.Owner:
    case Aux.World:
      return a.ref === b.ref;
    case Aux.Color:
      return [0, 1, 2].every((i) => (a.vec?.[i] ?? 0) === (b.vec?.[i] ?? 0));
    case Aux.Update:
      return (a.vec?.[0] ?? 0) === (b.vec?.[0] ?? 0) && (a.vec?.[1] ?? 0) === (b.vec?.[1] ?? 0);
    case Aux.Rotate: {
      const x = a.vec ?? [];
      const y = b.vec ?? [];
      return (
        x[6] === y[6] && [0, 1, 2, 3, 4, 5].every((i) => Math.abs((x[i] ?? 0) - (y[i] ?? 0)) < 1e-2)
      );
    }
    case Aux.Offset:
      return [0, 1, 2].every((i) => Math.abs((a.offset[i] ?? 0) - (b.offset[i] ?? 0)) < 1e-2);
    default:
      // Scale, matrix, update-time and duplicate data compared equal (cplops.c: "oy vay").
      return true;
  }
}

function simpleField(w: Word): number {
  return w.n;
}

const OPS: Partial<Record<number, OpFn>> = {
  [Op.MOVE]: (vm) => copyWord(vm.AS, vm.AR),

  [Op.ADD]: (vm) => {
    const { AS, AT, AR } = vm;
    if (AS.type === W.Aux && AT.type === W.Aux) {
      if (AS.aux === Aux.Offset && AT.aux === Aux.Offset) {
        const a = vec3(AS);
        const b = vec3(AT);
        setupAux(AR, Aux.Offset);
        AR.offset = [a[0] + b[0], a[1] + b[1], a[2] + b[2], 1];
      } else if (AS.aux === Aux.Int && AT.aux === Aux.Int) {
        const v = AS.int + AT.int;
        setupAux(AR, Aux.Int);
        AR.int = v;
      } else if (AS.aux === Aux.Float && AT.aux === Aux.Float) {
        const v = AS.float + AT.float;
        setupAux(AR, Aux.Float);
        AR.float = v;
      }
    } else clearWord(AR);
  },

  [Op.CLEAR]: (vm) => clearWord(vm.AR),
  [Op.PUSH]: (vm) => vm.push(vm.AS),
  [Op.POP]: (vm) => vm.pop(vm.AR, false),
  [Op.WIPE]: (vm) => {
    vm.word(vm.AS.n).wiped = true;
  },
  [Op.UNWIPE]: (vm) => {
    vm.word(vm.AS.n).wiped = false;
  },

  [Op.AND]: (vm) => logic(vm, 'and'),
  [Op.OR]: (vm) => logic(vm, 'or'),
  [Op.NOT]: (vm) => logic(vm, 'not'),

  [Op.COUNT]: (vm) => {
    const { AS, AR } = vm;
    if (AS.type === W.Features) {
      const n = first(AS) === null ? 0 : (AS.list?.length ?? 0);
      setupAux(AR, Aux.Int);
      AR.int = n;
    } else clearWord(AR);
  },

  [Op.INDEX]: (vm) => {
    const { AS, AD, AR } = vm;
    if (AS.type === W.Features && AD.type === W.Aux && first(AS) !== null) {
      // get_elem_ptr counts from 1 (0 and 1 both give the first).
      const i = Math.max(1, AD.int);
      const f = AS.list![i - 1] ?? null;
      setupWord(AR, W.Features);
      addFeature(AR.list!, f);
    } else clearWord(AR);
  },

  [Op.HASPROP]: (vm) => {
    const { AS, AT, AD, AR } = vm;
    if (AS.type !== W.Features || AT.type !== W.Props) return;
    const f = first(AS);
    if (!f) {
      clearWord(AR);
      return;
    }
    const p = firstProp(AT);
    if (AD.int === SUBFEATURES) {
      const obj = vm.mother(f);
      setupWord(AR, W.Features);
      if (obj)
        for (const s of vm.host.subfeatures(obj)) if (vm.props.has(s, p)) addFeature(AR.list!, s);
      if (AR.list!.length === 0) clearWord(AR);
    } else if (vm.props.has(f, p)) copyWord(AS, AR);
    else clearWord(AR);
  },

  [Op.GETPROP]: (vm) => {
    const { AS, AT, AR } = vm;
    if (AS.type === W.Features && AT.type === W.Props) {
      const f = first(AS);
      const p = firstProp(AT);
      if (f && vm.props.has(f, p)) {
        // The original read the value from the feature in AR (a bug, fixable).
        const from = vm.fixes.getpropReadsAS ? f : first(AR);
        const v = from ? vm.props.get(from, p) : 0;
        if (v !== 0 && v !== undefined && v !== null) {
          setupWord(AR, W.Aux);
          if (typeof v === 'number') AR.long = v;
          else AR.ref = v;
          return;
        }
      }
    }
    clearWord(AR);
  },

  [Op.JUMP]: (vm) => vm.jump(),

  [Op.BEQUAL]: (vm) => {
    if (vm.AD.type !== W.Ptr) return;
    logic(vm, 'and');
    if (vm.AR.type === W.Features) {
      if (first(vm.AR)) vm.jump();
    } else if (vm.AR.type !== W.Blank) vm.jump();
  },

  [Op.BNEQUAL]: (vm) => {
    if (vm.AD.type !== W.Ptr) return;
    logic(vm, 'and');
    if (vm.AR.type === W.Blank) vm.jump();
    else if (vm.AR.type === W.Features && !first(vm.AR)) vm.jump();
  },

  [Op.BNEMPTY]: (vm) => {
    if (vm.AD.type === W.Ptr && vm.AS.type === W.Features && first(vm.AS)) vm.jump();
  },

  [Op.BEMPTY]: (vm) => {
    if (vm.AD.type !== W.Ptr) return;
    if (vm.AS.type === W.Blank) vm.jump();
    else if (vm.AS.type === W.Features) {
      if ((vm.AS.list?.length ?? 0) === 0 || !first(vm.AS)) vm.jump();
    }
  },

  [Op.BTRUE]: (vm) => {
    const { AS, AD } = vm;
    if (AD.type !== W.Ptr) return;
    if (AS.type === W.Features) {
      if (first(AS)) vm.jump();
    } else if (AS.type === W.Aux) {
      if (AS.bool) vm.jump();
    } else if (AS.type !== W.Blank) vm.jump();
  },

  [Op.BFALSE]: (vm) => {
    const { AS, AD } = vm;
    if (AD.type !== W.Ptr) return;
    if (AS.type === W.Blank) vm.jump();
    else if (AS.type === W.Features) {
      if (!first(AS)) vm.jump();
    } else if (AS.type === W.Aux) {
      if (AS.bytes.getUint8(0) === 0) vm.jump();
    }
  },

  [Op.BWIPED]: (vm) => {
    if (vm.AS.wiped) vm.jump();
  },

  [Op.OWNER]: (vm) => {
    const { AD, AR } = vm;
    if (AD.type === W.Aux && vm.currentOwner) {
      const f = vm.larger(vm.currentOwner, AD.int);
      setupWord(AR, W.Features);
      addFeature(AR.list!, f);
    } else clearWord(AR);
  },

  [Op.SETOWN]: (vm) => {
    if (vm.AD.owner) vm.currentOwner = vm.AD.owner;
  },

  [Op.MOTHER]: (vm) => {
    const { AS, AD, AR } = vm;
    const f = AS.type === W.Features && AD.type === W.Aux ? first(AS) : null;
    if (f) {
      const m = vm.larger(f, AD.int);
      setupWord(AR, W.Features);
      addFeature(AR.list!, m);
    } else clearWord(AR);
  },

  [Op.ANCEST]: (vm) => {
    const { AS, AR } = vm;
    const f = AS.type === W.Features ? first(AS) : null;
    const obj = f ? vm.mother(f) : null;
    if (obj) {
      setupWord(AR, W.Features);
      addFeature(AR.list!, vm.host.unlinkedAncestor(obj));
    } else clearWord(AR);
  },

  [Op.PARENT]: (vm) => {
    const { AS, AR } = vm;
    const f = AS.type === W.Features ? first(AS) : null;
    const obj = f ? vm.mother(f) : null;
    if (!obj) {
      clearWord(AR);
      return;
    }
    const parent = vm.host.parent(obj);
    const world = vm.host.worldOf(obj);
    if (world && parent === vm.host.worldRoot(world)) {
      setupAux(AR, Aux.World);
      AR.world = world;
    } else {
      setupWord(AR, W.Features);
      addFeature(AR.list!, parent);
    }
  },

  [Op.CHLDRN]: (vm) => {
    const { AS, AR } = vm;
    const f = AS.type === W.Features ? first(AS) : null;
    const obj = f ? vm.mother(f) : null;
    if (!obj) {
      clearWord(AR);
      return;
    }
    setupWord(AR, W.Features);
    const kids = vm.host.children(obj);
    if (kids.length === 0) addFeature(AR.list!, null);
    for (const k of kids) addFeature(AR.list!, k);
  },

  [Op.DESCEND]: (vm) => {
    const { AS, AR } = vm;
    let top: Feature | null;
    if (AS.type === W.Features) {
      const f = first(AS);
      if (!f) {
        clearWord(AR);
        return;
      }
      top = vm.mother(f);
    } else if (AS.type === W.Aux) {
      const w = AS.world;
      if (!w) return;
      top = vm.host.worldRoot(w);
    } else {
      clearWord(AR);
      return;
    }
    setupWord(AR, W.Features);
    if (top) descendants(vm, top, top, AR.list!);
    if (AR.list!.length === 0) addFeature(AR.list!, null);
  },

  [Op.SIBLING]: (vm) => {
    const { AS, AR } = vm;
    const f = AS.type === W.Features ? first(AS) : null;
    const obj = f ? vm.mother(f) : null;
    const parent = obj ? vm.host.parent(obj) : null;
    if (obj && parent) {
      setupWord(AR, W.Features);
      for (const k of vm.host.children(parent)) if (k !== obj) addFeature(AR.list!, k);
      if (AR.list!.length === 0) addFeature(AR.list!, null);
      return;
    }
    clearWord(AR);
  },

  [Op.MAKE]: (vm) => {
    const { AT, AD, AR } = vm;
    clearWord(AR);
    if (AD.type !== W.Aux) return;
    let parent: Feature | null = null;
    if (AT.type === W.Aux) parent = AT.world ? vm.host.worldRoot(AT.world) : null;
    else if (AT.type === W.Features) {
      const f = first(AT);
      parent = f ? vm.mother(f) : null;
    }
    if (!parent) return;
    const t = AD.int;
    if (t === T.Vfe || t === T.Evf || t === T.Fve || t === T.Shell || t === T.Obj) {
      setupWord(AR, W.Features);
      const o = vm.host.makeChild(parent);
      vm.props.del(o, P.Visible); // no updates until it's all done
      addFeature(AR.list!, o);
    }
  },

  [Op.BMSGS]: (vm) => {
    const f = vm.AS.type === W.Features ? first(vm.AS) : null;
    if (f && vm.props.has(f, P.Msgpending)) vm.jump();
  },

  [Op.BNOMSGS]: (vm) => {
    const f = vm.AS.type === W.Features ? first(vm.AS) : null;
    if (f && !vm.props.has(f, P.Msgpending)) vm.jump();
  },

  [Op.MAKEMSG]: (vm) => vm.enterMessage(vm.AS),

  [Op.QMSG]: (vm) => {
    const { AS, AD } = vm;
    if ((AS.type === W.Features || AS.type === W.Blank) && AD.type === W.Aux) {
      const f = AS.type === W.Blank ? null : first(AS);
      // queue_feature_message tests `priority == TRUE`.
      vm.queueMessage(f, AD.int === 1);
    }
  },

  [Op.UNQMSG]: (vm) => {
    const f = vm.currentOwner;
    if (f && vm.props.has(f, P.Msgpending)) {
      const q = vm.queue(f);
      const w = q.shift();
      setupWord(vm.AR, W.Blank);
      if (w) copyWord(w, vm.AR);
      if (q.length === 0) vm.props.del(f, P.Msgpending);
    } else clearWord(vm.AR);
  },

  [Op.CHKMSG]: (vm) => {
    const f = vm.currentOwner;
    if (f && vm.props.has(f, P.Msgpending)) {
      const w = vm.queue(f)[0];
      setupWord(vm.AR, W.Blank);
      if (w) copyWord(w, vm.AR);
    } else clearWord(vm.AR);
  },

  [Op.JSR]: (vm) => vm.jsr(),
  [Op.JSRAT]: (vm) => vm.jsrat(),
  [Op.RTS]: (vm) => vm.rts(),

  [Op.SETFR]: (vm) => vm.setFrame(vm.AS.n),

  [Op.CRTN]: (vm) => vm.callCrtn(vm.AD.int),

  [Op.TRANS]: (vm) => {
    const { AS, AT, AD } = vm;
    if (AS.type === W.Environment) {
      if (AS.n === Env.Crosshair_part) vm.host.translateCrosshair(vec3(AD));
    } else if (AS.type === W.Features) {
      const f = first(AS);
      if (!f) return;
      const off = vec3(AD);
      if (off.every((c) => c === 0)) return;
      vm.host.translate(f, off, AT.type === W.Aux && AT.bool);
    } else if (AS.type === W.Aux && AS.aux === Aux.World && AS.world) {
      const off = vec3(AD);
      if (off.some((c) => c !== 0)) vm.host.translate(vm.host.worldRoot(AS.world), off, false);
    }
  },

  [Op.ROTATE]: (vm) => {
    const { AS, AD } = vm;
    const r = AD.vec ?? [0, 0, 0, 0, 0, 0, 0];
    if (AS.type === W.Environment) {
      if (AS.n === Env.Room_part) {
        vm.host.rotateRoom(Math.trunc(r[0] ?? 0), Math.trunc(r[1] ?? 0));
        vm.host.globalUpdate(UF.Recomputebackfaceflag | UF.Redrawflag, false);
      }
      return;
    }
    let obj: Feature | null = null;
    if (AS.type === W.Features) {
      const f = first(AS);
      if (!f) return;
      obj = vm.mother(f);
    } else if (AS.type === W.Aux && AS.aux === Aux.World && AS.world)
      obj = vm.host.worldRoot(AS.world);
    if (!obj) return;
    vm.host.rotateObject(
      obj,
      [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0],
      [r[3] ?? 0, r[4] ?? 0, r[5] ?? 0],
      r[6] ?? 0,
    );
    if (vm.updateOn)
      vm.host.logUpdate(
        obj,
        UF.Transformflag |
          UF.Evfeqnsflag |
          UF.Cutevfsflag |
          UF.Clearcutsectionflag |
          UF.Makecutsectionflag |
          UF.Computebboxflag |
          UF.Recomputebackfaceflag |
          UF.Logerasebboxflag,
        true,
      );
  },

  [Op.SCALE]: (vm) => {
    const { AS, AD } = vm;
    const f = AS.type === W.Features ? first(AS) : null;
    const obj = f ? vm.mother(f) : null;
    if (!obj) return;
    vm.host.scaleObject(obj, AD.vec?.[0] ?? 1);
    if (vm.updateOn)
      vm.host.logUpdate(
        obj,
        UF.Evfeqnsflag |
          UF.Cutevfsflag |
          UF.Makecutsectionflag |
          UF.Recomputebackfaceflag |
          UF.Logerasebboxflag,
        false,
      );
  },

  [Op.TRNSFRM]: (vm) => {
    const { AS, AD, AR } = vm;
    if (AS.type === W.Aux) {
      // transformpt: the point [x, y, z, w] as a row vector times the matrix.
      const p = AS.offset;
      const m = AD.vec ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      const out = [0, 1, 2, 3].map(
        (j) =>
          (p[0] ?? 0) * m[j]! +
          (p[1] ?? 0) * m[4 + j]! +
          (p[2] ?? 0) * m[8 + j]! +
          (p[3] ?? 0) * m[12 + j]!,
      );
      setupAux(AR, Aux.Offset);
      AR.offset = out;
    }
  },

  [Op.CONCAT]: (vm) => {
    const { AS, AT, AR } = vm;
    if (AS.type === W.Aux && AT.type === W.Aux) {
      // glLoadMatrix(AS); glMultMatrix(AT) on row-major arrays: AT × AS.
      const a = AT.vec ?? [];
      const b = AS.vec ?? [];
      const out: number[] = [];
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          let s = 0;
          for (let k = 0; k < 4; k++) s += (a[i * 4 + k] ?? 0) * (b[k * 4 + j] ?? 0);
          out.push(s);
        }
      setupAux(AR, Aux.Matrix);
      AR.vec = out;
    }
  },

  [Op.DIFF3D]: (vm) => {
    const { AS, AT, AR } = vm;
    clearWord(AR);
    const point = (w: Word, plane: boolean): [number, number, number] | null => {
      if (w.type === W.Environment) {
        if (w.n === Env.Crosshair_part || (plane && w.n === Env.Cutplane_part))
          return vm.host.cursor();
        return null;
      }
      if (w.type === W.Features) {
        const f = first(w);
        return f ? vm.host.firstVertex(f) : null;
      }
      if (w.type === W.Aux) return vec3(w);
      return null;
    };
    const a = point(AS, true);
    if (!a) return;
    const b = point(AT, false);
    if (!b) return;
    setupAux(AR, Aux.Offset);
    AR.offset = [b[0] - a[0], b[1] - a[1], b[2] - a[2], 1];
  },

  [Op.SNAP]: (vm) => {
    const { AS, AT } = vm;
    if (
      (AS.type !== W.Environment && AS.type !== W.Features) ||
      (AT.type !== W.Environment && AT.type !== W.Features && AT.type !== W.Aux)
    )
      return;
    if (AS.type === W.Environment) {
      if (AS.n !== Env.Crosshair_part) return;
      const c = vm.host.cursor();
      if (AT.type === W.Features) {
        const f = first(AT);
        const v = f ? vm.host.firstVertex(f) : null;
        if (v) vm.host.nudgeCrosshair([v[0] - c[0], v[1] - c[1], v[2] - c[2]]);
      } else if (AT.type === W.Aux) vm.host.nudgeCrosshair(vec3(AT));
      return;
    }
    const f = first(AS);
    if (!f) return;
    if (AT.type === W.Environment || AT.type === W.Aux) {
      const obj = vm.mother(f);
      const from = vm.host.firstVertex(f);
      if (!obj || !from) return;
      let to: [number, number, number] | null = null;
      if (AT.type === W.Environment) {
        if (AT.n === Env.Crosshair_part) to = vm.host.cursor();
        else if (AT.n === Env.Cutplane_part) to = [from[0], from[1], vm.host.cursor()[2]];
      } else if (AT.aux === Aux.Offset) to = vec3(AT);
      if (to) vm.host.snapObject(obj, from, to);
    } else {
      const source = first(AT);
      if (source) vm.host.snapFeatures(source, f);
    }
  },

  [Op.WITHIN]: (vm) => {
    const { AS, AT, AR } = vm;
    if (AS.type === W.Features && AT.type === W.Features) {
      const a = first(AS);
      const b = first(AT);
      const o1 = a ? vm.mother(a) : null;
      const o2 = b ? vm.mother(b) : null;
      if (o1 && o2 && vm.host.within(o1, o2)) {
        setupWord(AR, W.Features);
        addFeature(AR.list!, o2);
        return;
      }
    }
    clearWord(AR);
  },

  [Op.GETNAME]: (vm) => {
    const { AS, AR } = vm;
    if (AS.type === W.Features) {
      const f = first(AS);
      const obj = f ? vm.mother(f) : null;
      if (obj) {
        setupAux(AR, Aux.String);
        AR.str = vm.host.name(obj);
      }
    } else clearWord(AR);
  },

  [Op.SETNAME]: (vm) => {
    const { AS, AD } = vm;
    if (AS.type === W.Features && AD.type === W.Aux) {
      const f = first(AS);
      const obj = f ? vm.mother(f) : null;
      if (obj) vm.host.setName(obj, AD.str);
    }
  },

  [Op.GETLABEL]: (vm) => {
    const { AS, AD, AR } = vm;
    if (AS.type === W.Features && AD.type === W.Aux) {
      const f = first(AS);
      const obj = f ? vm.mother(f) : null;
      if (obj && vm.props.has(obj, P.Haslabel)) {
        setupAux(AR, Aux.String);
        AR.str = vm.host.label(obj, AD.int);
      }
    } else clearWord(AR);
  },

  [Op.SETLABEL]: (vm) => {
    const { AS, AT, AD } = vm;
    if (AS.type === W.Features && AT.type === W.Aux && AD.type === W.Aux) {
      const f = first(AS);
      const obj = f ? vm.mother(f) : null;
      if (obj) vm.host.setLabel(obj, AD.int, AT.str);
    }
  },

  [Op.GETCOLOR]: (vm) => {
    const { AS, AR } = vm;
    if (AS.type === W.Features) {
      const f = first(AS);
      if (!f) {
        clearWord(AR);
        return;
      }
      setupAux(AR, Aux.Color);
      AR.vec = [...vm.host.color(f)];
    } else clearWord(AR);
  },

  [Op.SETCOLOR]: (vm) => {
    const { AS, AD } = vm;
    if (AS.type === W.Features && AD.type === W.Aux) {
      const f = first(AS);
      if (f) vm.host.setColor(f, [AD.vec?.[0] ?? 0, AD.vec?.[1] ?? 0, AD.vec?.[2] ?? 0]);
    }
  },

  [Op.AUX2STR]: (vm) => {
    const { AS, AR } = vm;
    if (AS.type === W.Aux) {
      setupWord(AR, W.Aux);
      if (AS.aux === Aux.Float) AR.str = AS.float.toFixed(2);
    } else clearWord(AR);
  },

  [Op.STR2AUX]: (vm) => {
    const { AS, AR } = vm;
    if (AS.type === W.Aux) {
      const s = AS.str;
      setupWord(AR, W.Aux);
      const m = s ? /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s) : null;
      AR.aux = Aux.Float;
      AR.float = m ? Math.fround(Number(m[0])) : 0;
    } else clearWord(AR);
  },

  [Op.ADDPROP]: (vm) => {
    const f = vm.AS.type === W.Features ? first(vm.AS) : null;
    if (f) vm.props.add(f, firstProp(vm.AD));
  },

  [Op.REMPROP]: (vm) => {
    const f = vm.AS.type === W.Features ? first(vm.AS) : null;
    if (f) {
      const p = firstProp(vm.AD);
      if (vm.props.has(f, p)) vm.props.del(f, p);
    }
  },

  [Op.SELECT]: (vm) => {
    const f = vm.AS.type === W.Features ? first(vm.AS) : null;
    if (f && !vm.props.has(f, P.Selectable)) {
      const obj = vm.mother(f);
      if (obj) vm.host.unselect(obj);
      vm.host.setSelectable(f);
    }
  },

  [Op.UNSEL]: (vm) => {
    const f = vm.AS.type === W.Features ? first(vm.AS) : null;
    if (f && vm.props.has(f, P.Selectable)) {
      const obj = vm.mother(f);
      if (obj) vm.host.unselect(obj);
    }
  },

  [Op.PICK]: (vm) => {
    const { AS } = vm;
    if (AS.type === W.Features) {
      const f = first(AS);
      if (f && !vm.props.has(f, P.Picked)) {
        vm.host.logUpdate(f, UF.Logerasebboxflag, true);
        vm.host.pick(f);
      }
    } else if (AS.type === W.Environment && AS.n === Env.Cutplane_part) vm.host.pickPlane();
  },

  [Op.RELEAS]: (vm) => {
    const { AS } = vm;
    if (AS.type === W.Features) {
      const f = first(AS);
      if (f && vm.props.has(f, P.Picked) && f.type !== T.Obj) vm.host.release(f);
    } else if (AS.type === W.Environment && AS.n === Env.Cutplane_part) vm.host.releasePlane();
  },

  [Op.MRELEAS]: (vm) => {
    const f = vm.AS.type === W.Features ? first(vm.AS) : null;
    if (f && vm.props.has(f, P.Picked) && f.type !== T.Obj) vm.host.release(f);
  },

  [Op.UNPICK]: (vm) => {
    const f = vm.AS.type === W.Features ? first(vm.AS) : null;
    if (f && vm.props.has(f, P.Picked)) {
      vm.host.logUpdate(f, UF.Logerasebboxflag, true);
      vm.host.unpick(f);
    }
  },

  [Op.MPICK]: (vm) => {
    const f = vm.AS.type === W.Features ? first(vm.AS) : null;
    if (f) {
      vm.host.logUpdate(f, UF.Logerasebboxflag, true);
      vm.host.pick(f);
    }
  },

  [Op.DUP]: (vm) => {
    const { AS, AR } = vm;
    const f = AS.type === W.Features ? first(AS) : null;
    const obj = f ? vm.mother(f) : null;
    if (!obj) return;
    const copy = vm.host.duplicate(obj);
    if (vm.updateOn)
      vm.host.logUpdate(
        copy,
        UF.Cutevfsflag | UF.Makecutsectionflag | UF.Findnormalsflag | UF.Getselectableflag,
        true,
      );
    setupWord(AR, W.Features);
    addFeature(AR.list!, copy);
  },

  [Op.CPDELETE]: (vm) => {
    const { AS } = vm;
    if (AS.type === W.Features) {
      const f = first(AS);
      if (f) vm.props.add(f, P.Killed);
    } else if (AS.type === W.Aux && AS.world) {
      for (const k of vm.host.children(vm.host.worldRoot(AS.world))) vm.props.add(k, P.Killed);
    }
  },

  [Op.CPBOOLEAN]: (vm) => {
    const { AS, AT, AD, AR } = vm;
    if (AS.type === W.Features && AT.type === W.Features && AD.type === W.Aux) {
      const b = first(AT);
      const ob = b && vm.mother(b);
      // New here: every object in AS, not just the first (the drill lets go on all it overlaps).
      const oa = [...new Set((AS.list ?? []).map((a) => (a ? vm.mother(a) : null)))].filter(
        (o): o is Feature => !!o && o !== ob,
      );
      if (!ob || oa.length === 0) return;
      setupWord(AR, W.Features);
      for (const r of vm.host.boolean(oa, ob, AD.int)) addFeature(AR.list!, r);
    } else clearWord(AR);
  },

  [Op.ADOPT]: (vm) => {
    const { AS, AT, AD } = vm;
    if (
      (AS.type === W.Features || AS.type === W.Environment || AS.type === W.Aux) &&
      (AT.type === W.Features || AT.type === W.Environment) &&
      AD.type === W.Aux
    ) {
      const c = AT.type === W.Features ? first(AT) : null;
      if (!c) return;
      let link = AD.bool;
      let parent: Feature | null = null;
      if (AS.type === W.Features) {
        const pf = first(AS);
        if (!pf) return;
        parent = vm.mother(pf);
      } else if (AS.type === W.Environment) {
        if (AS.n === Env.Crosshair_part) parent = vm.host.envObject('crosshair');
        else if (AS.n === Env.Cutplane_part) parent = vm.host.envObject('cutplane');
      } else {
        link = true; // adopting at a root is always linked
        parent = AS.world ? vm.host.worldRoot(AS.world) : null;
      }
      if (!parent) {
        link = true;
        parent = vm.host.worldRoot(vm.working);
      }
      const child = vm.mother(c);
      if (!child) return;
      vm.host.adopt(parent, child, link);
      vm.host.logUpdate(parent, UF.Computebboxflag, true);
    }
  },

  [Op.UNADOPT]: (vm) => {
    const f = vm.AS.type === W.Features ? first(vm.AS) : null;
    const child = f ? vm.mother(f) : null;
    if (!child) return;
    const world = vm.host.worldOf(child);
    if (world) vm.host.adopt(vm.host.worldRoot(world), child, false);
  },

  [Op.GETLINK]: (vm) => {
    const { AS, AR } = vm;
    if (AS.type === W.Features) {
      setupAux(AR, Aux.Boolean);
      const f = first(AS);
      const obj = f ? vm.mother(f) : null;
      AR.bool = obj ? vm.host.linked(obj) : false;
    }
  },

  [Op.UPDATE]: (vm) => {
    const { AS, AD } = vm;
    if (!vm.updateOn || AS.type !== W.Features || AD.type !== W.Aux) return;
    const f = first(AS);
    if (f) vm.host.logUpdate(f, AD.vec?.[0] ?? 0, (AD.vec?.[1] ?? 0) !== 0);
  },

  [Op.WTRANS]: (vm) => {
    const { AS, AT } = vm;
    if (AS.type === W.Features && AT.type === W.Aux) {
      const f = first(AS);
      const obj = f ? vm.mother(f) : null;
      const world = AT.world;
      if (obj && world) vm.host.adopt(vm.host.worldRoot(world), obj, true);
    }
  },

  [Op.WORLD]: (vm) => {
    if (vm.AD.type === W.Aux && vm.AD.world) vm.working = vm.AD.world;
  },

  [Op.GLUPDATE]: (vm) => {
    if (vm.AD.type === W.Aux)
      vm.host.globalUpdate(vm.AD.vec?.[0] ?? 0, (vm.AD.vec?.[1] ?? 0) !== 0);
  },

  [Op.CPSHADE]: (vm) => vm.host.toggleShade(),

  /**
   * CONNECT: the object in AS is connected to the object in AT (its Connection,
   * which GETCONN reads back). New here: the original's execute_CONNECT was an
   * empty stub; toolpad.cpl uses it to give each tool its own pad.
   */
  [Op.CONNECT]: (vm) => {
    const { AS, AT } = vm;
    if (AS.type !== W.Features || AT.type !== W.Features) return;
    const f = first(AS);
    const t = first(AT);
    const obj = f ? vm.mother(f) : null;
    const to = t ? vm.mother(t) : null;
    if (obj && to) vm.props.set(obj, P.Connection, to);
  },

  [Op.GETCONN]: (vm) => {
    const { AS, AR } = vm;
    const f = AS.type === W.Features ? first(AS) : null;
    const obj = f ? vm.mother(f) : null;
    if (obj && vm.props.has(obj, P.Connection)) {
      setupWord(AR, W.Features);
      const c = vm.props.get(obj, P.Connection);
      addFeature(AR.list!, (c as Feature) ?? null);
    } else clearWord(AR);
  },

  [Op.UPDATEON]: (vm) => {
    vm.updateOn = true;
  },
  [Op.UPDATEOFF]: (vm) => {
    vm.updateOn = false;
  },

  [Op.QUIT]: (vm) => {
    vm.quit = true;
    vm.host.quit();
  },

  [Op.DEBUG]: (vm) => {
    if (vm.AD.type === W.Aux) vm.debug = vm.AD.bool;
  },

  /**
   * SETCODE feature, source-string, Code:kind (new): attaches CPL source as the
   * feature's private code, or (Property_code) loads it as property code.
   * AR-less; failures leave the old code.
   */
  [Op.SETCODE]: (vm) => {
    const { AS, AT, AD } = vm;
    const src = AT.type === W.Aux ? AT.str : null;
    if (src === null) return;
    const text = src.endsWith('\n') ? src : src + '\n';
    try {
      if (AD.int === Code.Property) vm.loadPropertyCode(text, '(SETCODE)');
      else {
        const f = AS.type === W.Features ? first(AS) : null;
        if (f) vm.loadPrivateCode(f, text, '(SETCODE)');
      }
    } catch {
      // A bad edit never breaks a running world.
    }
  },
};

/** Post-order object descendants (get_descendent_features), not the top itself. */
function descendants(vm: VM, obj: Feature, top: Feature, out: (Feature | null)[]): void {
  for (const k of vm.host.children(obj)) descendants(vm, k, top, out);
  if (obj !== top) addFeature(out, obj);
}

/** AND, OR and NOT (execute_AND etc.): set tests between single features, properties or values. */
function logic(vm: VM, which: 'and' | 'or' | 'not'): void {
  const { AS, AT, AR } = vm;
  if (AS.type === W.Features && AT.type === W.Features) {
    const a = first(AS);
    const b = first(AT);
    if (which === 'and') {
      if (a === b && a !== null) {
        setupWord(AR, W.Features);
        addFeature(AR.list!, a);
      } else clearWord(AR);
    } else if (which === 'or') {
      if (a !== null || b !== null) {
        setupWord(AR, W.Features);
        if (a !== null) addFeature(AR.list!, a);
        if (b !== null) addFeature(AR.list!, b);
      } else clearWord(AR);
    } else if (a !== b && a !== null) {
      setupWord(AR, W.Features);
      addFeature(AR.list!, a);
    } else clearWord(AR);
    return;
  }
  if (AS.type === W.Props && AT.type === W.Props) {
    const a = firstProp(AS);
    const b = firstProp(AT);
    if (which === 'and') {
      if (a === b && a !== NOPROPERTY) {
        setupWord(AR, W.Props);
        AR.props![0] = a;
      } else clearWord(AR);
    } else if (which === 'or') {
      if (a !== NOPROPERTY || b !== NOPROPERTY) {
        setupWord(AR, W.Props);
        AR.props![0] = b !== NOPROPERTY ? b : a;
      } else clearWord(AR);
    } else if (a !== NOPROPERTY && b !== NOPROPERTY) {
      if (a !== b) {
        setupWord(AR, W.Props);
        AR.props![0] = a;
      } else clearWord(AR);
    } else nonList(vm, which);
    return;
  }
  nonList(vm, which);
}

function nonList(vm: VM, which: 'and' | 'or' | 'not'): void {
  const { AS, AT, AR } = vm;
  if (AS.type === W.Aux && AT.type === W.Aux) {
    if (which === 'or') assignWord(AS, AR);
    else if (auxEqual(AS, AT) === (which === 'and')) assignWord(AS, AR);
    else clearWord(AR);
    return;
  }
  if (AS.type === AT.type) {
    let copy: boolean;
    const a = simpleField(AS);
    const b = simpleField(AT);
    switch (AS.type) {
      case W.Opcode:
      case W.Message:
      case W.Environment:
      case W.Icon:
      case W.Ptr:
      case W.Handle:
        if (which === 'and') copy = a === b;
        else if (which === 'not') copy = a !== b;
        else if (AS.type === W.Message) copy = a !== -1 || b !== -1;
        else if (AS.type === W.Icon) copy = a !== 0 && b !== 0;
        else copy = a !== 0 || b !== 0;
        break;
      default:
        copy = false;
    }
    if (copy) assignWord(AS, AR);
    else clearWord(AR);
    return;
  }
  clearWord(AR);
}

/** update.h's flags. */
export const UF = {
  Transformflag: 1,
  Evfeqnsflag: 2,
  Cutevfsflag: 4,
  Transformcutevfsflag: 8,
  Clearcutsectionflag: 16,
  Makecutsectionflag: 32,
  Findnormalsflag: 64,
  Computeplanedistsflag: 128,
  Computebboxflag: 256,
  Cleartranslatesflag: 512,
  Getselectableflag: 1024,
  Getnearestptsflag: 2048,
  Recomputebackfaceflag: 4096,
  Findplanenearptsflag: 8192,
  Redrawflag: 16384,
  Logerasebboxflag: 32768,
} as const;
