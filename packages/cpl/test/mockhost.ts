import type { Feature, Host, VM } from '../src/index.ts';
import { P, T } from '../src/index.ts';

/** A minimal world of named objects for VM tests. */
export interface MockObj extends Feature {
  type: number;
  name: string | null;
  parent: MockObj | null;
  children: MockObj[];
  world: MockWorld;
  linked: boolean;
  color: [number, number, number];
  pos: [number, number, number];
}
export interface MockWorld extends Feature {
  type: number;
  name: string;
  root: MockObj;
}

export class MockHost implements Host {
  readonly worlds: MockWorld[] = [];
  readonly log: string[] = [];
  cursorAt: [number, number, number] = [0, 0, 0];
  vm?: VM;

  world(name: string): MockWorld {
    const w = { type: T.World, name } as MockWorld;
    w.root = {
      type: T.Obj,
      name: null,
      parent: null,
      children: [],
      world: w,
      linked: true,
      color: [0, 0, 0],
      pos: [0, 0, 0],
    };
    this.worlds.push(w);
    return w;
  }

  obj(parent: MockObj, name: string | null = null): MockObj {
    const o: MockObj = {
      type: T.Obj,
      name,
      parent,
      children: [],
      world: parent.world,
      linked: true,
      color: [100, 100, 100],
      pos: [0, 0, 0],
    };
    parent.children.push(o);
    return o;
  }

  worldOf(f: Feature) {
    return (f as MockObj).world ?? null;
  }
  worldRoot(w: Feature) {
    return (w as MockWorld).root;
  }
  findWorld(name: string) {
    return this.worlds.find((w) => w.name === name) ?? null;
  }
  findObject(name: string) {
    const walk = (o: MockObj): MockObj | null => {
      if (o.name === name) return o;
      for (const c of o.children) {
        const r = walk(c);
        if (r) return r;
      }
      return null;
    };
    for (const w of this.worlds) {
      const r = walk(w.root);
      if (r) return r;
    }
    return null;
  }
  larger(f: Feature, type: number) {
    if (f.type === type) return f;
    if (type === T.World) return (f as MockObj).world;
    return null;
  }
  parent(o: Feature) {
    return (o as MockObj).parent;
  }
  children(o: Feature) {
    return (o as MockObj).children;
  }
  linked(o: Feature) {
    return (o as MockObj).linked;
  }
  unlinkedAncestor(o: Feature): Feature {
    const x = o as MockObj;
    return x.linked || !x.parent ? x : this.unlinkedAncestor(x.parent);
  }
  subfeatures() {
    return [];
  }
  adopt(parent: Feature, child: Feature, linked: boolean) {
    const c = child as MockObj;
    const p = parent as MockObj;
    if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1);
    c.parent = p;
    c.world = p.world;
    c.linked = linked;
    p.children.push(c);
    this.log.push(`adopt ${c.name} -> ${p.name ?? p.world.name}`);
  }
  makeChild(parent: Feature) {
    return this.obj(parent as MockObj);
  }
  duplicate(o: Feature) {
    const x = o as MockObj;
    const c = this.obj(x.parent ?? x.world.root, x.name ? `${x.name}'` : null);
    this.log.push(`dup ${x.name}`);
    return c;
  }
  envObject() {
    return this.worlds[0]!.root;
  }
  cursor(): [number, number, number] {
    return [...this.cursorAt];
  }
  firstVertex(f: Feature): [number, number, number] | null {
    return [...(f as MockObj).pos];
  }
  translateCrosshair(o: readonly number[] | number[]) {
    this.cursorAt = [this.cursorAt[0] + o[0]!, this.cursorAt[1] + o[1]!, this.cursorAt[2] + o[2]!];
    this.log.push(`crosshair ${o.join(',')}`);
  }
  translate(f: Feature, o: readonly number[] | number[]) {
    const x = f as MockObj;
    x.pos = [x.pos[0] + o[0]!, x.pos[1] + o[1]!, x.pos[2] + o[2]!];
    this.log.push(`trans ${x.name} ${o.join(',')}`);
  }
  rotateRoom(dx: number, dy: number) {
    this.log.push(`room ${dx},${dy}`);
  }
  rotateObject(o: Feature, _a: unknown, _p: unknown, t: number) {
    this.log.push(`rotate ${(o as MockObj).name} ${t}`);
  }
  scaleObject(o: Feature, s: number) {
    this.log.push(`scale ${(o as MockObj).name} ${s}`);
  }
  nudgeCrosshair(d: readonly number[] | number[]) {
    this.translateCrosshair(d);
  }
  snapObject(o: Feature) {
    this.log.push(`snap ${(o as MockObj).name}`);
  }
  snapFeatures() {}
  within() {
    return false;
  }
  boolean() {
    return [];
  }
  name(o: Feature) {
    return (o as MockObj).name ?? (o as MockWorld).name ?? null;
  }
  setName(o: Feature, n: string | null) {
    (o as MockObj).name = n;
  }
  label() {
    return null;
  }
  setLabel() {}
  color(f: Feature): [number, number, number] {
    return [...(f as MockObj).color];
  }
  setColor(f: Feature, c: readonly number[] | number[]) {
    (f as MockObj).color = [c[0]!, c[1]!, c[2]!];
    this.log.push(`color ${(f as MockObj).name} ${c.join(',')}`);
  }
  setSelectable() {}
  unselect() {}
  pick(f: Feature) {
    this.log.push(`pick ${(f as MockObj).name}`);
    this.vm?.props.add(f, P.Picked);
  }
  unpick(f: Feature) {
    this.log.push(`unpick ${(f as MockObj).name}`);
    this.vm?.props.del(f, P.Picked);
  }
  release(f: Feature) {
    this.log.push(`release ${(f as MockObj).name}`);
  }
  pickPlane() {
    this.log.push('pick plane');
  }
  releasePlane() {
    this.log.push('release plane');
  }
  logUpdate() {}
  globalUpdate() {}
  afterInstruction() {}
  toggleShade() {}
  quit() {
    this.log.push('quit');
  }
}
