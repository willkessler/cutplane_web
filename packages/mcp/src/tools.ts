import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Bridge } from './bridge.ts';
import { logPath, readLog, replay, type Recorder } from './record.ts';

/** What the app sends back for a look: the room as a JPEG, and its state then. */
interface Look {
  image: string;
  state: unknown;
}

/** The room's coordinates, told to the agent once (kernel ROOM). */
const ROOM_TEXT =
  'The room runs x -511..510 (left to right), y -382..383 (floor to ceiling), z -499..500 ' +
  '(back wall to front; the plane starts at the front). The crosshair always lies in the plane.';

/**
 * What the agent is told when it connects: how to work the app without the slips a long
 * build ran into (docs/MCP.md, "Working well", says the same at more length).
 */
export const INSTRUCTIONS = [
  'Cutplane is worked as a person works it: the crosshair, the plane, the button, keys. ' +
    ROOM_TEXT,
  "Before a run of work, hands_off {off: true}, so the person's mouse resting on the room " +
    "can't steer the crosshair; it lapses after two minutes without a call, so turn it on " +
    'again after a long stretch of reading code, and off when done.',
  'Check by numbers, not by eye: inspect after each step, and save now and then. inspect ' +
    'with all: true lists every object, long on a curved world; pick what you mean to check.',
  'A press takes the nearest part: within about 12 of a face (a thin bar, a face lying near ' +
    'the plane) it takes that face, and a drag then moves the face, reshaping the object. To ' +
    'pick or move a whole object, use the grabber (on the arrange rail; open it with the ' +
    "rail's handle and find it with locate arrangers), or press well inside its section. " +
    'Ctrl-Z undoes a slip. An edge takes a press ahead of a face within about 12 of it too, ' +
    'so a section under 24 across has no face to press: trim a small block one way while it ' +
    'is still broad the other (its depth by the face in the plane, then its width, then its ' +
    'height), or drag the two edges (corners, in the section) one after the other.',
  'A drag is held where things line up (faces, the room): the result says where it ended. To ' +
    'land a small correction, move past it and come back; a move of a unit or two may not ' +
    "register. A face left flush with another's (a cutter's top level with the face it " +
    'cuts) is better set clear of it.',
  'The scale box stands 20 outside the object, and that margin scales with it. A corner or ' +
    'edge handle scales about the opposite corner of the box, so to take an object from size ' +
    's to S along an axis, drag the handle to the far box face + (s + 40)·S/s. Click away and ' +
    'on the object again after a move or a scale, so the box fits it before the next drag. ' +
    "The corners are taken only with the plane at the box's front or back; with the plane " +
    'inside, a press takes an edge handle (across and up only). The room stops a handle, so ' +
    'a large factor takes two drags, the object moved first to give the handle room.',
  'R puts the rotate tool at the crosshair and keeps what is picked, and the picking goes on ' +
    'with it: an object under the crosshair when R is pressed is picked too, and turns ' +
    'with the rest. Slide along a bar a unit per degree. R on its centre puts it away.',
  'D copies what is picked. A copy of a copy goes on by the move and turn that took the one ' +
    'before to it (a ring by a turn each time); a first copy, or one scaled since, goes 100 ' +
    'over and 100 up (or on by the move between middles). Grouped, a set copies as one. ' +
    'The step is the whole move from the source, so a copy moved far (a window lifted to the ' +
    'other ring) sends its own copy as far again, out of the room maybe; reshape it (\\ a ' +
    'sliver off) and it goes 100 over and up instead. For a ring: copy, put the copy back on ' +
    'its source, turn it with R about the centre, then D again and again.',
  'The grabber picks one thing whole and goes back to its pad; with it out, Shift-click picks ' +
    'as without it. To pick many thin things whole, drag a marquee (moving the plane makes it ' +
    'a 3D box; it takes what it touches): start it more than 12 from every face and scale-box ' +
    'handle, or the press takes and drags that instead.',
  'To paint, open the goodies box for the colour control and move it clear of the rotate ' +
    "tool's dial (a press there turns all that is picked). Picking sets the bars to the " +
    "thing's colour; dragging a bar gives what is picked all three bars' colour. Pick first.",
  'A primitive comes from the primitives box (locate prims, click it open, drag a stamp ' +
    "out); its cylinder's axis is the depth (z). The drill (on the tools' rail) presses on " +
    'an object and cuts its copy from all it overlaps when let go; let go in place, it cuts ' +
    'where the object is; then delete the cutter. \\ slices what is picked at the plane and ' +
    'moves the halves 10 apart.',
].join('\n\n');

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
  .describe('How long the motion takes (default 0: it jumps; 300 or so glides, as a hand would).'); // prettier-ignore

/** A sequence's steps, by the tools' names, and the app's for each. */
const STEPS = {
  move_to: 'move',
  turn_view: 'turn',
  press: 'press',
  release: 'release',
  click: 'click',
  drag: 'drag',
  key: 'key',
  wheel: 'wheel',
} as const;
/** How long a sequence may take, all told (each glide takes as long as it is asked to). */
const SEQUENCE_MS = 120_000;

/**
 * The tools: a hand on the app. Each one is input a person gives (the crosshair moved,
 * the button pressed, a key, the wheel, the room turned) or something they'd see (a
 * look, where things are, their shapes); none makes geometry itself. Save is the app's own.
 * A sequence is several hand moves in one call. A recording keeps every call, to replay.
 */
export function addTools(
  server: McpServer,
  bridge: Bridge,
  saveDir: string,
  recorder: Recorder,
): void {
  /** The app's answer as text, then a look if asked for. */
  const act = async (op: string, args: Record<string, unknown>, look?: boolean, ms?: number) => {
    const result = await bridge.call(op, args, ms);
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
        '(hover) and what is picked (picked: "object", "face", "edge", "vertex"...); takes: what ' +
        'a press here takes ahead of hover, a tool or goodie of the room ("Colorcontrol red bar", ' +
        '"Vertical_Crossbar edge") or a scale box\'s handle ("scale box corner"); with neither ' +
        'and nothing hovered, a press drags what is picked (a marquee if nothing is); tools in ' +
        'hand; the rotate tool (rotateTool: its centre; the part the crosshair is on: "bar", ' +
        '"bauble" or "center"; bars: the bars it shows, end to end, a bauble at each end. Set ' +
        'on an edge in the plane it shows one bar, across that edge; on an edge piercing the ' +
        'plane, no bar, only the baubles, which dial about the edge); ' +
        'counts of objects, faces and vertices; the guide lines held on; the hints shown.',
      inputSchema: {},
    },
    guard(() => act('state', {})),
  );

  server.registerTool(
    'hands_off',
    {
      title: "Set the person's input aside",
      description:
        "off: true sets the person's own mouse, wheel and keys aside while you work, so a " +
        'pointer resting on the room cannot steer the crosshair; a banner says so, and its ' +
        'button gives them the app back. off: false hands it back. It lapses by itself after ' +
        'two minutes without a tool call, or when the link drops. Turn it on before a run of ' +
        'work and off when done; state.handsOff says whether it is on.',
      inputSchema: { off: z.boolean() },
    },
    guard((a) => act('hands', a)),
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
      inputSchema: {
        shift: z
          .boolean()
          .optional()
          .describe('Shift held: pick more, or unpick; on nothing, a marquee that picks more.'),
      },
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
        '\\ slice at the plane, R rotate tool (to the crosshair; R on its centre puts it away. A ' +
        'stroke along a bar rolls what is picked 1° a unit about the in-plane axis across the bar, ' +
        "through the tool's centre, not the object's: put the tool on the object's middle first. " +
        "A roll ends at the bar's end; within 10 units of an end is the bauble, which dials " +
        'about the plane normal instead), Z magnifier, H pan hand, P pencil, M ruler, V globe ' +
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
    'sequence',
    {
      title: 'Several moves in a row',
      description:
        'Does steps one after another, a frame apart, and gives back the state after the last ' +
        '(see state): one call for a whole gesture, say press, move_to, move_to, release. Each ' +
        'step is {"do": <tool>, ...that tool\'s arguments}, the tool one of move_to, turn_view, ' +
        'press, release, click, drag, key, wheel (no look, shift on press/click/drag, ms as ' +
        'there). It stops at a step that fails, and says which.',
      inputSchema: {
        steps: z
          .array(z.object({ do: z.enum(Object.keys(STEPS) as [keyof typeof STEPS]) }).passthrough()) // prettier-ignore
          .min(1)
          .max(200),
        look: lookArg,
      },
    },
    guard(
      ({ steps, look }) =>
      act('sequence', { steps: steps.map(({ do: d, ...a }) => ({ ...a, do: STEPS[d] })) }, look, SEQUENCE_MS), // prettier-ignore
    ),
  );

  server.registerTool(
    'inspect',
    {
      title: 'The shapes of things',
      description:
        'The shapes of what is picked (all: true, of every object in the world), in room ' +
        'coordinates, to check work by without a look: for each object its name, colour, box ' +
        '[least corner, greatest] and counts; with 48 corners or fewer, also its vertices ' +
        '[[x, y, z]...] and faces (v: its corners as indices into vertices, the outer loop; n: ' +
        'its outward normal; holes, if any). And picked: what is picked, by index into objects, ' +
        "a part with where it is (a vertex at, a face's corners and n, an edge's ends at). " +
        'all: true on a curved world is long: pick what you need instead.',
      inputSchema: { all: z.boolean().optional() },
    },
    guard((a) => act('inspect', a)),
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

  server.registerTool(
    'record',
    {
      title: 'Record the build',
      description:
        'Starts recording every call made of the app from here on (each tool, with its ' +
        'arguments, how long it took and where things were after), to replay the build the ' +
        'same way. It begins with the world as it is now, the toolbar choices and the view. ' +
        'stop: true ends it. The log goes in corpus/mcp/logs/<name>.jsonl; starting another ' +
        'ends the one before.',
      inputSchema: {
        name: z.string().min(1).optional().describe("The recording's name (to start one)."),
        stop: z.boolean().optional(),
      },
    },
    guard(async ({ name, stop }) => {
      const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] });
      if (stop) {
        const path = recorder.stop();
        return text(path ? `Recorded ${path}.` : 'Nothing was being recorded.');
      }
      if (!name) return text(`Recording: ${recorder.recording ?? 'nothing'}. Give a name to start.`); // prettier-ignore
      return text(`Recording to ${await recorder.start(name)}.`);
    }),
  );

  server.registerTool(
    'replay',
    {
      title: 'Replay a recording',
      description:
        'Does a recorded build again: opens the world it started from, sets the toolbar and ' +
        'view as they were, then makes each call it made, in order (not the looks), and ' +
        'says where it came out otherwise than recorded (drift) or failed. pace "recorded" ' +
        'keeps the pauses between calls (to watch, or film); up_to stops after that many.',
      inputSchema: {
        name: z.string().min(1),
        pace: z.enum(['fast', 'recorded']).optional(),
        up_to: z.number().int().min(1).optional(),
      },
    },
    guard(async ({ name, pace, up_to }) => {
      const r = await replay(bridge, readLog(logPath(saveDir, name)), { pace, upTo: up_to });
      const drift = r.drift.slice(0, 10);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...r, drift, drifted: r.drift.length }) }],
      };
    }),
  );
}
