import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { Request } from '../src/bridge.ts';
import { serve, type Running } from '../src/server.ts';

let running: Running;
let dir: string;
let client: Client;
const asked: Request[] = [];

/** A stand-in for the app: answers each request as `answer` says. */
async function page(answer: (r: Request) => unknown): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${running.port}/bridge`);
  ws.on('message', (data) => {
    const r = JSON.parse(String(data)) as Request;
    asked.push(r);
    ws.send(JSON.stringify({ id: r.id, ok: true, result: answer(r) }));
  });
  await new Promise((ok) => ws.on('open', ok));
  // (The server attaches it once the upgrade is through.)
  while (!running.bridge.connected) await new Promise((ok) => setTimeout(ok, 5));
  return ws;
}

const text = (r: unknown) =>
  ((r as { content: { type: string; text?: string }[] }).content.find((c) => c.type === 'text')?.text ?? ''); // prettier-ignore

beforeEach(async () => {
  asked.length = 0;
  dir = await mkdtemp(join(tmpdir(), 'cutplane-mcp-'));
  running = await serve({ port: 0, host: '127.0.0.1', saveDir: dir });
  client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp`)),
  );
});

afterEach(async () => {
  await client.close();
  await running.close();
  await rm(dir, { recursive: true, force: true });
});

describe('the MCP server', () => {
  it('offers a hand on the app, and direct calls by number', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        ...['click', 'drag', 'hands_off', 'inspect', 'key', 'locate', 'look', 'move_to', 'open', 'press', 'record', 'release', 'replay', 'save', 'sequence', 'state', 'turn_view', 'wheel'], // prettier-ignore
        ...['add_primitive', 'arrange_objects', 'boolean', 'clearance', 'copy_objects', 'delete_objects', 'group_objects', 'list_objects', 'move_face', 'move_objects', 'name_object', 'paint_objects', 'pick_objects', 'ray', 'rotate_objects', 'scale_objects', 'slice_objects', 'ungroup_object'], // prettier-ignore
      ].sort(),
    );
  });

  it('passes a direct call to the page as one', async () => {
    await page((r) => (r.op === 'direct' ? { objects: [{ id: 1 }] } : null));
    const r = await client.callTool({ name: 'move_objects', arguments: { objects: [1], by: [10, 0, 0] } }); // prettier-ignore
    expect(asked.at(-1)).toMatchObject({ op: 'direct', args: { call: 'move', args: { objects: [1], by: [10, 0, 0] } } }); // prettier-ignore
    expect(JSON.parse(text(r))).toEqual({ objects: [{ id: 1 }] });
  });

  it("shows a call's goal in the room first, and passes on the call without it", async () => {
    await page((r) => (r.op === 'direct' ? { objects: [{ id: 1 }] } : null));
    const goal = 'the right side: its grooves';
    await client.callTool({ name: 'move_objects', arguments: { objects: [1], by: [1, 0, 0], goal } }); // prettier-ignore
    expect(asked.map((r) => r.op)).toEqual(['goal', 'direct']);
    expect(asked[0]!.args).toEqual({ text: goal });
    expect(asked[1]!.args).toEqual({ call: 'move', args: { objects: [1], by: [1, 0, 0] } });
    const { tools } = await client.listTools();
    expect(tools.every((t) => 'goal' in (t.inputSchema.properties ?? {}))).toBe(true);
  });

  it('tells the agent how to work well when it connects', () => {
    const told = client.getInstructions() ?? '';
    expect(told).toMatch(/hands_off/);
    expect(told).toMatch(/grabber/);
    expect(told).toMatch(/margin scales/);
  });

  it('says so when no page is open', async () => {
    const r = await client.callTool({ name: 'state', arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/\?mcp/);
  });

  it('passes a move to the page and gives back where the crosshair ended up', async () => {
    await page((r) => (r.op === 'move' ? { x: 10, y: 20, z: 30 } : null));
    const r = await client.callTool({ name: 'move_to', arguments: { x: 10, y: 20, ms: 0 } });
    expect(asked).toEqual([{ id: 1, op: 'move', args: { x: 10, y: 20, ms: 0 } }]);
    expect(JSON.parse(text(r))).toEqual({ x: 10, y: 20, z: 30 });
  });

  it('gives back a look as an image, and one after an action when asked', async () => {
    await page((r) =>
      r.op === 'look' ? { image: 'data:image/jpeg;base64,AAAA', state: { x: 1 } } : { ok: 1 },
    );
    const r = (await client.callTool({ name: 'key', arguments: { key: 'd', look: true } })) as {
      content: { type: string; data?: string; mimeType?: string }[];
    };
    expect(asked.map((a) => a.op)).toEqual(['key', 'look']);
    expect(r.content.map((c) => c.type)).toEqual(['text', 'image', 'text']);
    expect(r.content[1]).toMatchObject({ data: 'AAAA', mimeType: 'image/jpeg' });
  });

  it('passes a sequence on as one request, its steps named as the app names them', async () => {
    await page(() => ({ x: 5 }));
    const r = await client.callTool({
      name: 'sequence',
      arguments: {
        steps: [
          { do: 'move_to', x: 5, y: 6 },
          { do: 'press', shift: true },
          { do: 'turn_view', yaw: 10 },
          { do: 'release' },
        ],
      },
    });
    expect(asked).toEqual([
      {
        id: 1,
        op: 'sequence',
        args: {
          steps: [
            { do: 'move', x: 5, y: 6 },
            { do: 'press', shift: true },
            { do: 'turn', yaw: 10 },
            { do: 'release' },
          ],
        },
      },
    ]);
    expect(JSON.parse(text(r))).toEqual({ x: 5 });
  });

  it('turns away a sequence step that is not a hand move', async () => {
    await page(() => null);
    const r = await client.callTool({ name: 'sequence', arguments: { steps: [{ do: 'save' }] } });
    expect(r.isError).toBe(true);
    expect(asked).toEqual([]);
  });

  it('saves the file the app wrote', async () => {
    await page(() => ({ text: '(cut file)', file: 'Orion III.cut' }));
    const r = await client.callTool({ name: 'save', arguments: { name: 'Orion III' } });
    expect(text(r)).toContain('Orion III.cut');
    expect(await readFile(join(dir, 'Orion III.cut'), 'utf8')).toBe('(cut file)');
  });

  it("gives back the page's error", async () => {
    const ws = await page(() => null);
    ws.removeAllListeners('message');
    ws.on('message', (data) => {
      const r = JSON.parse(String(data)) as Request;
      ws.send(JSON.stringify({ id: r.id, ok: false, error: 'no such thing' }));
    });
    const r = await client.callTool({ name: 'locate', arguments: { what: 'nothing' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('no such thing');
  });

  it('records every call, from the world as it was, and replays it the same way', async () => {
    // A page whose crosshair goes where it's moved, and which keeps a world.
    let world = '(the start)';
    const at = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, picked: [] as string[], objects: 1 };
    await page((r) => {
      const a = r.args;
      if (r.op === 'worldText') return world;
      if (r.op === 'openText') world = String(a['text']);
      if (r.op === 'settings') return { faceDrag: 'extrude' };
      if (r.op === 'move') Object.assign(at, { x: a['x'] ?? at.x, y: a['y'] ?? at.y });
      if (r.op === 'key' && a['key'] === 'd') at.objects++;
      if (r.op === 'look') return { image: 'data:image/jpeg;base64,AAAA', state: { ...at } };
      return { ...at };
    });
    expect(text(await client.callTool({ name: 'record', arguments: { name: 'build' } }))).toContain('build.jsonl'); // prettier-ignore
    await client.callTool({ name: 'move_to', arguments: { x: 40, y: 20 } });
    await client.callTool({ name: 'key', arguments: { key: 'd', look: true } });
    await client.callTool({ name: 'record', arguments: { stop: true } });
    const lines = (await readFile(join(dir, 'logs', 'build.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>); // prettier-ignore
    expect(lines[0]).toMatchObject({ kind: 'start', world: '(the start)', settings: { faceDrag: 'extrude' }, view: { x: 0, y: 0 } }); // prettier-ignore
    expect(lines.slice(1).map((l) => l['op'] ?? l['kind'])).toEqual([
      'move',
      'key',
      'look',
      'stop',
    ]);
    expect(lines[1]).toMatchObject({ args: { x: 40, y: 20 }, ok: true, after: { x: 40, y: 20, objects: 1 } }); // prettier-ignore
    expect(lines[3]).toMatchObject({ after: { objects: 2 } }); // a look's state is kept, not its image
    expect(JSON.stringify(lines[3])).not.toContain('AAAA');

    // The world goes on; a replay goes back to the start and does it again, without the look.
    world = '(later)';
    Object.assign(at, { x: 99, objects: 5 });
    asked.length = 0;
    const r = JSON.parse(text(await client.callTool({ name: 'replay', arguments: { name: 'build' } }))); // prettier-ignore
    expect(asked.map((a) => a.op)).toEqual(['openText', 'settings', 'turn', 'move', 'move', 'key']);
    expect(asked[0]!.args).toEqual({ text: '(the start)' });
    expect(asked[1]!.args).toEqual({ set: { faceDrag: 'extrude' } });
    // Its objects came out otherwise (the stand-in doesn't reopen them): that's drift.
    expect(r).toMatchObject({ done: 2, drifted: 2 });
    expect(r.drift[0]).toMatchObject({ line: 2, op: 'move', was: { objects: 1 }, now: { objects: 5 } }); // prettier-ignore
  });
});
