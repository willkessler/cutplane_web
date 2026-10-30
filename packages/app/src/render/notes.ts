import * as THREE from 'three';
import { decalFrame, notePoint, ROOM, type CutObject, type TextDecal } from '@cutplane/kernel';
import { textStrokes } from './labels.ts';

/**
 * New: notes (TextDecal's `note`): not laid on a surface but floating out from it,
 * a leader line back to where they were put, what they say on a tag in the note's
 * colour that faces whoever looks. Folded, a tag shows only the start of what it
 * says; with the crosshair over it, all of it, a few words a line.
 */

type V3 = [number, number, number];

/** Hershey capitals' height, in font units (hershey.ts). */
const CAP = 11.5;
/** What a folded note shows, at most; and an open one's line, about. */
const FOLDED = 16;
const LINE = 28;

/** A note as one of an object's decals. */
export interface NoteRef {
  object: CutObject;
  index: number;
}

/** A note's tag as drawn: where it floats, its sides (from there, across and up), its lines. */
interface Tag extends NoteRef {
  at: V3;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  lines: string[];
  height: number;
}

/** What a note shows: folded, its start; open, all of it, broken at spaces. */
export function noteLines(text: string, open: boolean): string[] {
  const t = text.trim() || '...';
  if (!open) return [t.length <= FOLDED ? t : `${t.slice(0, FOLDED - 2).trimEnd()}..`];
  const lines: string[] = [];
  let line = '';
  for (const word of t.split(/\s+/)) {
    if (line && line.length + 1 + word.length > LINE) {
      lines.push(line);
      line = '';
    }
    line = line ? `${line} ${word}` : word;
    while (line.length > LINE) {
      lines.push(line.slice(0, LINE));
      line = line.slice(LINE);
    }
  }
  if (line) lines.push(line);
  return lines;
}

const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]; // prettier-ignore
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!; // prettier-ignore

/**
 * A note's tag, `right` and `up` the view's: it reaches away from the thing (left if the
 * note points left, down if it points down), its corner where the leader line ends, unless
 * it's slid to stay in the room.
 */
export function layTag(
  ref: NoteRef,
  d: TextDecal,
  open: boolean,
  right: readonly number[],
  up: readonly number[],
): Tag {
  const f = decalFrame(ref.object, d);
  const lines = noteLines(d.text, open);
  const s = f.height / CAP;
  const pad = f.height * 0.5;
  const width = Math.max(...lines.map((l) => textStrokes(l, s).width)) + 2 * pad;
  const height = lines.length * f.height * 1.7 + pad;
  const at = notePoint(f);
  // Away from the thing; but no further out of the room (out of the crosshair's reach)
  // than it has to: slid back across, then up or down, as far as it takes to be in it.
  const left = dot(f.n, right) < -0.2;
  const down = dot(f.n, up) < -0.2;
  const tag = { x0: left ? -width : 0, x1: left ? 0 : width, y0: down ? -height : 0, y1: down ? 0 : height }; // prettier-ignore
  const corners = () =>
    [tag.x0, tag.x1].flatMap((x) =>
      [tag.y0, tag.y1].map((y) => [0, 1, 2].map((k) => at[k]! + x * right[k]! + y * up[k]!)),
    );
  const slide = (dir: readonly number[]): number => {
    let lo = -Infinity;
    let hi = Infinity;
    for (const c of corners())
      for (const k of [0, 1, 2] as const) {
        if (Math.abs(dir[k]!) < 1e-6) continue;
        const a = (ROOM.min[k] - c[k]!) / dir[k]!;
        const b = (ROOM.max[k] - c[k]!) / dir[k]!;
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
      }
    return lo > hi ? 0 : Math.min(hi, Math.max(lo, 0));
  };
  const sx = slide(right);
  tag.x0 += sx;
  tag.x1 += sx;
  const sy = slide(up);
  tag.y0 += sy;
  tag.y1 += sy;
  return { ...ref, at, ...tag, lines, height: f.height };
}

/** Of `tags`, the nearest the eye that the line from `eye` through `through` passes through. */
export function tagUnder(
  tags: readonly Tag[],
  eye: readonly number[],
  through: readonly number[],
  right: readonly number[],
  up: readonly number[],
): Tag | null {
  const ray = sub(through, eye);
  const ahead: V3 = [
    right[1]! * up[2]! - right[2]! * up[1]!,
    right[2]! * up[0]! - right[0]! * up[2]!,
    right[0]! * up[1]! - right[1]! * up[0]!,
  ];
  let best: { tag: Tag; t: number } | null = null;
  for (const tag of tags) {
    const across = dot(ray, ahead);
    if (Math.abs(across) < 1e-9) continue;
    const t = dot(sub(tag.at, eye), ahead) / across;
    if (t <= 0) continue;
    const hit = sub(
      eye.map((c, k) => c + t * ray[k]!),
      tag.at,
    );
    const x = dot(hit, right);
    const y = dot(hit, up);
    // A little round it counts too: a tag is small to aim at.
    const m = tag.height * 0.6;
    const on = x >= tag.x0 - m && x <= tag.x1 + m && y >= tag.y0 - m && y <= tag.y1 + m;
    if (on && (!best || t < best.t)) best = { tag, t };
  }
  return best?.tag ?? null;
}

/** Dark lettering on a light tag, light on a dark one. */
const inkOn = (c: readonly number[]): V3 =>
  0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]! > 140 ? [0.08, 0.08, 0.1] : [1, 1, 1];

export class NoteView {
  readonly object = new THREE.Group();
  /** The note the crosshair is over (its tag open), if any. */
  hovered: NoteRef | null = null;
  private readonly leaders: THREE.LineSegments;
  private readonly tags: THREE.Mesh;
  private readonly ink: THREE.LineSegments;
  private key = '';

  constructor() {
    this.leaders = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x303038 }),
    );
    // Tags are cards in the room, turned to face whoever looks: nearer things hide them,
    // and they hide what's behind them.
    this.tags = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    this.ink = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true }),
    );
    for (const o of [this.leaders, this.tags, this.ink]) {
      o.frustumCulled = false;
      this.object.add(o);
    }
  }

  /** The notes on `objects`, facing `camera`; the one the crosshair (`cursor`) is over, open. */
  update(objects: readonly CutObject[], camera: THREE.Camera, cursor: readonly number[]): void {
    const e = camera.matrixWorld.elements;
    const right = [e[0]!, e[1]!, e[2]!];
    const up = [e[4]!, e[5]!, e[6]!];
    const eye = [e[12]!, e[13]!, e[14]!];
    const refs: NoteRef[] = [];
    for (const object of objects)
      for (const [index, d] of (object.decals ?? []).entries())
        if (d.note !== undefined) refs.push({ object, index });
    const lay = (r: NoteRef, open: boolean) =>
      layTag(r, r.object.decals![r.index]!, open, right, up);
    // Open, it stays open while the crosshair is anywhere on it.
    const was = this.hovered;
    const open =
      was && refs.some((r) => r.object === was.object && r.index === was.index)
        ? tagUnder([lay(was, true)], eye, cursor, right, up)
        : null;
    const folded = refs.map((r) => lay(r, false));
    const over = open ?? tagUnder(folded, eye, cursor, right, up);
    this.hovered = over && { object: over.object, index: over.index };
    const key = JSON.stringify([
      e,
      over && [refs.findIndex((r) => r.object === over.object), over.index],
      refs.map((r) => [r.object.decals![r.index], [...r.object.xform]]),
    ]);
    if (key === this.key) return;
    this.key = key;
    const isOver = (t: NoteRef) => !!over && t.object === over.object && t.index === over.index;
    const tags = [...folded.filter((t) => !isOver(t)), ...(over ? [lay(over, true)] : [])];
    const lead: number[] = [];
    const quad: number[] = [];
    const quadCol: number[] = [];
    const ink: number[] = [];
    const inkCol: number[] = [];
    // Toward the eye: the card's front, and the ink a little off it.
    const toward = [e[8]!, e[9]!, e[10]!];
    const place = (t: Tag, x: number, y: number, z = 0): number[] =>
      [0, 1, 2].map((k) => t.at[k]! + x * right[k]! + y * up[k]! + z * toward[k]!);
    for (const t of tags) {
      const d = t.object.decals![t.index]!;
      lead.push(...decalFrame(t.object, d).at, ...t.at);
      // Slid to stay in the room, on from there to the tag.
      const near = place(t, Math.min(t.x1, Math.max(t.x0, 0)), Math.min(t.y1, Math.max(t.y0, 0)));
      lead.push(...t.at, ...near);
      const c = d.color.map((v) => v / 255);
      const edge = c.map((v) => v * 0.7);
      const th = t.height * 0.3;
      const xs = [t.x0, t.x1, t.x1, t.x0];
      const ys = [t.y0, t.y0, t.y1, t.y1];
      const back = xs.map((x, i) => place(t, x, ys[i]!));
      const front = xs.map((x, i) => place(t, x, ys[i]!, th));
      for (const [face, col] of [
        [front, c],
        [back, c],
      ] as const)
        for (const i of [0, 1, 2, 0, 2, 3]) {
          quad.push(...face[i]!);
          quadCol.push(...col);
        }
      // Its edges, darker, so it reads as a card with some thickness.
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        for (const v of [back[i]!, back[j]!, front[j]!, back[i]!, front[j]!, front[i]!]) {
          quad.push(...v);
          quadCol.push(...edge);
        }
      }
      const corners = xs.map((x, i) => place(t, x, ys[i]!, th * 1.05));
      const k = inkOn(d.color);
      for (let i = 0; i < 4; i++) {
        ink.push(...corners[i]!, ...corners[(i + 1) % 4]!);
        inkCol.push(...k, ...k);
      }
      const s = t.height / CAP;
      const pad = t.height * 0.5;
      t.lines.forEach((line, i) => {
        const base = t.y1 - pad - t.height - i * t.height * 1.7;
        const { pos } = textStrokes(line, s);
        for (let j = 0; j < pos.length; j += 3) {
          ink.push(...place(t, t.x0 + pad + pos[j]!, base + pos[j + 1]!, th * 1.05));
          inkCol.push(...k);
        }
      });
    }
    set(this.leaders, lead);
    set(this.tags, quad, quadCol);
    set(this.ink, ink, inkCol);
  }
}

function set(o: THREE.Mesh | THREE.LineSegments, pos: number[], col?: number[]): void {
  o.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  o.geometry = g;
}
