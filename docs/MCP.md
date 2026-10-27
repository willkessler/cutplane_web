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
window: moves glide (300 ms unless the agent asks otherwise), so they can be followed.

## The tools

| Tool               | What it is to a person                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `move_to`          | Moving the mouse (x, y) and the plane (z), gliding there. With the button held, it drags; guides may hold it, and the result says where it ended up. |
| `press`, `release` | The button held down (Shift: pick more) and let go.                                                                                                  |
| `click`, `drag`    | A click (or a double click); a press, a move and a release in one.                                                                                   |
| `key`              | A key, with Shift, Ctrl, Alt or ⌘ (`"d"`, `"\\"`, `"Space"`, `"Escape"`…).                                                                           |
| `wheel`            | The mouse wheel: each click pushes the plane 8 units, positive deeper.                                                                               |
| `turn_view`        | A right-drag: yaw −90…90°, pitch 0…90°.                                                                                                              |
| `look`             | A screenshot of the room (JPEG), and the state.                                                                                                      |
| `state`            | Where the crosshair and plane are, what's under the crosshair and picked, tools in hand, counts, guides held, the hints shown.                       |
| `locate`           | Where something in the room is (the primitives box, the colour control, the rails…), as one can see it.                                              |
| `open`             | A world from the model menu (`new:cube`, `samples/discovery.cut`, `saved:<name>.cut`).                                                               |
| `save`             | Save: the app writes the `.cut` file, keeps a copy in the browser, and the server puts it in `corpus/mcp/`.                                          |

Each action tool takes `look: true` to send a screenshot back with its result.

The room runs x −511…510 (left to right), y −382…383 (floor to ceiling) and z −499…500 (back
wall to front). The crosshair always lies in the plane.

## How it works

`packages/mcp` is the server: MCP over HTTP at `/mcp` (stateless, JSON responses) and a
WebSocket at `/bridge` on the same port. `packages/app/src/mcp.ts` is the page's end, loaded
only with `?mcp`: it takes each request and does it through the same hooks the end-to-end tests
use (`window.__cutplane`), and keys and the wheel as DOM events on the page, so they go through
the app's own handlers. `e2e/mcp.spec.ts` works the app through the server from end to end.
