# Enhancements for Oct 17, 2026

- Copy this file and the README.md into the docs/ folder, but rename the README so it clearly indicates it was the rebuild-plan from the authors (Will Kessler/Larry Edwards) and not a Claude-generated file
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
