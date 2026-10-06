# NexSpiro

Texture-first spiral slicer. Generates knit, rope, perforated, ribbed and sine wall textures directly as toolpaths, including in-layer Z motion (non-planar), and outputs G-code for Marlin, Klipper and Bambu.

- Scope and roadmap: [docs/SCOPE.md](docs/SCOPE.md)
- Tests: `npm test`
- Generate: `npm run generate -- bowl knit klipper out.gcode`
  - Primitives: `vase`, `bowl`, `shade`, `cylinder`
  - Patterns: `none`, `sine`, `knit`, `rope`, `perforated`, `ribbed`
