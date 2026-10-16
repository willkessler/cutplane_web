import { defName, latin1, type Field, type Value, type VNode } from './inventor.ts';
import { INVENTOR_FIELDS } from './inventorfields.ts';

/**
 * Binary Open Inventor (V1.0, V2.0, V2.1), read into the same nodes the text
 * formats give (see inventor.ts). Big-endian throughout, every value at least
 * four bytes. A node is its type's name (a string: a length and its bytes,
 * padded to four), in V2.1 a flags word (2: a group), then a word holding how
 * many fields follow (and 0x40 above them if the node describes its own field
 * types, as nodes Inventor doesn't know do), each field its name, its value
 * and a flags word; then a group's number of children, and its children.
 * DEF and USE are written as words, as in text. Built-in nodes don't say
 * their fields' types: those come from INVENTOR_FIELDS.
 */

/** Node type → field name → field type, and whether it's a group. */
let table: Map<string, { group: boolean; fields: Map<string, string> }> | null = null;
function known() {
  if (table) return table;
  table = new Map();
  for (const line of INVENTOR_FIELDS.split('\n')) {
    const [head, ...fields] = line.trim().split(' ');
    if (!head) continue;
    const group = head.endsWith('+');
    table.set(group ? head.slice(0, -1) : head, {
      group,
      fields: new Map(fields.map((f) => f.split(':') as [string, string])),
    });
  }
  return table;
}

/** Field types of fixed size: how many numbers, and of what. */
const NUMBERS: Record<string, [number, 'f32' | 'f64' | 'i32' | 'u32']> = {
  Float: [1, 'f32'], Int32: [1, 'i32'], UInt32: [1, 'u32'], Short: [1, 'i32'], UShort: [1, 'u32'],
  Vec2f: [2, 'f32'], Vec3f: [3, 'f32'], Vec4f: [4, 'f32'], Color: [3, 'f32'], Rotation: [4, 'f32'],
  Matrix: [16, 'f32'], Plane: [4, 'f32'], Vec2s: [2, 'i32'], Vec2i32: [2, 'i32'],
  Vec3i32: [3, 'i32'], Vec4i32: [4, 'i32'], Vec3d: [3, 'f64'], Vec2d: [2, 'f64'],
  Vec4d: [4, 'f64'], Double: [1, 'f64'], Time: [1, 'f64'],
}; // prettier-ignore

const IS_GROUP = 2;
const NOT_BUILTIN = 0x40;
const CONNECTED = 0x2; // a field's flag: its value comes from an engine or another field

export function parseBinary(bytes: Uint8Array, progress?: (f: number) => void): VNode[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nl = bytes.indexOf(10);
  const header = latin1(bytes.subarray(0, nl));
  const version = Number(/V(\d+\.\d+)/.exec(header)?.[1] ?? 2.1);
  let at = (nl + 4) & ~3; // past the header's line, to a word
  let reported = 0;
  const defs = new Map<string, VNode>();

  const fail = (what: string): never => {
    throw new Error(`binary Inventor: ${what} (at byte ${at})`);
  };
  const need = (n: number) => {
    if (at + n > bytes.length) fail('the file ends too soon');
  };
  const u32 = () => {
    need(4);
    const v = dv.getUint32(at);
    at += 4;
    return v;
  };
  const string = () => {
    const n = u32();
    need(n);
    const s = latin1(bytes.subarray(at, at + n));
    at += (n + 3) & ~3;
    return s;
  };
  const numbers = (count: number, kind: 'f32' | 'f64' | 'i32' | 'u32'): Float64Array => {
    const size = kind === 'f64' ? 8 : 4;
    need(count * size);
    const out = new Float64Array(count);
    for (let k = 0; k < count; k++, at += size)
      out[k] =
        kind === 'f32'
          ? dv.getFloat32(at)
          : kind === 'f64'
            ? dv.getFloat64(at)
            : kind === 'i32'
              ? dv.getInt32(at)
              : dv.getUint32(at);
    return out;
  };

  /** One field's value, as the text reader would have it. */
  const value = (type: string, field: string, node: string): Field => {
    const multi = type.startsWith('MF');
    const base = type.slice(2);
    const fixed = NUMBERS[base];
    if (fixed) return numbers(multi ? u32() * fixed[0] : fixed[0], fixed[1]);
    const count = multi ? u32() : 1;
    const out: Value[] = [];
    for (let k = 0; k < count; k++) {
      switch (base) {
        case 'String':
        case 'Name':
        case 'Enum':
          out.push(string());
          break;
        case 'Bool':
          out.push(u32() ? 'TRUE' : 'FALSE');
          break;
        case 'BitMask':
          // Its flags' names, ended by an empty one.
          for (let s = string(); s; s = string()) out.push(s);
          break;
        case 'Image': {
          // Width, height, components, then the pixels a byte each, padded to a word;
          // kept as the text form has them (one number a pixel).
          const [w, h, c] = numbers(3, 'u32') as unknown as [number, number, number];
          const n = w * h;
          need(n * c);
          out.push(w, h, c);
          for (let p = 0; p < n; p++) {
            let v = 0;
            for (let j = 0; j < c; j++) v = v * 256 + bytes[at + p * c + j]!;
            out.push(v);
          }
          at += (n * c + 3) & ~3;
          break;
        }
        case 'Node': {
          const n = node1();
          if (n) out.push(n);
          break;
        }
        default:
          fail(`can't read ${node}'s field ${field} (of type ${type})`);
      }
    }
    return out;
  };

  /** A node, or null for NULL (an empty SFNode). */
  const node1 = (): VNode | null => {
    if (progress && at - reported > 1 << 20) {
      reported = at;
      progress(at / bytes.length);
    }
    let type = string();
    if (type === 'NULL') return null;
    if (type === 'USE') {
      const name = string();
      return defs.get(name) ?? { type: 'Group', fields: new Map(), children: [] };
    }
    let name: string | undefined;
    if (type === 'DEF') {
      name = string();
      type = string();
    }
    const shown = name && defName(name);
    const n: VNode = { type, fields: new Map(), children: [], ...(shown ? { name: shown } : {}) };
    if (name) defs.set(name, n);
    const builtin = known().get(type);
    const flags = version > 2 ? u32() : 0;
    const word = u32();
    const count = word & 0xff;
    let types = builtin?.fields;
    if ((word >> 8) & NOT_BUILTIN) {
      types = new Map(types);
      for (let k = 0; k < count; k++) {
        let t = string();
        if (['field', 'exposedField', 'eventIn', 'eventOut'].includes(t)) t = string();
        types.set(string(), t);
      }
    } else if (!builtin) fail(`a ${type} node, which isn't one of Inventor's (and doesn't say what its fields are)`); // prettier-ignore
    for (let k = 0; k < count; k++) {
      const field = string();
      const t = types!.get(field) ?? fail(`${type} has no field ${field}`);
      n.fields.set(field, value(t, field, type));
      if (u32() & CONNECTED) fail(`${type}'s field ${field} is connected to another (not read)`);
    }
    const group = version > 2 ? (flags & IS_GROUP) !== 0 : (builtin?.group ?? false);
    if (group) for (let k = u32(); k > 0; k--) n.children.push(node1() ?? fail('a NULL child'));
    return n;
  };

  const roots: VNode[] = [];
  while (at + 4 <= bytes.length) {
    // Some writers pad the end with zeros.
    if (dv.getUint32(at) === 0) {
      at += 4;
      continue;
    }
    const n = node1();
    if (n) roots.push(n);
  }
  return roots;
}
