# Changelog

Cutplane is a 2026 browser rebuild of Cutplane / 3Form, the SGI modeler Will Kessler and Larry
Edwards built in 1989–1991. It runs the original's CPL scripts and reads its `.cut` files. This
log lists what 2026 added: first the enhancements beyond what the 1991 program did, newest first,
then the rebuild itself. [Differences from the original](docs/README.md#differences-from-the-original)
has the detail on each.

## 2026 enhancements

New in 2026: none of these were in the 1991 original.

### October 17, 2026

- **The magnet works like a magnet.** Drags with it are solid: what it drags stops where it
  meets another object and slides along it. Taken by a face, it sticks by that face for as long
  as the button is held. Near another object's face, it turns so the face dragged lies flush on
  it. Drawn off, it lets go and turns back the way it was taken, and near another face it sticks
  to that one.
- **Fit to room.** A double click with the magnifier fits everything into the room, with a 10%
  margin. Undo puts it back.
- **The 1 key's wire views.** What isn't picked is drawn as light grey wire, then put out of
  sight, then shown again. With nothing picked, everything is drawn as wire (front faces, then
  all), then back to normal.
- **Gravity always, and dangling.** A double click with the globe keeps gravity on: everything
  falls and stays down unless dragged. Picked whole, an object dangles from where it's held, by
  a vertex, an edge or from inside. The gravity key is now V.
- **Falls can be interrupted.** A press stops whatever is falling where it is, so it can be
  picked mid-fall. What isn't picked falls on.
- **Double click puts things away.** A double click on the colour control's base or the camera's
  body puts it back in the goodies box.
- **The keys plate.** In full-screen work mode the shortcut keys are on a plate at the side of
  the plane, so they don't need a 2D panel.
- **A new hand.** The pan tool's 1991 hand shaded in broken pieces. It is redrawn as one smooth,
  rounded shape with a cuff at the wrist.
- **The group tool works in hand.** A click with it groups or ungroups what is picked, and a
  marquee with it groups what it touches.
- **Each tool goes back to its own pad**, whether its pad is clicked or its key is pressed again.
  Before this fix the hand could land on the magnifier's pad, after which H no longer brought it.

### October 16, 2026

- **The globe and gravity.** The globe tool drops things: they fall, land on the floor or on
  other objects, and are cut and lit while they fall. The globe's picture is the Earth.
- **Groups pick whole.** A toolbar choice picks a whole group from any of its parts.
- **Big and binary Inventor files** are read in the background, with a progress ring in the
  room.
- **Tools in hand show through models**, so a tool is never lost behind what it works on.

### October 12–14, 2026

- **Undo and redo** (⌘Z / ⇧⌘Z), kept with the autosave.
- **Broken drags are put back.** A drag or delete that would break a solid is undone or refused.
- **Group drags.** Pressing on something already picked keeps the other picks, so several things
  drag together.
- **The plane jump glides**, and alternates between the back and front walls.
- **Code in files, edited live.** Objects carry their CPL in `.cut` files, edited in the app.
- **Files.** Models open from glTF, OBJ, STL, Open Inventor, VRML and DXF, by drag and drop; the
  world exports to glTF, OBJ and STL; every change is autosaved in the browser.
- **The union tool and B.** A union tool on the tools' rail, and B unions everything picked.
- **Faces can extrude** instead of only stretching.
- **The pencil draws on surfaces**, splitting a face from edge to edge, and tidies its strokes.
- **The saw cuts what is picked**, groups whole, and parts a group's halves.
- **The camera flies over the world** through shots you place, and can record a video.
- **The measure pad comes with a ruler** (M): every object is measured, sizes can be typed, and
  marquees are measured while they're dragged.
- **A help plate** behind the ? pad, and **⌘A** picks everything.
- **New keys:** H the pan tool, P the pencil, M the ruler, Z the magnifier, V the globe.
- **Tools are one size in hand**, and a click on nothing no longer jams a tool.
- **Far edges are dimmer**, and broken imports still pick.
- **One set of bindings** for a trackpad and either mouse; a trackpad swipe moves the plane.
- **New pictures:** the grabber's claw, the arranging rail's headpad, the union's green blocks.

## 2026: the rebuild (M0–M8)

The 1991 program rebuilt for the browser, milestone by milestone (see the
[roadmap](docs/README.md#roadmap)):

- **M0:** workspace, Docker images, tests and CI.
- **M1:** the geometry kernel (half-edge B-rep, Euler operators) and `.cut` files.
- **M2:** the room, the plane, live sections and full-screen work mode.
- **M3:** direct manipulation: pick, drag, constrain, carry, marquee.
- **M4:** the rotate tool, duplicate, delete, scale boxes and the colour control.
- **M5:** the CPL virtual machine, with the original's environment running on it: toolbars,
  pads, toolboxes, plates, the light bulb and the camera.
- **M6:** modeling: the saw, drill, pencil, magnet, grabber, pan tool, magnifier and group tool,
  with booleans through manifold-3d.
- **M7:** mesh formats, drag and drop, and autosave.
- **M8:** shipping: the user guide, live on GitHub Pages.
