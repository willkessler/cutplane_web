import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { connect, serve } from '../packages/mcp/src/index.ts';

// New: an agent works the app through the MCP server (packages/mcp), as a person would.
// The page opens with ?mcp pointed at a server started here; the agent is an MCP client.

type Result = { isError?: boolean; content: { type: string; text?: string; data?: string }[] };
const json = (r: unknown) =>
  JSON.parse((r as Result).content.find((c) => c.type === 'text')!.text!) as Record<string, unknown>; // prettier-ignore

test('through MCP: opens a cube, pulls a corner out, looks, and saves it', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the link');
  const dir = mkdtempSync(join(tmpdir(), 'cutplane-mcp-'));
  const server = await serve({ port: 0, host: '127.0.0.1', saveDir: dir });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto(`/?still=1&mcp=ws://127.0.0.1:${server.port}/bridge`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect.poll(() => server.bridge.connected).toBe(true);
    const agent = await connect(`http://127.0.0.1:${server.port}/mcp`);
    const call = (name: string, args: Record<string, unknown> = {}) =>
      agent.callTool({ name, arguments: args });

    expect(json(await call('open', { model: 'new:cube' }))).toMatchObject({ objects: 1, faces: 6 });
    await call('turn_view', { yaw: -30, pitch: 20 });
    // To the cube's front corner, gliding; then pull it out and carry it forward.
    expect(json(await call('move_to', { x: 97, y: 103, z: 100 }))).toMatchObject({ hover: 'vertex' }); // prettier-ignore
    await call('move_to', { x: 100, y: 100, ms: 0 });
    await call('press');
    await call('move_to', { x: 140, y: 150 });
    await call('move_to', { z: 160 });
    const s = json(await call('release'));
    expect(s).toMatchObject({ picked: ['vertex'], faces: 9 });

    // A key: undo, and redo.
    expect(json(await call('key', { key: 'z', ctrl: true }))).toMatchObject({ faces: 6 });
    expect(json(await call('key', { key: 'z', ctrl: true, shift: true }))).toMatchObject({ faces: 9 }); // prettier-ignore

    // The wheel pushes the plane deeper.
    const z0 = json(await call('state'))['z'] as number;
    const z1 = json(await call('wheel', { clicks: 3 }))['z'] as number;
    expect(z1).toBeLessThan(z0);

    // A look is a picture of the room.
    const look = (await call('look', { width: 640 })) as Result;
    expect(look.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    expect(Buffer.from(look.content[0]!.data!, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // prettier-ignore

    // Save is the app's: the file it writes, kept in the browser too.
    expect((await call('save', { name: 'Pulled cube' })) as Result).not.toHaveProperty('isError', true); // prettier-ignore
    const text = readFileSync(join(dir, 'pulled_cube.cut'), 'utf8');
    expect(text).toContain('Pulled cube');
    expect(await page.evaluate(() => localStorage.getItem('cutplane.world.pulled_cube.cut'))).toBe(text); // prettier-ignore
    await agent.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
  expect(errors).toEqual([]);
});

test("through MCP: hands off sets the person's mouse aside, and Take over gives it back", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the link');
  const dir = mkdtempSync(join(tmpdir(), 'cutplane-mcp-'));
  const server = await serve({ port: 0, host: '127.0.0.1', saveDir: dir });
  try {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto(`/?still=1&mcp=ws://127.0.0.1:${server.port}/bridge`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect.poll(() => server.bridge.connected).toBe(true);
    const agent = await connect(`http://127.0.0.1:${server.port}/mcp`);
    const call = (name: string, args: Record<string, unknown> = {}) =>
      agent.callTool({ name, arguments: args });

    await call('open', { model: 'new:cube' });
    await call('move_to', { x: 0, y: 0, ms: 0 });
    expect(json(await call('hands_off', { off: true }))).toMatchObject({ handsOff: true });
    await expect(page.locator('#handsoff')).toBeVisible();
    // The person's pointer and keys do nothing now; the agent's moves still go.
    const box = (await page.locator('#viewport').boundingBox())!;
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.move(box.x + 80, box.y + 90, { steps: 5 });
    await page.mouse.down();
    await page.mouse.up();
    expect(json(await call('state'))).toMatchObject({ x: 0, y: 0, picked: [] });
    expect(json(await call('move_to', { x: 30, y: 20, ms: 0 }))).toMatchObject({ x: 30, y: 20 });
    // Take over: the app is theirs again.
    await page.locator('#takeover').click();
    await expect(page.locator('#handsoff')).toBeHidden();
    expect(json(await call('state'))).toMatchObject({ handsOff: false });
    await agent.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('through MCP: a sequence pulls a corner in one call, and inspect gives back its shape', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the link');
  const dir = mkdtempSync(join(tmpdir(), 'cutplane-mcp-'));
  const server = await serve({ port: 0, host: '127.0.0.1', saveDir: dir });
  try {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto(`/?still=1&mcp=ws://127.0.0.1:${server.port}/bridge`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect.poll(() => server.bridge.connected).toBe(true);
    const agent = await connect(`http://127.0.0.1:${server.port}/mcp`);
    const call = (name: string, args: Record<string, unknown> = {}) =>
      agent.callTool({ name, arguments: args });

    await call('open', { model: 'new:cube' });
    // The whole pull, as in the first test, in one call (each move a jump now).
    const s = json(
      await call('sequence', {
        steps: [
          { do: 'turn_view', yaw: -30, pitch: 20 },
          { do: 'move_to', x: 97, y: 103, z: 100 },
          { do: 'move_to', x: 100, y: 100 },
          { do: 'press' },
          { do: 'move_to', x: 140, y: 150 },
          { do: 'move_to', z: 160 },
          { do: 'release' },
        ],
      }),
    );
    expect(s).toMatchObject({ picked: ['vertex'], faces: 9 });

    // Its shape, without a look: the corner where it was carried, its faces about it.
    type Shape = { box: number[][]; vertices: number[][]; faces: { v: number[]; n: number[] }[] }; // prettier-ignore
    const got = json(await call('inspect')) as {
      objects: Shape[];
      picked: { kind: string; object: number; vertex: number }[];
    };
    expect(got.objects).toHaveLength(1);
    const cube = got.objects[0]!;
    expect(cube.faces).toHaveLength(9);
    expect(got.picked).toEqual([{ kind: 'vertex', object: 0, vertex: expect.any(Number), at: [140, 150, 160] }]); // prettier-ignore
    expect(cube.vertices[got.picked[0]!.vertex]).toEqual([140, 150, 160]);
    expect(cube.box).toEqual([[-100, -100, -100], [140, 150, 160]]); // prettier-ignore
    for (const f of cube.faces) expect(Math.hypot(...f.n)).toBeCloseTo(1, 2);
    expect((json(await call('inspect', { all: true })) as { objects: Shape[] }).objects).toHaveLength(1); // prettier-ignore

    // A curved thing is its box and counts alone; its picked parts still say where they are.
    await call('sequence', { steps: [{ do: 'key', key: 'z', ctrl: true }, { do: 'key', key: 'Escape' }] }); // prettier-ignore
    await call('open', { model: 'samples/discovery.cut' });
    await call('key', { key: 'a', ctrl: true });
    const all = json(await call('inspect')) as { objects: (Shape & { counts: { vertices: number } })[] }; // prettier-ignore
    const big = all.objects.filter((o) => o.counts.vertices > 48);
    expect(big.length).toBeGreaterThan(0);
    for (const o of big) expect(o).not.toHaveProperty('vertices');

    await agent.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('through MCP: state says what a press takes ahead of the world, and where the rotate bars are', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the link');
  const dir = mkdtempSync(join(tmpdir(), 'cutplane-mcp-'));
  const server = await serve({ port: 0, host: '127.0.0.1', saveDir: dir });
  try {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto(`/?still=1&mcp=ws://127.0.0.1:${server.port}/bridge`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect.poll(() => server.bridge.connected).toBe(true);
    const agent = await connect(`http://127.0.0.1:${server.port}/mcp`);
    const call = (name: string, args: Record<string, unknown> = {}) =>
      agent.callTool({ name, arguments: args });

    // The docked tool: both bars, end to end.
    const s = json(await call('open', { model: 'new:cube' }));
    expect(s['rotateTool']).toEqual({
      center: [347.5, 220.5],
      bars: [
        [
          [477.5, 220.5],
          [217.5, 220.5],
        ],
        [
          [347.5, 350.5],
          [347.5, 90.5],
        ],
      ],
    });
    // On its vertical bar, a press takes the bar, whatever the world has there.
    expect(json(await call('move_to', { x: 347.5, y: 150 }))).toMatchObject({ takes: 'Vertical_Crossbar edge' }); // prettier-ignore
    // The cube picked whole: its scale box's edge handle, 20 out from its corner.
    await call('sequence', { steps: [{ do: 'move_to', x: 0, y: 0, z: 0 }, { do: 'click' }] });
    expect(json(await call('move_to', { x: 120, y: 120 }))).toMatchObject({ takes: 'scale box edge' }); // prettier-ignore
    expect(json(await call('move_to', { x: 60, y: 0 }))).not.toHaveProperty('takes');
    await agent.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('through MCP: a glide zooms with the magnifier as far as a jump does, not over and over', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the link');
  const dir = mkdtempSync(join(tmpdir(), 'cutplane-mcp-'));
  const server = await serve({ port: 0, host: '127.0.0.1', saveDir: dir });
  try {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto(`/?still=1&mcp=ws://127.0.0.1:${server.port}/bridge`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect.poll(() => server.bridge.connected).toBe(true);
    const agent = await connect(`http://127.0.0.1:${server.port}/mcp`);
    const call = (name: string, args: Record<string, unknown> = {}) =>
      agent.callTool({ name, arguments: args });
    type Box = [[number, number, number], [number, number, number]];
    const box = async () => (json(await call('inspect', { all: true }))['objects'] as { box: Box }[])[0]!.box; // prettier-ignore

    await call('open', { model: 'new:cube' });
    const before = await box();
    // The magnifier, about the room's middle: up 110 is 1.01^110 bigger, gliding as by hand.
    await call('sequence', { steps: [{ do: 'move_to', x: 0, y: 0, z: 0 }, { do: 'key', key: 'z' }] }); // prettier-ignore
    await call('sequence', {
      steps: [{ do: 'press' }, { do: 'move_to', y: 110, ms: 300 }, { do: 'release' }],
    });
    const after = await box();
    for (const k of [0, 1, 2])
      expect(after[1][k]! - after[0][k]!).toBeCloseTo((before[1][k]! - before[0][k]!) * 1.01 ** 110, 0); // prettier-ignore
    await agent.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('through MCP: a recorded build replays to the same shape, from the world it started with', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the link');
  const dir = mkdtempSync(join(tmpdir(), 'cutplane-mcp-'));
  const server = await serve({ port: 0, host: '127.0.0.1', saveDir: dir });
  try {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto(`/?still=1&mcp=ws://127.0.0.1:${server.port}/bridge`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect.poll(() => server.bridge.connected).toBe(true);
    const agent = await connect(`http://127.0.0.1:${server.port}/mcp`);
    const call = (name: string, args: Record<string, unknown> = {}) =>
      agent.callTool({ name, arguments: args });
    const shape = async () => JSON.stringify(json(await call('inspect', { all: true }))['objects']);

    await call('open', { model: 'new:cube' });
    await call('record', { name: 'pull' });
    await call('sequence', {
      steps: [
        { do: 'turn_view', yaw: -30, pitch: 20 },
        { do: 'move_to', x: 97, y: 103, z: 100 },
        { do: 'move_to', x: 100, y: 100 },
        { do: 'press' },
        { do: 'move_to', x: 140, y: 150 },
        { do: 'move_to', z: 160 },
        { do: 'release' },
      ],
    });
    await call('key', { key: 'd' });
    const made = await shape();
    await call('record', { stop: true });

    // Something else altogether in the room; the replay starts from the cube again.
    await call('open', { model: 'samples/discovery.cut' });
    const r = json(await call('replay', { name: 'pull' }));
    expect(r).toMatchObject({ done: 2, drifted: 0 });
    expect(r).not.toHaveProperty('failed');
    expect(await shape()).toBe(made);
    await agent.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('through MCP: direct calls put in, move, turn, copy, cut and pull by number, each one undo', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the link');
  const dir = mkdtempSync(join(tmpdir(), 'cutplane-mcp-'));
  const server = await serve({ port: 0, host: '127.0.0.1', saveDir: dir });
  try {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto(`/?still=1&mcp=ws://127.0.0.1:${server.port}/bridge`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect.poll(() => server.bridge.connected).toBe(true);
    const agent = await connect(`http://127.0.0.1:${server.port}/mcp`);
    const call = (name: string, args: Record<string, unknown> = {}) =>
      agent.callTool({ name, arguments: args });
    type Info = { id: number; box: number[][]; center: number[]; size: number[]; color: number[]; parts?: number[] }; // prettier-ignore
    const list = async () => (json(await call('list_objects')) as { objects: Info[] }).objects;

    await call('open', { model: 'new:cube' });
    expect(await list()).toMatchObject([{ id: 1, center: [0, 0, 0], size: [200, 200, 200] }]);

    // A primitive at a size and place; a move glided is still one step to undo.
    const post = json(await call('add_primitive', { kind: 'box', size: [10, 60, 10], center: [0, 0, 300], color: [255, 220, 60] })) as Info; // prettier-ignore
    expect(post).toMatchObject({ id: 2, box: [[-5, -30, 295], [5, 30, 305]], color: [255, 220, 60] }); // prettier-ignore
    await call('move_objects', { objects: 1, by: [100, 50, 0], ms: 200 });
    expect((await list())[0]).toMatchObject({ center: [100, 50, 0] });
    await call('key', { key: 'z', ctrl: true });
    expect((await list())[0]).toMatchObject({ center: [0, 0, 0] });

    // A ring of copies in one call, turned about the middle of the room.
    const ring = json(await call('copy_objects', { objects: 2, count: 11, rotate: { axis: 'y', degrees: 30, point: [0, 0, 0] } })) as { copies: number[][] }; // prettier-ignore
    expect(ring.copies[0]).toHaveLength(11);
    const all = await list();
    expect(all).toHaveLength(13);
    expect(all.find((o) => o.id === 5)!.center).toEqual([300, 0, 0]); // the third copy: 90° round
    const g = json(await call('group_objects', { objects: [2, ...ring.copies[0]!] })) as Info;
    expect(g.parts).toHaveLength(12);
    expect(g.size).toEqual([610, 60, 610]);

    // The cube turned, a hole drilled through it, its top pulled up to y 120.
    await call('rotate_objects', { objects: 1, axis: 'y', degrees: 45 });
    const drill = json(await call('add_primitive', { kind: 'cylinder', size: [40, 40, 400], center: [0, 0, 0] })) as Info; // prettier-ignore
    const cut = json(await call('boolean', { op: 'subtract', objects: 1, tool: drill.id })) as { objects: Info[] }; // prettier-ignore
    expect(cut.objects).toHaveLength(1);
    const pulled = json(await call('move_face', { object: 1, face: '+y', to: 120 })) as Info;
    expect(pulled.box[1]![1]).toBeCloseTo(120);
    expect(pulled.box[0]![1]).toBeCloseTo(-100);
    // Sliced in two at z 0, and the copies' group scaled to half its height.
    const halves = json(await call('slice_objects', { objects: 1, z: 0 })) as { back: Info[]; front: Info[] }; // prettier-ignore
    expect(halves.back).toHaveLength(1);
    expect(halves.front).toHaveLength(1);
    expect(halves.front[0]!.box[0]![2]).toBeCloseTo(0);
    const half = json(await call('scale_objects', { objects: g.id, size: [null, 30, null] })) as { objects: Info[] }; // prettier-ignore
    expect(half.objects[0]!.size).toEqual([610, 30, 610]);
    // What the room draws: the cube's halves and the twelve posts.
    expect((json(await call('state')) as { objects: number }).objects).toBe(3);

    await agent.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
