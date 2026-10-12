import type { Address, Feature } from './word.ts';

/**
 * Properties (properties.c, globals.c's propinfo). A property is a number
 * with a name and, optionally, the address of its CPL property code. Every
 * feature keeps its own list of properties, and every world keeps, for each
 * property, the list of its features that have it: CPL iterates those
 * (`Prop:Selectable*`), and ROM's main loop runs property code through them.
 *
 * add_property puts the new property at the *front* of both lists, so the
 * most recently given property comes first. That order decides which code
 * runs first, so it is kept exactly.
 */

/** The built-in properties, numbered as in globals.c. */
export const BUILTIN_PROPS = [
  'Noproperty',
  'Nullfeature',
  'Touched',
  'Killed',
  'Quickupdate',
  'Regularupdate',
  'Thislocation',
  'Nextlocation',
  'Msgpending',
  'Translated',
  'Selectable',
  'Nonselectable',
  'Picked',
  'Grabbed',
  'Transparent',
  'Neverdraw',
  'Alwaysdraw',
  'Nonmanifold',
  'Sectioninvisible',
  'Selectinvisible',
  'Pickedinvisible',
  'Lockedgeometry',
  'Connection',
  'Copyproperty',
  'Forcedcpnormal',
  'Hasdecal',
  'Haslabel',
  'Hasdimension',
  'Background',
  'Visible',
  'Invisible',
  'Hideable',
  'Luminous',
  'Noshadow',
  'Tool',
  'Menu',
  'Toolbox',
  'Active',
  'Activemenu',
  'Hotspot',
  'Oriented',
  'Dragonly',
  'Goodies',
  'Primitive',
  'Draw',
  'Erase',
  'Sketch',
  'Colorbar',
  'Paint',
  'Drill',
  'Slice',
  'Glue',
  'Stamp',
  'Magnetic',
  'Zoom',
  'Group',
  'Deform',
  'Puncture',
  'Lightbulb',
  'Toolbar',
  'Toolpad',
  'Toolvisible',
  'Headpad',
  'Padhandle',
  'Dialog',
  'Textinput',
  'Inputplate',
  'Scalebbox',
] as const;

export type BuiltinProp = (typeof BUILTIN_PROPS)[number];

/** Property numbers of the built-ins by name: `P.Selectable`. */
export const P = Object.fromEntries(BUILTIN_PROPS.map((n, i) => [n, i])) as {
  readonly [K in BuiltinProp]: number;
};

/** One entry in a world's list of the features with a property. */
export class PropNode {
  prev: PropNode | null = null;
  next: PropNode | null = null;
  /** False once deleted; a deleted node keeps its `next`, as freed memory did. */
  live = true;
  constructor(
    readonly owner: Feature,
    public value: unknown,
  ) {}
}

/** A doubly linked list of PropNodes (a world proplist). */
export class PropList {
  first: PropNode | null = null;
  last: PropNode | null = null;
  count = 0;

  /** add_new_blank_elem(list, Nil, ...): insert at the beginning. */
  addFront(n: PropNode): void {
    n.prev = null;
    n.next = this.first;
    if (this.first) this.first.prev = n;
    else this.last = n;
    this.first = n;
    this.count++;
  }

  /** append_elem. */
  append(n: PropNode): void {
    n.next = null;
    n.prev = this.last;
    if (this.last) this.last.next = n;
    else this.first = n;
    this.last = n;
    this.count++;
  }

  /** rem_elem: unlinks; the node's own next pointer is left as it was. */
  remove(n: PropNode): void {
    if (n.prev) n.prev.next = n.next;
    else this.first = n.next;
    if (n.next) n.next.prev = n.prev;
    else this.last = n.prev;
    this.count--;
  }

  *[Symbol.iterator](): IterableIterator<PropNode> {
    for (let n = this.first; n; n = n.next) yield n;
  }
}

interface OwnProp {
  kind: number;
  node: PropNode;
}

export interface PropertyWorlds {
  /** The world a feature belongs to (determine_world_proplist), or null for the working world. */
  worldOf(f: Feature): Feature | null;
  /** The working world, for features in none. */
  working(): Feature;
  /** A feature gained or lost a property (set_prop_flags / clear_prop_flags side effects). */
  changed?(f: Feature, p: number, added: boolean): void;
}

export class Properties {
  readonly names: string[] = [...BUILTIN_PROPS];
  /** Property code addresses (propinfo[].propertycode); 0 when there is none. */
  readonly code: Address[] = BUILTIN_PROPS.map(() => 0);
  private readonly own = new Map<Feature, OwnProp[]>();
  private readonly worldLists = new Map<Feature, PropList[]>();
  /** Bumped whenever a feature gains or loses a property (for views that redraw on change). */
  version = 0;

  constructor(private readonly worlds: PropertyWorlds) {}

  get count(): number {
    return this.names.length;
  }

  /** find_property: the number of a property by name, or -1. */
  find(name: string): number {
    return this.names.indexOf(name);
  }

  /** define_new_property. */
  defineNew(name: string, code: Address = 0): number {
    this.names.push(name);
    this.code.push(code);
    return this.names.length - 1;
  }

  /** define_property: gives a property its code, defining it first if need be. */
  defineCode(name: string, code: Address): number {
    const p = this.find(name);
    if (p >= 0) {
      this.code[p] = code;
      return p;
    }
    return this.defineNew(name, code);
  }

  /** The list, in a world, of features having property `p`. */
  worldList(world: Feature, p: number): PropList {
    let lists = this.worldLists.get(world);
    if (!lists) this.worldLists.set(world, (lists = []));
    return (lists[p] ??= new PropList());
  }

  private listFor(f: Feature, p: number): PropList {
    return this.worldList(this.worlds.worldOf(f) ?? this.worlds.working(), p);
  }

  /** A feature's properties, most recent first. */
  of(f: Feature): number[] {
    return (this.own.get(f) ?? []).map((o) => o.kind);
  }

  has(f: Feature, p: number): boolean {
    return this.own.get(f)?.some((o) => o.kind === p) ?? false;
  }

  /** add_property: does nothing if the feature has it already. */
  add(f: Feature, p: number, value: unknown = 0): boolean {
    if (this.has(f, p)) return false;
    this.insert(f, p, value);
    return true;
  }

  /** set_property: sets the value, adding the property if need be. */
  set(f: Feature, p: number, value: unknown): void {
    const o = this.own.get(f)?.find((x) => x.kind === p);
    if (o) o.node.value = value;
    else this.insert(f, p, value);
  }

  private insert(f: Feature, p: number, value: unknown): void {
    let list = this.own.get(f);
    if (!list) this.own.set(f, (list = []));
    const node = new PropNode(f, value);
    list.unshift({ kind: p, node });
    this.listFor(f, p).addFront(node);
    this.version++;
    this.worlds.changed?.(f, p, true);
  }

  /** get_property_val: the value, or 0 when the feature lacks it. */
  get(f: Feature, p: number): unknown {
    return this.own.get(f)?.find((x) => x.kind === p)?.node.value ?? 0;
  }

  /** del_property: false if the feature didn't have it. */
  del(f: Feature, p: number): boolean {
    const list = this.own.get(f);
    const i = list?.findIndex((o) => o.kind === p) ?? -1;
    if (!list || i < 0) return false;
    const [o] = list.splice(i, 1);
    const wl = this.findNode(o!.node, p);
    if (wl) wl.remove(o!.node);
    o!.node.live = false;
    if (list.length === 0) this.own.delete(f);
    this.version++;
    this.worlds.changed?.(f, p, false);
    return true;
  }

  /** The world list that holds a node (it is normally the owner's current world's). */
  private findNode(n: PropNode, p: number): PropList | undefined {
    const l = this.listFor(n.owner, p);
    for (const x of l) if (x === n) return l;
    for (const lists of this.worldLists.values()) {
      const wl = lists[p];
      if (wl) for (const x of wl) if (x === n) return wl;
    }
    return undefined;
  }

  /** Forgets every property of a feature (it was killed). */
  forget(f: Feature): void {
    for (const p of this.of(f)) this.del(f, p);
  }

  /**
   * transfer_moved_obj_props: after objects moved from `from` to `to`, their
   * entries in `from`'s lists move to the end of `to`'s, in order.
   */
  transfer(from: Feature, to: Feature): void {
    const lists = this.worldLists.get(from);
    if (!lists) return;
    lists.forEach((l, p) => {
      if (!l) return;
      let n = l.first;
      while (n) {
        const next = n.next;
        if (this.worlds.worldOf(n.owner) === to) {
          l.remove(n);
          this.worldList(to, p).append(n);
        }
        n = next;
      }
    });
  }

  /** All features in a world with property `p`, in list order. */
  features(world: Feature, p: number): Feature[] {
    return [...this.worldList(world, p)].map((n) => n.owner);
  }
}
