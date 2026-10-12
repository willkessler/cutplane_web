# Cutplane documentation

The user guide and architecture notes will grow here as each milestone lands. Screenshots go in
`docs/images/`.

## Roadmap

| Milestone | Scope                                                               |
| --------- | ------------------------------------------------------------------- |
| **M0** ✅ | Scaffold: workspace, Docker dev/prod images, tests, CI              |
| M1        | Kernel and `.cut` I/O: half-edge B-rep, Euler operators, validation |
| M2        | Room, plane, section and full-screen work mode                      |
| M3        | Direct manipulation: selection hierarchy, drag, constrain, carry    |
| M4        | Rotate tool and editing, undo                                       |
| M5        | CPL VM and environment: code stored in objects, live editing        |
| M6        | Modeling operations: slice, booleans, drill, push/pull              |
| M7        | Formats: OBJ, STL, glTF, drag and drop, autosave                    |
| M8        | Ship: user guide, help plate, deployment                            |
| M9        | Acceptance: load and rebuild the stapler, fan and Discovery         |
| M10       | Language evolution (optional)                                       |

## Development notes

- **Builds run in Docker only.** `compose.yaml` keeps every `node_modules` in named volumes, so
  the Linux binaries never land on the host.
- **Firefox E2E runs headed under `xvfb-run`.** Headless Firefox on Linux has no WebGL.
- `pnpm check` is the full local gate. (pnpm 12 reserves `pnpm ci` for a clean install.)
