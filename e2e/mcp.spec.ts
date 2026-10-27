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
