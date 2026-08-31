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
import { DEG, TAU, clamp, vec3, type Vec3 } from '../../core/math.ts';
import { Raster, type RGB } from '../../core/raster.ts';
import { Rng } from '../../core/rng.ts';
import { RasterBlitter } from '../../gl/blit.ts';
import { Drone, type Room } from '../../audio/drone.ts';
import type { LabelSpec } from '../../ui/labels.ts';
import { generateSky, type SkyModel } from './sky.ts';
import { generateDeepSky } from './deepsky.ts';

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

/**
 * The dome at night: almost no body, and a wide thread of cold air over it.
 * The two tones sit at the written octave and the lowpass is left open, so
 * what you mostly hear is the room rather than the note — which is the right
 * shape for a chapter where the subject is the emptiness between the stars.
 */
const ROOM: Room = {
  octave: 1,
  cutoff: 6,
  resonance: 0.7,
  upper: 0.22,
  airHz: 2600,
  airQ: 0.8,
  air: 0.28,
  // A fifth two octaves up: a cold pinprick over the dome, which is what
  // this chapter is a picture of.
  partial: 5,
  partialLevel: 0.05,
  wobbleHz: 0.07,
  cents: 4,
  depth: 0.36,
  level: 0.42,
};

export function create(ctx: ChapterContext): ChapterInstance {
  const { gl, camera, inks, labels, controls, canvas, print, audio } = ctx;

  // The room this chart is heard in. Its pitch comes from the seed's own audio
  // stream, so the same sky always hums at the same note and a reroll moves it.
  const drone = new Drone(audio, ctx.seed, ROOM);
  audio.addVoice(drone);

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
  const chartTitle = titleRng.pick(ATLAS_TITLES);
  const seedLine = `SEED ${ctx.seed}`;
  const epochLine = `EPOCH ${new Date().getFullYear()}.0 \u00b7 THE FORGE PRESS`;

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

  // -- the instrument plate -------------------------------------------------
  // Every piece of furniture below is drawn by the chapter's own rasterizer:
  // the lettering comes out of raster.text()'s stroke font, the compass points
  // are barycentric triangle fills, the rules and ticks are Wu lines. Drawing
  // your own chrome with the thing the chapter is about is the point.

  /**
   * Raster pixels per CSS pixel. Everything lettered has to be sized in this,
   * not in raster pixels: the raster is capped at 1500 across, so on a laptop
   * one raster pixel is about one CSS pixel, and on a phone it is two — type
   * measured in raster pixels would come out half-size on the phone.
   */
  let pxPerCss = 1;

  const dsDir = vec3.create();

  const drawDeepSky = (): void => {
    const aa = settings.antialias;
    const zoom = Math.sqrt(clamp((110 * DEG) / camera.fov, 0.3, 2.4));
    for (const object of deepSky) {
      const color = ink(object.inkIndex);
      const points = object.points;
      for (let i = 0; i < object.radii.length; i++) {
        vec3.set(dsDir, points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!);
        projectDir(dsDir, pa);
        if (!pa.visible) continue;
        raster.dot(pa.x, pa.y, object.radii[i]! * zoom, color, object.alphas[i]!, aa);
      }
    }
  };

  /** A filled rectangle, out of the two triangles it is made of. */
  const fillRect = (x0: number, y0: number, x1: number, y1: number, color: RGB, alpha: number): void => {
    raster.triangle(x0, y0, x1, y0, x1, y1, color, alpha, false);
    raster.triangle(x0, y0, x1, y1, x0, y1, color, alpha, false);
  };

  const strokeRect = (x0: number, y0: number, x1: number, y1: number, color: RGB, alpha: number): void => {
    const aa = settings.antialias;
    raster.line(x0, y0, x1, y0, color, { alpha, aa });
    raster.line(x1, y0, x1, y1, color, { alpha, aa });
    raster.line(x1, y1, x0, y1, color, { alpha, aa });
    raster.line(x0, y1, x0, y0, color, { alpha, aa });
  };

  // Where the furniture ended up this plate, so the star pass can print
  // *around* it. A cartouche with the sky showing through its title is a
  // cartouche nobody can read.
  let cartX0 = 0, cartY0 = 0, cartX1 = -1, cartY1 = -1;
  let roseX = 0, roseY = 0, roseR = -1;

  const drawCartouche = (): void => {
    const s = pxPerCss;
    const pad = 10 * s;
    const titleSize = 9.5 * s;
    const lineSize = 6.4 * s;
    const gap = 7 * s;

    const width = Math.max(
      raster.measureText(chartTitle, titleSize),
      raster.measureText(seedLine, lineSize),
      raster.measureText(epochLine, lineSize),
    ) + pad * 2;
    const height = pad * 2 + titleSize + gap + lineSize + gap * 0.7 + lineSize;

    // Both rails of the HUD sit in the bottom corners on a wide screen, and
    // the panel takes the bottom-left on a narrow one. The clear band is the
    // bottom centre on a desktop and the top centre on a phone, so the title
    // block goes wherever the chrome is not.
    const x0 = Math.round((raster.width - width) / 2);
    const y0 = Math.round(
      cssWidth < 900 ? 96 * s : raster.height - height - 30 * s,
    );
    const x1 = x0 + width;
    const y1 = y0 + height;
    cartX0 = x0; cartY0 = y0; cartX1 = x1; cartY1 = y1;

    // Printed *onto* the chart: the paper fill is what makes it a block of
    // type rather than a box of graticule.
    fillRect(x0, y0, x1, y1, paperRgb, 0.93);
    strokeRect(x0, y0, x1, y1, lineRgb, 0.5);
    const inset = 3 * s;
    strokeRect(x0 + inset, y0 + inset, x1 - inset, y1 - inset, lineRgb, 0.22);

    // Corner cuts, the way an engraved title block is finished.
    const cut = 7 * s;
    const aa = settings.antialias;
    raster.line(x0, y0 + cut, x0 + cut, y0, lineRgb, { alpha: 0.5, aa });
    raster.line(x1 - cut, y0, x1, y0 + cut, lineRgb, { alpha: 0.5, aa });
    raster.line(x0, y1 - cut, x0 + cut, y1, lineRgb, { alpha: 0.5, aa });
    raster.line(x1 - cut, y1, x1, y1 - cut, lineRgb, { alpha: 0.5, aa });

    const cx = (x0 + x1) / 2;
    let y = y0 + pad;
    raster.textCentered(cx, y, chartTitle, titleSize, lineRgb, { alpha: 0.92, aa });
    y += titleSize + gap;
    raster.textCentered(cx, y, seedLine, lineSize, ink(1), { alpha: 0.85, aa });
    y += lineSize + gap * 0.7;
    raster.textCentered(cx, y, epochLine, lineSize, lineRgb, { alpha: 0.45, aa });
  };

  /**
   * An eight-point rose. Its north is the *real* north: the celestial pole
   * projected onto the chart, measured from the rose's own position — so on a
   * planisphere, where north is a different direction in every part of the
   * frame, the rose still tells the truth.
   */
  const poleDir = vec3.create(0, 1, 0);
  const drawCompassRose = (): void => {
    const s = pxPerCss;
    const aa = settings.antialias;
    const R = Math.min(50 * s, Math.min(raster.width, raster.height) * 0.11);
    const cx = raster.width - R - 26 * s;
    const cy = 200 * s + R;
    roseX = cx; roseY = cy; roseR = R * 1.06;

    let north = -Math.PI / 2;
    projectDir(poleDir, pb);
    const dx = pb.x - cx;
    const dy = pb.y - cy;
    if (pb.visible && Math.hypot(dx, dy) > R * 0.5) north = Math.atan2(dy, dx);

    raster.dot(cx, cy, R * 1.06, paperRgb, 0.9, aa);

    // Fine ticks all the way round, longer every eighth.
    for (let i = 0; i < 48; i++) {
      const a = north + (i / 48) * TAU;
      const inner = R * (i % 6 === 0 ? 0.82 : 0.9);
      raster.line(
        cx + Math.cos(a) * inner, cy + Math.sin(a) * inner,
        cx + Math.cos(a) * R, cy + Math.sin(a) * R,
        lineRgb, { alpha: i % 6 === 0 ? 0.55 : 0.3, aa },
      );
    }
    raster.ring(cx, cy, R * 0.78, lineRgb, 0.35, aa);
    raster.ring(cx, cy, R * 0.2, lineRgb, 0.45, aa);

    // Eight points, each a pair of barycentric triangles — one half in the
    // light ink and one in shadow, which is what makes a rose read as raised.
    for (let k = 0; k < 8; k++) {
      const a = north + (k / 8) * TAU;
      const long = k % 2 === 0;
      const reach = R * (long ? 0.76 : 0.46);
      const halfWidth = R * (long ? 0.11 : 0.08);
      const tipX = cx + Math.cos(a) * reach;
      const tipY = cy + Math.sin(a) * reach;
      const px = -Math.sin(a) * halfWidth;
      const py = Math.cos(a) * halfWidth;
      const color = long ? ink(1) : lineRgb;
      raster.triangle(cx, cy, tipX, tipY, cx + px, cy + py, color, 0.75, aa);
      raster.triangle(cx, cy, tipX, tipY, cx - px, cy - py, color, 0.34, aa);
    }

    // Only N is lettered: four letters at this size is a smudge.
    const letter = 7 * s;
    raster.textCentered(
      cx + Math.cos(north) * R * 1.3, cy + Math.sin(north) * R * 1.3 - letter / 2,
      'N', letter, ink(1), { alpha: 0.9, aa },
    );
  };

  /**
   * Degree ticks around the planisphere's rim — but only once the whole sphere
   * is on the page. Zoomed in, the "rim" is a circle far outside the frame and
   * the ticks are meaningless.
   */
  const drawLimbTicks = (): void => {
    const shortSide = Math.min(raster.width, raster.height);
    const R = (Math.PI / (camera.fov / 2)) * CHART_EXTENT * shortSide;
    if (R > shortSide * 0.47) return;

    const s = pxPerCss;
    const aa = settings.antialias;
    const cx = raster.width / 2;
    const cy = raster.height / 2;

    raster.ring(cx, cy, R, lineRgb, 0.3, aa);

    for (let deg = 0; deg < 360; deg += 5) {
      const a = (deg * Math.PI) / 180;
      const long = deg % 45 === 0;
      const mid = deg % 15 === 0;
      const len = R * (long ? 0.055 : mid ? 0.032 : 0.018);
      raster.line(
        cx + Math.cos(a) * R, cy + Math.sin(a) * R,
        cx + Math.cos(a) * (R - len), cy + Math.sin(a) * (R - len),
        lineRgb, { alpha: long ? 0.5 : mid ? 0.34 : 0.2, aa },
      );
      if (long) {
        const size = 6 * s;
        const rr = R - len - size * 1.5;
        raster.textCentered(
          cx + Math.cos(a) * rr, cy + Math.sin(a) * rr - size / 2,
          `${String(deg).padStart(3, '0')}\u00b0`, size, lineRgb, { alpha: 0.4, aa },
        );
      }
    }
  };

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
    vec3.copy(meteorStart, basisForward);
    vec3.scaleAndAdd(meteorStart, meteorStart, basisRight, Math.cos(a) * r);
    vec3.scaleAndAdd(meteorStart, meteorStart, basisUp, Math.sin(a) * r);
    vec3.normalize(meteorStart, meteorStart);

    const travel = meteorRng.range(0.09, 0.22) * Math.max(1, camera.fov / (110 * DEG));
    const dir = meteorRng.range(0, TAU);
    vec3.copy(meteorEnd, meteorStart);
    vec3.scaleAndAdd(meteorEnd, meteorEnd, basisRight, Math.cos(dir) * travel);
    vec3.scaleAndAdd(meteorEnd, meteorEnd, basisUp, Math.sin(dir) * travel);
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

  const drawStars = (): void => {
    const aa = settings.antialias;
    for (let i = 0; i < model.stars.length; i++) {
      const star = model.stars[i]!;
      projectDir(star.dir, pa);
      if (!pa.visible) continue;
      // The furniture is printed onto the plate, so the sky stops at its edge.
      if (pa.x >= cartX0 && pa.x <= cartX1 && pa.y >= cartY0 && pa.y <= cartY1) continue;
      if (roseR > 0) {
        const rx = pa.x - roseX;
        const ry = pa.y - roseY;
        if (rx * rx + ry * ry <= roseR * roseR) continue;
      }

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
  let plate: Uint32Array | null = null;

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
        plate === null ||
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

      if (dirty) {
        pxPerCss = raster.width / Math.max(1, cssWidth);
        raster.clear(paperRgb);
        if (settings.graticule) drawGraticule();
        // Deep-sky objects are sky, not chrome: they are there whether or not
        // the instrument furniture is.
        drawDeepSky();
        if (settings.furniture) {
          drawLimbTicks();
          drawCompassRose();
          drawCartouche();
        } else {
          cartX1 = -1;
          roseR = -1;
        }
        plate = raster.snapshot(plate ?? undefined);
        plateView.set(v);
        plateFov = camera.fov;
        plateW = raster.width;
        plateH = raster.height;
        plateGraticule = settings.graticule;
        plateFurniture = settings.furniture;
        plateAa = settings.antialias;
      } else {
        raster.restore(plate!);
      }

      drawStars();
      if (settings.figures) drawFigures();
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
      camera.inputEnabled = true;
      camera.lookOut = false;
      camera.minFov = 18 * DEG;
      camera.maxFov = 70 * DEG;
      camera.fov = 42 * DEG;
      labels.projector = null;
      audio.stopVoice(drone);
      blitter.dispose();
    },
  };
}
