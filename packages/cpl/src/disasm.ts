import { OPCODE_ARGS, OPCODE_NAMES, AS_ARG, AT_ARG, AR_ARG, AD_ARG } from './opcodes.ts';
import { Aux, CODEKIND_NAMES, ENV_NAMES, W, type Address, type Word } from './word.ts';

/** What disassembly needs to name things. */
export interface DisasmEnv {
  word(a: Address): Word;
  labelAt(a: Address): string | undefined;
  messageName(n: number): string;
  readonly props: { readonly names: readonly string[] };
  readonly crtnNames: readonly string[];
  /** A name for a feature (its object's name), for featurelists. */
  featureName?(f: object): string;
}

const fmt = (n: number, d = 1) => {
  const s = n.toFixed(d);
  return s === '-0.0' ? '0.0' : s;
};

/** disassemble_CPL_auxdata, readable rather than byte-exact. */
function auxText(env: DisasmEnv, w: Word): string {
  const v = w.vec ?? [];
  switch (w.aux) {
    case Aux.Int:
      return `Const:I${w.int}`;
    case Aux.Long:
      return `Const:I${w.long}`;
    case Aux.Char: {
      const c = w.char & 0xff;
      return c > 32 && c < 127
        ? `Const:A${String.fromCharCode(c)}`
        : `Const:A0x${c.toString(16).padStart(2, '0').toUpperCase()}`;
    }
    case Aux.String:
      return `Const:T[${w.str ?? ''}]`;
    case Aux.Float:
      return `Const:D${w.float}`;
    case Aux.Offset:
      return `Const:V[${fmt(w.offset[0] ?? 0)},${fmt(w.offset[1] ?? 0)},${fmt(w.offset[2] ?? 0)}]`;
    case Aux.Matrix: {
      const rows = [0, 1, 2, 3].map(
        (r) => `{${[0, 1, 2, 3].map((c) => fmt(v[r * 4 + c] ?? 0)).join(',')}}`,
      );
      return `Const:M[${rows.join(',')}]`;
    }
    case Aux.Boolean:
      return w.bool ? 'Const:TRUE' : 'Const:FALSE';
    case Aux.Address:
      return 'Const:P0';
    case Aux.Color:
      return `Const:C[${v[0] ?? 0},${v[1] ?? 0},${v[2] ?? 0}]`;
    case Aux.Update:
      return `Const:U${v[0] ?? 0}/when:${v[1] ? 'Now' : 'Later'}`;
    case Aux.Rotate:
      return `Const:Rvec:[${fmt(v[0] ?? 0)},${fmt(v[1] ?? 0)},${fmt(v[2] ?? 0)}]/pt:[${fmt(v[3] ?? 0)},${fmt(v[4] ?? 0)},${fmt(v[5] ?? 0)}]/ang:${v[6] ?? 0}`;
    case Aux.Scale:
      return `Const:S${v[0] ?? 1}`;
    case Aux.DuplicateDestroy:
      return 'Duplicatedestroy';
    case Aux.Owner: {
      const o = w.owner;
      return `Owner_feature:${o && env.featureName ? env.featureName(o) : o ? 'feature' : 'Nil'}`;
    }
    case Aux.Crtn:
      return `Crtn:${env.crtnNames[w.int] ?? `#${w.int}`}`;
    case Aux.Codekind:
      return `Code:${CODEKIND_NAMES[w.int] ?? w.int}`;
    case Aux.World: {
      const o = w.world;
      return `Const:W${o && env.featureName ? env.featureName(o) : 'Nil'}`;
    }
    default:
      return 'Const:?';
  }
}

/** disassemble_CPL_word. */
export function disassembleWord(env: DisasmEnv, w: Word | undefined): string {
  if (!w) return '';
  let s: string;
  switch (w.type) {
    case W.Blank:
      s = '(Blank)';
      break;
    case W.Opcode:
      s = OPCODE_NAMES[w.n] ?? `#${w.n}`;
      break;
    case W.Message:
      s = `Msg:${env.messageName(w.n)}`;
      break;
    case W.Ptr:
      s = `A:${env.labelAt(w.n) ?? `@${w.n}`}`;
      break;
    case W.Handle:
      s = `AA:${env.labelAt(w.n) ?? `@${w.n}`}`;
      break;
    case W.Aux:
      s = auxText(env, w);
      break;
    case W.Features: {
      const l = w.list ?? [];
      const f = l[0];
      const name = f ? (env.featureName?.(f) ?? 'feature') : 'Nil';
      s = `Featurelist:${name}${l.length > 1 ? `...(${l.length})` : ''}`;
      break;
    }
    case W.Props: {
      const p = w.props ?? [];
      s = `Prop:${env.props.names[p[0] ?? 0] ?? p[0]}${p.length > 1 ? '...' : ''}`;
      break;
    }
    case W.Environment:
      s = `Env:${ENV_NAMES[w.n] ?? w.n}`;
      break;
    default:
      s = '(Unknown)';
  }
  if (w.contentsOf) s += '*';
  else if (w.addressOf) s += '&';
  return s;
}

/** disassemble_CPL_sentence: `label  OPCODE  args` for the sentence at `op`. */
export function disassembleSentence(env: DisasmEnv, op: Address, args: Address[]): string {
  const label = env.labelAt(op) ?? '';
  const parts = args.filter((a) => a !== 0).map((a) => disassembleWord(env, env.word(a)));
  const w = env.word(op);
  return `${label.padEnd(16)}${disassembleWord(env, w).padEnd(10)}${parts.join(',')}${w.wiped ? '\t(*** WIPED ***)' : ''}`;
}

/** Disassembles `count` sentences from `start` (a listing for the debugger). */
export function disassemble(
  env: DisasmEnv,
  start: Address,
  count: number,
): { address: Address; text: string }[] {
  const out: { address: Address; text: string }[] = [];
  let a = start;
  for (let i = 0; i < count; i++) {
    const w = env.word(a);
    const need = w.type === W.Opcode ? (OPCODE_ARGS[w.n] ?? 0) : 0;
    const args: Address[] = [];
    let next = a + 1;
    for (const bit of [AS_ARG, AT_ARG, AR_ARG, AD_ARG]) args.push(need & bit ? next++ : 0);
    out.push({ address: a, text: disassembleSentence(env, a, args) });
    a = next;
  }
  return out;
}
