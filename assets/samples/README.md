# Sample models

Models built in the original Cutplane / 3Form on SGI workstations at Stanford, 1991–93, from
Larry Edwards's archive. They're the original `.cut` files, decompressed and renamed (see
`index.json` for each file's original name and date). They load unchanged.

One is new: `orion-iii.cut`, the Pan Am Orion III shuttle from _2001: A Space Odyssey_, built in
2026 by Claude working the app by hand through its MCP server (see `docs/MCP.md`). It has no
original (`"original": null` in the index). So is `space-station-v.cut`, the station the Orion
docks at, built the same way and still in progress: two rings (one finished, one half bare
struts), their spokes, the hub and the docking bay. And `eva-pod.cut`, one of _Discovery_'s EVA
pods, made with the direct calls: the hull with its window canted back, a ribbed oval funnel narrowing inward, flush with the shell, the side thruster cones with their dark
panels and radial grooves, the grab-bar dimples for an astronaut outside, four grabbers, the headlamps, the emergency hatch Dave blows (an object of its own), and inside,
the seat and control panel. It's one group; ungroup it to take it apart. And `moonbus.cut`, the
lunar transport that carries Floyd to the monolith: five windows down each roof flank in a dark
band, the windscreen split by its strut, the wide cheeks beside it with the cockpit's side windows,
lamps front and roof, the antenna, jets in cubbies at the corners and four landing feet. One group
too.

Not from the film: `also-tmb1.cut`, the TMB-1 electric bike from Also, also built with the
direct calls: spoked wheels with brake discs and the drive as Also built it, pedal-by-wire, with
no chain. The pedals turn a generator, and the traction motor (its purple ring) drives the rear
wheel by a belt in the black arm; both are seen through a smoked glass cover. The white battery
pops in with its purple fold-out handle. The frame is round and step-through, with a
black-and-gold fork, bars and a saddle on rails. One group.

The full archive (116 files, including scratch and test files) is kept out of the repo. To run the
corpus tests against it, put it in `corpus/cut/` (git-ignored) or point `CUTPLANE_CORPUS` at it.
