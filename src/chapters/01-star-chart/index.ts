/**
 * Chapter 01 — Star Chart
 *
 * A night sky drawn entirely by a software rasterizer: perspective projection
 * done by hand on the CPU, Wu/DDA lines, barycentric triangles, Catmull-Rom
 * figure strokes — then blitted to the screen as a single texture. The GPU's
 * only job here is the shared print pass.
 *
 * It is also the first true generator: the seed writes the sky.
 */

import type { ChapterContext, ChapterInstance } from '../../app/chapter.ts';
import { DEG, clamp, vec3, type Vec3 } from '../../core/math.ts';
import { Raster, type RGB } from '../../core/raster.ts';
import { RasterBlitter } from '../../gl/blit.ts';
import type { LabelSpec } from '../../ui/labels.ts';
import { generateSky, type SkyModel } from './sky.ts';

/** The celestial sphere's world radius — labels live at this distance. */
const SPHERE_RADIUS = 60;
/** CPU buffer cap: full canvas resolution is wasted on a stippled chart. */
const MAX_RASTER_WIDTH = 1500;

interface Settings {
  antialias: boolean;
  figures: boolean;
  graticule: boolean;
  names: boolean;
  draw: boolean;
}

export function create(ctx: ChapterContext): ChapterInstance {
  const { gl, camera, inks, labels, controls, canvas, print } = ctx;

  // Heavier paper for the chart: it should feel like an old plate.
  print.settings.paperGrain = 0.045;
  print.settings.halftone = 0.12;
  print.settings.vignette = 0.65;

  // Sky viewing: eye at the centre, drag pans, wheel zooms the FOV.
  // The zoom range runs far past what a perspective matrix could show — the
  // chart's own azimuthal projection (below) handles the wide end.
  camera.lookOut = true;
  camera.minFov = 30 * DEG;
  camera.maxFov = 7.6; // radians of chart width: the whole sphere, plus margin
  camera.fov = 110 * DEG;
  camera.focus(vec3.create(0, 0, 0));

  const settings: Settings = {
    antialias: true,
    figures: true,
    graticule: true,
    names: true,
    draw: false,
  };

  const model: SkyModel = generateSky(ctx.seed);

  const raster = new Raster(4, 4);
  const blitter = new RasterBlitter(gl);

  // The raster works in 0-255 RGB triples; InkSet caches those conversions
  // once so every CPU-drawing chapter (this one, ch.6's poster mode) shares
  // the same palette resolution instead of re-deriving it.
  const paperRgb = inks.paperRgb;
  const lineRgb = inks.lineRgb;
  const ink = (i: number): RGB => inks.rgb(i);

  // -- CPU projection -------------------------------------------------------
  // An azimuthal equidistant projection — the planisphere. A direction's
  // angular distance from the view centre becomes radial distance on the
  // chart, so zooming out never clips: at full zoom-out the entire celestial
  // sphere is one circle, the antipode stretched around its rim. This is the
  // projection real star charts use, computed per point by hand.

  interface Projected {
    x: number;
    y: number;
    visible: boolean;
  }

  // View basis, pulled from the camera's view matrix each frame.
  const basisRight = vec3.create();
  const basisUp = vec3.create();
  const basisForward = vec3.create();

  const updateBasis = (): void => {
    const v = camera.view;
    vec3.set(basisRight, v[0]!, v[4]!, v[8]!);
    vec3.set(basisUp, v[1]!, v[5]!, v[9]!);
    vec3.set(basisForward, -v[2]!, -v[6]!, -v[10]!);
  };

  /** The chart circle's radius, as a fraction of the frame's short side. */
  const CHART_EXTENT = 0.46;

  /** Project a unit direction into normalized [0,1]² screen coords. */
  const projectNorm = (dir: Vec3, out: Projected): void => {
    const f = Math.min(1, Math.max(-1, vec3.dot(dir, basisForward)));
    const rx = vec3.dot(dir, basisRight);
    const ry = vec3.dot(dir, basisUp);

    const theta = Math.acos(f);
    const halfFov = camera.fov / 2;
    const s = (theta / halfFov) * CHART_EXTENT;

    const sinT = Math.hypot(rx, ry);
    const ux = sinT > 1e-6 ? rx / sinT : 0;
    const uy = sinT > 1e-6 ? ry / sinT : 0;

    // s is a fraction of the short side; convert per axis.
    const aspectX = Math.min(1, height / width);
    const aspectY = Math.min(1, width / height);
    out.x = 0.5 + ux * s * aspectX;
    out.y = 0.5 - uy * s * aspectY;
    out.visible =
      theta < Math.PI * 0.999 &&
      out.x >= -0.18 && out.x <= 1.18 && out.y >= -0.18 && out.y <= 1.18;
  };

  const projectDir = (dir: Vec3, out: Projected): void => {
    projectNorm(dir, out);
    out.x *= raster.width;
    out.y *= raster.height;
  };

  const pa: Projected = { x: 0, y: 0, visible: false };
  const pb: Projected = { x: 0, y: 0, visible: false };

  // Labels follow the same chart, not the camera's perspective matrix.
  const labelDir = vec3.create();
  labels.projector = (position, out) => {
    vec3.normalize(labelDir, position);
    projectNorm(labelDir, out);
  };

  // -- drawing your own constellations --------------------------------------

  /** User strokes: chains of catalog star indices, drawn like figures. */
  const userChains: number[][] = [];
  let activeChain: number[] | null = null;

  const pickStar = (clientX: number, clientY: number): number => {
    // Invert the chart: pointer → chart radius/angle → direction on the sphere.
    const rect = canvas.getBoundingClientRect();
    updateBasis();

    const nx = (clientX - rect.left) / rect.width - 0.5;
    const ny = 0.5 - (clientY - rect.top) / rect.height;
    const sx = nx / Math.min(1, height / width);
    const sy = ny / Math.min(1, width / height);
    const s = Math.hypot(sx, sy);

    const halfFov = camera.fov / 2;
    const theta = (s / CHART_EXTENT) * halfFov;
    if (theta > Math.PI) return -1; // clicked outside the sphere

    const ux = s > 1e-6 ? sx / s : 0;
    const uy = s > 1e-6 ? sy / s : 0;
    const sinT = Math.sin(theta);
    const rayDir = vec3.create();
    vec3.scaleAndAdd(rayDir, rayDir, basisForward, Math.cos(theta));
    vec3.scaleAndAdd(rayDir, rayDir, basisRight, ux * sinT);
    vec3.scaleAndAdd(rayDir, rayDir, basisUp, uy * sinT);

    // The pick radius grows with the zoom-out, in chart terms.
    let best = -1;
    let bestDot = Math.cos(3.5 * DEG * Math.max(1, camera.fov / (110 * DEG)));
    for (let i = 0; i < model.stars.length; i++) {
      const star = model.stars[i]!;
      if (star.mag < 0.4) continue; // faint dust isn't clickable
      const d = vec3.dot(rayDir, star.dir);
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    return best;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!settings.draw || e.button !== 0) return;
    const star = pickStar(e.clientX, e.clientY);
    if (star < 0) return;
    if (!activeChain) {
      activeChain = [star];
      userChains.push(activeChain);
    } else if (activeChain[activeChain.length - 1] !== star) {
      activeChain.push(star);
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);

  // -- controls -------------------------------------------------------------

  controls.addAll([
    { kind: 'toggle', label: 'Constellation figures', value: settings.figures, onChange: (v) => (settings.figures = v) },
    { kind: 'toggle', label: 'Graticule', value: settings.graticule, onChange: (v) => (settings.graticule = v) },
    { kind: 'toggle', label: 'Names', value: settings.names, onChange: (v) => (settings.names = v) },
    {
      kind: 'toggle', label: 'Antialiasing', value: settings.antialias,
      onChange: (v) => (settings.antialias = v),
    },
    {
      kind: 'toggle', label: 'Draw your own', value: settings.draw,
      onChange: (v) => {
        settings.draw = v;
        activeChain = null;
        // While drawing, clicks pick stars instead of panning the sky.
        camera.inputEnabled = !v;
        canvas.style.cursor = v ? 'crosshair' : 'grab';
      },
    },
    {
      kind: 'button', label: 'Lift your ink',
      onClick: () => {
        userChains.length = 0;
        activeChain = null;
      },
    },
  ]);

  // -- labels ---------------------------------------------------------------

  const buildLabels = (): void => {
    const specs: LabelSpec[] = [];
    for (const constellation of model.constellations) {
      specs.push({
        id: `c-${constellation.name}`,
        text: constellation.name,
        color: inks.hex(constellation.inkIndex),
        position: vec3.scale(vec3.create(), constellation.centroid, SPHERE_RADIUS),
        priority: 5,
      });
    }
    model.stars.forEach((star, i) => {
      if (!star.name) return;
      specs.push({
        id: `s-${i}`,
        text: star.name,
        color: inks.palette.line,
        position: vec3.scale(vec3.create(), star.dir, SPHERE_RADIUS),
        priority: 2,
      });
    });
    labels.set(specs);
  };
  buildLabels();

  // -- render passes (all CPU) ----------------------------------------------

  const drawGraticule = (): void => {
    const aa = settings.antialias;
    const alpha = 0.16;
    const steps = 72;
    const point = vec3.create();

    // Declination circles.
    for (let ring = 1; ring < 6; ring++) {
      const phi = (ring / 6) * Math.PI;
      const y = Math.cos(phi);
      const r = Math.sin(phi);
      let started = false;
      for (let s = 0; s <= steps; s++) {
        const theta = (s / steps) * Math.PI * 2;
        vec3.set(point, r * Math.cos(theta), y, r * Math.sin(theta));
        projectDir(point, pb);
        if (started && pa.visible && pb.visible) {
          raster.line(pa.x, pa.y, pb.x, pb.y, lineRgb, { alpha, aa });
        }
        pa.x = pb.x; pa.y = pb.y; pa.visible = pb.visible;
        started = true;
      }
    }

    // Right-ascension meridians.
    for (let m = 0; m < 12; m++) {
      const theta = (m / 12) * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      let started = false;
      for (let s = 0; s <= steps / 2; s++) {
        const phi = (s / (steps / 2)) * Math.PI;
        const r = Math.sin(phi);
        vec3.set(point, r * ct, Math.cos(phi), r * st);
        projectDir(point, pb);
        if (started && pa.visible && pb.visible) {
          raster.line(pa.x, pa.y, pb.x, pb.y, lineRgb, { alpha, aa });
        }
        pa.x = pb.x; pa.y = pb.y; pa.visible = pb.visible;
        started = true;
      }
    }
  };

  let twinkleClock = 0;

  const drawStars = (): void => {
    const aa = settings.antialias;
    for (let i = 0; i < model.stars.length; i++) {
      const star = model.stars[i]!;
      projectDir(star.dir, pa);
      if (!pa.visible) continue;

      const color = star.tint >= 0 ? ink(star.tint) : lineRgb;
      // Radius follows magnitude; the zoom widens stars a little so the sky
      // feels closer, not just cropped — clamped so the whole-sphere view
      // still resolves individual points.
      const zoom = clamp((110 * DEG) / camera.fov, 0.3, 2.4);
      const radius = (0.4 + star.mag * star.mag * 2.6) * Math.sqrt(zoom);

      // Faint stars shimmer; bright ones hold steady, like real seeing.
      let alpha = 0.5 + star.mag * 0.5;
      if (star.mag < 0.45) {
        alpha *= 0.75 + 0.25 * Math.sin(twinkleClock * 2.1 + i * 1.7);
      }

      raster.dot(pa.x, pa.y, radius, color, alpha, aa);

      // The brightest get a four-pointed diamond, built from real triangles —
      // barycentric fills earning their keep.
      if (star.mag > 0.88) {
        const s = radius * 3.2;
        raster.triangle(pa.x - s, pa.y, pa.x, pa.y - radius * 0.55, pa.x, pa.y + radius * 0.55, color, alpha * 0.6, aa);
        raster.triangle(pa.x + s, pa.y, pa.x, pa.y - radius * 0.55, pa.x, pa.y + radius * 0.55, color, alpha * 0.6, aa);
        raster.triangle(pa.x, pa.y - s, pa.x - radius * 0.55, pa.y, pa.x + radius * 0.55, pa.y, color, alpha * 0.6, aa);
        raster.triangle(pa.x, pa.y + s, pa.x - radius * 0.55, pa.y, pa.x + radius * 0.55, pa.y, color, alpha * 0.6, aa);
      }
    }
  };

  /** Project a chain of stars and stroke a Catmull-Rom figure through it. */
  const chainScratch: number[] = []; // reused: this runs per figure per frame
  const strokeChain = (chain: number[], color: RGB, alpha: number, bold: boolean): void => {
    const points = chainScratch;
    points.length = 0;
    for (const idx of chain) {
      projectDir(model.stars[idx]!.dir, pa);
      // A figure that wraps behind the viewer would smear across the frame —
      // stroke only runs of visible stars.
      if (!pa.visible) {
        if (points.length >= 4) {
          raster.splineStroke(points, color, { alpha, aa: settings.antialias, bold });
        }
        points.length = 0;
        continue;
      }
      points.push(pa.x, pa.y);
    }
    if (points.length >= 4) {
      raster.splineStroke(points, color, { alpha, aa: settings.antialias, bold });
    }
  };

  const drawFigures = (): void => {
    for (const constellation of model.constellations) {
      const color = ink(constellation.inkIndex);
      strokeChain(constellation.chain, color, 0.5, false);
      for (const [from, to] of constellation.branches) {
        projectDir(model.stars[from]!.dir, pa);
        projectDir(model.stars[to]!.dir, pb);
        if (pa.visible && pb.visible) {
          raster.line(pa.x, pa.y, pb.x, pb.y, color, { alpha: 0.5, aa: settings.antialias });
        }
      }
    }
  };

  const drawUserChains = (): void => {
    for (const chain of userChains) {
      if (chain.length === 1) {
        // A started chain marks its first star with a ring.
        projectDir(model.stars[chain[0]!]!.dir, pa);
        if (pa.visible) raster.ring(pa.x, pa.y, 6, lineRgb, 0.8, settings.antialias);
        continue;
      }
      strokeChain(chain, lineRgb, 0.85, true);
    }
  };

  // -- lifecycle ------------------------------------------------------------

  let width = ctx.size.width;
  let height = ctx.size.height;

  // The plate: everything that only changes with the *view* — the cleared
  // paper and the graticule, ~1300 projected line segments — baked to a
  // snapshot and restored by memcpy each frame. Stars, figures and chains
  // still draw per frame (the twinkle animates, and layering puts them above
  // the graticule), but the majority of the line work stops repeating itself.
  // The view comparison is exact: the camera's damping converges bitwise, so
  // a resting chart re-bakes nothing.
  const plateView = new Float32Array(16);
  let plateFov = -1;
  let plateW = -1;
  let plateH = -1;
  let plateGraticule = false;
  let plateAa = false;
  let plate: Uint32Array | null = null;

  return {
    update(dt) {
      twinkleClock += dt;
      labels.visible = settings.names;
    },

    render() {
      const scale = Math.min(1, MAX_RASTER_WIDTH / width);
      raster.resize(Math.round(width * scale), Math.round(height * scale));

      updateBasis();

      const v = camera.view;
      let dirty =
        plate === null ||
        plateFov !== camera.fov ||
        plateW !== raster.width ||
        plateH !== raster.height ||
        plateGraticule !== settings.graticule ||
        plateAa !== settings.antialias;
      if (!dirty) {
        for (let i = 0; i < 16; i++) {
          if (plateView[i] !== v[i]!) {
            dirty = true;
            break;
          }
        }
      }

      if (dirty) {
        raster.clear(paperRgb);
        if (settings.graticule) drawGraticule();
        plate = raster.snapshot(plate ?? undefined);
        plateView.set(v);
        plateFov = camera.fov;
        plateW = raster.width;
        plateH = raster.height;
        plateGraticule = settings.graticule;
        plateAa = settings.antialias;
      } else {
        raster.restore(plate!);
      }

      drawStars();
      if (settings.figures) drawFigures();
      drawUserChains();

      blitter.upload(raster);
      blitter.draw();
    },

    resize(w, h) {
      width = w;
      height = h;
    },

    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.style.cursor = 'grab';
      camera.inputEnabled = true;
      camera.lookOut = false;
      camera.minFov = 18 * DEG;
      camera.maxFov = 70 * DEG;
      camera.fov = 42 * DEG;
      labels.projector = null;
      blitter.dispose();
    },
  };
}
