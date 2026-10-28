import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bridge, Tapped } from './bridge.ts';

/**
 * A recording: every call the agent's tools make of the page, in order, one JSON line each,
 * so a build can be done again the same way (replay). The first line is where it started:
 * the world (as .cut text), the toolbar's choices, the crosshair, plane and view. Each call
 * keeps what it asked, how long it took and where things were after (where the crosshair
 * ended up, what was picked, how many objects), which a replay checks itself against. The
 * page connecting or closing (a reload) is noted too, as hands off lapses with it.
 */

/** A recording's lines. */
export type Line =
  | {
      kind: 'start';
      v: 1;
      name: string;
      at: string;
      world: string;
      settings: Record<string, string>;
      view: View;
    }
  | {
      kind: 'call';
      t: number;
      op: string;
      args: Record<string, unknown>;
      took: number;
      ok: boolean;
      error?: string;
      after?: After | undefined;
    }
  | { kind: 'page'; t: number; event: 'connected' | 'closed' }
  | { kind: 'stop'; t: number };

interface View {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Where things were after a call: what a replay checks. */
export interface After {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  picked: unknown;
  objects: unknown;
  handsOff: unknown;
}

/** Calls that only look, or save: kept in the log, not done again. */
const LOOKS = new Set(['state', 'look', 'locate', 'inspect', 'save', 'settings', 'worldText', 'openText']); // prettier-ignore

/** Where a recording is kept. */
export const logPath = (dir: string, name: string) =>
  join(dir, 'logs', `${name.replace(/[^\w.-]+/g, '_')}.jsonl`);

/** The state in a reply (a look's is inside it), cut down to what a replay checks. */
function after(result: unknown): After | undefined {
  const r = result as Record<string, unknown> | null;
  const s = (r && typeof r === 'object' && 'state' in r ? r['state'] : r) as Record<string, unknown> | null; // prettier-ignore
  if (!s || typeof s !== 'object' || typeof s['x'] !== 'number') return undefined;
  const { x, y, z, yaw, pitch, picked, objects, handsOff } = s as unknown as After;
  return { x, y, z, yaw, pitch, picked, objects, handsOff };
}

export class Recorder {
  private path: string | null = null;
  private t0 = 0;

  private readonly bridge: Bridge;
  private readonly dir: string;

  constructor(bridge: Bridge, dir: string) {
    this.bridge = bridge;
    this.dir = dir;
  }

  get recording(): string | null {
    return this.path;
  }

  /** Starts a recording from where the page is now (any recording before it ends). */
  async start(name: string): Promise<string> {
    this.stop();
    const text = (await this.bridge.call('worldText', {})) as string;
    const settings = (await this.bridge.call('settings', {})) as Record<string, string>;
    const s = (await this.bridge.call('state', {})) as View;
    const path = logPath(this.dir, name);
    mkdirSync(join(this.dir, 'logs'), { recursive: true });
    this.t0 = Date.now();
    const view = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch };
    const at = new Date(this.t0).toISOString();
    appendFileSync(path, '', { flag: 'w' });
    this.path = path;
    this.write({ kind: 'start', v: 1, name, at, world: text, settings, view });
    this.bridge.tap = (e) => this.tapped(e);
    return path;
  }

  stop(): string | null {
    const path = this.path;
    if (!path) return null;
    this.write({ kind: 'stop', t: Date.now() - this.t0 });
    this.bridge.tap = null;
    this.path = null;
    return path;
  }

  private tapped(e: Tapped): void {
    if ('page' in e) {
      this.write({ kind: 'page', t: Date.now() - this.t0, event: e.page });
      return;
    }
    const { op, args, started, took, reply } = e;
    this.write({
      kind: 'call',
      t: started - this.t0,
      op,
      args,
      took,
      ok: reply.ok,
      ...(reply.ok ? { after: op === 'save' ? undefined : after(reply.result) } : { error: reply.error }), // prettier-ignore
    });
  }

  private write(line: Line): void {
    if (this.path) appendFileSync(this.path, JSON.stringify(line) + '\n');
  }
}

export interface Replayed {
  /** Calls done again. */
  done: number;
  /** Calls that came out otherwise than recorded: where, and how. */
  drift: { line: number; op: string; was: unknown; now: unknown }[];
  /** A call that failed where it hadn't (the replay stops there). */
  failed?: { line: number; op: string; error: string };
}

/**
 * Does a recording again: opens the world it started from, sets the toolbar and view as they
 * were, then makes each call it made, in order (all but the ones that only look), checking
 * where things are after each against the recording. `pace: 'recorded'` keeps the pauses
 * between calls; otherwise one follows another. `upTo` stops after that many calls.
 */
export async function replay(
  bridge: Bridge,
  lines: Line[],
  {
    pace = 'fast',
    upTo = Infinity,
  }: { pace?: 'fast' | 'recorded' | undefined; upTo?: number | undefined } = {},
): Promise<Replayed> {
  const start = lines[0];
  if (start?.kind !== 'start') throw new Error('not a recording: no start line');
  await bridge.call('openText', { text: start.world });
  await bridge.call('settings', { set: start.settings });
  const { x, y, z, yaw, pitch } = start.view;
  await bridge.call('turn', { yaw, pitch });
  await bridge.call('move', { x, y, z });
  const out: Replayed = { done: 0, drift: [] };
  let free = 0; // when the recording's last call ended
  for (const [i, l] of lines.entries()) {
    if (out.done >= upTo) break;
    if (l.kind !== 'call' || LOOKS.has(l.op)) continue;
    if (pace === 'recorded' && out.done > 0)
      await new Promise((ok) => setTimeout(ok, Math.max(0, l.t - free)));
    free = l.t + l.took;
    let result: unknown;
    try {
      result = await bridge.call(l.op, l.args, l.op === 'sequence' ? 120_000 : undefined);
    } catch (e) {
      if (l.ok) {
        out.failed = { line: i + 1, op: l.op, error: (e as Error).message };
        break;
      }
    }
    out.done++;
    const now = after(result);
    if (l.after && now && drifted(l.after, now))
      out.drift.push({ line: i + 1, op: l.op, was: l.after, now });
  }
  return out;
}

const drifted = (a: After, b: After) =>
  (['x', 'y', 'z', 'yaw', 'pitch'] as const).some((k) => Math.abs(a[k] - b[k]) > 0.05) ||
  JSON.stringify(a.picked) !== JSON.stringify(b.picked) ||
  a.objects !== b.objects;

export const readLog = (path: string): Line[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line);
