/**
 * The CPL word (cpl_cutplane.h's CPL_word): one tagged cell of CPL memory.
 * A word is an opcode, a message, an environment part, a pointer or handle
 * to another word, immediate "auxiliary" data, or a list of features or
 * properties, plus three flags: contents-of (`*`), address-of (`&`) and
 * wiped (the instruction will not execute).
 *
 * The original's word is a C union, and CPL code leans on that: a word set
 * up as an integer is tested as a Boolean, a Boolean is read as a message
 * priority. Scalar auxiliary data therefore lives in an 8-byte buffer read
 * through whichever field the C code reads (`int`, `bool`, `char`,
 * `double`...), so those reinterpretations behave as they did.
 */

/** word_type (CPLwordkind). Order matters: copies treat types up to Aux as plain values. */
export const W = {
  Blank: 0,
  Opcode: 1,
  Message: 2,
  Environment: 3,
  Icon: 4,
  Ptr: 5,
  Handle: 6,
  Aux: 7,
  Features: 8,
  Props: 9,
} as const;

/** aux_kind (auxdatakind). */
export const Aux = {
  None: 0,
  Int: 1,
  Long: 2,
  Char: 3,
  String: 4,
  Float: 5,
  Offset: 6,
  Matrix: 7,
  Boolean: 8,
  Address: 9,
  Color: 10,
  Update: 11,
  Rotate: 12,
  Scale: 13,
  DuplicateDestroy: 14,
  Owner: 15,
  Crtn: 16,
  UpdateTime: 17,
  CutplaneShade: 18,
  Codekind: 19,
  World: 20,
} as const;

/** environmentkind. */
export const Env = {
  Nothingness: 0,
  Crosshair_part: 1,
  Cutplane_part: 2,
  Room_part: 3,
  Universe_part: 4,
} as const;
export const ENV_NAMES = [
  'Nothingness',
  'Crosshair_part',
  'Cutplane_part',
  'Room_part',
  'Universe_part',
];

export const ICON_NAMES = ['Noicon', 'Rotateicon', 'Planecontrasticon', 'Helpicon'];

/** codekind. */
export const Code = { None: 0, Private: 1, Property: 2 } as const;
export const CODEKIND_NAMES = ['Nocodekind', 'Private_code', 'Property_code'];

/**
 * Topology type ids (topology.h). CPL constants such as Const:Motherobj
 * carry these numbers, and opcodes test features' types against them.
 */
export const T = {
  Vfe: 8,
  Evf: 9,
  Le: 10,
  Bound: 11,
  Fve: 12,
  Shell: 13,
  Obj: 14,
  World: 15,
} as const;

/** Anything a featurelist can hold: a vertex, edge, face, shell, object or world. */
export interface Feature {
  /** One of the T type ids. */
  readonly type: number;
}

/** A word address in CPL memory; 0 is Nil. */
export type Address = number;

export class Word {
  type: number = W.Blank;
  /** Opcode, message, environment part or icon number; or the address a pointer or handle holds. */
  n = 0;
  list: (Feature | null)[] | null = null;
  props: number[] | null = null;
  aux: number = Aux.None;
  /** The scalar members of the auxiliary union (int, long, char, Boolean, double...). */
  readonly bytes = new DataView(new ArrayBuffer(8));
  /** Pointer members of the auxiliary union: a string, owner feature, world, or other value. */
  ref: unknown = null;
  /**
   * Array members of the auxiliary union: an offset [x, y, z, w], a matrix (16, row-major),
   * a colour [r, g, b], rotate data [vx, vy, vz, px, py, pz, angle], update data
   * [flags, now], scale data [factor].
   */
  vec: number[] | null = null;
  contentsOf = false;
  addressOf = false;
  wiped = false;

  // ---- the scalar fields of CPLauxunion ----

  get int(): number {
    return this.bytes.getInt32(0, true);
  }
  set int(v: number) {
    this.bytes.setInt32(0, v, true);
  }
  get long(): number {
    return Number(this.bytes.getBigInt64(0, true));
  }
  set long(v: number) {
    this.bytes.setBigInt64(0, BigInt(Math.trunc(v)), true);
  }
  get char(): number {
    return this.bytes.getInt8(0);
  }
  set char(v: number) {
    this.bytes.setInt8(0, v);
  }
  /** Boolean is an unsigned char: TRUE is 1. */
  get bool(): boolean {
    return this.bytes.getUint8(0) === 1;
  }
  set bool(v: boolean) {
    this.bytes.setUint8(0, v ? 1 : 0);
  }
  get float(): number {
    return this.bytes.getFloat64(0, true);
  }
  set float(v: number) {
    this.bytes.setFloat64(0, v, true);
  }

  // ---- the pointer fields, all sharing `ref` ----

  get str(): string | null {
    return typeof this.ref === 'string' ? this.ref : null;
  }
  set str(v: string | null) {
    this.ref = v;
  }
  get owner(): Feature | null {
    return isFeature(this.ref) ? this.ref : null;
  }
  set owner(v: Feature | null) {
    this.ref = v;
  }
  get world(): Feature | null {
    const r = this.ref;
    return isFeature(r) && r.type === T.World ? r : null;
  }
  set world(v: Feature | null) {
    this.ref = v;
  }

  /** The offset (vertype) member. */
  get offset(): number[] {
    return (this.vec ??= [0, 0, 0, 0]);
  }
  set offset(v: readonly number[]) {
    this.vec = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0];
  }
}

export function isFeature(x: unknown): x is Feature {
  return typeof x === 'object' && x !== null && typeof (x as Feature).type === 'number';
}

/** blankout_CPL_word: a blank word with its data zeroed (aux_kind is left alone, as in C). */
export function blankout(w: Word): void {
  w.type = W.Blank;
  w.n = 0;
  w.list = null;
  w.props = null;
  w.bytes.setBigUint64(0, 0n);
  w.ref = null;
  w.vec = null;
  w.contentsOf = w.addressOf = w.wiped = false;
}

/** clear_word: back to Blank_word. The auxiliary data stays behind, as it did. */
export function clearWord(w: Word): void {
  switch (w.type) {
    case W.Opcode:
      w.n = 0;
      break;
    case W.Message:
      w.n = -1;
      break;
    case W.Environment:
    case W.Icon:
    case W.Ptr:
    case W.Handle:
      w.n = 0;
      break;
    case W.Features:
      w.list = null;
      break;
    case W.Props:
      w.props = null;
      break;
  }
  w.type = W.Blank;
  w.contentsOf = w.addressOf = w.wiped = false;
}

/** The whole word, data and flags, as C's struct assignment `b = a` does. */
export function assignWord(a: Word, b: Word): void {
  b.type = a.type;
  b.n = a.n;
  b.list = a.list;
  b.props = a.props;
  b.aux = a.aux;
  b.bytes.setBigUint64(0, a.bytes.getBigUint64(0));
  b.ref = a.ref;
  b.vec = a.vec ? [...a.vec] : null;
  b.contentsOf = a.contentsOf;
  b.addressOf = a.addressOf;
  b.wiped = a.wiped;
}

/** copy_wordA_to_wordB: lists are cloned; everything else is copied whole. */
export function copyWord(a: Word, b: Word): void {
  if (b.type !== W.Blank) clearWord(b);
  if (a.type <= W.Aux) assignWord(a, b);
  else if (a.type === W.Features) {
    b.type = W.Features;
    b.list = [...(a.list ?? [])];
  } else if (a.type === W.Props) {
    b.type = W.Props;
    b.props = [...(a.props ?? [])];
  }
}

export function cloneWord(a: Word): Word {
  const w = new Word();
  assignWord(a, w);
  if (w.list) w.list = [...w.list];
  if (w.props) w.props = [...w.props];
  return w;
}

/** NOPROPERTY: the property index meaning "none". */
export const NOPROPERTY = 0;

/** setup_CPL_word: cleared, then made an empty list or a blank word of the given type. */
export function setupWord(w: Word, type: number): void {
  clearWord(w);
  w.type = type;
  if (type === W.Features) w.list = [];
  else if (type === W.Props) w.props = [NOPROPERTY];
}

/** setup_CPL_word_blank. */
export function setupWordBlank(w: Word, type: number): void {
  blankout(w);
  setupWord(w, type);
}

/** setup_CPL_auxword. */
export function setupAux(w: Word, kind: number): void {
  blankout(w);
  setupWord(w, W.Aux);
  w.aux = kind;
}

// ---- small constructors ----

export function featuresWord(...fs: (Feature | null)[]): Word {
  const w = new Word();
  setupWord(w, W.Features);
  w.list!.push(...fs);
  return w;
}

export function propWord(prop: number, contentsOf = false): Word {
  const w = new Word();
  setupWord(w, W.Props);
  w.props![0] = prop;
  w.contentsOf = contentsOf;
  return w;
}

export function opcodeWord(op: number): Word {
  const w = new Word();
  w.type = W.Opcode;
  w.n = op;
  return w;
}

export function messageWord(msg: number): Word {
  const w = new Word();
  w.type = W.Message;
  w.n = msg;
  return w;
}

export function envWord(part: number): Word {
  const w = new Word();
  w.type = W.Environment;
  w.n = part;
  return w;
}

export function ptrWord(
  address: Address,
  flags: { contentsOf?: boolean; addressOf?: boolean } = {},
): Word {
  const w = new Word();
  w.type = W.Ptr;
  w.n = address;
  w.contentsOf = flags.contentsOf ?? false;
  w.addressOf = flags.addressOf ?? false;
  return w;
}

export function intWord(v: number): Word {
  const w = new Word();
  setupAux(w, Aux.Int);
  w.int = v;
  return w;
}

export function boolWord(v: boolean): Word {
  const w = new Word();
  setupAux(w, Aux.Boolean);
  w.bool = v;
  return w;
}

export function floatWord(v: number): Word {
  const w = new Word();
  setupAux(w, Aux.Float);
  w.float = v;
  return w;
}

export function charWord(c: number): Word {
  const w = new Word();
  setupAux(w, Aux.Char);
  w.char = c;
  return w;
}

export function stringWord(s: string | null): Word {
  const w = new Word();
  setupAux(w, Aux.String);
  w.str = s;
  return w;
}

export function offsetWord(v: readonly number[]): Word {
  const w = new Word();
  setupAux(w, Aux.Offset);
  w.offset = v;
  return w;
}

export function colorWord(rgb: readonly number[]): Word {
  const w = new Word();
  setupAux(w, Aux.Color);
  w.vec = [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0];
  return w;
}

export function worldWord(world: Feature | null): Word {
  const w = new Word();
  setupAux(w, Aux.World);
  w.world = world;
  return w;
}

/** The first element of a featurelist word, or null (empty lists and Nil entries alike). */
export function first(w: Word): Feature | null {
  return w.list?.[0] ?? null;
}

/** The first property of a proplist word. */
export function firstProp(w: Word): number {
  return w.props?.[0] ?? NOPROPERTY;
}
