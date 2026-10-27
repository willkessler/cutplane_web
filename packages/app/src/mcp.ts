/**
 * New: an agent's hand on the app (?mcp). The MCP server (packages/mcp) passes on what the
 * agent does, and this does it as a person would: the crosshair moved (gliding, so whoever
 * watches sees it go), the button pressed and let go, a key, the wheel, the room turned,
 * a look at the room. Nothing here makes geometry: the tools, the plane and the world's
 * CPL do, as they do for anyone. Save is the app's own.
 */

type Hooks = NonNullable<Window['__cutplane']>;
type Args = Record<string, unknown>;

/** How long a glide takes unless asked otherwise (ms). */
const GLIDE = 300;
/** How soon a lost link is tried again (ms). */
const RETRY = 2000;

/** Connects to the MCP server at `url`, and again whenever the link is lost. */
export function connectMcp(url: string, hooks: Hooks): void {
  const ops = operations(hooks);
  const open = () => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => console.info(`MCP: connected to ${url}`));
    ws.addEventListener('message', (e) => {
      const { id, op, args } = JSON.parse(String(e.data)) as { id: number; op: string; args: Args }; // prettier-ignore
      const f = ops[op];
      Promise.resolve()
        .then(() => {
          if (!f) throw new Error(`no such operation: ${op}`);
          return f(args);
        })
        .then(
          (result) => ws.send(JSON.stringify({ id, ok: true, result: result ?? null })),
          (err: unknown) =>
            ws.send(JSON.stringify({ id, ok: false, error: String((err as Error)?.message ?? err) })), // prettier-ignore
        );
    });
    ws.addEventListener('close', () => setTimeout(open, RETRY));
  };
  open();
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const round = (v: number) => Math.round(v * 10) / 10;
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** The next frame (a hidden page gets none: then straight away). */
const frame = () =>
  document.hidden ? Promise.resolve() : new Promise((ok) => requestAnimationFrame(ok));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** The physical key for what the agent names: "d", "1", "\\", "Space", "Escape"… */
export function keyCode(key: string): { code: string; key: string; shift: boolean } {
  const named: Record<string, [string, string, boolean?]> = {
    ' ': ['Space', ' '],
    space: ['Space', ' '],
    '\\': ['Backslash', '\\'],
    '/': ['Slash', '/'],
    '?': ['Slash', '?', true],
    esc: ['Escape', 'Escape'],
    escape: ['Escape', 'Escape'],
    delete: ['Delete', 'Delete'],
    backspace: ['Backspace', 'Backspace'],
    enter: ['Enter', 'Enter'],
    return: ['Enter', 'Enter'],
    home: ['Home', 'Home'],
    '.': ['Period', '.'],
    ',': ['Comma', ','],
    '-': ['Minus', '-'],
  };
  const n = named[key.toLowerCase()] ?? named[key];
  if (n) return { code: n[0], key: n[1], shift: n[2] ?? false };
  if (/^[a-z]$/i.test(key))
    return { code: `Key${key.toUpperCase()}`, key, shift: key !== key.toLowerCase() };
  if (/^[0-9]$/.test(key)) return { code: `Digit${key}`, key, shift: false };
  if (/^Arrow(Left|Right|Up|Down)$/i.test(key)) {
    const k = `Arrow${key[5]!.toUpperCase()}${key.slice(6).toLowerCase()}`;
    return { code: k, key: k, shift: false };
  }
  return { code: key, key, shift: false }; // a code as is ("KeyA", "F2")
}

function operations(h: Hooks): Record<string, (a: Args) => unknown> {
  /** What the agent sees as it works: where things are, what is picked, what is shown. */
  const state = () => {
    const s = h.state();
    const e = h.edit();
    return {
      x: round(s.x),
      y: round(s.y),
      z: round(s.z),
      yaw: s.yaw,
      pitch: s.pitch,
      hover: e.hover,
      picked: e.picked,
      inHand: h.locate('inHand'),
      objects: e.objects,
      faces: e.faces,
      vertices: e.vertices,
      marquee: e.marquee,
      guides: h.guides().map((g) => ({ at: g.at.map(round), dir: g.dir.map(round) })),
      hints: h.hints(),
      notice: h.notice().text || undefined,
    };
  };

  /** Glides from where things are to where they're asked to be, a frame at a time. */
  const glide = async (
    to: Partial<Record<'x' | 'y' | 'z' | 'yaw' | 'pitch', number | undefined>>,
    ms: number,
  ) => {
    const s = h.state();
    const from = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch };
    const keys = (Object.keys(to) as (keyof typeof from)[]).filter((k) => to[k] !== undefined);
    const at = (t: number) =>
      Object.fromEntries(keys.map((k) => [k, from[k] + (to[k]! - from[k]) * ease(t)]));
    const t0 = performance.now();
    for (;;) {
      await frame();
      const t = ms > 0 ? Math.min(1, (performance.now() - t0) / ms) : 1;
      h.set(at(t));
      if (t >= 1) break;
    }
  };
  const point = (a: Args) => ({ x: num(a['x']), y: num(a['y']), z: num(a['z']) });
  const glideMs = (a: Args) => num(a['ms']) ?? GLIDE;

  const keyEvent = (type: 'keydown' | 'keyup', a: Args) => {
    const k = keyCode(String(a['key']));
    window.dispatchEvent(
      new KeyboardEvent(type, {
        code: k.code,
        key: k.key,
        shiftKey: !!a['shift'] || k.shift,
        ctrlKey: !!a['ctrl'],
        altKey: !!a['alt'],
        metaKey: !!a['meta'],
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  return {
    state,
    async move(a) {
      await glide(point(a), glideMs(a));
      return state();
    },
    async turn(a) {
      await glide({ yaw: num(a['yaw']), pitch: num(a['pitch']) }, glideMs(a));
      return state();
    },
    press(a) {
      h.press(!!a['shift']);
      return state();
    },
    release() {
      h.release();
      return state();
    },
    async click(a) {
      if (a['double']) h.doubleClick();
      else {
        h.press(!!a['shift']);
        await frame();
        h.release();
      }
      return state();
    },
    async drag(a) {
      h.press(!!a['shift']);
      await glide(point(a), glideMs(a));
      h.release();
      return state();
    },
    key(a) {
      keyEvent('keydown', a);
      keyEvent('keyup', { key: a['key'] }); // (the modifiers let go with it)
      return state();
    },
    async wheel(a) {
      // A notch at a time, as a wheel turns (each a line: 8 units of depth).
      const clicks = Math.trunc(num(a['clicks']) ?? 0);
      const canvas = document.getElementById('viewport')!;
      for (let i = 0; i < Math.abs(clicks); i++) {
        canvas.dispatchEvent(
          new WheelEvent('wheel', { deltaY: -Math.sign(clicks), deltaMode: 1, cancelable: true }),
        );
        await frame();
      }
      return state();
    },
    async look(a) {
      const ms = num(a['wait_ms']) ?? 0;
      if (ms) await wait(ms);
      return { image: h.snapshot(num(a['width']) ?? 1024), state: state() };
    },
    locate(a) {
      return h.locate(String(a['what']));
    },
    async open(a) {
      await h.open(String(a['model']));
      return state();
    },
    save(a) {
      return h.saveAs(String(a['name']));
    },
  };
}
