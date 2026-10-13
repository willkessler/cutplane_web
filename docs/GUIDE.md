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
- Above the room is the **top bar** (models, input profile, files) and below it a **status
  line** with the controls. Both disappear when you start working (section 2).

The first time, choose your **input profile** in the top bar: _Trackpad_ (the default on a Mac),
_Two-button mouse_ or _Three-button mouse_. The examples below use the trackpad and two-button
mouse, where the plane is moved with ⌥ (Option, Alt). Every held key is
**spring-loaded**: it lasts only while you hold it.

## 2. Looking around

| To...                   | Do this                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| move the crosshair      | move the pointer                                                 |
| move the plane in depth | hold ⌥ and move (or scroll); middle-drag on a three-button mouse |
| turn the room           | right-drag (or hold ⌘ and move on a trackpad), or the arrow keys |
| face the room again     | 0                                                                |
| jump to the back wall   | Space (Space again comes back)                                   |
| work full screen        | **F**, or _Start working_; Esc leaves                            |

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

- **Saw**: click on an object to cut it in two at the plane.
- **Drill**: press on an object to make a red copy of it, the cutter; carry it into another
  object and let go, and the cutter is taken out of it.
- **Union** (two green blocks): carry one object into another and let go, and they become one.

The headpad with **three bars** opens the arranging tools: the **magnifier** (**Z**: drag up to
zoom in, down to zoom out), the **group** tool, the **pan** tool (**H**: drag to move the whole
world), the **magnet** (press on a face of one object, let go on a face of another, and the first
lies flush on the second), the **grabber** (always picks whole objects), and the **ruler**.

The **toolboxes** stand on the floor at the back (Space takes the plane there). The primitives box
stamps cubes, cylinders, cones, spheres and pyramids; the goodies box holds a camera, a light bulb
and the colour control (three bars and a paint chip: drag a bar and what is picked takes the
colour, or drag the chip onto a face to paint it).

## 6. Measuring

Take the **ruler** (the last pad on the arranging rail, or press **M**) and the **measure pad**
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

## 7. Files

- **Open…** (top bar), or drop files anywhere on the page:
  - a **`.cut`** world from 3Form or Cutplane replaces the world;
  - **models** are added to it: glTF (`.glb`, `.gltf`), OBJ (with its `.mtl`), STL, and the SGI
    era's Open Inventor (`.iv`), VRML (`.wrl`) and DXF. A file comes in as one group; **G** takes
    it apart. Models are made into solids on the way in, and scaled to fit the room if need be.
    Free models to try: [Poly Pizza](https://poly.pizza/) (glTF, CC0 and CC-BY) and
    [Sketchfab](https://sketchfab.com/) (filter by downloadable).
- **Save** writes the world as a `.cut` file, and keeps a copy in the browser (listed in the model
  menu). The **floppy** pad in the room does the same by name: click it, click _Save to:_ or
  _Load from:_, type a name and press Return.
- **Export…** writes **glTF** (`.glb`, which opens in Blender: _File → Import → glTF 2.0_), **OBJ**
  or **STL** (for printing).
- **Everything is autosaved** in this browser as you go, undo history and all. Close the tab and
  come back, and the world is as you left it; undo still works. Choosing a model from the menu
  starts that model afresh, so Save what you want to keep.

## 8. Help in the room

![The help plate, opened from the ? pad](images/guide-help.png)

Click the **?** pad (bottom right) for a plate of the controls in the plane, written for the input
profile you chose. Click ? again to put it away.

## 9. If something doesn't work

- **Nothing happens when I click.** The crosshair must be on the section: put the plane through
  the object first (⌥ and move, or scroll).
- **I can't pick an imported model.** Its section must close. Most models are made solid on the
  way in; one that still shows an open section is picked from inside any part of it.
- **Keys type into a field.** A field on a plate is listening: press Return or Esc, or click
  elsewhere.
- **The plane won't stop where I want it.** Hold Ctrl for slow, unsnapped moves.
- **I lost my work.** Choose _Unsaved changes_ at the top of the model menu.
