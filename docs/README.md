# Cutplane documentation

The user guide and architecture notes will grow here as each milestone lands. Screenshots go in
`docs/images/`.

## Roadmap

| Milestone | Scope                                                               |
| --------- | ------------------------------------------------------------------- |
| **M0** ✅ | Scaffold: workspace, Docker dev/prod images, tests, CI              |
| **M1** ✅ | Kernel and `.cut` I/O: half-edge B-rep, Euler operators, validation |
| **M2** ✅ | Room, plane, section and full-screen work mode                      |
| M3        | Direct manipulation: selection hierarchy, drag, constrain, carry    |
| M4        | Rotate tool and editing, undo                                       |
| M5        | CPL VM and environment: code stored in objects, live editing        |
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
edges come to lie in the plane, ready to grab. Hold **Ctrl** to move slowly with no snapping.

### Controls

Pick a profile in the toolbar (Macs default to the trackpad). Every mode is **spring-loaded**: it
lasts only while you hold the key or button.

| Action          | Trackpad / one button | Three-button mouse | Two-button mouse     |
| --------------- | --------------------- | ------------------ | -------------------- |
| Move crosshair  | move                  | move               | move                 |
| Plane depth     | hold ⌥ + move, scroll | middle-drag, wheel | hold ⌥ + move, wheel |
| Rotate the room | hold ⌘ + move         | right-drag         | right-drag           |
| Fine, no snaps  | hold Ctrl             | hold Ctrl          | hold Ctrl            |

| Key     | Command                                                   |
| ------- | --------------------------------------------------------- |
| Space   | Plane jump: to the back wall, and back again              |
| ← → ↑ ↓ | Rotate the room 10° (±90° side to side, 0–90° from above) |
| 0       | Reset the view                                            |
| F       | Start or stop working (full screen, pointer captured)     |

Dragging the plane follows the plane on screen: you push it the way it visibly travels as it goes
deeper. Facing the room, that is up the screen; with the room turned 90°, it is sideways. Scrolling
away always sends it deeper.

### Work mode

**Start working** (or F) goes full screen and captures the pointer, like the SGI: the cursor
can't leave the window, and the plane and room can be pushed as far as you like without hitting a
screen edge. Input is raw relative motion, unaccelerated where the browser allows. Nothing flat
covers the room while you work: the toolbar and the status bar disappear.

- **Leaving:** tap Esc (or F).
- **Pausing:** if the pointer is released (Esc, ⌘-Tab, a notification), everything stays where
  it was, and a click resumes.
- **Without work mode** the app runs windowed: the crosshair sits exactly under the hidden
  pointer, and all the bindings above still work.

![The flying hand (rsc/hand6.rsc) cut through the palm](images/section-hand6.png)

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
