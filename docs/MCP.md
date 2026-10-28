# An agent's hand on Cutplane (MCP)

New in 2026. An agent such as Claude Code can work Cutplane the way a person does, through an
[MCP](https://modelcontextprotocol.io) server: it moves the crosshair, presses and lets go of
the button, presses keys, rolls the wheel, turns the room and looks at the room, while you
watch it happen in your own browser. None of its tools makes geometry. Everything is made by
the app's tools, the plane and the world's CPL, as it is for anyone, and the file is written
by the app's own Save.

## Running it

```sh
docker compose up dev mcp     # the app on :5173, the MCP server on :5174
```

Open the app with `?mcp`: <http://localhost:5173/?mcp>. The page connects to the server, and
connects again if the server restarts. `?mcp=ws://host:port/bridge` points it somewhere else.
<http://localhost:5174/> says whether a page is connected. The last page to connect is the one
worked, so keep one tab open.

Claude Code picks the server up from the repository's `.mcp.json` (it asks before using it the
first time). For another project or client, add it by hand:

```sh
claude mcp add --transport http cutplane http://localhost:5174/mcp
```

An MCP client finds its servers when it starts, so start a new session after adding it.

While the agent works, keep your mouse off the room: in windowed mode the crosshair follows the
pointer, so your mouse moving over it moves the crosshair too. To record it, record the browser
window, and have the agent glide (`ms` 300 or so): its moves jump unless it asks. A glide goes
a step a frame from where the hand has the crosshair, as a mouse does, so a tool that holds the
crosshair still and works by the move (the magnifier) gets each step once.

## The tools

| Tool               | What it is to a person                                                                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `move_to`          | Moving the mouse (x, y) and the plane (z): a jump unless `ms` asks for a glide. With the button held, it drags; guides may hold it, and the result says where it ended up.                                                                                                         |
| `press`, `release` | The button held down (Shift: pick more; on nothing, a marquee that adds) and let go.                                                                                                                                                                                               |
| `click`, `drag`    | A click (or a double click); a press, a move and a release in one.                                                                                                                                                                                                                 |
| `key`              | A key, with Shift, Ctrl, Alt or ⌘ (`"d"`, `"\\"`, `"Space"`, `"Escape"`…).                                                                                                                                                                                                         |
| `wheel`            | The mouse wheel: each click pushes the plane 8 units, positive deeper.                                                                                                                                                                                                             |
| `turn_view`        | A right-drag: yaw −90…90°, pitch 0…90°.                                                                                                                                                                                                                                            |
| `look`             | A screenshot of the room (JPEG), and the state.                                                                                                                                                                                                                                    |
| `state`            | Where the crosshair and plane are, what's under the crosshair and picked, what a press would take first (a room tool or goodie, a scale box's handle), tools in hand, the rotate tool's centre, bars and the part of it under the crosshair, counts, guides held, the hints shown. |
| `locate`           | Where something in the room is (the primitives box, the colour control, the rails…), as one can see it.                                                                                                                                                                            |
| `open`             | A world from the model menu (`new:cube`, `samples/discovery.cut`, `saved:<name>.cut`).                                                                                                                                                                                             |
| `save`             | Save: the app writes the `.cut` file, keeps a copy in the browser, and the server puts it in `corpus/mcp/`.                                                                                                                                                                        |
| `hands_off`        | Your own mouse, wheel and keys set aside while the agent works (a banner says so; its **Take over** button gives the app back). It lapses after two idle minutes.                                                                                                                  |
| `sequence`         | Several of the moves above in one call (`[{"do": "press"}, {"do": "move_to", "x": 40}, …]`), a frame apart; the state after the last. A whole gesture is one call.                                                                                                                 |
| `record`, `replay` | A log of every call, from the world as it was (see below); the build done again from it.                                                                                                                                                                                           |
| `inspect`          | The shapes of what is picked (or of everything): each object's box, vertices and faces (corners, normal) in room coordinates, and the picked parts. To check work without a look.                                                                                                  |

Each action tool takes `look: true` to send a screenshot back with its result.

## Working well

The agent works the app as a person does, so it slips as a person would. These are the slips
that building the Orion III and the space station from _2001_ ran into, and how to avoid them.
The server tells an agent the same when it connects (its instructions, `INSTRUCTIONS` in
`packages/mcp/src/tools.ts`).

- **Hands off first.** Turn `hands_off` on before a run of work, or a mouse resting on the room
  steers the crosshair. It lapses after two minutes without a call, so after a long stretch of
  reading code, turn it on again.
- **Check by numbers.** `inspect` after each step says exactly where things came out; a look
  doesn't. Save now and then. `inspect` with `all: true` on a world of 72-sided cylinders runs
  to tens of thousands of characters: pick what you mean to check.
- **A press near a face takes the face.** Within about 12 units of a face (a thin bar, a face
  lying close to the plane), a press picks that face, and a drag moves it, reshaping the object.
  To pick or move a whole object, take the **grabber** from the arrange rail (open the rail with
  its handle; `locate arrangers` gives its pads), or press well inside the object's section.
  Ctrl-Z undoes a slip.
- **Drags are held where things line up.** A move stops at faces it lines up with, and the
  result says where it ended. To land a small correction, go past it and come back: a move of
  a unit or two may not register at all. A cutter's face left flush with the face it cuts is
  better set clear of it.
- **The scale box's margin scales too.** The box stands 20 outside the object and grows with it.
  A corner or edge handle scales about the box's opposite corner, so taking an object from size
  _s_ to _S_ along an axis means dragging the handle to the far box face + (_s_ + 40)·_S_/_s_.
  After a move or a scale, click away and on the object again so the box fits before the next
  drag; a stale box scales from the wrong place. Corners are taken only with the plane at the
  box's front or back; with the plane inside, a press takes an edge handle, which scales across
  and up only. The room stops a handle, so a large factor takes two drags, with the object moved
  first to leave the handle room.
- **R picks what is under the crosshair too.** The rotate tool goes where the crosshair is and
  keeps what is picked; an object under the crosshair is picked as well and turns with the rest.
  Slide along a bar a unit per degree. R on its centre puts it away (and unpicks).
- **D goes on as the last copy went.** A copy of a copy is moved and turned as that one was (a
  ring by a turn each time). A first copy goes 100 over and 100 up; one scaled since goes on by
  the move between the middles. Grouped (G), a set copies as one.
- **Primitives and cuts.** A primitive comes from the primitives box (`locate prims`, click it
  open, drag a stamp out); its cylinder's axis is the depth (z), so stand it up with R. The drill
  copies what it presses and, let go (in place, if the cutter is already where it should cut),
  cuts the copy from everything it overlaps; then delete the cutter. `\` slices what is picked
  at the plane and moves the two halves 10 apart.

## Recording a build, and replaying it

`record` with a name starts a log of every call the agent makes of the app, in
`corpus/mcp/logs/<name>.jsonl`, one JSON line each; `record` with `stop: true` ends it. The
first line is where the build started: the world as it was (its `.cut` text), the toolbar's
choices (plane style, faces drag, group pick, level hold, plane stick, which the browser
remembers) and the crosshair, plane and view. Each call after it keeps its arguments, when it
was made, how long it took and where things were after it: the crosshair and plane, the view,
what was picked, how many objects, and whether hands off was on (it lapses after two idle
minutes, so a log shows where it did). Looks keep their state, not their picture. The page
reconnecting (a reload) is a line of its own.

`replay` does a recording again: it opens the world it started from, sets the toolbar and the
view as they were, and makes each call in order, all but the ones that only look (`look`,
`state`, `locate`, `inspect`, `save`). After each it checks where things are against the
recording and reports what came out otherwise (`drift`, with the line in the log), or the
call that failed where it hadn't. `pace: "recorded"` keeps the pauses between calls, to watch
it or film it; `up_to` stops after that many calls, to replay part of a build.

The room runs x −511…510 (left to right), y −382…383 (floor to ceiling) and z −499…500 (back
wall to front). The crosshair always lies in the plane.

## How it works

`packages/mcp` is the server: MCP over HTTP at `/mcp` (stateless, JSON responses) and a
WebSocket at `/bridge` on the same port. `packages/app/src/mcp.ts` is the page's end, loaded
only with `?mcp`: it takes each request and does it through the same hooks the end-to-end tests
use (`window.__cutplane`), and keys and the wheel as DOM events on the page, so they go through
the app's own handlers. `e2e/mcp.spec.ts` works the app through the server from end to end.
