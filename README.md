# The Forge — a generated cosmos

**[▶ Open the live build](https://nuterian.github.io/forge/)** &nbsp;·&nbsp; [![Deploy](https://github.com/nuterian/forge/actions/workflows/deploy.yml/badge.svg)](https://github.com/nuterian/forge/actions/workflows/deploy.yml)

A redo of my NYU Spring 2015 Computer Graphics coursework (instructed by Ken Perlin)
as a single showcase of fundamental graphics concepts: six chapters escalating from a
hand-written software rasterizer in WebGL2 to WebGPU compute and a single-pass analytic
ray tracer.

Every chapter is a **seeded generator** with a reroll button, and the chapters build on
each other literally — each one's generator becomes a component of the finale, which
composes them all into a full star-system generator.

The live link above always points at the latest `main`; the badge is the status of the
deploy that published it.

## Chapters

| | Chapter | Concepts | Status |
|---|---|---|---|
| 01 | **Star Chart** | Software rasterization (DDA lines, barycentric fills), perspective projection by hand on the CPU, splines, aliasing | Built |
| 02 | **Orrery** | Scene graph, Kepler orbits, MVP + quaternion camera, instancing, parametric surfaces, OBJ loading | Built |
| 03 | **Worldsmith** | Procedural noise (FBM, domain warping), shading models side by side, tangent-space normal mapping, colour ramps and filtering | Built |
| 04 | **Groundside** | Framebuffers and post, shadow mapping with PCF, bloom, tone mapping | In press |
| 05 | **Galaxy Loom** | WebGPU compute, storage buffers, GPGPU particles, curl noise | In press |
| 06 | **The Forge** | Analytic ray tracing, hard shadows and reflections, procedural poster layout | In press |

Each is a re-imagining of a specific 2015 assignment, not just the same topic — see
[DESIGN.md](DESIGN.md) for the lineage table, the art direction, and the per-chapter
specs.

## Art direction

Space-age print — risograph and vintage poster, deliberately stylized and never
photoreal. A limited ink palette on near-black paper, Lambert quantized into hard bands
with crisp terminators, clean vector linework for orbits and constellation strokes, and
one shared grain/halftone/vignette post pass that unifies every chapter. Lighting stays
physically sensible even where the shading is flat: correct terminators, dark night
sides, sun-relative phases.

## Running it

```bash
npm install
npm run dev
```

`npm run build` typechecks and builds to `dist/`; `npm run typecheck` runs the
typechecker alone.

Chapters are addressed by hash route, and seeds are shareable:
`#/worldsmith?seed=VELA-2015`.

## Stack

Vite + TypeScript with **zero runtime dependencies** — no three.js, no math library, no
shader framework. The fundamentals are the point, so the matrix/quaternion math, the
WebGL2 helpers, the noise, the seeded PRNG, the OBJ parser and the software rasterizer
are all hand-rolled.

```
src/
  core/      math, seeded rng/hash, noise, camera, splines, loop, software raster
  gl/        WebGL2 helpers: programs and #include chunks, FBOs, meshes, geometry,
             polylines, render-pass state, the print post pass
  scene/     furniture shared by the space chapters: sky pass, glow billboard, and
             the body/rings/orbit/sun shaders
  ui/        control panel, labels, ink palettes
  chapters/  one directory per chapter
```
