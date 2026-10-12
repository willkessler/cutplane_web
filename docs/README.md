# Cutplane documentation

The user guide and architecture notes will grow here as each milestone lands. Screenshots go in
`docs/images/`.

## Roadmap

| Milestone | Scope                                                               |
| --------- | ------------------------------------------------------------------- |
| **M0** ✅ | Scaffold: workspace, Docker dev/prod images, tests, CI              |
| **M1** ✅ | Kernel and `.cut` I/O: half-edge B-rep, Euler operators, validation |
| **M2** ✅ | Room, plane, section and full-screen work mode                      |
| **M3** ✅ | Direct manipulation: pick, drag, constrain, carry, marquee, undo    |
| **M4** ✅ | Rotate tool, duplicate, delete, scale boxes, colour                 |
| **M5** ✅ | CPL VM and environment: code stored in objects, live editing        |
| M6        | Modeling operations: slice, booleans, drill, push/pull              |
| M7        | Formats: OBJ, STL, glTF, drag and drop, autosave                    |
| M8        | Ship: user guide, help plate, deployment                            |
| M9        | Acceptance: load and rebuild the stapler, fan and Discovery         |
| M10       | Language evolution (optional)                                       |

## Using Cutplane

![The Discovery cut at z = 0, room turned 25° to the left](images/section-discovery.png)

The room is a box in front of you. The **cutplane** is always parallel to its front wall and
moves only in depth, and the **crosshair** always lies in the plane. Wherever the plane slices a
solid you see its **section**: medium yellow where the cut surface faces you, edged in black so it
reads over any colour, dotted where geometry in front of the plane hides it, and bright yellow
for edges lying exactly in the plane. Whatever is behind the plane shows through its stipple, so
"behind" is visible at a glance. Shadows fall straight down onto the floor.

As the plane moves slowly it **clicks onto vertex depths**: a small move that would carry it past
a vertex lands exactly on it, and the next move carries on. Fast moves fly straight through, so a
dense model never slows you down (the original's `snap_plane_to_nearestpt`). That is how faces and
edges come to lie in the plane, ready to grab. Holding **Ctrl** moves the plane slowly with no
snapping.

### Controls

Pick a profile in the toolbar (Macs default to the trackpad). Every mode is **spring-loaded**: it
lasts only while you hold the key or button.

| Action          | Trackpad / one button        | Three-button mouse | Two-button mouse     |
| --------------- | ---------------------------- | ------------------ | -------------------- |
| Move crosshair  | move                         | move               | move                 |
| Plane depth     | hold ⌥ + move, scroll        | middle-drag, wheel | hold ⌥ + move, wheel |
| Rotate the room | hold ⌘ + move, or right-drag | right-drag         | right-drag           |
| Pick, drag      | click, press and drag        | left               | left                 |
| Carry in depth  | drag, then hold ⌥            | left + middle      | drag, then hold ⌥    |
| Add or remove   | shift-click                  | shift-click        | shift-click          |
| One axis        | hold Ctrl                    | hold Ctrl          | hold Ctrl            |

| Key     | Command                                                   |
| ------- | --------------------------------------------------------- |
| Space   | Plane jump: glides to the back wall, and back again       |
| ← → ↑ ↓ | Rotate the room 10° (±90° side to side, 0–90° from above) |
| 0       | Reset the view                                            |
| F       | Start or stop working (full screen, pointer captured)     |
| R       | Rotate tool to the crosshair (on its centre: put it away) |
| D       | Duplicate what is picked                                  |
| ⌫       | Delete what is picked                                     |
| ⌘Z, ⇧⌘Z | Undo, redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y elsewhere)     |

Dragging the plane follows the plane on screen: you push it the way it visibly travels as it goes
deeper. Facing the room, that is up the screen; with the room turned 90°, it is sideways. Two-finger
swipes on a trackpad follow it the same way. A mouse wheel turned away always sends it deeper.

### Editing

![A new cube with one corner pulled out and carried forward](images/edit-cube.png)

Everything is picked and moved through the section, at the crosshair. What the crosshair would
pick is outlined in white, with a yellow pick box at the point it would take hold of; what is
picked is red. In order of priority, within a 10-unit box around the crosshair:

1. a **vertex** lying in the plane;
2. an **edge**: one lying in the plane (anywhere along it), or one piercing it (at the
   piercing point, a corner of the section);
3. a **face**, through its section line;
4. a **face lying in the plane**, from anywhere inside it;
5. the whole **object**, from inside its section. Objects marked `Lockedgeometry` are always
   picked whole, and an object is always picked with the group it belongs to.

**Press and drag** to move what is picked: a 5-unit dead zone first, so a click never nudges
anything, then it follows the crosshair exactly. Everything moves rigidly, in the plane. **Moving
the plane while still holding** carries it in depth too, and so does the plane jump (Space).
Faces the motion would bend are split first, so every face stays flat: a convex face loses just
the triangle at the moving corner, anything else is triangulated. The pieces still act as one
face (they highlight and drag together), and **on release, pieces that are flat again merge
back**. Pull a corner out and push it back, and the cube is a cube again.

- **Shift-click** adds to what is picked, or takes a picked feature or object away. Pressing on
  something already picked keeps the rest, so several things can be dragged together.
- **Press on empty space** and drag out a **marquee**: a box in the plane, or a 3D box if you move
  the plane while dragging. It picks the objects inside it (shift adds to the picks). A plain
  click on empty space drops all picks.
- **Ctrl** locks the crosshair, and so the drag, to one axis: it holds still for the first 5
  units and then follows only the axis you pushed along most.
- **Undo and redo** (⌘Z / ⇧⌘Z) go back and forth one drag at a time. A drag that would leave a
  solid broken (an edge squashed to nothing, a face folded flat) is put back on release.
- **New cube** in the model menu starts from a plain cube, to shape from scratch.

### Tools

![The rotate tool set on a cube in the plane, rolling it](images/tool-rolled.png)

Like everything else, the tools stand in the room and are used through the plane.

- **The rotate tool** always lies in the cutplane, parked in the upper right corner: a centre
  ring, two crossbars with a bauble at each end, and a dial circle. **R** brings it to the
  crosshair and picks what is there on its own. Over a vertex, edge or face it lines up with
  the feature: along an edge lying in the plane, across a face's section line, or, on an edge
  piercing the plane, ready to spin about that edge. **R** on the tool's centre parks it again,
  and the centre can also be dragged and dropped onto a feature.
  - **Slide along a bar** to roll what is picked about the axis in the plane across the bar,
    through the centre: 1° per unit. The crosshair stays on the bar.
  - **Off the end of a bar**, or from a **bauble**, the drag turns the dial: the crosshair rides
    the circle and what is picked spins about the plane's normal (or about the piercing edge),
    the bars turning with it. It pauses briefly at horizontal.
  - **Set on a face's section line**, rolling stops briefly when the face stands straight across
    the plane, and within 5° of lying in the plane it **snaps the face exactly into the plane**;
    the rotation ends there and everything is let go.
  - Rotation always turns whole objects (with their group).
- **Scale boxes.** A picked object shows the handles of a box 20 units outside it: grey squares
  where the box's edges pierce the plane, white ones at corners the plane is near. Drag an edge
  handle to stretch the object across that edge, away from the opposite one; move the plane
  while holding it to slide the handle along its edge to a corner. Drag a corner to scale about
  the opposite corner, each axis on its own (carrying it in depth scales in depth). **Ctrl**
  scales evenly about the middle.
- **D** duplicates what is picked: each picked thing's whole object, 100 units right and up, and
  the copies are picked. **⌫** deletes it: whole objects, or single vertices, edges and faces.
  Deleting a vertex cuts it off, the faces around it becoming one face across its neighbours;
  an edge between two faces lying flat merges them, any other edge goes with both its ends; a
  face goes with all its corners. A delete that would leave the solid broken or flat is refused.
- **The colour control** lives in the goodies box (see below): three bars, red, green and blue,
  on a base, and a white paint chip. Drag a bar's top up or down and what is picked takes the
  mixed colour as you go. Drag the chip and a copy comes away with the crosshair; carry it to a
  face or an object (move the plane with it) and let go to paint it there. A face painted on its
  own keeps its colour when its object is recoloured. Drag the **base** to bring the whole
  control along, up beside what you are colouring (move the plane while holding it to carry it
  forward).

All of these can be undone.

### The environment

![The toolpads' rail opened: pencil, saw and drill on their pads](images/env-rails.png)

The room is laid out as in the 3Form photos. Everything in it runs on the original CPL scripts.

- **Toolbars** ride in the plane, top left: a **headpad** with its icon (the hammer for tools,
  the grabber for arranging), and under it a rail of **toolpads**, each with its tool's picture.
  Click a headpad to open or close its rail.
  - Click a toolpad and its tool comes off it and rides on the crosshair, just in front of the
    plane. Click the pad again to put the tool back.
  - Drag a pad by its handle (the strip along its top) to pull it off the rail. Let it go
    anywhere to leave it floating, on another rail to hang it there, or on a headpad to drop it in.
  - The tools themselves (pencil, saw, drill, magnifier, group, pan, magnet) do their work in M6.
- **Toolboxes** stand on the floor by the back wall, bottom right; Space takes the plane there.
  Click one to open it, and what it holds stacks up above it.
  - **Primitives box.** Pick a primitive (cube, cylinder, cone, sphere, pyramid) and a copy is
    stamped into the world, picked, ready to drag forward. The box closes again.
  - **Goodies box.** It holds the **camera**, the **light bulb** and the **colour control**. Drag
    one out to use it; drop it on the box to put it back.
    - The bulb lights the room in its colour from wherever it is. Paint it with the colour
      control to change the light.
    - Click the camera to show what it sees, on a slide above it, and drag it to look elsewhere.
      Put the plane through its lens and drag the lens to aim the camera: it turns about its
      middle to follow the crosshair (`lens.cpl`). Dropped back on its box, the bulb goes out
      and the camera's slide goes away.
- **The storage pad** (the floppy disk, bottom left in the plane) opens the **Load / Save
  plate**. Click a field and type: the keys go to the field (Backspace, ← →; Esc puts the old
  text back), not to the commands.
  - Return on **Save to:** keeps the world in this browser under that name.
  - Return on **Load from:** brings in a world you saved, or a bundled sample (`disc4`,
    `stapler`...).

![The Load / Save plate, a name being typed into Load from:](images/env-plate.png)

![The camera out of its box, its slide showing the Discovery](images/goodies-camera.png)

### Code

![The CPL editor showing stamp.cpl](images/code-editor.png)

Behaviour lives in CPL, the original's own scripting language, and the app runs the original
scripts. **Code**, in the toolbar, opens the editor (outside work mode only, so nothing flat
covers the room while you work).

- Choose a **property file** (`stamp.cpl`, `toolbox.cpl`, `paint.cpl` and so on) to see the code
  that runs for everything with that property. Choose **What is picked** to see the picked
  thing's name, its properties and its own private code.
- Edit it and press **Apply** (⌘↵ / Ctrl+↵). The world runs the new code from the next frame,
  with nothing restarted: change `stamp.cpl` and the next stamp behaves differently. A broken edit
  is refused, its errors listed, and the old code keeps running.
- **Save** writes the world as a `.cut` file, and each object's private code goes into the file
  with it. **Open…** reads one back, and the code comes too.

### Work mode

**Start working** (or F) goes full screen and captures the pointer, like the SGI: the cursor
can't leave the window, and the plane and room can be pushed as far as you like without hitting a
screen edge. Input is raw relative motion, unaccelerated where the browser allows. Nothing flat
covers the room while you work: the toolbar and the status bar disappear.

- **Leaving:** tap Esc (or F).
- **Pausing:** if the pointer is released (Esc, ⌘-Tab, a notification), everything stays where
  it was, and a click resumes.
- **Without work mode** the app runs windowed: the crosshair follows the hidden pointer, and
  all the bindings above still work. While ⌘ or ⌥ is held the pointer keeps moving but the
  crosshair doesn't, so afterwards the pointer picks the crosshair up where it was left
  (it never jumps); it lines up with the pointer again when the pointer re-enters the window.

![The flying hand (rsc/hand6.rsc) cut through the palm](images/section-hand6.png)

## Differences from the original

Cutplane follows what the 1990s 3Form actually did, read from its C and CPL sources rather than
the papers. Where it differs, it's on purpose, and the differences are listed here.

**New things**

- **Undo and redo** (⌘Z / ⇧⌘Z). The original's U key did nothing.
- **Broken drags are put back.** A drag that would leave a solid broken (an edge squashed to
  nothing, a face folded flat) is undone on release, and a delete that would do the same is
  refused. The original let both happen.
- **Group drags.** Pressing on something already picked keeps the other picks, so several things
  can be dragged together. `assets/cpl/rom.cpl` is `rom.cpl` with this change made (marked
  "cutplane_web"), as the lines its authors had commented out were meant to do.
- **The plane jump glides.** Space sends the plane to the back wall and back over a quarter
  second, eased, instead of in one frame, so the room doesn't jump under you. Whatever is picked
  or held still travels with it. `assets/cpl/cursor.cpl` is `cursor.cpl` with this change
  (marked "cutplane_web"): `Jumplane` works out the jump, and a new `Glideplane` message moves
  each frame's share. These two are the only changes to the original's CPL; every other script
  runs as it was.
- **Code in files, edited live.** Objects carry their CPL inline in `.cut` files. The original
  saved only the name of a code file, and only for vertices, edges and faces. The CPL editor is
  new, and so are Save and Open outside the Load/Save plate.
- **Trackpad and two-button profiles.** The SGI had a three-button mouse (middle drags the
  plane, right turns the room). That layout is still a profile, alongside ⌥ / ⌘ quasimodes for
  trackpads and a two-button layout.
- **Windowed mode.** Besides full-screen work mode, which captures the pointer the way the SGI
  did, the app runs in a browser window with the crosshair following the hidden pointer.

**Fixes to the original's behaviour**

- **Picking.** Any vertex on the plane counts as a vertex. The original only counted one with
  an edge lying in the plane, through a pointer comparison in `cursor_near_pt`. Only the single
  best pick across all objects is taken, where the original picked one per object under the
  crosshair.
- **Rotate tool.**
  - The face snap's 7.5° limit on a single move now tests the size of the angle. The original
    let every negative angle through.
  - The dial keeps fractional degrees. The original rounded each mouse event down to whole
    degrees, so slow turns were lost.
  - **R** over a vertex, or over a face lying in the plane, brings the tool there. The original
    left it where it was.
- **Scale boxes** keep every side at least 1 unit long. The original could scale a solid flat or
  turn it inside out.
- **Colour bars** all map their height to 0–255 the same way. In the original, the bar being
  dragged used a different formula and could go past 255.
- **Toolboxes, pads and plates.** The storage pad starts in the plane, bottom left. The
  original left it by the back wall, and only a drag brought it into the plane.
- **The camera's view** is a slide standing in the room above the camera. The original opened a
  second window. The **light bulb** adds a point light in its colour to the face shading, as
  `setup_light_source(2, ...)` did.
- **Saving through the Load/Save plate** keeps the world in the browser, under the typed name,
  and loading looks there first, then among the bundled samples. The original read and wrote
  files in its working directory.
- **Sections** always come out as closed loops, even through nearly flat faces that 1991 float32
  drift left slightly bent. The original warned "face crosses plane odd number of times" there.

**Timing.** Ctrl's axis decision is measured by distance (5 units), since browsers send many
more, smaller events than the SGI did. The rotate tool's brief stops (at perpendicular, and the
dial at horizontal) are the original CPL's counters again. The app sends CPL one coalesced move
per frame, so they count frames, as the original counted its update loop.

**Geometry.** Every coordinate snaps to a 1/256-unit grid, so repeated rotations can't build
up error and coincident points are exactly equal. The original used floats. Files written by
older versions of the format are normalised to the latest one on save.

**Left out on purpose**

- **No 15° rotation steps.** The plan promised 15° and 5° snapping, but `Rotatesnapangle 15` is
  a dead constant in the original and Ctrl does nothing to rotation. The only snaps are the face
  magnet and the two stops above.
- **Code the original never ran isn't ported:**
  - `do_sticking`;
  - the z-pause while constraining (only `do_cursor_notifications` sent it, and nothing calls
    that);
  - `recombine_affected_coplanar_fves`;
  - `duplicate.cpl`, `delete.cpl`, `colorctrl.cpl`, `sizebbox.cpl` and the `old*` rotate
    scripts (those, `calipers.cpl`, `menu.cpl`, `toolbar.cpl` and `workgroup.cpl` are in an
    older CPL dialect that doesn't assemble).
- **Not yet:** the measure pad (its name, size and distance plates need primitives that can be
  resized, which come with M6) and the tools' own work (M6).

## CPL and the environment (M5)

- **`packages/cpl`** is the language. The assembler reads the original `.cpl` files as they are,
  and the VM follows `cplcore.c` and `cplops.c` closely:
  - tagged words in one flat memory, with the original's addressing (`A:`, `AA:`, `*`, `&`);
  - the resolver iterates feature lists like an odometer;
  - JSRAT, per-feature message queues, and updates logged during a frame and done at its end;
  - property lists kept per world, as the original's were.
    The disassembler and trace drive the tests. Each known bug in the original VM is fixed only
    behind an option (`fixes`), so the original scripts run as they always did.
- **`packages/behaviors`** is the world the VM runs in: the C side of the original, on the
  kernel.
  - `Runtime` implements the host API the opcodes call (picking, translation, adoption,
    duplicates, deletes, colours, labels, worlds) and select.c's selectechniques.
  - `Controls` turns input into RAM sentences as `controls.c` did: PICK, RELEAS, TRANS of the
    crosshair and of what is picked, key commands as messages, and typed characters for text
    inputs.
  - Each tool in `src/tools/` builds its objects the way `tools.c`, `rotatetool.c` or `scale.c`
    did and ports the C routines (`Crtn:`) its scripts call. The tools are the rotate tool, scale
    boxes, colour control, toolbars, toolboxes, goodies and plates.
  - Undo is a journal of the edited world. Scale boxes come and go with picking, so they are
    never recorded.
- **The app** sends each frame's motion to CPL and draws what the VM says: highlights from
  Selectable and Picked, the tools from Visible and Active, pads, decals, Hershey labels and
  plates.
- **Tests** run the original scripts end to end: picking, dragging, marquee, delete, duplicate,
  plane jump, every tool, stamping, the pads and the plates. Further tests cover live edits
  of `stamp.cpl` and an object's code surviving a save and a reload.

## Tools (M4)

Ported from `rotatetool.c`, `rotateobj.c`, `scale.c`, `duplicate.c`, `topology.c`'s
`delete_vertex` family and `tools.c`'s `create_color_control`, and the CPL that drove them
(`rotatecircle.cpl`, `rotatexbar.cpl`, `rotatebauble.cpl`, `scalebbox.cpl`, `colorbar.cpl`,
`paint.cpl`, `rom.cpl`).

- **No 15° steps.** The plan promised 15° and 5° snapping, but `Rotatesnapangle 15` is a dead
  constant in the original and Ctrl does nothing to rotation. Its only snaps are the ones above:
  the 5° magnet that lays a face into the plane, the stop at perpendicular, and the dial's stop
  at horizontal.
- **Deliberate fixes** are listed under
  [Differences from the original](#differences-from-the-original).
- **Goodies.** The colour control's base runs `goodies.cpl`, which every goodie runs: picked, it
  drags the whole control. In M5 it moved into the goodies box, out of which it is dragged.
- **Kernel.** `ops/delete.ts` follows `delete_vertex`: every face around the vertex is first cut
  so only a triangle touches it, then the triangles merge into one face across the neighbours,
  which is triangulated if bent. Earlier deletes can leave a vertex where two fans of faces meet;
  deleting one of those is refused. A property test runs random chains of deletes on a cube, a
  holed cube and a sphere and checks the B-rep stays consistent.

## Direct manipulation (M3)

The behaviour comes from the original's CPL scripts (`cpl/rom.cpl`, `cpl/cursor.cpl`) and the C
they ran on (`select.c`, `translate.c`, `split.c`, `update.c`), not from the 1988 paper or the
2017 JS port. Both of those moved faces along their normals; 3Form translates them in the plane.

- **Picking** (`packages/kernel/src/select/pick.ts`) uses the original's square pick box
  (`Pkboxsize`, 10 units) and priority order.
- **Planarize** (`packages/kernel/src/ops/planarize.ts`) runs before every step of a drag, as
  `planarize_affected_fves` did. Pieces of a face share a surface (`mothersurf`). On release they
  merge back if they are as flat as the face they came from, so slightly bent float32-era faces
  in old files merge back too. Faces that were separate to begin with never merge.
- **Departures** from the original (picking changes, Ctrl measured by distance, undo, rollback,
  group drags, and the code it never ran) are listed under
  [Differences from the original](#differences-from-the-original).
- **Tests.** A property test drags random vertices, edges and faces of a cube and a cube with a
  hole and checks that the solid stays closed, consistent and flat, before and after recombining.

## Sections (M2)

- **Algorithm.** `packages/kernel/src/section/section.ts` rewrites the original's `intersect.c`,
  which made per-face segments but never chained them into loops. Each vertex is classified once
  as in front of, behind or on the plane. On-plane vertices count as "just in front" (a symbolic
  perturbation), so every edge either crosses or doesn't, and the degenerate cases (a corner
  touching the plane, an edge or a whole face lying in it) are limits of the generic one. Each
  crossing is keyed by its edge, which both of the edge's faces share, so segments chain into
  loops by edge ID alone, with no point matching and no epsilon. Loops run counter-clockwise
  around material and clockwise around holes, and each segment records its face and edges, for
  selection in M3.
- **Tested on real models.** Every closed shell in the bundled samples, the original resources
  and the 1991–94 archive gives only closed loops, cut at 15 depths and exactly at sampled vertex
  depths. That includes nearly flat faces left slightly non-planar by 1991 float32 drift, the case
  the original warned about ("face crosses plane odd number of times").
- **Rendering** follows `grafx.c`: the SGI's 50% polygon stipple for the plane (one cell per CSS
  pixel), `shade.c`'s ambient light plus two lights fixed to the room, the plus-shaped 3Form
  crosshair (`cursor.c`), and the room's black edges over background-coloured halos. Colours are
  the original 8-bit values, written to the screen unconverted.

## Geometry kernel and files (M1)

- **B-rep.** `packages/kernel` is a half-edge boundary representation after Mäntylä's GWB, the
  same model as the original's `topology.h`, stored in typed-array pools with stable integer IDs.
  All nine Euler operators are implemented (mvfs, mev, kev, mef, kef, kemr, mekr, kfmrh, mfkrh),
  plus sweep, revolve, apex split and the original's primitives. The chair and table come later,
  since they're multi-object groups.
- **Coordinates.** As in the original, vertices are stored in object-local coordinates alongside
  the object's transform. Every coordinate is snapped to a 1/256-unit grid, so repeated rotations
  can't accumulate error and coincident points are exactly equal.
- **Validation.** `validate()` separates structural errors (broken links, which must never
  happen) from manifold and geometry warnings (open or misoriented edges, non-manifold vertices,
  zero-area or non-planar faces). Old files and laminas can legitimately have warnings.
- **`.cut` files.** `packages/formats` reads and writes the Sequoia format line for line. It
  tolerates the archive's variants: missing technique lines, missing end markers, a missing
  Motherworld line, a Zoom Scale line, a file with 0-based vertex indices, and so on. Each
  coordinate is written as the shortest decimal that snaps back to the same value, so files the
  original wrote come back byte for byte.
- **Results on Larry's 1991–94 archive (116 files, 2,015 objects).** Every file loads, passes
  structural validation and round-trips. 89 files rewrite byte-identically. The other 27 differ
  only because they were written by older format versions, which are normalized on save. 1,560
  of the objects are closed manifolds. All 31 `.cut`-format resources in `assets/original` pass
  too.

## Development notes

- **Builds run in Docker only.** `compose.yaml` keeps every `node_modules` in named volumes, so
  the Linux binaries never land on the host.
- **Firefox E2E runs headed under `xvfb-run`.** Headless Firefox on Linux has no WebGL.
- `pnpm check` is the full local gate. (pnpm 12 reserves `pnpm ci` for a clean install.)
- **Archive corpus.** The full archive isn't in the repo. Put it in `corpus/cut/` (git-ignored)
  or set `CUTPLANE_CORPUS`, and the corpus tests run too; CI tests the bundled samples and
  original resources. `node packages/formats/scripts/report.ts corpus/cut` (in the dev
  container) prints a fidelity report.
- **README animation.** `docs/images/demo.gif` is recorded from the running app:
  `RECORD=1 docker compose run --rm e2e`. It plays the scripted session in
  `packages/app/src/demo.ts`, which does one thing at a time the way a person would (turn the
  room a little, push the plane, turn again); a unit test keeps it that way. Re-record it
  whenever a milestone changes what the app looks like.
- **Screenshots.** `SHOTS=.shots docker compose run --rm e2e` saves the E2E screenshots used in
  these docs (copy them into `docs/images/`).
