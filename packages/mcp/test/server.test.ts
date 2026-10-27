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
  it('offers a hand on the app, and nothing that makes geometry', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['click', 'drag', 'key', 'locate', 'look', 'move_to', 'open', 'press', 'release', 'save', 'state', 'turn_view', 'wheel'].sort(), // prettier-ignore
    );
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
});
