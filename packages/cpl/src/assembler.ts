import { OPCODE_ARGS, Op, argCount, lookupOpcode } from './opcodes.ts';
import type { Properties } from './props.ts';
import {
  Aux,
  CODEKIND_NAMES,
  ENV_NAMES,
  ICON_NAMES,
  T,
  W,
  setupAux,
  setupWord,
  type Address,
  type Feature,
  type Word,
} from './word.ts';

/**
 * The CPL assembler (cplread.c): reads CPL source a line at a time into
 * words of CPL memory. A line is
 *
 *     [label]  OPCODE  arg,arg,...   ; comment
 *
 * with the label in the first column. Arguments are `Type:name` symbols
 * (Opcd, Msg, Env, Icon, Prop, Crtn, Const, A, AA, Obj, Code), with a
 * trailing `*` (contents of) or `&` (address of). Labels starting with `_`
 * are local to their file. DEFPROP defines a property; STARTPROP starts
 * its property code.
 *
 * Where the original stopped the program on a bad line, this reports the
 * error with its line number and the caller keeps the code it had.
 */

export interface AsmError {
  file: string;
  /** 1-based. */
  line: number;
  message: string;
}

export class CplAssemblyError extends Error {
  constructor(readonly errors: AsmError[]) {
    super(errors.map((e) => `${e.file}:${e.line}: ${e.message}`).join('\n'));
  }
}

export interface SymbolRec {
  name: string;
  address: Address;
  /** The source unit (file) that defined it. */
  unit: string;
}

/** A pointer word that names a symbol, kept so a reloaded unit can relink it. */
export interface SymbolRef {
  address: Address;
  name: string;
  unit: string;
}

/** What the assembler needs from the machine it loads into. */
export interface AsmEnv {
  /** The (mutable) word at an address. */
  word(a: Address): Word;
  readonly props: Properties;
  /** lookup_CPL_message: the number of a message name, defining it if new. */
  message(name: string): number;
  /** The index of a C routine (Crtn) by name, or -1. */
  crtnIndex(name: string): number;
  findWorld(name: string): Feature | null;
  findObject(name: string): Feature | null;
  /** Global symbols, oldest first: find_symbol returns the first match. */
  readonly symbols: SymbolRec[];
  /** Local labels, for disassembly only (total_local_symbol_records). */
  readonly localSymbols: SymbolRec[];
  readonly symbolRefs: SymbolRef[];
  /** Obj: words whose object did not exist yet (CPL_forward_object_refs). */
  readonly objectRefs: { address: Address; name: string }[];
}

/** CPL_constnames, in constant_kind order. */
export const CONST_NAMES = [
  'Self',
  'Subfeatures',
  'Mothervfe',
  'Motherevf',
  'Motherfve',
  'Mothershell',
  'Motherobj',
  'Motherworld',
  'Prioritymsg',
  'Noprioritymsg',
  'Codeowner',
  'Quicktranslate',
  'Normaltranslate',
  'Boolunion',
  'Boolsubtract',
  'Boolintersect',
  'Origin',
  'x_axis',
  'y_axis',
  'z_axis',
  'imatrix',
  'Pickboxsize',
  'Rotateiconcentersize',
  'Alphabet',
  'Numeric',
  'Alphanumeric',
  'Asciiset',
] as const;

/** The constant_kind of Subfeatures, which HASPROP tests for. */
export const SUBFEATURES = 1;

/** user.h's Pkboxsize and rotatetool.h's Rotateiconctrsize. */
export const PKBOXSIZE = 10;
export const ROTATEICONCTRSIZE = PKBOXSIZE * 2;

/** The keyboard filter sets (cplread.c). */
export const CHAR_SETS = {
  Alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  Numeric: '+-1234567890.e',
  Alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+-1234567890. ',
  Asciiset:
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+-1234567890 .,`~!@#$%^&*()=_[]{}\\|;:/?<>',
} as const;

/** update.c's update flag names and values (cplread.c's update_names). */
export const UPDATE_FLAGS: Record<string, number> = (() => {
  const names = [
    'Transformflag',
    'Evfeqnsflag',
    'Cutevfsflag',
    'Transformcutevfsflag',
    'Clearcutsectionflag',
    'Makecutsectionflag',
    'Findnormalsflag',
    'Computeplanedistsflag',
    'Computebboxflag',
    'Cleartranslatesflag',
    'Getselectableflag',
    'Getnearestptsflag',
    'Recomputebackfaceflag',
    'Findplanenearptsflag',
    'Redrawflag',
    'Logerasebboxflag',
  ];
  const out: Record<string, number> = { Noupdateflag: 0 };
  names.forEach((n, i) => (out[n] = 1 << i));
  out['Allupdateflags'] =
    out['Transformflag']! |
    out['Evfeqnsflag']! |
    out['Cutevfsflag']! |
    out['Clearcutsectionflag']! |
    out['Makecutsectionflag']! |
    out['Findnormalsflag']! |
    out['Computebboxflag']! |
    out['Cleartranslatesflag']! |
    out['Getselectableflag']! |
    out['Getnearestptsflag']! |
    out['Recomputebackfaceflag']! |
    out['Findplanenearptsflag']! |
    out['Redrawflag']! |
    out['Logerasebboxflag']!;
  return out;
})();

/** boolean.h. */
export const BOOL_OP = { Union: 0, Subtraction: 1, Intersection: 2 } as const;

/** cpl_cutplane.h's Maxopcodes. */
export const MAX_OPCODES = 150;
const MAX_LABEL = 25;
const MAX_OPCODE = 15;
const MAX_SYMBOL = 256;
const MAX_LINE = 256;
const MAX_SYMBOLS_PER_INST = 5;

/** get_cpl_line: lines as the original read them (a last line with no newline is dropped). */
export function cplLines(source: string): string[] {
  const parts = source.split('\n');
  parts.pop(); // the text after the last newline never made it into a line
  return parts.map((l) => (/^[ \t]*\r?$/.test(l) ? '' : l));
}

/** read_CPL_string: the next token from `point`, or null at the end of the arguments. */
function readToken(
  line: string,
  point: number,
  max: number,
): { tok: string; point: number } | null {
  let p = point;
  while (line[p] === '\t' || line[p] === ' ' || line[p] === ',') p++;
  const c = line[p];
  if (c === undefined || c === ';' || c === '\r') return null;
  let tok = '';
  for (;;) {
    const ch = line[p];
    if (ch === undefined || ch === '\t' || ch === ' ' || ch === ',' || ch === ';' || ch === '\r')
      break;
    tok += ch;
    p++;
    if (tok.length === max) return { tok, point: p };
    if (line[p] === '[') {
      // A bracketed block (string, vector, matrix) is read whole, spaces and all.
      do {
        tok += line[p] ?? '';
        p++;
        if (tok.length === max) return { tok, point: p };
      } while (p < line.length && line[p] !== ']');
      if (p < line.length) {
        tok += line[p];
        p++;
      }
    }
  }
  return { tok, point: p };
}

/** sscanf-style %f/%d: the longest numeric prefix, as a number (0 if none). */
function scanNumber(s: string, integer = false): { v: number; rest: string } {
  const m = integer ? /^\s*[+-]?\d+/.exec(s) : /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s);
  if (!m) return { v: 0, rest: s };
  return { v: Number(m[0]), rest: s.slice(m[0].length) };
}

/** Numbers in a constant, in order (the separators in the sscanf formats are fixed text). */
function numbers(s: string, n: number): number[] {
  const out: number[] = [];
  const re = /[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/g;
  for (let m = re.exec(s); m && out.length < n; m = re.exec(s)) out.push(Number(m[0]));
  while (out.length < n) out.push(0);
  return out;
}

export interface AssembleOptions {
  /** Shown in errors. */
  file: string;
  /** The unit the global symbols belong to (normally the file); a reload replaces them. */
  unit?: string;
  /** Where to start loading. */
  at: Address;
  /** The feature whose private code this is (Const:Codeowner). */
  owner?: Feature | null;
  /** Stop after the first error (the default is to report them all). */
  firstErrorOnly?: boolean;
}

export interface AssembleResult {
  start: Address;
  /** The first address after the code. */
  end: Address;
  /** The property code started by the last STARTPROP, if any. */
  lastProperty: string | null;
  /** Global symbols this unit defined. */
  globals: SymbolRec[];
}

/** Assembles a source file (read_cplfile). Throws CplAssemblyError, having changed no symbols, on errors. */
export function assemble(env: AsmEnv, source: string, opts: AssembleOptions): AssembleResult {
  return new Assembly(env, opts).run(source);
}

/** Assembles one instruction line into RAM (encode_CPL_RAM_instruction). Returns the next free address. */
export function assembleLine(env: AsmEnv, line: string, at: Address): Address {
  const a = new Assembly(env, { file: '(RAM)', at });
  a.local = null;
  const end = a.line(line, at, 0);
  a.resolveForward();
  if (a.errors.length) throw new CplAssemblyError(a.errors);
  a.commit();
  return end;
}

class Assembly {
  readonly errors: AsmError[] = [];
  /** Local labels of this file; null outside a file (RAM lines). */
  local: SymbolRec[] | null = [];
  private readonly globals: SymbolRec[] = [];
  private readonly refs: SymbolRef[] = [];
  private readonly forward: { address: Address; name: string; line: number }[] = [];
  private readonly objectRefs: { address: Address; name: string }[] = [];
  private lastProperty: string | null = null;
  private readonly propertyCode: [string, Address][] = [];
  private readonly unit: string;

  constructor(
    private readonly env: AsmEnv,
    private readonly opts: AssembleOptions,
  ) {
    this.unit = opts.unit ?? opts.file;
  }

  run(source: string): AssembleResult {
    let at = this.opts.at;
    const lines = cplLines(source);
    for (let i = 0; i < lines.length; i++) {
      at = this.line(lines[i]!, at, i);
      if (this.errors.length && this.opts.firstErrorOnly) break;
    }
    this.resolveForward();
    if (this.errors.length) throw new CplAssemblyError(this.errors);
    this.commit();
    return { start: this.opts.at, end: at, lastProperty: this.lastProperty, globals: this.globals };
  }

  private error(line: number, message: string): void {
    this.errors.push({ file: this.opts.file, line: line + 1, message });
  }

  /** find_symbol: local labels first, then globals (this file's, then everyone's, oldest first). */
  private find(name: string): Address {
    const l = this.local?.find((s) => s.name === name);
    if (l) return l.address;
    const g = this.globals.find((s) => s.name === name);
    // A unit being reloaded shadows its own old symbols.
    const old = this.env.symbols.find((s) => s.name === name && s.unit !== this.unit);
    return (old ?? g)?.address ?? 0;
  }

  commit(): void {
    for (const [name, a] of this.propertyCode) this.env.props.defineCode(name, a);
    // A RAM line defines nothing else and is overwritten next frame: nothing to record.
    if (this.local === null) return;
    const syms = this.env.symbols;
    const mine = new Set(this.globals.map((s) => s.name));
    // Reloading a unit replaces its symbols (and relinks words that pointed at them).
    const replaced = new Map<string, Address>();
    for (let i = syms.length - 1; i >= 0; i--) {
      const s = syms[i]!;
      if (s.unit === this.unit) {
        if (mine.has(s.name)) replaced.set(s.name, s.address);
        syms.splice(i, 1);
      }
    }
    syms.push(...this.globals);
    for (const s of this.globals) {
      if (!replaced.has(s.name)) continue;
      for (const r of this.env.symbolRefs)
        if (r.name === s.name && r.unit !== this.unit) this.env.word(r.address).n = s.address;
    }
    this.env.localSymbols.push(...this.local);
    // Forget references held by the unit's old code; record the new ones.
    for (let i = this.env.symbolRefs.length - 1; i >= 0; i--)
      if (this.env.symbolRefs[i]!.unit === this.unit) this.env.symbolRefs.splice(i, 1);
    this.env.symbolRefs.push(...this.refs);
    this.env.objectRefs.push(...this.objectRefs);
  }

  resolveForward(): void {
    for (const f of this.forward) {
      const a = this.find(f.name);
      if (!a) this.error(f.line, `symbol ${f.name} unknown`);
      else this.env.word(f.address).n = a;
    }
  }

  /** read_cpl_line: one line into memory at `at`; returns the next free address. */
  line(text: string, at: Address, lineNo: number): Address {
    if (text.length > MAX_LINE) {
      this.error(lineNo, `line longer than ${MAX_LINE} characters`);
      return at;
    }
    const c0 = text[0];
    if (c0 === undefined || c0 === ';' || c0 === '\r') return at;
    let point = 0;
    let label = '';
    if (c0 !== '\t' && c0 !== ' ') {
      const t = readToken(text, 0, MAX_LABEL);
      label = t?.tok ?? '';
      point = t?.point ?? 0;
    }
    const opTok = readToken(text, point, MAX_OPCODE);
    if (!opTok) {
      if (label) this.error(lineNo, 'no opcode found');
      return at;
    }
    point = opTok.point;
    const op = lookupOpcode(opTok.tok);
    if (op < 0) {
      this.error(lineNo, `opcode ${opTok.tok} unknown`);
      return at;
    }

    const start = at;
    let noargs = false;
    if (op === Op.DEFPROP) {
      // A new property: no space, no symbol.
      if (this.env.props.find(label) === -1) this.env.props.defineNew(label);
      return at;
    }
    if (op === Op.STARTPROP) {
      // The property's code starts at the next word (given to the property once this assembles).
      if (this.env.props.find(label) === -1) this.env.props.defineNew(label);
      this.propertyCode.push([label, at]);
      this.lastProperty = label;
      if (label) this.addSymbol(label, at);
      return at;
    }
    const w = this.env.word(at);
    if (op === Op.CPLDATA) setupAux(w, Aux.Int);
    else if (op === Op.CPLPTR) setupWord(w, W.Ptr);
    else if (op === Op.CPLHANDLE) setupWord(w, W.Handle);
    else {
      w.type = W.Opcode;
      w.n = op;
      noargs = OPCODE_ARGS[op] === 0;
    }
    w.contentsOf = w.addressOf = false;
    at++;
    if (label) this.addSymbol(label, start);
    if (noargs) return at;

    let read = 0;
    for (let i = 0; i < MAX_SYMBOLS_PER_INST; i++) {
      const t = readToken(text, point, MAX_SYMBOL);
      if (!t) break;
      point = t.point;
      if (!this.symbol(t.tok, at, lineNo)) return at;
      at++;
      read++;
    }
    if (read !== argCount(op)) {
      this.error(lineNo, `${opTok.tok.toUpperCase()} takes ${argCount(op)} arguments, got ${read}`);
    }
    return at;
  }

  private addSymbol(name: string, address: Address): void {
    const rec = { name, address, unit: this.unit };
    if (name.startsWith('_') && this.local) this.local.push(rec);
    else this.globals.push(rec);
  }

  /** encode_CPL_symbol. False on an error that ends the line. */
  private symbol(tok: string, at: Address, lineNo: number): boolean {
    const w = this.env.word(at);
    const colon = tok.indexOf(':');
    if (colon < 0) {
      this.error(lineNo, `symbol ${tok} has no type`);
      return false;
    }
    const type = tok.slice(0, colon);
    let name = tok.slice(colon + 1);
    if (name.endsWith('*')) {
      w.contentsOf = true;
      name = name.slice(0, -1);
    } else if (name.endsWith('&')) {
      w.addressOf = true;
      name = name.slice(0, -1);
    } else w.contentsOf = w.addressOf = false;

    switch (type) {
      case 'Opcd': {
        // An unknown name (lightbulb.cpl tests Opcd:DELETE) was only logged: it gets
        // Maxopcodes, which no event ever has.
        const op = lookupOpcode(name);
        w.type = W.Opcode;
        w.n = op < 0 ? MAX_OPCODES : op;
        return true;
      }
      case 'Msg':
        w.type = W.Message;
        w.n = this.env.message(name);
        return true;
      case 'Env': {
        const i = ENV_NAMES.indexOf(name);
        if (i < 0) {
          this.error(lineNo, `unknown environment part ${name}`);
          return false;
        }
        w.type = W.Environment;
        w.n = i;
        return true;
      }
      case 'Icon': {
        const i = ICON_NAMES.indexOf(name);
        if (i < 0) {
          this.error(lineNo, `unknown icon ${name}`);
          return false;
        }
        w.type = W.Icon;
        w.n = i;
        return true;
      }
      case 'Prop': {
        const p = this.env.props.find(name);
        if (p < 0) {
          this.error(lineNo, `property ${name} unknown`);
          return false;
        }
        w.type = W.Props;
        w.props = [p];
        return true;
      }
      case 'Crtn': {
        const i = this.env.crtnIndex(name);
        if (i < 0) {
          this.error(lineNo, `C routine ${name} unknown`);
          return false;
        }
        w.type = W.Aux;
        w.aux = Aux.Crtn;
        w.int = i;
        return true;
      }
      case 'Const':
        return this.constant(name, w, lineNo);
      case 'A':
      case 'AA': {
        w.type = type === 'A' ? W.Ptr : W.Handle;
        w.n = this.find(name);
        if (!w.n) this.forward.push({ address: at, name, line: lineNo });
        if (!name.startsWith('_')) this.refs.push({ address: at, name, unit: this.unit });
        return true;
      }
      case 'Obj': {
        w.type = W.Features;
        const o = this.env.findObject(name);
        w.list = [o];
        if (!o) this.objectRefs.push({ address: at, name });
        return true;
      }
      case 'Code': {
        const i = CODEKIND_NAMES.indexOf(name);
        if (i < 0) {
          this.error(lineNo, `code kind ${name} unknown`);
          return false;
        }
        w.type = W.Aux;
        w.aux = Aux.Codekind;
        w.int = i;
        return true;
      }
      default:
        this.error(lineNo, `CPL symbol type ${type} unknown`);
        return false;
    }
  }

  /** encode_const_word. */
  private constant(name: string, w: Word, lineNo: number): boolean {
    w.type = W.Aux;
    const k = (CONST_NAMES as readonly string[]).indexOf(name);
    const bool = (v: boolean) => {
      w.bool = v;
      w.aux = Aux.Boolean;
    };
    const int = (v: number) => {
      w.int = v;
      w.aux = Aux.Int;
    };
    const offset = (v: number[]) => {
      w.offset = v;
      w.aux = Aux.Offset;
    };
    const str = (s: string) => {
      w.str = s;
      w.aux = Aux.String;
    };
    if (k >= 0) {
      switch (CONST_NAMES[k]) {
        case 'Prioritymsg':
        case 'Quicktranslate':
          bool(true);
          break;
        case 'Noprioritymsg':
        case 'Normaltranslate':
          bool(false);
          break;
        case 'Boolunion':
          int(BOOL_OP.Union);
          break;
        case 'Boolsubtract':
          int(BOOL_OP.Subtraction);
          break;
        case 'Boolintersect':
          int(BOOL_OP.Intersection);
          break;
        case 'Codeowner':
          w.owner = this.opts.owner ?? null;
          w.aux = Aux.Owner;
          break;
        case 'Self':
          int(-1);
          break;
        case 'Subfeatures':
          int(SUBFEATURES);
          break;
        case 'Mothervfe':
          int(T.Vfe);
          break;
        case 'Motherevf':
          int(T.Evf);
          break;
        case 'Motherfve':
          int(T.Fve);
          break;
        case 'Mothershell':
          int(T.Shell);
          break;
        case 'Motherobj':
          int(T.Obj);
          break;
        case 'Motherworld':
          int(T.World);
          break;
        case 'Origin':
          offset([0, 0, 0, 1]);
          break;
        case 'x_axis':
          offset([1, 0, 0, 1]);
          break;
        case 'y_axis':
          offset([0, 1, 0, 1]);
          break;
        case 'z_axis':
          offset([0, 0, 1, 1]);
          break;
        case 'imatrix':
          w.vec = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
          w.aux = Aux.Matrix;
          break;
        case 'Pickboxsize':
          w.float = PKBOXSIZE;
          w.aux = Aux.Float;
          break;
        case 'Rotateiconcentersize':
          w.float = ROTATEICONCTRSIZE;
          w.aux = Aux.Float;
          break;
        case 'Alphabet':
        case 'Numeric':
        case 'Alphanumeric':
        case 'Asciiset':
          str(CHAR_SETS[CONST_NAMES[k] as keyof typeof CHAR_SETS]);
          break;
      }
      return true;
    }
    if (name === 'TRUE') {
      bool(true);
      return true;
    }
    if (name === 'FALSE') {
      bool(false);
      return true;
    }
    const body = name.slice(1);
    switch (name[0]) {
      case 'A': {
        // An ASCII character; A0xYY gives one in hex.
        w.char = name.length > 2 ? parseInt(name.slice(3), 16) || 0 : name.charCodeAt(1) || 0;
        w.aux = Aux.Char;
        break;
      }
      case 'T': {
        // sscanf("[%s]"): the string runs to the first space and keeps the closing bracket.
        const m = /^\[\s*(\S*)/.exec(body);
        const s = m?.[1] ?? '';
        w.aux = Aux.String;
        w.str = s.length === 0 ? null : s;
        break;
      }
      case 'I':
        int(scanNumber(body, true).v);
        break;
      case 'D':
        w.float = scanNumber(body).v;
        w.aux = Aux.Float;
        break;
      case 'V':
        offset([...numbers(body, 3), 0]);
        break;
      case 'M':
        w.vec = numbers(body, 16).map(Math.fround);
        w.aux = Aux.Matrix;
        break;
      case 'P':
        w.ref = null;
        w.aux = Aux.Address;
        break;
      case 'S':
        w.vec = [Math.fround(scanNumber(body).v)];
        w.aux = Aux.Scale;
        break;
      case 'R': {
        // Rvec:[x,y,z]/pt:[x,y,z]/ang:tenths
        const m = /^vec:\[([^\]]*)\]\/pt:\[([^\]]*)\]\/ang:(.*)$/.exec(body);
        const v = numbers(m?.[1] ?? '', 3);
        const p = numbers(m?.[2] ?? '', 3);
        const a = scanNumber(m?.[3] ?? '', true).v;
        w.vec = [...v, ...p, a];
        w.aux = Aux.Rotate;
        break;
      }
      case 'W': {
        const wn = /^[A-z_]*/.exec(body)?.[0] ?? '';
        const world = this.env.findWorld(wn);
        w.world = world;
        w.aux = Aux.World;
        if (!world) {
          this.error(lineNo, `unknown world name ${wn}`);
          return false;
        }
        break;
      }
      case 'C': {
        w.vec = numbers(body, 3);
        w.aux = Aux.Color;
        break;
      }
      case 'U': {
        const slash = body.indexOf('/');
        if (slash < 0) {
          this.error(lineNo, 'UPDATE constant requires When');
          return false;
        }
        const flag = body.slice(0, slash);
        const when = body.slice(slash + 6);
        w.vec = [UPDATE_FLAGS[flag] ?? 0, when === 'Immediateupdate' || when === 'Now' ? 1 : 0];
        w.aux = Aux.Update;
        break;
      }
      default:
        // Unknown constants (Const:Environment_world in pan.cpl, say) load as empty data.
        break;
    }
    return true;
  }
}
