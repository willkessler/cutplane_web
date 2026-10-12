# Cutplane

![The Discovery, built in 3Form in 1991, loaded from its original .cut file](docs/images/demo.gif)

A browser-native rebuild of **Cutplane / 3Form**, the late-1980s SGI 3D modeler built around a
_moving section plane_. You push a plane through the room, and wherever it slices your solids you
see their cross-sections. Vertices, edges and faces are picked and edited where they cross it.

> **Status: M5 (CPL and the environment).** The animation shows the _Discovery_, modeled in
> 3Form in April 1991 and loaded unchanged from its original `disc4.cut`. The cutplane is pushed
> through it (the yellow line is the live section), and a face of the command module is taken hold
> of through the section, pulled out and pushed back home. The rotate tool is brought to the lower
> ship and a slide along its bar rolls the ship around and back. Last, a click on the toolpads'
> headpad opens its rail. All of this now runs on the original CPL scripts (`rom.cpl`,
> `cursor.cpl`, the tools' and pads' code) in a CPL virtual machine. Code is stored in objects and
> can be edited while it runs. Modeling operations come next.
> See the [roadmap](docs/README.md#roadmap), the [controls](docs/README.md#using-cutplane) and
> [how it differs from the original](docs/README.md#differences-from-the-original).

## Quick start

Everything installs, builds and tests inside Docker. Nothing needs to be installed on the host
except Docker.

```sh
docker compose up                          # dev server at http://localhost:5173
docker compose run --rm dev pnpm check     # format, lint, typecheck, unit tests, build
docker compose run --rm e2e                # Playwright: Chromium, Firefox, WebKit
docker compose --profile prod up web       # production image at http://localhost:8080
```

## Layout

| Package              | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `packages/kernel`    | Half-edge B-rep, Euler operators, sectioning, selection (no DOM, no three.js) |
| `packages/formats`   | `.cut` / `.rsc` / `.dcl` / `.icon` I/O; OBJ, STL and glTF import and export   |
| `packages/booleans`  | manifold-3d adapter, with coplanar face re-merge back into the B-rep          |
| `packages/cpl`       | CPL assembler, virtual machine, disassembler and debugger                     |
| `packages/behaviors` | The world CPL runs in: host API, C routines, the environment's tools          |
| `packages/app`       | three.js renderer, input and full-screen work mode, UI                        |

## Deploying

The production image (`docker/Dockerfile`) builds the static site and serves it with Caddy on
`$PORT`. Both [Render](render.yaml) and [Railway](railway.json) configs are included. Point
either service at this repository and it will build from the Dockerfile.

## License

[MIT](LICENSE).
