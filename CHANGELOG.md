# Changelog

Cutplane is a 2026 browser rebuild of Cutplane / 3Form, the SGI modeler Will Kessler and Larry
Edwards built in 1989–1991. It runs the original's CPL scripts and reads its `.cut` files. This
log lists what 2026 added: first the enhancements beyond what the 1991 program did, newest first,
then the rebuild itself. [Differences from the original](docs/README.md#differences-from-the-original)
has the detail on each.

## 2026 enhancements

New in 2026: none of these were in the 1991 original.

### October 28, 2026

- **A new sample: the Also TMB-1.** The electric bike, built by an agent with the direct calls:
  spoked wheels, the motor block with its battery cover, pedals and chain, the frame, fork, bars
  and saddle. It's in the model menu.
- **A torus of any thickness.** `add_primitive` takes `tube` for a torus: how thick its ring
  is, so a tyre or a rim comes out as one, where before it was always a fat donut with a small
  hole. And `clearance` no longer calls two parts that only touch (a pane resting on its window
  floor, a block standing on another) an overlap.
- **A new sample: the Moonbus.** The lunar transport from _2001_, built by an agent with the
  direct calls and checked with them as it went (each cut's volume, a ray into every window):
  the passenger windows down the roof flanks, the windscreen and the wide cockpit cheeks beside
  it, lamps, antenna, the jets in their cubbies and the four landing feet. It's in the model menu.
- **The agent checks its work by number.** A boolean now says how much of each object it
  kept, and fails aloud where it did nothing, instead of reporting success. Two new calls:
  `ray` says what a line of sight meets (looking into a window: the glass, or the cabin behind
  it), and `clearance` whether two parts overlap, one sits inside the other, or how far apart
  they are. A look can aim at a point and zoom in on it.
- **See what the agent is after.** Every MCP call can carry a goal, a few words on what the
  step is for, and the app shows it at the top of the room as the step is done. A run of
  direct calls (a sphere here, a cut there) is hard to follow on its own; with the goal shown,
  a person watching can.
- **A new sample: the EVA pod.** One of _Discovery_'s pods from _2001_, built by an agent with
  the direct calls: the window canted back above the grabbers (a ribbed oval funnel narrowing inward, flush with the shell), thruster cones on the sides with
  their four dark panels and the radial grooves round them, headlamps, the dimples with grab bars
  Dave pulls himself along on his EVA, the emergency hatch he blows as an object of its own, and a
  seat and controls inside. It comes as one group, to take apart if you want. It's in the model
  menu.
- **The agent works by number too.** Besides its hand on the crosshair, the MCP server now
  has direct calls: a primitive put in at a size and place, things moved, turned and scaled
  exactly, copied in a row or ring in one call, painted, named, deleted, unioned, cut (as the
  drill cuts), intersected, sliced, grouped, lined up, and a face pulled to a coordinate. Each
  is one step to undo, and the room shows it happen. See
  [docs/MCP.md](docs/MCP.md#direct-calls).

### October 27, 2026

- **Space Station V lit, with the Orion III on approach.** Rows of yellow windows set flush in
  the rings, and the Orion nose up below the docking bay. The agent's instructions now cover
  trimming a small block (an edge takes a press ahead of a face) and copies moved far (D
  repeats the whole move).
- **A piece cut off with `\` can be picked.** The pieces `\` made of a picked object could be
  neither picked nor dragged; now each is an object like any other.
- **A group takes a colour in every part.** Painting a picked group with the colour bars
  coloured the group and its first part only; now every part takes it.
- **A new sample: Space Station V, in progress.** The station the Orion III docks at in _2001_,
  built in the app by an agent through MCP: a finished ring, a ring half bare struts, their
  spokes, the hub and the docking bay. It's in the model menu, and will gain detail and colour.
- **The agent is told how to work well.** The MCP server gives a connecting agent instructions
  on the slips a long build ran into (a press near a face takes the face, the scale box's margin
  scales too, R picks what's under the crosshair, small moves held by guides), and
  [docs/MCP.md](docs/MCP.md#working-well) says the same at more length.
- **D goes on by a move and turn only.** A copy D made, then scaled (a crossbar's copy stood up
  as a post), no longer makes the next copy scaled as much again: the next is just moved as
  far on. A copy reshaped since (a union of D's copies) starts afresh, 100 right and up, rather
  than going on by a step from the copy it once was.
- **A pad clicked on its rail stays on it.** Letting go of a pad's handle, even a plain click,
  floated it off its rail with its tool, and the room kept it so after a reload: the pencil's
  pad left over the saw's, with three pads on the rail. A handle let go at the rail now goes
  back on it, in the order the pads hang, so one dropped part-way down goes in there.
- **A union where two solids graze.** Joining a long ellipsoid onto a cone at a shallow angle
  was refused: on the grid, one face's edge ran out to a point and straight back, and a sliver
  triangle's corners fell in a line. The spur now goes, and the sliver's middle corner goes
  into the face across its long edge, so the shell comes back closed.
- **A hole is the colour of what cut it.** The walls the drill (or any subtraction) leaves are
  the colour of the cutter, the drill's being that of the object it was copied from rather
  than its red: colour a cylinder black and the hole it drills has black walls.
- **A new sample: the Orion III.** The Pan Am shuttle from _2001: A Space Odyssey_, built in the
  app by an agent working it through MCP, is in the model menu with the 1991 samples.
- **A build recorded, and replayed.** The agent's `record` tool logs every call it makes of
  the app, from the world as it was and the toolbar's choices, with where things were after
  each; `replay` does the build again from the log, the same way, and says where it came out
  otherwise. See [docs/MCP.md](docs/MCP.md#recording-a-build-and-replaying-it).
- **An agent's hand on the app.** An MCP server (`docker compose up mcp`) lets an agent such as
  Claude Code work Cutplane as a person does, while you watch in your own browser (open it with
  `?mcp`). It moves the crosshair, gliding so its moves can be followed, and presses and lets
  go of the button, presses keys, rolls the wheel, turns the room and looks at it. None of its
  tools makes geometry: the app's tools and the plane do, and the app's own Save writes the
  file. See [docs/MCP.md](docs/MCP.md).
- **Hands off while the agent works.** The agent can set your own mouse, wheel and keys aside
  while it works, so a pointer resting on the room can't steer the crosshair from under it. A
  banner says so, and its **Take over** button gives you the app back; it also lapses after two
  minutes without a word from the agent, or when the link drops.
- **The agent works faster.** A `sequence` tool does a whole gesture (press, moves, release, keys)
  in one call; `inspect` gives back the shapes of what is picked (vertices, faces and their
  normals, in room coordinates), so the agent can check its work without a screenshot; and
  the agent's moves jump unless it asks for a glide.
- **The agent sees what a press will take.** Its state names a room tool, goodie or scale box
  handle under the crosshair ahead of the world's part, and where the rotate tool's bars are.
- **A rotate-tool roll let go just past the bar's end lets go.** Run onto the bauble in one
  quick move and let go, the tool stayed on, holding the crosshair to the bar and taking the
  presses meant for the colour bars, the pads and the goodies box.
- **A scale-box corner let go lets go.** Pulled in depth to a thin box and let go, it stayed
  held, and the object went on scaling as the crosshair moved.
- **A sphere joins a cone.** A union or drill whose result had two points closer than a
  grid step was refused, so B did nothing: the B-rep put them together, an edge of no length.
- **A tilted face slid along its own plane slides, with faces extruding.** Rounding in its
  normal took the slide for a pull outward, and the face came back where it was on release.
- **A colour bar at its least can be raised again.** A press on it took the whole colour control
  and dragged it off.
- **The colour control comes back whole.** A room kept for the next visit could bring the
  paint chip back far from the control, where it was built in the goodies box, and it stayed
  that far off as the control was dragged about. Its chip and bars are now put back on it as
  built, which mends a room already kept so.
- **An agent's glide with the magnifier zooms as far as asked.** It zoomed by the whole move
  again at every frame of the glide (a 300 ms glide could zoom ten billion times).
- **Shift-drag from nothing draws a marquee** that adds what it takes in to what is picked. It
  used to carry what was picked along instead.

### October 26, 2026

- **Primitives of your own.** Drop something on the primitives box and it goes in as a
  primitive of its own; a group goes in whole, and picking any part of it stamps out the whole
  group. Held over the box it turns blue, to show it will go in; dropped on an open box, it
  shows there at once. In the box it's shown as wide or tall as the 1991 primitives, seen from
  the front, made smaller or bigger, and the box's stack goes on in another column
  to the left instead of through the ceiling; a copy comes out its own size. To take one out
  again, drop a copy of it back on the box: held over the box the copy turns red, and let go it
  goes back where it was picked up while its primitive leaves the box.
  (A copy is anything of the same shape, so something just like a primitive already there takes
  that out rather than going in twice.) The 1991 primitives can't be taken out. What you add is
  kept with the room from one visit to the next; _Reset the room_ clears it. Fixed on the way:
  the original made only a group's root a primitive, leaving its parts showing by the box where
  nothing could take them out; a thing dropped in stayed selectable, hidden, so the next press
  anywhere stamped it out; and only the primitives box takes what's dropped on it (on the goodies
  box a thing stays in the world, where the original made it a primitive there too).
- **A marquee picks what it takes in, even partly.** As in drawing programs, a marquee that
  reaches over part of something picks it; the original wanted it wholly inside, which is hard
  to do, and for things on the floor (the crosshair stops there) never quite happened, so
  after the globe had dropped them nothing could marquee them. Some of a thing's section at
  the plane has to be in the marquee, not just its box, so the empty corner of a turned
  thing's box doesn't pick it.
- **Lining up in depth.** Guide lines only held a drag across or up and down, so lining two
  blocks up in depth meant parking the plane on one's front face and watching the other's come
  flush. Now something carried in depth holds where its middle, front or back comes level in
  depth with another's (two middles at one depth, fronts or backs flush, or one's front
  against the other's back), the plane stopping there and a dashed line drawn at that depth
  through both middles; pushed on, it comes off again. While something is carried, the plane no
  longer stops at faces and corners as it does on its own: those were where things had been
  before the drag (the carried thing's own faces too), and they held the plane, not the
  carried thing's face, so it stopped short of lining up, offset.
- **A lines up two things.** With just two picked, A did nothing: they already lay on the
  line through the two of them. Now two line up level, upright or in depth, whichever they're
  most apart in, the second coming to the first. (Shift-A spaces things out between the two at
  the ends, so it needs three or more.)
- **A plane just touching a face tilted a hair no longer draws its hole alone.** A vertex
  within the half-unit tolerance counted as on the plane even when its face didn't lie in it,
  so a face with a hole, tilted a little and touched along one edge, had its hole taken as
  on the plane but its far side not: the section was the hole alone, inside out. Now the
  tolerance is for faces lying in the plane all over (an old file's drift); other vertices are
  on it only when they are.

### October 25, 2026

- **A headpad dragged by its tab no longer sticks to the crosshair.** A rail's headpad was
  hung on the crosshair on its first drag step, missing the little way the crosshair had moved
  before the drag began; each drag left it a bit further off, and dragged by the end of its tab
  the crosshair could end up just outside it, where no release reached it. It rode the
  crosshair for good, kept that way between visits. Now it's hung on as it's picked, as a pad's
  handle is. A room kept with one stuck comes back with it on the plane.
- **Reset the room.** The top bar's _Settings_ menu puts the room back as it was built: the
  rails, toolboxes and goodies, the plane and the view. What you're making stays as it is.
  (Clearing the kept room by hand didn't do it: leaving the page keeps the room again.)
- **The hand no longer stops working after H mid-marquee.** Pressing H (or another tool key)
  while dragging a marquee brought the tool in at once; when the marquee ended the hand was
  sent what it had taken in, a message it never reads, and from then on it never saw a press:
  every drag with it drew a marquee. A tool key pressed mid-drag now brings its tool when the
  button is let go. (The ruler was left the same unread message by every marquee; it's
  cleared now.)
- **Drags hold at levels.** A face, edge or corner stretched or pulled out holds where it
  meets the height of a face lying flat on something else (a column pulled up stops level with
  the walls' tops), or the place of a face standing square across it; the level is drawn dashed
  across the room, a tick to the face it came from. Something moved whole holds with its top
  or bottom, or a side, on one too, as well as on the guide lines through other things'
  middles. Drag on and it comes off. With Ctrl
  locking the drag straight up (or across), the levels square across it still hold. To try out: the top bar's _Settings_
  sets which drags hold (_Stretches and moves_, _Stretches_ only, or none).
- **2D DXF plans come in as faces to pull up.** A DXF with no surfaces, only lines (a floor
  plan, say, as SketchUp or AutoCAD export it), comes in as the regions its lines close round,
  each a lamina lying flat on the room's floor, a group per layer. The lines needn't be joined: lines meeting,
  crossing or ending on another are joined there, a line drawn twice counts once, and an end
  left just short of a line is carried on to meet it. Lines, polylines (with their arcs), arcs,
  circles and splines are read. Pick a wall's lamina where the plane runs along it and pull it
  up with _Faces extrude_; a lamina pulls out from either face, or from an edge or corner of it (the plane, clicking onto a wall's edge, takes the edge: it used to bend the wall up into a slope). The notice says how many regions
  there were and how many lines closed none (a door's swing, say). **B joins pieces of a plan:**
  pick laminas lying in one plane (shift-click; the plane can move between picks) and B makes
  them one face, the lines between them gone, to pull up as one.
- **Rolling something picked whole is smooth again.** With other things near, the guide lines
  joined in while a rotate tool's bar or dial was dragged, pulling the crosshair off the bar
  toward a guide as the thing swung, so it jumped back and forth. Guides are now only for
  dragging things themselves.
- **R on a face in a group, or of one of several picked.** The rotate tool comes to a face of a
  part of a group picked whole, and rolling it turns the whole group. R no longer unpicks
  everything else either: with several things picked, the tool goes to the face and the roll
  turns them all about it.
- **Hints for what is picked.** Pick something and a small plate beside the room lists the
  keys that matter for it: after D, how to repeat it and line the copies up; with several
  picked, A, Shift-A, G and B. It goes when nothing is picked; ? still shows every key.
- **A lines things up, Shift-A spaces them out.** Pick several things and A puts their middles
  on the line between the two farthest apart, squared to the room's axes when it's within 10°
  of one. Shift-A keeps those two ends and spaces the rest evenly between them, by the gaps
  between them, so things of different sizes come out evenly spaced too. ⌘A now picks
  everything even when one thing is already picked (it used to miss that one).
- **A reload no longer brings something back half picked.** A world saved (or autosaved) with
  something picked came back with it marked picked but without its scale box, so a press on
  anything else dragged it instead. Nothing comes back picked now.
- **Guide lines while dragging.** Lines run through the middles of the eight things nearest
  what you drag, along the room's axes and each thing's own if it's turned. Its middle holds on
  one when it comes within 12 units, with the line drawn across the room, or where two cross,
  so a row lines up as you lay it out and any part can be put in line with any other near it.
  Ctrl drags without them. A turned thing's own axis also holds a copy at another depth where
  it passes through the plane, putting the two on one axis: a turned cylinder's copy, moved
  back, lines up coaxial again.
- **D repeats the last copy's move.** Every copy used to land 100 right and 100 up. Now, move
  the first copy where the next should go, and D puts each further copy on by the same step, a
  turn included: a row of struts at even spacing, or a ring when the copy was turned about a
  point. A copy flipped over to face its original just moves on, not back.

- **The magnet lines faces up.** It used to lay a face flush on another wherever the crosshair
  had it, twisted however it came. A face just like the other (a copy's, turned to meet its
  original) now fits it exactly, edge on edge and corner on corner. Any other face squares up
  with the other's edges when it's within 5° of square, and catches where the centres meet, a
  corner meets a corner, or an edge falls in line with one of the other's, if that's within 20
  units. The ghost shows the fit before you let go. (The original's `snap_features_together`
  noted that it "eventually must handle inplane faces".)

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
- **A face stood across the plane holds.** Rolled on the rotate tool's bar from its section line,
  a face catches at 90° to the plane and stays until the bar is pushed on 15 units, so two
  parts (a duplicate and its flip) are easily stood parallel. The original's stop there lasted
  five mouse events, too brief to feel.
- **The rotate tool's dial stops every 45°.** Turning the outer circle, the bars catch level,
  upright and diagonal and hold until pushed on, so a face's section line is easily made
  vertical. The original meant to stop every 45°, but a rounding slip left only horizontal, and
  that for three mouse events.
- **A stop can be seen.** While the rotate tool is held at any of its stops, its baubles (the
  little circles at the bars' ends) and the ring at the crosshair are drawn half as big again.
- **The drill cuts whatever its cutter overlaps.** Let go anywhere, the cutter takes a bite out
  of every object it overlaps, which are drawn selectable as it is carried; the object it was
  copied from is left alone. The original cut only the one object under the crosshair, so a big
  cutter (a flattened sphere, for the Death Star's dish) had to be let go with the crosshair on
  its target's section. The union tool fuses everything it overlaps the same way.

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
