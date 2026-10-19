# Edges tool: chamfer, fillet, smooth body

Open it from the toolbar (cube icon) or press **G**. Works on one object at a time in Prepare.

## Picking edges
- Click an edge: the whole crease run it belongs to is picked (a rim, a straight run).
- **Shift+click** adds a run, or removes it when it is already picked. **Alt+click** picks a single tessellation edge.
- **Select all creases** picks every edge bending more than the **Crease** angle.
- **Show edges** draws creases (dark), open edges (red), the outline of painted colour regions (a dark shade of that
  filament) and, for quad models, the outline of the quads. **Smooth shading** only changes how the model is lit.

## Chamfer / fillet
- Size is the distance along each adjoining face, measured from the edge. **Round** is the number of segments of a fillet.
- Convex edges lose material, concave edges gain it.
- The size is reduced when it would not fit inside the neighbouring triangles; the toast tells you the size used.
  Very short or sliver triangles (finely tessellated curves) can force a small size, and **Refine** does not remove
  that limit.
- Open and non-manifold edges are skipped.

## Smooth body
- **Subdivide**: models imported from OBJ with quad faces are subdivided with Catmull-Clark. Other models use Loop.
  Edges steeper than the crease angle stay sharp. Up to 3 levels, capped at 2 million triangles.
- **Relax surface**: Taubin smoothing (keeps volume); vertices on creases and open borders stay put.
  **Painted area only** limits it to triangles that carry colour, support or seam paint.
- **Refine** splits edges longer than **Max edge** so triangles are even. The shape does not change.

All edits are one undo step, keep per-triangle paint, and keep the object on the bed if it was on it.

## Notes
- STL and 3MF have no quad information, so subdividing them uses Loop. OBJ face groups are kept in project files.
- Chamfer and fillet work on the mesh. For STEP / IGES models they would act on the tessellation, not the original surfaces.

## Code
`src/engine/topology.ts` (edge data), `src/engine/meshedit.ts` (edits), `src/state/meshTools.ts` (actions),
`src/viewport/edgeOverlay.ts` (lines), `tests/meshedit.test.ts`.
