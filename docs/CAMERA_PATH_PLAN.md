# Camera paths: a plan

A plan for review, not yet built. The camera follows a smooth path you draw and shape in the
room. A first pass keeps the camera's aim fixed as it travels. A second pass adds a second path
that the lens looks at.

## Where things stand (October 18)

- The camera's view is on a small screen in the room above the camera. The pop-up window is
  gone.
- The old fly-over is gone with the window: its shots, Play and Record video. Its curve code (a
  centripetal Catmull-Rom through the shots, timed by arc length, easing in and out) is in git at
  `1619346`, in `packages/app/src/camera/flyover.ts`. Most of it can come back for paths.
- Cutplane has no curves. The nearest things are:
  - the pencil's stroke, a list of points in the plane, closed into a face and extruded when you
    let go (`packages/behaviors/src/tools/pencil.ts`);
  - the grouper, a "Nonmanifold" object with no faces to speak of, which `.cut` files already
    save and load.

## The idea in one paragraph

You draw a rough stroke with the pencil, starting on the camera. When you let go, the stroke
isn't closed into a solid. It becomes a **path**: a few control points with a smooth curve
through them. The control points are ordinary vertices, so everything you already do to
vertices works on them:

- hover and pick them;
- drag them in the plane;
- carry them in depth with ⌥;
- turn the whole path with the rotate tool;
- move it, undo it, save it.

Click the camera's screen to play. The camera travels along the path while its screen shows the
view, and a record button plays the trip into a video.

## Phase 1: a path the camera follows (aim fixed)

### 1. The path object

- A world object with the new property **Camerapath** and a new draw technique,
  `draw_path_technique`.
- Its geometry is a Nonmanifold brep:
  - one vertex per control point, in order;
  - one bound listing them, as the grouper's single-vertex bound does.
- The `.cut` format saves this as it is, with no format change. An old reader sees a strange
  object with no faces and ignores it.
- It isn't cut by the plane, and it isn't part of:
  - booleans, slicing or the magnet;
  - gravity or shadows;
  - mesh export (later, glTF could export it as a line).
- The camera's screen doesn't show it.
- **Risk, to spike first:** whether the kernel and the VM let you hover, pick and drag the
  vertices of a faceless Nonmanifold object. If they don't, the fallback is a thin tube solid
  with the control points as its vertices, which costs more and looks worse.

### 2. The curve

- **Recommended first:** a curve that passes _through_ the control points (centripetal
  Catmull-Rom, as the fly-over used):
  - each point you place is on the path, so no handles to learn;
  - a drag moves the curve right there.
- **Adobe-style later:** Bézier handles at each point, setting the curve's direction and pull
  there. This is more control, but each point grows two extra things to pick. They could show
  only on the picked point, as Illustrator does.
- Both are open curves. A closed loop (for orbiting a model) is a flag on the path.
- From a rough stroke to a few points:
  - simplify the raw pencil points (Ramer–Douglas–Peucker, with a tolerance in pixels, so it
    behaves the same at any zoom);
  - then place points so the Catmull-Rom curve stays close to the stroke;
  - aim for 4–12 points on a typical stroke.

### 3. Making one

- **Pencil, starting on the camera.** A stroke that starts on the camera's body becomes that
  camera's path instead of a solid. No new tool, key or pad, and it reads well: you draw where
  the camera goes, from the camera.
- The stroke is flat (it's drawn in the plane), so the path starts flat. To take it into 3D:
  - drag single points with ⌥ (forward and back) or with the plane;
  - turn the whole path with the rotate tool;
  - drag the whole path by its curve.
- **Adding and removing points:** a click on the curve between two points adds one there.
  Delete on a picked point removes it, keeping at least two.
- Picking a vertex already shows its pick box; the curve redraws live as a point is dragged.

### 4. How it looks

- The curve is a smooth line in the camera's magenta, 2 px, with a dotted copy where it's
  hidden, as the tools in hand now do.
- The control points are small hollow squares. The picked one is filled.
- A dashed control polygon is drawn only while a point is picked (Phase 1b, with Bézier
  handles).
- A small arrowhead at the end shows which way the camera travels.

### 5. Playing it

- **Controls live on the camera's screen**, in the room:
  - a thin bar under the picture, like the plates' buttons, with ▶ / ■, ● (record), and − / +
    for speed;
  - all clicked with the crosshair, with no flat panel and nothing over the room.
- **Timing:** even speed along the curve's length (arc length), easing in and out at the ends.
  Speed is in room units per second, so a longer path takes longer.
- **What moves:** the camera itself travels along the path during play, and its screen goes
  with it, showing the view.
- **Aim:** in Phase 1 the camera keeps its aim as it travels; it doesn't turn.
- **Afterwards:** the camera goes back to where it started. Playing is a preview, not an edit,
  so it isn't in the undo history.
- **Starting point:** the camera jumps to the path's start when play begins. The alternative
  (start wherever the camera is nearest on the path) is an open question below.

### 6. Recording

- During recording, a second renderer draws the camera's view to an offscreen canvas at 1280×720.
  `captureStream` and MediaRecorder turn it into a `.webm` (or `.mp4` in Safari), which
  downloads when play ends. The old window did this, so the code exists (`camerawindow.ts` at
  `1619346`).
- The second WebGL context uploads the scene again, so recording costs memory while it runs. It
  is made when recording starts and thrown away when it ends.

### 7. Keeping it

- The path is a world object, so save, autosave, undo and the room-as-you-left-it all keep it
  with no extra code.
- **The camera ↔ path link:** the camera lives in the environment, not the world, so the link
  sits on the path, as the Camerapath property. If there are several paths, the camera follows
  the one last picked (or the newest).

### 8. Tests

- **Unit:**
  - stroke simplification;
  - Catmull-Rom arc-length timing;
  - a path round-tripping through `.cut`.
- **Behaviors:**
  - a stroke from the camera makes a path, not a solid;
  - dragging a point reshapes the curve;
  - undo restores it.
- **E2E:**
  - draw a path, play it, and the camera moves along it with its screen showing the view;
  - record in Chromium.

## Phase 2: a path the lens looks at

- **A second path, the target**, drawn with the pencil starting on the camera's **lens**.
- **Matching the two:** at each moment the camera is a fraction _u_ of the way along its path
  and looks at the point the same fraction _u_ along the target path. Fractions of length, not of
  points, so the two paths needn't have the same number of points.
- **Showing the link:** faint tie lines join matching points on the two paths, every 10%, so
  you can see what the camera looks at when.
- **Other aims, which are cheap once paths exist:**
  - look at a fixed point, or at a picked object's middle;
  - look along the path, like a roller coaster;
  - keep the aim fixed (Phase 1's behaviour).
    These could be a choice on the camera's screen bar.
- **Later:** keyed timing (ease points along the path), roll, and zoom (lens length).

## Order and size

| Step                                                           | Size     |
| -------------------------------------------------------------- | -------- |
| Spike: pick and drag the vertices of a faceless object         | ½ day    |
| Path object, curve, drawing (1, 2, 4)                          | 1–2 days |
| Pencil from the camera makes a path; add and remove points (3) | 1 day    |
| Play bar on the screen; camera travels the path (5)            | 1 day    |
| Recording (6)                                                  | ½ day    |
| Tests and docs (GUIDE, README, CHANGELOG)                      | 1 day    |
| Phase 2: target path and aim choices                           | 2 days   |

## Questions for you

1. **Through the points (Catmull-Rom) first, with Bézier handles later?** Or handles from the
   start?
2. **Pencil from the camera** to make a path: is that the right gesture? Or would you rather
   have a path pad on the goodies box?
3. **After play**, should the camera go back to where it started (a preview), or stay at the
   path's end?
4. **The play bar on the camera's screen:** is it okay for the screen to grow a row of in-room
   buttons?
5. **Several paths at once** (several takes), or one path per camera?
