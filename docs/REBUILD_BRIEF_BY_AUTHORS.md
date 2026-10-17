# The story of CUTPLANE

In 1987, rapid physical product design was difficult. The CAD
(Computer Aided Design) tools of the day were based on blueprint
designs: side, front, top and isometric views. Designing forms in
these systems required visualizing objects within these views, and
manipulating points and surfaces in them. This was slow and tedious;
not to mention, it is not the way humans think about the real
world. We have stereo vision and look at objects from different angles
all the time.

Along with my partner, Laurence (Larry) Edwards, I wanted to create an
immersive modeling system that would overcome these limitations. From
any viewing angle, you should be able to shape and mold objects
quickly, intuitively, and without creating impossible-to-manufacture
shapes.

The problem was using the mouse, trackpad, or other flat input
device. The 2d position of the mouse didn't map easily to a 3d
coordinate without using the 3 views. In the isometric view, it was
very easy to get confused about where you were "pointing" if you just
cast a ray directly back in space to an arbitrary depth to determine
where the user wanted to put a vertex, edge, or surface. Even if you
were using CSG models vs polygonal models, the system could easily get
confused. Changing the isometric viewing angle would quickly reveal
some frankenstein creations that looked great at one viewing angle but
at another were totally wrong.

So, Larry and I created the Cutplane project. It was our master's
theses. We built a working version of the system (after about 100
prototypes for various features tested with users).

The invention that worked here was the "cutplane", a cutting plane
that could be passed through any surface you wished to manipulate in
the 3d space. The cut-section was two-dimensional, so the 2d mouse
could be mapped directly into that cutting plane with zero
ambiguity. The cutplane could then be moved back and forth in space to
manipulate different sections of a solid or to move solids in space.
You could move the Cutplane back and forth with the middle button of
the mouse, and the left mouse button could click and grab. For
instance, you could grab an edge of the section line to manipulate an
entire polygonal surface intersecting the Cutplane.

A "working room" was drawn to help orient users and the plane relative
to objects. The right mouse button could be held down to rotate the view.

After much user-testing, it was also determined that while users could
rotate the "working room" to change the viewing angle, the Cutplane's
orientation should stay fixed relative to the walls of the room. The
amount of room rotation was also limited to 90 degrees left/right and
up/down, because rotating the room too far required flipping of
left-right or up-down on the mouse mapping and led to user
confusion. If you absolutely needed to work on an object at an angle
past these limits, you could rotate individual objects or groups of
objects using a rotation tool that existed inside the plane. This tool
allowed you to rotate objects about all three axes with simple
dragging, or even about edges of the Cutplane section.

Our philosophy was "total immersion". You never left the 3d space to
access controls such as object manipulators like the rotation tool,
cutting tools, glueing tools, etc. Even dialog boxes appeared in the
Cutplane surface rather than menus in an outer standard application of
the day.

At the time of this work, "virtual reality" was all the rage, so our
work fit naturally into gaming, movie design, and other 3d world
creation efforts, as well as mechanical engineering and aerospace.

Cutplane was coded in about 80,000 lines of pure C code, leveraging
the IrisGL rendering system. It also had a custom language I built
called "CPL" (the Cutplane Language) which resembled assembly code,
where code could be associated with objects to dynamically control
their behavior. The "tool boxes" in the back of the working room were
implemented in this language. For instance, you could open the box of
primitives like cones, spheres, cubes etc, and then clicking on one of
those would self clone to give you a new shape to work with. The
self-cloning was implemented by CPL.

An article on the project was submitted to SIGCHI (see `docs/`
folder).

Eventually, Stanford sought a patent on the work, and Larry and I
formed a company to sell the invention. However, due to the fact that
only high-end Silicon Graphics computers were capable of rendering
this level of UX interactively, the software was inaccessible to most
PC users. And it was difficult to attain significant sales and
licensing; other companies (like Wavefront, Alias, and Autocad) were
loathe to change their systems just for a relatively young, unproven
technology, and felt their users didn't want systems that were
actually _easier_ to use as this devalued their exteremely expensive
software costs.

On the flip side, certain design firms (such as David Kelly Design /
IDEO) loved the system.

# Resurrecting CUTPLANE

It's been many years since this tech was invented. Other tech such as
SketchUp have come along (which we believe was inspired by our work)
as personal computers became more capable of these sort of
interactions.

Today, ThreeJs in the browser is actually capable of the speed and
rendering that cost us tens of thousands back in the late 1980's.

An initial port of Cutplane to javascript was first attempted 9 years
ago. It was fairly successful in implementing the basics, like surface
manipulation, and basic CSG-style boolean operations. You can find it
in this directory under `cutplane_js` (it has its own git repo).

However, Larry continued to from time to time improve the C version of
the codebase, and it was ported most recently to Macos Sequoia. The
most recenty copy of the C codebase is in `cutplane_c/`.

What we want to do now is to resurrect the entire system in the
browser. We want anybody to be able to try out the system, and also
load and save objects in some of todays' more popular 3d modeling
formats instead of just the simple format we built back then (indexes,
edges, polygons, and surface colors).

You should be able to open some of the objects we created as samples
back then: stapler, standing floor fan, and the Discovery spaceship
from the movie 2001 (our favorite movie in 1989).

Our end result would be a new git repo where the entire system could
be stood up locally. The preferred language would be Typescript, or,
if webasm makes more sense from a speed perspective, we could consider
that as well.

It would be great to re-implement CPL, but also would consider
swapping in a more modern, complete language for dynamic interactivity
of the objects.

We want to keep working with underlying polygonal models rather than
switching to a pure underlying CSG or octree model. This is powerful
because you can drag surfaces, edges and even individual points very
easily using this underlying models. However, one downside is that
boolean operations on polygonal models such as union, subtraction, and
cutting are difficult since floating point inaccuracies can "break"
surface continuity or end up with divide-by-zero errors.

In this port, we should be aware of these shortcomings and plan ahead
for them.

## Your process and goal

Rebuild Cutplane as a typescript project fully usable in a browser.
We want to establish a new git repo that anybody can use to try out
the system. We will eventually stand it up in Railway.com or
Render.com. The new repo would include images and instructions on how
to setup and use the system.

You can (and probably should) reference the js and Sequoia ports,
along with screenshots from the old SGI version (see
`original_photos/`) while building the new version. You should read
the pdf files in the `articles/` folder to see the patentable ideas.

Begin by creating a formal plan for the implementation. Check in with
me on the plan before implementing anything.
