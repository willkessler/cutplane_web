# Changelog

Cutplane is a 2026 browser rebuild of Cutplane / 3Form, the SGI modeler Will Kessler and Larry
Edwards built in 1989–1991. It runs the original's CPL scripts and reads its `.cut` files. This
log lists what 2026 added: first the enhancements beyond what the 1991 program did, newest first,
then the rebuild itself. [Differences from the original](docs/README.md#differences-from-the-original)
has the detail on each.

## 2026 enhancements

New in 2026: none of these were in the 1991 original.

### October 24, 2026

- **Rounder primitives.** The primitives toolbox's cylinder, cone and sphere go round in 72
  steps, not 14: in 1991 every polygon cost the graphics chip, and a sphere had 196 faces. It
  now has about 5,000, and still cuts and moves at once.
- **Faces in the plane can be scaled.** A face picked where it lies in the plane gets a flat
  scale box with corner handles, as a picked object has one: drag a corner to resize the face in
  the plane, and hold Ctrl to keep it square about its middle. Ctrl on a cylinder's end draws it
  in about its axis, into a truncated cone of any slant (the sides of the 2001 pods), where
  before it had to be sliced off a cone. Sides that would bend are split, and merge back where
  they come out flat.

### October 23, 2026

Big meshes (a Mars terrain of 400 thousand faces) are quick to work with. The 1991 SGIs could
never draw a model this size, so the original never had to be.

- **The plane cuts only what it meets.** Each object's faces are sorted by depth, so a plane
  move looks at the few thousand faces near it, not all of them: the Mars terrain's section
  takes 4 ms instead of 330, and is exactly the same. Finding what's under the crosshair uses
  the same index.
- **A fine mesh doesn't hold the plane back.** A mesh of more than 20,000 vertices stops the
  plane only at its front and back, and only faces really facing along the plane are sticky,
  not every tiny facet, so the plane no longer creeps through a terrain.
- **A big mesh moves and turns as a stand-in.** While you drag or turn it, the mesh already
  built is moved by a matrix (turned, it's grey and has no shadow), and its section comes
  straight from its triangles, dotted. A second after it stops, or when you let go, it's built
  where it now is. Turning the terrain went from over a second a frame to under 10 ms.
- **A pick no longer rebuilds a big mesh.** Picking a face or vertex marks it in the B-rep,
  which made it look reshaped; the drawing now keys on its shape alone.
- **A fine mesh is outlined round its outside.** Its contour ran round every bump on it, each
  facet turned away from the eye, and covered a terrain in white; now only its outer outline
  shows, drawn off the mesh's own place on the screen.
- **Drop a folder.** Everything in it, folders inside it too, opens as if its files had been
  dropped together: a model that comes as several files can be dropped as the folder it came
  in. Hidden files (`.DS_Store`) are left out.

### October 18, 2026

- **The room as you left it.** Close the tab and come back, and the plane, the crosshair, the
  room's turn, the open rails, the rotate tool, the toolboxes, the goodies out in the room, the
  keys plate, permanent gravity and the top bar's choices are where they were. The world itself
  was already autosaved.
- **A turned first view.** The first visit sees the room turned 20° and tipped 5°, so it reads
  as a 3D room, with the keys plate open. 0 still faces it straight on.
- **Ctrl on a scale box's handle scales evenly.** Ctrl's lock to one axis fought the handle, and
  could shrink an object to nothing. The handle now has the crosshair to itself.
- **A picked object's faces stay pickable.** With groups picked whole, the scale box round a
  picked object counted as its group, so its faces couldn't be taken until it was unpicked. As
  in the original, you can go from the whole object to a face at any time.
- **The plane sticks to parallel faces.** Slide the plane up to a face parallel to it and the plane
  catches there, holding until you push a little further, so the whole face is easy to take.
  The top bar sets how firmly. The original had this (`do_sticking`) but never switched it on.
- **G on the parts of one group ungroups it.** With two parts of a group picked (by part, or
  by a marquee), G wrapped the group in another group instead of taking it apart, so it took
  two G's to undo, and the first seemed to do nothing. G now ungroups whenever all that is
  picked belongs to one group.
- **The camera's view is a screen in the room.** Its own window got lost behind the browser and
  had no room on a laptop; now a click on the camera brings up a small screen with a thin black
  border, standing in the room above it like the plates. The fly-over's shots, play and video
  went with the window, to come back as a path the camera follows.
- **A tool in hand is outlined only where it's hidden.** Its dotted white outline covered small
  tools, so it was hard to see which one you held. Now it shows only where something is in
  front of the tool.
- **The 1 key, with nothing picked, takes one press there and one back.** It goes straight to
  every edge (back ones too) and then back to solids, with no front-faces step between. Its
  wire is a deeper grey, which was too faint to see on the room's colours.
- **Tools in hand are bigger, and alike in size.** A long, thin tool (pencil, saw, drill) is 120
  long in hand, twice its pad size; any other (union, magnifier, group tool, hand, magnet,
  grabber, globe) is 75 across, so a bulky tool doesn't dwarf a thin one. On its pad a tool is
  the size it was.
- **Esc puts the tool in hand away**, back on its pad: the key you reach for to get out of a
  tool. (In full screen the browser keeps Esc to leave it.)
- **A tool left in hand comes back in hand, and goes away again.** The room as you left it
  brought the tool back on the crosshair but not as the one in hand, so nothing could put it
  away.
- **Big STLs are simplified.** A model of more than 400,000 faces is brought down to about that
  many, but an STL (each triangle with its own three corners) came in whole: 2.7 million faces
  of a 3D-printing figure, with seconds to cut. The simplifier is now handed only the corners in
  use.
- **An STL stands up.** STL's up is Z, a printer's; the room's is Y. A figure made for printing
  came in lying on its back; it now stands, and STL exports stand up on a printer's bed.
- **A big world reads back.** A world saved with a solid of hundreds of thousands of faces (an
  import) couldn't be opened again, the next visit stopping with "Maximum call stack size
  exceeded".
- **Inventor face sets with their own points.** A face set can carry its points and colours
  itself (Inventor 2.1's `vertexProperty`), as JPL's Mars terrain meshes do; those came in empty,
  or stopped the simplifier with "Assertion failed".
- **Textures from the SGI era, and Mars on a slab.** An Inventor file's `Texture2` colours its
  faces when its image is dropped with it: an SGI `.rgb` (read in Cutplane, which the browser
  can't), a `.png` or a `.jpg`. A photo's colours go on once the model is simplified, so
  texture doesn't stop the simplifier. Terrain made with Z up, as NASA JPL's Mars rover meshes
  are, is laid flat and stood on a slab of ground (its edge closed with one face cut up through
  the ground), so the plane cuts its profile.
- **Photos are lit softly.** A rover's picture already has the sun in it, so a face coloured
  from one shows the photo's own colour when level, and no less than 60% of it however it
  faces, where the room's lights would darken it by a third or more.
- **The top bar's settings are in one menu.** The plane's look, what dragging a face does, how
  groups pick and how firmly the plane sticks are under _Settings_, so the bar fits on one line.

### October 17, 2026

- **The magnet shows where it will snap.** Taken by a face, what it drags stays on the
  crosshair, passing through anything. The face of another object under the crosshair is
  highlighted, and a see-through ghost shows the dragged object snapped onto it, turned so the
  face taken lies flush. Move off and the ghost goes; near another face it shows there. Let go
  and the object goes to the ghost, or, with none showing, stays where it is. The magnet stays in
  hand until it is put away.
- **Fit to room.** A double click with the magnifier fits everything into the room, with a 10%
  margin. Undo puts it back.
- **The 1 key's wire views.** What isn't picked is drawn as grey wire, then put out of
  sight, then shown again. With nothing picked, everything is drawn as wire (front faces, then
  all), then back to normal.
- **Gravity always, and dangling.** A double click with the globe keeps gravity on: everything
  falls and stays down unless dragged. Picked whole, an object dangles from where it's held, by
  a vertex, an edge or from inside. The gravity key is now V.
- **Falls can be interrupted.** A press stops whatever is falling where it is, so it can be
  picked mid-fall. What isn't picked falls on.
- **Double click puts things away.** A double click on the colour control's base or the camera's
  body puts it back in the goodies box.
- **The keys plate.** The ? pad, or the ? key, opens a plate of every key and tool at the side
  of the plane, in groups (the plane, the view, picking and moving, changing what is picked,
  tools, goodies and files), windowed and in full screen alike. It replaces the help plate and
  the 2D status bar.
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
- **The camera flies over the world** through shots you place, and can record a video (until
  October 18, when the view moved into the room).
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
