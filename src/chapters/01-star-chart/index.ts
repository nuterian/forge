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
import { DEG, TAU, vec3, type Vec3 } from '../../core/math.ts';
import { Raster } from '../../core/raster.ts';
import { Rng } from '../../core/rng.ts';
import { RasterBlitter } from '../../gl/blit.ts';
import type { LabelSpec } from '../../ui/labels.ts';
import { generateSky, type SkyModel } from './sky.ts';
import { generateDeepSky } from './deepsky.ts';
import {
  CHART_EXTENT, ChartPlate, projectPlanisphere,
  type Basis, type PlateView, type Projected,
} from './plate.ts';

/** The celestial sphere's world radius — labels live at this distance. */
const SPHERE_RADIUS = 60;
/** CPU buffer cap: full canvas resolution is wasted on a stippled chart. */
const MAX_RASTER_WIDTH = 1500;

interface Settings {
  antialias: boolean;
  figures: boolean;
  graticule: boolean;
  furniture: boolean;
  names: boolean;
  draw: boolean;
}

/**
 * Titles in the register the old atlases used. Curated rather than assembled
 * from syllables: half a dozen real ones read better than a thousand invented
 * ones, and the plate only ever shows you a single title.
 */
const ATLAS_TITLES = [
  'URANOGRAPHIA',
  'SPECULUM COELI',
  'FIRMAMENTUM',
  'PLANISPHAERIUM',
  'ATLAS COELESTIS',
  'COELUM STELLATUM',
  'TABULA ASTRORUM',
];

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
    furniture: true,
    names: true,
    draw: false,
  };

  const model: SkyModel = generateSky(ctx.seed);
  const deepSky = generateDeepSky(ctx.seed);

  // The plate's own title block. Its own stream again, so choosing a title
  // cannot disturb a single star.
  const titleRng = new Rng(`title:${ctx.seed}`);
  const plate = new ChartPlate(model, deepSky, inks, {
    title: titleRng.pick(ATLAS_TITLES),
    seed: `SEED ${ctx.seed}`,
    epoch: `EPOCH ${new Date().getFullYear()}.0 \u00b7 THE FORGE PRESS`,
  });

  const raster = new Raster(4, 4);
  const blitter = new RasterBlitter(gl);

  // The raster works in 0-255 RGB triples; InkSet caches those conversions
  // once so every CPU-drawing chapter (this one, ch.6's poster mode) shares
  // the same palette resolution instead of re-deriving it.
  const paperRgb = inks.paperRgb;
  const lineRgb = inks.lineRgb;

  // -- CPU projection -------------------------------------------------------
  // The planisphere lives in plate.ts; this is the live view it is fed.

  // View basis, pulled from the camera's view matrix each frame.
  const basis: Basis = { right: vec3.create(), up: vec3.create(), forward: vec3.create() };

  const updateBasis = (): void => {
    const v = camera.view;
    vec3.set(basis.right, v[0]!, v[4]!, v[8]!);
    vec3.set(basis.up, v[1]!, v[5]!, v[9]!);
    vec3.set(basis.forward, -v[2]!, -v[6]!, -v[10]!);
  };

  /** Project a unit direction into normalized [0,1]² screen coords. */
  const projectNorm = (dir: Vec3, out: Projected): void => {
    projectPlanisphere(dir, basis, camera.fov, width, height, out);
  };

  const projectDir = (dir: Vec3, out: Projected): void => {
    projectNorm(dir, out);
    out.x *= raster.width;
    out.y *= raster.height;
  };

  // What the plate is drawn with this frame; the fields are refreshed in render().
  const view: PlateView = { project: projectDir, fov: camera.fov, pxPerCss: 1, narrow: false, antialias: true };

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
    vec3.scaleAndAdd(rayDir, rayDir, basis.forward, Math.cos(theta));
    vec3.scaleAndAdd(rayDir, rayDir, basis.right, ux * sinT);
    vec3.scaleAndAdd(rayDir, rayDir, basis.up, uy * sinT);

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
    { kind: 'toggle', label: 'Instrument plate', value: settings.furniture, onChange: (v) => (settings.furniture = v) },
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
    for (const object of deepSky) {
      specs.push({
        id: `d-${object.name}`,
        text: object.name,
        color: inks.hex(object.inkIndex),
        position: vec3.scale(vec3.create(), object.dir, SPHERE_RADIUS),
        priority: 3,
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

  // -- a shooting star ------------------------------------------------------
  /**
   * Roughly every twenty to forty seconds, one meteor. It is drawn per frame
   * OVER the plate and never into it: the plate is everything that only
   * changes with the view, and a streak that got baked into the snapshot would
   * hang in the sky until the next time the camera moved.
   *
   * Its own Rng stream, and its own clock, accumulated so the chart's other
   * settings can never change how often it happens.
   *
   * It is aimed inside the current view on purpose. A meteor placed uniformly
   * on the sphere would be behind you two times in three, which does not make
   * it rarer so much as it makes it not happen.
   */
  const meteorRng = new Rng(`meteor:${ctx.seed}`);
  const METEOR_LIFE = 0.6;
  let meteorClock = 0;
  let meteorNext = meteorRng.range(6, 18); // the first one comes sooner
  let meteorAge = -1;
  const meteorStart = vec3.create();
  const meteorEnd = vec3.create();
  const meteorHead = vec3.create();
  const meteorTail = vec3.create();

  const spawnMeteor = (): void => {
    // The basis is normally refreshed in render(), and this runs in update() —
    // which on the very first frame means aiming at a basis that is still all
    // zeros, and normalising that produces a direction that projects nowhere.
    updateBasis();
    // A direction inside the frame, then a short arc to travel along it.
    const spread = Math.min(camera.fov * 0.34, 0.9);
    const a = meteorRng.range(0, TAU);
    const r = Math.sqrt(meteorRng.next()) * spread;
    vec3.copy(meteorStart, basis.forward);
    vec3.scaleAndAdd(meteorStart, meteorStart, basis.right, Math.cos(a) * r);
    vec3.scaleAndAdd(meteorStart, meteorStart, basis.up, Math.sin(a) * r);
    vec3.normalize(meteorStart, meteorStart);

    const travel = meteorRng.range(0.09, 0.22) * Math.max(1, camera.fov / (110 * DEG));
    const dir = meteorRng.range(0, TAU);
    vec3.copy(meteorEnd, meteorStart);
    vec3.scaleAndAdd(meteorEnd, meteorEnd, basis.right, Math.cos(dir) * travel);
    vec3.scaleAndAdd(meteorEnd, meteorEnd, basis.up, Math.sin(dir) * travel);
    vec3.normalize(meteorEnd, meteorEnd);

    meteorAge = 0;
  };

  /** Lerp along the meteor's arc and re-normalise back onto the sphere. */
  const meteorAt = (out: Vec3, t: number): void => {
    const u = t < 0 ? 0 : t > 1 ? 1 : t;
    vec3.set(
      out,
      meteorStart[0]! + (meteorEnd[0]! - meteorStart[0]!) * u,
      meteorStart[1]! + (meteorEnd[1]! - meteorStart[1]!) * u,
      meteorStart[2]! + (meteorEnd[2]! - meteorStart[2]!) * u,
    );
    vec3.normalize(out, out);
  };

  const drawMeteor = (): void => {
    if (meteorAge < 0) return;
    const t = meteorAge / METEOR_LIFE;
    // Brightens as it enters and fades as it burns out, rather than starting
    // at full and dimming — which is what a meteor actually looks like.
    const glow = Math.pow(Math.sin(Math.PI * t), 0.7);
    if (glow <= 0.01) return;

    meteorAt(meteorHead, t);
    meteorAt(meteorTail, t - 0.45);
    projectDir(meteorHead, pa);
    projectDir(meteorTail, pb);
    if (!pa.visible || !pb.visible) return;

    // The trail, then a brighter length behind the head, then the head: three
    // Wu lines standing in for a streak that thins along its length.
    raster.line(pb.x, pb.y, pa.x, pa.y, lineRgb, { alpha: 0.34 * glow, aa: true });
    raster.line(
      pb.x + (pa.x - pb.x) * 0.55, pb.y + (pa.y - pb.y) * 0.55,
      pa.x, pa.y, lineRgb, { alpha: 0.75 * glow, aa: true },
    );
    raster.dot(pa.x, pa.y, 1.9, lineRgb, 0.95 * glow, true);
  };

  let twinkleClock = 0;

  const drawUserChains = (): void => {
    for (const chain of userChains) {
      if (chain.length === 1) {
        // A started chain marks its first star with a ring.
        projectDir(model.stars[chain[0]!]!.dir, pa);
        if (pa.visible) raster.ring(pa.x, pa.y, 6, lineRgb, 0.8, settings.antialias);
        continue;
      }
      plate.strokeChain(raster, view, chain, lineRgb, 0.85, true);
    }
  };

  // -- lifecycle ------------------------------------------------------------

  let width = ctx.size.width;
  let height = ctx.size.height;
  // The canvas's CSS width, for sizing type. Read on resize only — a layout
  // measurement has no place in a render loop.
  let cssWidth = canvas.clientWidth || width;

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
  let plateFurniture = false;
  let plateAa = false;
  let baked: Uint32Array | null = null;

  return {
    update(dt) {
      twinkleClock += dt;

      if (meteorAge >= 0) {
        meteorAge += dt;
        if (meteorAge > METEOR_LIFE) meteorAge = -1;
      } else {
        meteorClock += dt;
        if (meteorClock >= meteorNext) {
          meteorClock = 0;
          meteorNext = meteorRng.range(20, 40);
          spawnMeteor();
        }
      }

      labels.visible = settings.names;
    },

    render() {
      const scale = Math.min(1, MAX_RASTER_WIDTH / width);
      raster.resize(Math.round(width * scale), Math.round(height * scale));

      updateBasis();

      const v = camera.view;
      let dirty =
        baked === null ||
        plateFov !== camera.fov ||
        plateW !== raster.width ||
        plateH !== raster.height ||
        plateGraticule !== settings.graticule ||
        plateFurniture !== settings.furniture ||
        plateAa !== settings.antialias;
      if (!dirty) {
        for (let i = 0; i < 16; i++) {
          if (plateView[i] !== v[i]!) {
            dirty = true;
            break;
          }
        }
      }

      view.fov = camera.fov;
      view.antialias = settings.antialias;
      view.pxPerCss = raster.width / Math.max(1, cssWidth);
      view.narrow = cssWidth < 900;

      if (dirty) {
        raster.clear(paperRgb);
        if (settings.graticule) plate.drawGraticule(raster, view);
        plate.drawDeepSky(raster, view);
        if (settings.furniture) plate.drawFurniture(raster, view);
        else plate.clearFurniture();
        baked = raster.snapshot(baked ?? undefined);
        plateView.set(v);
        plateFov = camera.fov;
        plateW = raster.width;
        plateH = raster.height;
        plateGraticule = settings.graticule;
        plateFurniture = settings.furniture;
        plateAa = settings.antialias;
      } else {
        raster.restore(baked!);
      }

      plate.drawStars(raster, view, twinkleClock);
      if (settings.figures) plate.drawFigures(raster, view);
      drawUserChains();
      drawMeteor();

      blitter.upload(raster);
      blitter.draw();
    },

    resize(w, h) {
      width = w;
      height = h;
      cssWidth = canvas.clientWidth || w;
    },

    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.style.cursor = 'grab';
      blitter.dispose();
    },
  };
}
