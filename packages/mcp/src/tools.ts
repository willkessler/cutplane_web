import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Bridge } from './bridge.ts';

/** What the app sends back for a look: the room as a JPEG, and its state then. */
interface Look {
  image: string;
  state: unknown;
}

/** The room's coordinates, told to the agent once (kernel ROOM). */
const ROOM_TEXT =
  'The room runs x -511..510 (left to right), y -382..383 (floor to ceiling), z -499..500 ' +
  '(back wall to front; the plane starts at the front). The crosshair always lies in the plane.';

const lookArg = z
  .boolean()
  .optional()
  .describe('Also take a look at the room afterwards (a screenshot).');

const point = {
  x: z.number().optional().describe('Across, -511..510.'),
  y: z.number().optional().describe('Up, -382..383.'),
  z: z.number().optional().describe("The plane's depth, -499 (back) .. 500 (front)."),
};

const ms = z
  .number()
  .int()
  .min(0)
  .max(10_000)
  .optional()
  .describe('How long the motion takes, as a hand would (default 300 ms; 0 jumps).');

/**
 * The tools: a hand on the app. Each one is input a person gives (the crosshair moved,
 * the button pressed, a key, the wheel, the room turned) or something they'd see (a
 * look, where things are); none makes geometry itself. Save is the app's own.
 */
export function addTools(server: McpServer, bridge: Bridge, saveDir: string): void {
  /** The app's answer as text, then a look if asked for. */
  const act = async (op: string, args: Record<string, unknown>, look?: boolean) => {
    const result = await bridge.call(op, args);
    const out: CallToolResult = { content: [{ type: 'text', text: JSON.stringify(result) }] };
    if (look) out.content.push(...(await looked({})).content);
    return out;
  };
  const looked = async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const { image, state } = (await bridge.call('look', args)) as Look;
    const data = image.replace(/^data:image\/\w+;base64,/, '');
    return {
      content: [
        { type: 'image', data, mimeType: 'image/jpeg' },
        { type: 'text', text: JSON.stringify(state) },
      ],
    };
  };
  const guard =
    <A>(f: (a: A) => Promise<CallToolResult>) =>
    async (a: A): Promise<CallToolResult> => {
      try {
        return await f(a);
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
      }
    };

  server.registerTool(
    'look',
    {
      title: 'Look at the room',
      description:
        'A screenshot of the room as the user sees it, and the state (see state). ' + ROOM_TEXT,
      inputSchema: {
        width: z.number().int().min(320).max(2048).optional().describe('Pixels wide (default 1024).'), // prettier-ignore
        wait_ms: z.number().int().min(0).max(10_000).optional().describe('Wait this long first (a fall, an animation).'), // prettier-ignore
      },
    },
    guard(looked),
  );

  server.registerTool(
    'state',
    {
      title: 'Where things are',
      description:
        'The crosshair (x, y) and the plane (z); the view (yaw, pitch); what the crosshair is over ' +
        '(hover) and what is picked (picked: "object", "face", "edge", "vertex"...); tools in hand; ' +
        'counts of objects, faces and vertices; the guide lines held on; the hints shown.',
      inputSchema: {},
    },
    guard(() => act('state', {})),
  );

  server.registerTool(
    'move_to',
    {
      title: 'Move the crosshair',
      description:
        'Moves the crosshair to (x, y), and the plane to depth z, as the mouse and wheel do. With ' +
        'the button held (press), it drags what is picked, and guides may hold it where it lines ' +
        'up: the result says where it ended up. Leave out what stays. ' +
        ROOM_TEXT,
      inputSchema: { ...point, ms, look: lookArg },
    },
    guard(({ look, ...a }) => act('move', a, look)),
  );

  server.registerTool(
    'turn_view',
    {
      title: 'Turn the room',
      description:
        "Turns the room, as a right-drag does: yaw -90..90 (degrees; positive turns the room's " +
        'front to the left), pitch 0..90 (looking down on it). 0, 0 faces it squarely.',
      inputSchema: {
        yaw: z.number().min(-90).max(90).optional(),
        pitch: z.number().min(0).max(90).optional(),
        ms,
        look: lookArg,
      },
    },
    guard(({ look, ...a }) => act('turn', a, look)),
  );

  server.registerTool(
    'press',
    {
      title: 'Press the button',
      description:
        'Presses the mouse button where the crosshair is and holds it: picks what is under it ' +
        '(an object, a face, an edge, a vertex, a tool, a goody in a box), or starts a marquee ' +
        'over nothing. Then move_to drags, and release lets go.',
      inputSchema: { shift: z.boolean().optional().describe('Shift held: pick more, or unpick.') },
    },
    guard((a) => act('press', a)),
  );

  server.registerTool(
    'release',
    {
      title: 'Release the button',
      description: 'Lets go of the button (ending a drag or a marquee).',
      inputSchema: { look: lookArg },
    },
    guard(({ look }) => act('release', {}, look)),
  );

  server.registerTool(
    'click',
    {
      title: 'Click',
      description: 'A click where the crosshair is (press, then release).',
      inputSchema: {
        shift: z.boolean().optional().describe('Shift held: pick more, or unpick.'),
        double: z.boolean().optional().describe('A double click.'),
        look: lookArg,
      },
    },
    guard(({ look, ...a }) => act('click', a, look)),
  );

  server.registerTool(
    'drag',
    {
      title: 'Drag',
      description:
        'Presses where the crosshair is, moves to (x, y) and depth z over ms, and releases: ' +
        'press, move_to, release in one.',
      inputSchema: { ...point, shift: z.boolean().optional(), ms, look: lookArg },
    },
    guard(({ look, ...a }) => act('drag', a, look)),
  );

  server.registerTool(
    'key',
    {
      title: 'Press a key',
      description:
        'Presses and releases a key, as on the keyboard. key: a letter or digit ("a", "1"), "\\\\", ' +
        '"/" or a key name ("Space", "Escape", "Delete", "Backspace", "ArrowLeft", "Enter"). ' +
        'The keys: D duplicate, Delete, G group/ungroup, B union, A line up, Shift-A space evenly, ' +
        '\\ slice at the plane, R rotate tool, Z magnifier, H pan hand, P pencil, M ruler, V globe ' +
        '(gravity), Space plane to the walls and back, 0 face the room, 1 how the rest is drawn, ' +
        '? the keys plate, Esc put the tool away, Ctrl-Z undo, Shift-Ctrl-Z redo, Ctrl-A pick all.',
      inputSchema: {
        key: z.string().min(1),
        shift: z.boolean().optional(),
        ctrl: z.boolean().optional(),
        alt: z.boolean().optional(),
        meta: z.boolean().optional(),
        look: lookArg,
      },
    },
    guard(({ look, ...a }) => act('key', a, look)),
  );

  server.registerTool(
    'wheel',
    {
      title: 'Roll the wheel',
      description:
        'Rolls the mouse wheel: each click pushes the plane 8 units, positive deeper (away), ' +
        'negative toward you. The plane stops a while at faces lying in it, as by hand.',
      inputSchema: { clicks: z.number().int().min(-200).max(200), look: lookArg },
    },
    guard(({ look, ...a }) => act('wheel', a, look)),
  );

  server.registerTool(
    'locate',
    {
      title: 'Where is it',
      description:
        'The middle of a thing in the room, as one would see where it is: prims (the primitives ' +
        'box), goodies, stamps (the primitives in the box), picked, base, chip, bars (the colour ' +
        'control), bulb, camera, toolpads, arrangepads, pads, arrangers, rails (which are open), ' +
        'inHand, measure, help.',
      inputSchema: { what: z.string() },
    },
    guard((a) => act('locate', a)),
  );

  server.registerTool(
    'open',
    {
      title: 'Open a world',
      description:
        'Picks a world from the model menu: "new:cube" (a cube to shape from scratch), ' +
        '"samples/discovery.cut" and the other samples, or "saved:<name>.cut" (one saved here).',
      inputSchema: { model: z.string(), look: lookArg },
    },
    guard(({ look, ...a }) => act('open', a, look)),
  );

  server.registerTool(
    'save',
    {
      title: 'Save the world',
      description:
        'Saves the world being made as a .cut file, as the Save button does (the app writes it; ' +
        'a copy is kept in the browser too). The file goes in corpus/mcp/.',
      inputSchema: { name: z.string().min(1).describe('The title, and the file name.') },
    },
    guard(async ({ name }) => {
      const { text, file } = (await bridge.call('save', { name })) as { text: string; file: string }; // prettier-ignore
      await mkdir(saveDir, { recursive: true });
      const path = join(saveDir, file.replace(/[/\\]/g, '_'));
      await writeFile(path, text);
      return { content: [{ type: 'text', text: `Saved ${path} (${text.length} characters).` }] };
    }),
  );
}
