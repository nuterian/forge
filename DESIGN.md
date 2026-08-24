# The Forge — a generated cosmos

A redo of my NYU Spring 2015 Computer Graphics coursework (instructed by Ken Perlin)
as a single showcase of fundamental graphics concepts: six high-polish chapters,
escalating from a hand-written software rasterizer in WebGL2 to WebGPU compute and
a single-pass analytic ray tracer.

## Art direction: space-age print (risograph / vintage poster)

Deliberately stylized, NOT photoreal. Cheap to render, impossible to render
"wrong," unique, and consistent:

- **Limited ink palette:** 3–4 colors per chapter from one shared set, on
  near-black "paper." Seeds may pick the ink combination.
- **Flat, banded lighting:** Lambert quantized into 2–3 hard bands; crisp
  terminators. Planets read as silkscreened prints, not renders.
- **One shared post pass:** grain + ordered dither/halftone + vignette in a
  single cheap fullscreen shader — this is what unifies every chapter visually.
- **Clean vector linework:** orbits, trails, constellation strokes as ink lines;
  poster typography for labels.
- No PBR/IBL, no deferred, no volumetrics, no progressive accumulation. Every
  effect must be achievable with simple, reliable shaders.

**Unifying idea: every chapter is a seeded generator.** Each has a seed and a
reroll button (the DNA of the old repo's last two projects — the Perlin-terrain
generator and the walkable voxel world). And the chapters build on each other
*literally*: each chapter's generator becomes a component of the finale, which
composes all of them into a full star-system generator.

**Second rule: every chapter is a re-imagining of a specific original project.**
Not just the same topics — a recognizable descendant, with deliberate callbacks.

Old repo (reference only, not a foundation): `graphics-gh-pages/`

## Lineage — old spirit → new chapter

| Original (2015) | What it really was | Re-imagined as |
|---|---|---|
| Demo 1 — Intro to shaders | A procedural sun in one fragment shader, cursor-lit | The star at the Orrery's center (ch.2) and the Forge's stars (ch.6) — the same "whole sun in one shader" idea, grown up |
| Demos 2–4 — Ray tracing | Analytic sphere ray tracer in a fragment shader: Phong, shadows, reflections | The Forge's Poster Mode (ch.6) — still a single-pass analytic sphere tracer in a shader, same complexity class, now stylized and composited into a generated poster |
| Demo 5 — Matrices + OBJ | Mesh loading (incl. a space shuttle OBJ), matrix transforms | The Orrery's probe (ch.2): an OBJ-loaded spacecraft flying the spline tour — the old shuttle, re-imagined |
| Demo 6 — Perspective & parametric | Hand-rolled CPU 3D engine (c3d.js), parametric spheres/cylinders | Star Chart's software renderer (ch.1): the build-the-pipeline-yourself spirit, now with a CPU-projected 3D celestial sphere |
| Demo 7 — Splines | Spline painting toy: generative fractal brush along Bézier paths | Star Chart's constellation brush (ch.1): stippled generative strokes along user-drawn splines; also the Orrery's spline camera tours (ch.2) |
| Demo 8 — three.js + noise | Seeded Perlin voxel-terrain generator with reroll | Worldsmith (ch.3): seeded procedural planets, hand-rolled |
| Final project — Voxel world | First-person walkable generated world | Groundside (ch.4): stand on / fly over the generated planet; voxel render mode as an easter-egg homage |

## Chapters

### 1. Star Chart — rasterization from scratch (WebGL2)
- **Generator:** seed → a night sky on parchment: star field, constellation
  lines, invented constellation names, stippled/halftone shading — every stroke
  produced by a hand-written software rasterizer (lines via Bresenham/DDA,
  triangles via barycentric edge functions) blitted to a fullscreen quad.
  Users can also draw their own constellations with a **spline brush**: click
  control points and a generative stippled stroke travels the Bézier/Catmull-Rom
  path (demo 7's fractal-brush toy, re-imagined). The chart is a CPU-projected
  3D celestial sphere — my own perspective math, no GPU transforms (demo 6's
  c3d.js spirit).
- **Concepts:** the raster pipeline itself, perspective projection done by hand,
  barycentric interpolation, splines, aliasing (toggle naive vs antialiased;
  toggle my rasterizer vs the GPU's — outputs match).
- **Re-imagines:** demo 6 (hand-rolled CPU 3D engine) + demo 7 (spline painting).
- **Feeds the finale:** background star fields and chart-style system maps.

### 2. Orrery — the solar system visualizer (WebGL2)
- **Visualizer:** our actual solar system. Kepler elliptical orbits, hierarchical
  transforms (sun → planets → moons), instanced asteroid belt, orbit trails,
  parametric surfaces (spheres, ring annuli), Catmull-Rom/Bezier spline camera
  tours between bodies. Time scrubbing/warp. At the center: a procedural
  **shader sun** — noise-shaded entirely in one fragment shader (demo 1,
  grown up). Riding the spline tour: an **OBJ-loaded probe** — the old
  shuttle.obj's descendant (demo 5).
- **Concepts:** scene graph & hierarchical transforms, MVP, quaternion camera,
  depth, instancing, parametric surfaces, splines, mesh loading.
- **Re-imagines:** demo 1 (procedural shader sun) + demo 5 (matrices/OBJ meshes).
- **Feeds the finale:** orbital mechanics + camera/navigation system.

### 3. Worldsmith — planet generator (WebGL2)
- **Generator:** seed → a whole planet: domain-warped FBM continents, oceans,
  ice caps — rendered as posterized biome ramps with banded lighting and a
  rim-lit atmosphere. Visible shading-style toggle: Lambert → Blinn-Phong →
  banded/toon. Reroll button.
- **Concepts:** shading models, procedural noise (Perlin/FBM/domain warp),
  sphere UVs & color ramps, texture filtering. (No PBR/IBL — see art direction.)
- **Re-imagines:** demo 8 (the seeded Perlin terrain generator) — hand-rolled,
  wrapped onto a sphere; homage to the instructor.
- **Feeds the finale:** the planet generator, verbatim.

### 4. Groundside — standing on the generated planet (WebGL2)
- **Generator:** seeded skies over ch.3 terrain: sunsets, storms, aurora bands —
  stylized gradients, not scattering sims. Bloom on bright inks, one PCF shadow
  map, tone-mapping comparison slider. (No deferred, no god rays.)
- **Concepts:** FBOs & the post pipeline, bloom, tone mapping, shadow maps.
- **Re-imagines:** the walkable voxel-world final project — free-fly/walk over
  the generated terrain, plus a **voxel render mode** easter egg that snaps the
  terrain to cubes as a direct homage.
- **Feeds the finale:** the HDR/post pipeline used everywhere.

### 5. Galaxy Loom — galaxy generator (WebGPU)
- **Generator:** seed → a galaxy: ~200k compute-driven stars settling into
  spiral arms, curl-noise gas lanes, cursor stirring — dots and streaks in 2–3
  ink colors, additive. Reroll condenses a new galaxy live.
- **Concepts:** WebGPU compute shaders, structured buffers, GPGPU particle sim,
  3D noise, additive/soft rendering. First WebGPU chapter — the API jump is
  part of the escalation.
- **Feeds the finale:** the sky backdrop + compute infrastructure.

### 6. The Forge — star system generator + Poster Mode (WebGPU)
- **Generator:** seed → an entire star system: star class (drives ink color and
  light), planets built by Worldsmith, rings, moons, comets, Galaxy Loom
  backdrop, navigated with Orrery mechanics. Fly through in real time; then
  **Poster Mode**: the framed shot re-renders through a single-pass analytic
  ray tracer (spheres/rings, hard shadows, optional reflections) in banded inks
  and halftone, composited with generated typography ("VISIT SEED-8F3A · TWIN
  MOONS · RING SEASON") into a downloadable retro travel poster of a system
  that has never existed before.
- **Concepts:** analytic ray tracing (ray-sphere/ray-plane), hard shadows &
  reflection rays, compositing, procedural layout/typography.
- **Re-imagines:** demos 2–4 (analytic sphere ray tracing in a fragment shader) —
  the same complexity class, stylized instead of scaled up.
- **Composes:** chapters 1–5 as components. "Each demo builds on the prior one,"
  literally.

## Tech & structure

- **Stack:** Vite + TypeScript, zero runtime dependencies. No three.js — the
  fundamentals ARE the showcase. Hand-rolled minimal math lib (vec3/mat4/quat),
  thin WebGL2 and WebGPU helper layers, shared themed UI panel.
- **Seeds everywhere:** one shared seeded PRNG/hash module; seed shown in the UI,
  shareable via URL (?seed=...), reroll button in consistent chrome.
- **Layout:**
  ```
  src/
    core/        math, seeded rng/hash, noise, color, input, loop
    gl/          WebGL2 helpers (program, fbo, mesh, texture)
    gpu/         WebGPU helpers (pipeline, bindgroups, buffers)
    scene/       furniture shared by the space chapters: sky pass, glow
                 billboard, and the body/rings/orbit/sun shaders
    ui/          themed control panel, "how it works" overlay, seed bar, chapter nav
    chapters/
      01-star-chart/
      02-orrery/
      03-worldsmith/
      04-groundside/
      05-galaxy-loom/
      06-forge/
  ```
- **Every chapter has:** seed chip + reroll (seeded chapters); a collapsible
  "How it works" panel naming the concepts; a small opinionated control panel
  (defaults live in code); consistent HUD.
- **The index is a printer's proof sheet:** each chapter is a plate — a
  monochrome line engraving at rest that gets *inked* on hover (color floods
  in and the vignette starts to move). Unbuilt chapters show stamped "in
  press" plates.
- **Visual language:** the space-age print direction above — shared ink palette
  module, shared grain/halftone post pass, one poster typeface, shared chrome.
  One production, not nine assignments.
- **Fallbacks:** chapters 5–6 detect WebGPU and degrade gracefully (capability
  note + reduced WebGL2 mode or recorded loop).

## Build order

1. Scaffold: Vite + TS, core math + seeded RNG + noise, GL helpers, UI shell, router.
2. Chapter 2 (Orrery) first — exercises the whole engine core.
3. Chapter 1 (Star Chart) — self-contained; becomes the landing page.
4. Chapter 3 (Worldsmith) → 4 (Groundside) — they share the planet/terrain.
5. Chapter 5 (Galaxy Loom) — WebGPU helpers land here.
6. Chapter 6 (The Forge) — composition + Poster Mode tracer.
7. Polish: transitions, annotations, palette unification, OG images, seed sharing.
