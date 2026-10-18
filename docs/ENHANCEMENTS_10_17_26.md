# Enhancements for Oct 17, 2026

## Session 1: morning

- Copy this file and the README.md into the docs/ folder, but rename
  the README so it clearly indicates it was the rebuild-plan from the
  authors (Will Kessler/Larry Edwards) and not a Claude-generated file
- Zoom tool enhancement: double clicking while holding the zoom tool fits all objects into the room at once.
- The "1" key converts the rendering of all objects except selected
  objects to light grey wireframe (front facing polys only), then
  hides them completely, then a third press of the "1" key restores
  all objects to being rendered. If no objects are selected it just
  converts all rendering to the light grey wireframe front-facing
  polys only, then second press to light grey wireframe (all polys),
  and then back to regular rendering.
- Double clicking with the new gravity tool sets "permanent gravity"
  meaning _all_ objects fall to the floor and don't stay up at all
  unless they're being dragged. In this "permanent gravity mode", when
  you pick up an object (if "Groups pick whole" is chosen), the object
  does not deform but "dangles" about where you pick. Ie, if you pick
  up by a single vertex, the object hangs down from that one
  vertex. if by an edge, it that edge stays at the angle its is at but
  the rest of the object pivots below it as if gravity were pulling on
  it. If you pick inside an object, it pivots so that as much mass as
  possible is hanging down just as it might in the real world. Double
  clicking with the new gravity tool again ends "permanent gravity
  mode".
- The ">" key for gravity tool is moved to the "v" key. We do not use
  the ">" key any more.
- The base of the color picker and camera should respond to
  double-click which means "put this away" (back inside their box).
- The "magnet" tool works to snap two faces together as-is. But it
  would be fantastic to use the physics library to push back while
  dragging objects using the magnet tool when the object you're
  dragging collides with a target object; in other words, you cannot
  drag the source object _inside_ the target object, it just stops
  where the two faces touch so you can slap two objects together more
  quickly and easily.

## Session 2: afternoon

- The magnet tool object collision works well, but it doesn't exactly
  do what a user might want. It's sensitive to dragging an object via
  its face (not its body). What the user expects therefore is _that_
  face would snap to the target object's face, but it doesn't if that
  would create a collision _on the way there_. So that means the
  dragged object must reorient so that the face the user is _dragging_
  snaps to the target object's face. It should feel like you can just
  stick the object to another object along the surfaces you're
  dragging, as if you temporarily magnetized both objects' faces.
- While the gravity is being applied you cannot interact with the
  objects. Sometimes "settling" into a stable position takes the
  physics engine a while. An impatient user just wants to grab and
  manipulate objects at any time, whether they're still falling,
  fallen, or in the air.
- The shortcuts help shown when not in full screenmode is very
  helpful. But it's hidden in full screen mode, which was part of the
  brief, we don't want to destroy the immersion in 3d. So you
  previously added a 3d help panel. It's great and up-to-date on
  shortcuts but not visible unless you show it. We want to experiment
  with a single 3d help panel mounted to the side of the cutplane. It
  would be attached to the cutplane as a simple square with the text
  hints on it. It doesn't need to be as verbose as the current help
  panel (that can stay) but it would basically just list out the
  shortcut keys and what they do. At certain viewing angles it would
  be hard to see this panel, ie if the room is rotated far to the left
  right or top. That's ok for now, let's see how it looks, and then we
  can strategize what to do in those cases afterwards.
- The "hand" tool icon was hand drawn by me back in 1991 and it looks
  pretty poor. There are some polygon breaks that make it not render
  smoothly. those need to be repaired or a new fresh hand icon object
  should be created instead to replace the one we had back then.
