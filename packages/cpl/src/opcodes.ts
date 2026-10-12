/**
 * The opcode table (cplcore.c's opcoderecs, cpl_cutplane.h's opcodekind):
 * each opcode's name and which argument words follow it, always in the
 * order source, target, result, data.
 */

export const AS_ARG = 1;
export const AT_ARG = 2;
export const AR_ARG = 4;
export const AD_ARG = 8;

const S = AS_ARG;
const T = AT_ARG;
const R = AR_ARG;
const D = AD_ARG;

/** [name, args] in opcode-number order: the number is the index. */
const TABLE = [
  ['NOP', 0],
  ['CPLDATA', 0],
  ['CPLPTR', 0],
  ['CPLHANDLE', 0],
  ['MOVE', S | R],
  ['ADD', S | T | R],
  ['CLEAR', R],
  ['PUSH', S],
  ['POP', R],
  ['WIPE', S],
  ['UNWIPE', S],

  ['AND', S | T | R],
  ['OR', S | T | R],
  ['NOT', S | T | R],
  ['COUNT', S | R],
  ['INDEX', S | R | D],

  ['BEQUAL', S | T | D],
  ['BNEQUAL', S | T | D],
  ['BEMPTY', S | D],
  ['BNEMPTY', S | D],
  ['BTRUE', S | D],
  ['BFALSE', S | D],
  ['BWIPED', S | D],

  ['OWNER', R | D],
  ['SETOWN', D],
  ['MOTHER', S | R | D],
  ['ANCEST', S | R],
  ['DESCEND', S | R],
  ['PARENT', S | R],
  ['CHLDRN', S | R],
  ['SIBLING', S | R],
  ['MAKE', T | R | D],

  ['BMSGS', S | D],
  ['BNOMSGS', S | D],
  ['MAKEMSG', S],
  ['QMSG', S | D],
  ['UNQMSG', R],
  ['CHKMSG', R],

  ['JSR', D],
  ['JSRAT', S | D],
  ['RTS', 0],
  ['JUMP', D],

  ['SETFR', S],
  ['ENDFR', 0],

  ['CRTN', D],

  ['TRANS', S | T | D],
  ['ROTATE', S | D],
  ['SCALE', S | D],
  ['TRNSFRM', S | R | D],
  ['CONCAT', S | T | R],
  ['DIFF3D', S | T | R],
  ['SNAP', S | T],
  ['WITHIN', S | T | R],

  ['GETNAME', S | R],
  ['SETNAME', S | D],
  ['GETLABEL', S | R | D],
  ['SETLABEL', S | T | D],

  ['GETCOLOR', S | R],
  ['SETCOLOR', S | D],

  ['AUX2STR', S | R],
  ['STR2AUX', S | R],

  ['HASPROP', S | T | R | D],
  ['GETPROP', S | T | R],
  ['ADDPROP', S | D],
  ['REMPROP', S | D],

  ['SELECT', S],
  ['UNSEL', S],
  ['PICK', S],
  ['RELEAS', S],
  ['UNPICK', S],
  ['DBLPIC', S],
  ['MPICK', S],
  ['MRELEAS', S],

  ['DUP', S | R],
  ['DUPCPL', S | R],

  ['CPDELETE', S],
  ['CPBOOLEAN', S | T | R | D],

  ['ADOPT', S | T | D],
  ['UNADOPT', S],
  ['GETLINK', S | R],

  ['WORLD', D],
  ['WTRANS', S | T],
  ['UPDATE', S | D],
  ['GLUPDATE', D],
  ['CPSHADE', S],

  ['CONNECT', S | T | D],
  ['GETCONN', S | R],

  ['RECON', S | D],
  ['RECOFF', S],
  ['UPDATEON', 0],
  ['UPDATEOFF', 0],

  ['QUIT', 0],

  ['DEBUG', D],

  ['DEFPROP', 0],
  ['STARTPROP', 0],

  // New in this port (PLAN.md §8.5): attach code to a feature at run time.
  ['SETCODE', S | T | D],
] as const;

export type OpcodeName = (typeof TABLE)[number][0];

export const OPCODE_NAMES: readonly string[] = TABLE.map(([n]) => n);
export const OPCODE_ARGS: readonly number[] = TABLE.map(([, a]) => a);

/** Opcode numbers by name: `Op.PICK`. */
export const Op = Object.fromEntries(TABLE.map(([n], i) => [n, i])) as {
  readonly [K in OpcodeName]: number;
};

/** The opcode number for a name (any case), or -1. */
export function lookupOpcode(name: string): number {
  return OPCODE_NAMES.indexOf(name.toUpperCase());
}

/** How many argument words follow an opcode. */
export function argCount(op: number): number {
  const a = OPCODE_ARGS[op] ?? 0;
  return (a & 1) + ((a >> 1) & 1) + ((a >> 2) & 1) + ((a >> 3) & 1);
}
