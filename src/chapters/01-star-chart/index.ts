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
import { DEG, vec3, mat4, type Vec3 } from '../../core/math.ts';
import { Raster, type RGB } from '../../core/raster.ts';
import { RasterBlitter } from '../../gl/blit.ts';
import { hexToVec3 } from '../../ui/palette.ts';
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
  camera.lookOut = true;
  camera.fov = 55 * DEG;
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

  // -- ink lookup tables (Uint8 RGB for the raster) -------------------------

  const toRgb = (hex: string): RGB => {
    const v = hexToVec3(hex);
    return [v[0]! * 255, v[1]! * 255, v[2]! * 255];
  };
  const paperRgb = toRgb(inks.palette.paper);
  const lineRgb = toRgb(inks.palette.line);
  const inkRgb: RGB[] = inks.palette.inks.map(toRgb);
  const ink = (i: number): RGB => inkRgb[((i % inkRgb.length) + inkRgb.length) % inkRgb.length]!;

  // -- CPU projection -------------------------------------------------------
  // The one matrix multiply the GPU usually hides, spelled out per star.

  interface Projected {
    x: number;
    y: number;
    visible: boolean;
  }

  const projectDir = (dir: Vec3, out: Projected): void => {
    const m = camera.viewProjection;
    const x = dir[0]! * SPHERE_RADIUS;
    const y = dir[1]! * SPHERE_RADIUS;
    const z = dir[2]! * SPHERE_RADIUS;
    const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    if (cw <= 1e-6) {
      out.visible = false;
      return;
    }
    const cx = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / cw;
    const cy = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / cw;
    out.x = (cx * 0.5 + 0.5) * raster.width;
    out.y = (1 - (cy * 0.5 + 0.5)) * raster.height;
    out.visible = cx >= -1.15 && cx <= 1.15 && cy >= -1.15 && cy <= 1.15;
  };

  const pa: Projected = { x: 0, y: 0, visible: false };
  const pb: Projected = { x: 0, y: 0, visible: false };

  // -- drawing your own constellations --------------------------------------

  /** User strokes: chains of catalog star indices, drawn like figures. */
  const userChains: number[][] = [];
  let activeChain: number[] | null = null;

  const pickStar = (clientX: number, clientY: number): number => {
    // Invert the projection: pointer → ray → nearest bright-ish star.
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);

    const inv = mat4.invert(mat4.create(), camera.viewProjection);
    if (!inv) return -1;
    const far = vec3.transformMat4(vec3.create(), vec3.create(ndcX, ndcY, 1), inv);
    const rayDir = vec3.normalize(far, vec3.sub(far, far, camera.position));

    let best = -1;
    let bestDot = Math.cos(3.5 * DEG * (camera.fov / (55 * DEG)));
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
      // feels closer, not just cropped.
      const zoom = (55 * DEG) / camera.fov;
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
  const strokeChain = (chain: number[], color: RGB, alpha: number, bold: boolean): void => {
    const points: number[] = [];
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

  return {
    update(dt) {
      twinkleClock += dt;
      labels.visible = settings.names;
    },

    render() {
      const scale = Math.min(1, MAX_RASTER_WIDTH / width);
      raster.resize(Math.round(width * scale), Math.round(height * scale));

      raster.clear(paperRgb);
      if (settings.graticule) drawGraticule();
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
      camera.fov = 42 * DEG;
      blitter.dispose();
    },
  };
}
