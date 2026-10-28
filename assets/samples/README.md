# Sample models

Models built in the original Cutplane / 3Form on SGI workstations at Stanford, 1991–93, from
Larry Edwards's archive. They're the original `.cut` files, decompressed and renamed (see
`index.json` for each file's original name and date). They load unchanged.

One is new: `orion-iii.cut`, the Pan Am Orion III shuttle from _2001: A Space Odyssey_, built in
2026 by Claude working the app by hand through its MCP server (see `docs/MCP.md`). It has no
original (`"original": null` in the index).

The full archive (116 files, including scratch and test files) is kept out of the repo. To run the
corpus tests against it, put it in `corpus/cut/` (git-ignored) or point `CUTPLANE_CORPUS` at it.
