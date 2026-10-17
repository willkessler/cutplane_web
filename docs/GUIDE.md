# Cutplane user guide

Cutplane is a 3D modeler you work in through a moving slice. A flat **cutplane** stands across the
room, and wherever it passes through a solid you see the solid's cross-section. You pick, drag and
reshape things where they cross that plane. This guide walks through it from the first click. The
[reference](README.md#using-cutplane) lists every control in full.

Open it at **[willkessler.github.io/cutplane_web](https://willkessler.github.io/cutplane_web/)**.
Nothing to install. It works in Chrome, Edge, Firefox and Safari on a desktop or laptop.

## 1. What you're looking at

![The Discovery, the plane through it, the toolbars and pads around the room](images/guide-screen.png)

- **The room** is the box. Its front wall is open, toward you.
- **The cutplane** is the sheet of fine dots parallel to the front wall. It only ever moves
  forward and back. Whatever lies behind it shows through the dots.
- **The crosshair** (the small circle and cross) always lies in the plane. It is your hand.
- **The section** is the yellow outline where the plane cuts a solid. You pick things through it.
- Around the edges of the plane ride the tools: the **toolbars** top left (orange headpads with a
  hammer and with three bars), the **rotate tool** top right, the **floppy disk** and the **?**
  along the bottom. They move with the plane, so they're always within reach.
- Above the room is the **top bar** (models, plane style, files) and below it a **status
  line** with the controls. Both disappear when you start working (section 2).

A trackpad, a two-button mouse and the SGI's three-button mouse all work as they are, with
nothing to set up: hold ⌘ or right-drag to turn the room, hold ⌥ (Option, Alt) or middle-drag to
move the plane. Every held key or button is **spring-loaded**: it lasts only while you hold it.

## 2. Looking around

| To...                   | Do this                                                   |
| ----------------------- | --------------------------------------------------------- |
| move the crosshair      | move the pointer                                          |
| move the plane in depth | hold ⌥ and move, middle-drag, or scroll                   |
| turn the room           | hold ⌘ and move, right-drag, or the arrow keys            |
| face the room again     | 0                                                         |
| jump to the back wall   | Space (again comes back; the next goes to the front wall) |
| work full screen        | **F**, or _Start working_; Esc leaves                     |

Push the plane slowly through a model and watch the section change. Moving slowly, the plane
**clicks onto the depths of vertices**, so a face or an edge comes to lie exactly in the plane,
ready to take hold of. Move fast and it flies straight through. Hold **Ctrl** to move it slowly
without clicking.

**Work mode** (F) goes full screen and captures the pointer, as the SGI did: nothing flat covers
the room, and the pointer can't run off the edge of the window. Press **?** in the room (bottom
right) any time for the controls on a plate in the plane.

## 3. Picking and moving

Everything is picked **at the crosshair, through the section**. Hovering, what you would pick is
outlined in white with a small yellow box where you'd take hold of it. What is picked turns red.

- Over a **corner** of the section: a vertex, or the edge that pierces the plane there.
- On the **section line**: the face it cuts.
- **Inside** the section: the whole object. An object that belongs to a group is picked with its
  group.

**Groups pick whole or by part** (top bar). With _Groups pick whole_, the first choice, a click
anywhere on a group's part picks the whole group. _Groups pick by part_ is the original: a click
on a grouped object's corner, edge or face picks just that, and only a click inside its section
picks the group.
Use it for imported models: a model file comes in as a group of many thin parts, whose sections
have little inside to click (the rover's wheels, say, and nothing else). Ungroup (**G**) to work
on single faces again.

**Press and drag** to move what is picked. It follows the crosshair in the plane; hold ⌥ while
dragging to carry it in depth too. **Shift-click** adds to what is picked or takes something away.
**Press on empty space and drag** to draw a **marquee**: a box that picks the objects inside it
(move the plane while dragging for a 3D box). **⌘A** picks everything; **⌫** deletes what is
picked. **⌘Z** undoes, one drag at a time, and **⇧⌘Z** redoes.

Try it: choose **New cube** from the model menu, put the plane through the cube (⌥ and move), and
drag one of its corners out. The faces around the corner stay flat: they split as needed and join
up again when you put the corner back.

![A face of the cube pulled out with Faces extrude](images/guide-extrude.png)

**Faces stretch or extrude** (top bar). _Faces stretch_ is the original: drag a face and the faces
around it stretch to follow. With _Faces extrude_, a face pulled outward grows walls of its own,
so the cube above has grown a box out of its right side. Push it back and the walls go.

## 4. Turning and resizing

- **R** brings the **rotate tool** to the crosshair and picks what's there. Slide along one of its
  bars to roll the object over, or turn its outer circle to spin it in the plane. R on its centre
  puts it away.
- A picked object shows the handles of its **scale box**: grey squares where the box's edges
  pierce the plane. Drag one to stretch the object; Ctrl scales it evenly.
- **D** duplicates what is picked, **G** groups it (or ungroups a group), **\\** slices it in two
  at the plane, **B** unions picked objects into one solid.

## 5. Tools

Click the **hammer** headpad (top left) to open its rail, and click a pad to take its tool. A
tool rides on the crosshair; click its pad again, or call up another tool, to put it back.

- **Pencil** (or **P**): press and draw a shape in the plane. Let go and it becomes a solid 50
  deep. Or draw **on a surface**: press on a corner of an object's section, and a white line
  follows the crosshair...

  ![The pencil's white line from one corner of the cube's section](images/guide-pencil-line.png)

  ...press on another corner of the same face, and the face is split along the line. Pull the new
  face out with _Faces extrude_, or paint it.

  ![The cube's side split in two by the pencil](images/guide-pencil-split.png)

- **Saw**: click on an object to cut it in two at the plane. Taking the saw keeps what is picked:
  pick a whole group (the Discovery, say), take the saw, and a click on it cuts every part at once.
- **Drill**: press on an object to make a red copy of it, the cutter; carry it into another
  object and let go, and the cutter is taken out of it.
- **Union** (two green blocks): carry one object into another and let go, and they become one.

The headpad with **three bars** opens the arranging tools: the **magnifier** (**Z**: drag up to
zoom in, down to zoom out), the **group** tool, the **pan** tool (**H**: drag to move the whole
world), the **magnet** (press on a face of one object, let go on a face of another, and the first
lies flush on the second), the **grabber** (always picks whole objects), the **ruler**, and the
**globe**.

- **Globe** (a little Earth, the last pad, or press **>**): click on an object and it falls to the floor. It
  tumbles, bounces a little and comes to rest as a solid of its shape would, so a car or a rover
  held at a slant lands on its wheels, and a chair on its legs. A group falls whole; click on
  something picked and everything picked falls (things dropped together can land on each
  other). It lands on whatever is under it, the floor or another object, so stacking things is a
  matter of dropping one over another. Only the room's floor is solid, not its walls: something
  bigger than the room falls too. Then the globe goes back to its pad. One ⌘Z lifts it back to
  where it was. A fall is worked out by
  [Rapier](https://rapier.rs), a physics engine, from each part's _convex hull_ (the part
  shrink-wrapped): the hull's underside is what a solid lying on a floor can touch it with.

The **toolboxes** stand on the floor at the back (Space takes the plane there). Click one to open
it. The primitives box holds a cube, cylinder, cone, sphere and pyramid: press on one and a copy
comes out, picked, to carry forward into the world. The goodies box holds a camera (section 7), a
light bulb and the colour control (three bars and a paint chip: drag a bar and what is picked takes
the colour, or drag the chip onto a face to paint it).

## 6. Measuring

Take the **ruler** (on the arranging rail, above the globe, or press **M**) and the **measure pad**
comes out, bottom left beside the floppy. Put the ruler away and it goes.

![The measure pad: the cube picked, its length, width and height, the width field clicked](images/guide-measure.png)

- **Pick an object** and its **length** (front to back), **width** and **height** show above the
  pad, in inches (ten room units to the inch, as the 1991 original had it), with its name.
- **Change a size:** click a field (its text is outlined, ready to replace), type the new size
  and press Return. The object is resized from its lower corner, and one ⌘Z puts it back. Type
  into the name field to rename it.
- **Pick two things** (shift-click the second) to see how far apart they are, overall and along
  x, y and z. Type a new distance and the second one moves.
- **Pick an edge** to see its length.
- **Drag out a marquee** and its size shows as it grows.

## 7. The camera and fly-overs

The camera gives you a second point of view, and can fly over what you've made.

1. **Take it out.** Space takes the plane to the toolboxes; click the goodies box (the one with the
   camera on it), then drag the magenta camera out and carry it forward (⌥ and move).
2. **Open its window.** Click the camera. A window opens beside the main one, **Camera's View**,
   showing what the lens sees, live as you carry the camera. Put it on a second screen if you have
   one. (If nothing opens, let the page open pop-ups; until then the view stands on a slide in the
   room above the camera.)
3. **Aim it.** It comes out of its box looking out of the room, at you. Put the plane through the
   lens (the grey cylinder at its front) and drag the lens: the camera turns to follow. To turn
   it round to face the world, hold the lens and take the plane back past the camera (⌥ and move).
4. **Place shots.** In the camera's window, click **Add shot** (or press Return) to keep where the
   camera is and where it looks. Move and aim it again and add another; three or four make a good
   fly-over. Each shot shows in the room as a magenta cross, with a dashed line through them all.
   _Remove last_ and _Clear_ take shots away.
5. **Fly.** Click **Play** (or Space in the camera's window): the view flies smoothly through the
   shots and the path's white mark travels with it. _Seconds per shot_ sets the pace.
   **Record video** plays it into a video file, which downloads when it ends.

Click the camera again, or close its window, to put the view away; the shots are kept.

## 8. Files

- **Open…** (top bar), or drop files anywhere on the page:
  - a **`.cut`** world from 3Form or Cutplane replaces the world;
  - **models** are added to it: glTF (`.glb`, `.gltf`), OBJ (with its `.mtl`), STL, and the SGI
    era's Open Inventor (`.iv`, text or binary), VRML (`.wrl`) and DXF, gzipped or not
    (`.iv.gz`). A file comes in as one group; **G** takes it apart. Models are made into solids on
    the way in, and scaled to fit the room if need be.
  - A big file takes a few seconds: a **ring turns in the room** while it's read, filling as it
    goes. **Esc** stops it. A model of more than 400,000 faces is simplified to about that many,
    so the room stays quick to work in (the status line says so); add `?faces=all` to the page's
    address to keep every face.
    Free models to try: [Poly Pizza](https://poly.pizza/) (glTF, CC0 and CC-BY) and
    [Sketchfab](https://sketchfab.com/) (filter by downloadable).
- **Save** writes the world as a `.cut` file, and keeps a copy in the browser (listed in the model
  menu). The **floppy** pad in the room does the same by name: click it, click _Save to:_ or
  _Load from:_, type a name and press Return.
- **Export…** writes **glTF** (`.glb`, which opens in Blender: _File → Import → glTF 2.0_), **OBJ**
  or **STL** (for printing).
- **Everything is autosaved** in this browser as you go, undo history and all. Close the tab and
  come back, and the world is as you left it; undo still works. Choosing a model from the menu
  starts that model afresh, so Save what you want to keep. (It's kept once the mouse and keys
  have been left alone for five seconds, or as you leave the page. With a very big model, the
  undo history kept is only its last few steps.)

## 9. Help in the room

![The help plate, opened from the ? pad](images/guide-help.png)

Click the **?** pad (bottom right) for a plate of the controls in the plane. Click ? again to put it away.

## 10. If something doesn't work

- **Nothing happens when I click.** The crosshair must be on the section: put the plane through
  the object first (⌥ and move, or scroll).
- **I can't pick an imported model.** Its section must close. Most models are made solid on the
  way in; one that still shows an open section is picked from inside any part of it.
- **Keys type into a field.** A field on a plate is listening: press Return or Esc, or click
  elsewhere.
- **The plane won't stop where I want it.** Hold Ctrl for slow, unsnapped moves.
- **I lost my work.** Choose _Unsaved changes_ at the top of the model menu.
