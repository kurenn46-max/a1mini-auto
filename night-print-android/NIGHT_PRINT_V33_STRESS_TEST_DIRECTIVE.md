# NIGHT PRINT V3.3 — autonomous offline geometry/process stress-testing directive

## Role / objective
You are a safety-first slicer QA engineer for NIGHT PRINT on Bambu Lab A1 mini (180 × 180 × 180 mm). **Execute** this directive, not just recommend it: generate deterministic 3MF meshes, drive the real Android ViewModel/native Orca slicer, parse executable G-code, fix reproducible faults in an isolated feature branch, and rerun tests. The goal is reliable geometry + process fidelity without an extra “ナイト設定” step.

## Hard constraints
- No printer pairing, upload, heating or printing; outputs remain offline G-code only. Preserve V3.2 and main branch; publish no APK unless final tests pass. Separate package ID for any debug build.
- Never claim a virtual slicer run proves physical printability, fit, strength, support removal, adhesion or electrical/thermal safety.
- Every positive 3MF must preserve model XML (watertight oriented mesh and real Z height), PETG nozzle 235°C and bed 65°C, embedded process settings, exact A1 mini printer profile.
- Audit executable commands, not only G-code headers or previews: PETG startup, 180 mm XY deposition limits, nonempty positive extrusion on every layer, Z increases and layer count for known fixture height, top/bottom/infill/walls, no 220°C executable startup.
- Negative input must be rejected safely: corrupt ZIP, missing config, wrong filament (PLA), temperature mismatch, malformed/traversal archive, invalid material, oversized geometry, overlapping/colliding objects when relevant. Report unsupported paths explicitly rather than implicitly declaring success.
- Benchmark wall-clock seconds, G-code bytes and layer count; do not invent performance percentages or infer print quality from G-code alone.

## Matrix of independent cases
1. Baseline 20×24×20 mm 1024-facet ring (0.20 mm, 5 walls, 40% gyroid, 100 layers).
2. Same ring at 0.16 mm / 4 walls / 25% cubic / 125 layers.
3. Same ring at 0.25 mm / 3 walls / 35% grid / 80 layers (0.4 mm nozzle).
4. Solid cube/prism with flat top and large infill (test slicing massive solid layers).
5. Concave L-bracket with sharp internal corners (dimension and topology).
6. Small circular through-hole mount / annular plate (hole continuity).
7. Thin-wall open tube (perimeter thinning and E generation).
8. T-overhang cantilever shape (bridging and layer coverage; does not prove physical feasibility).
9. Tapered/frustum solid (varying cross-section over Z).
10. Two disjoint models in one 3MF (multi-object—not multiple material), if supported.
11. Reimport new 3MF after prior-night-process overrides; after-import explicit override remains supported.
12. Negative malformed/corrupt config, PLA, temperature disagreement, model exceeds bed, and internal ZIP path traversal where handled.

## Gates
- Generate and validate deterministic 3MF archives with Python: ZIP CRC and profile, triangle indices, watertight edge-incidence=2, consistent edge orientation, real object dimensions and valid print volume. Never repair a fixture silently.
- Android E2E runs on true native ARM64 code, via the real app's import → UI/ViewModel startSlicing → SliceComplete or safe Error; measure metrics for each fixture.
- XML report 0 failures/0 skipped (or explicitly documented failure/unsupported); final commit only. Inspect GitHub Actions artifacts and test logs rather than relying on “green workflow” alone.
- Produce a concise report with *tested / passed / blocked / risks*; do not label unsupported negative cases pass. Physical print tests deferred for user approval.
