/**
 * The plate: everything the Star Chart's rasterizer draws, as one renderer
 * with no view of its own.
 *
 * The chapter drives it with the live camera, the benchmark drives it with a
 * fixed view, and the determinism suite fingerprints its bytes — so the
 * number in the budget is the code that ships, and a change to a stroke here
 * moves a committed hash before it moves a shared sky. Nothing in this file
 * touches GL or the DOM; it runs in Node.
 */

import { DEG, TAU, clamp, vec3, type Vec3 } from '../../core/math.ts';
import type { Raster, RGB } from '../../core/raster.ts';
import type { InkSet } from '../../ui/palette.ts';
import type { SkyModel } from './sky.ts';
import type { DeepSkyObject } from './deepsky.ts';

export interface Projected {
  x: number;
  y: number;
  visible: boolean;
}

/** The view's axes, as pulled out of a view matrix. */
export interface Basis {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

/** The chart circle's radius, as a fraction of the frame's short side. */
export const CHART_EXTENT = 0.46;

/**
 * An azimuthal equidistant projection — the planisphere. A direction's
 * angular distance from the view centre becomes radial distance on the
 * chart, so zooming out never clips: at full zoom-out the entire celestial
 * sphere is one circle, the antipode stretched around its rim. This is the
 * projection real star charts use, computed per point by hand. Output is in
 * normalized [0,1]²; `width` and `height` only set the aspect.
 */
export function projectPlanisphere(
  dir: Vec3, basis: Basis, fov: number, width: number, height: number, out: Projected,
): void {
  const f = Math.min(1, Math.max(-1, vec3.dot(dir, basis.forward)));
  const rx = vec3.dot(dir, basis.right);
  const ry = vec3.dot(dir, basis.up);

  const theta = Math.acos(f);
  const halfFov = fov / 2;
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
}

/** What a frame of the plate depends on besides the sky itself. */
export interface PlateView {
  /** A unit direction to raster pixels. */
  project(dir: Vec3, out: Projected): void;
  /** Radians of chart width; sets the limb radius and how zoom widens stars. */
  fov: number;
  /**
   * Raster pixels per CSS pixel. Everything lettered is sized in this, not in
   * raster pixels: the raster is capped, so on a laptop one raster pixel is
   * about one CSS pixel, and on a phone it is two — type measured in raster
   * pixels would come out half-size on the phone.
   */
  pxPerCss: number;
  /** A phone-width frame: the cartouche goes top-centre, clear of the panel. */
  narrow: boolean;
  antialias: boolean;
}

/** The plate's own title block, lettered onto it. */
export interface PlateLines {
  title: string;
  seed: string;
  epoch: string;
}

const POLE = vec3.create(0, 1, 0);

export class ChartPlate {
  readonly model: SkyModel;
  readonly deepSky: DeepSkyObject[];
  private readonly inks: InkSet;
  private readonly lines: PlateLines;
  private readonly paperRgb: RGB;
  private readonly lineRgb: RGB;

  // Scratch, allocated once: this runs per frame.
  private readonly pa: Projected = { x: 0, y: 0, visible: false };
  private readonly pb: Projected = { x: 0, y: 0, visible: false };
  private readonly point = vec3.create();
  private readonly chainScratch: number[] = [];

  // Where the furniture ended up this plate, so the star pass can print
  // *around* it. A cartouche with the sky showing through its title is a
  // cartouche nobody can read.
  private cartX0 = 0;
  private cartY0 = 0;
  private cartX1 = -1;
  private cartY1 = -1;
  private roseX = 0;
  private roseY = 0;
  private roseR = -1;

  constructor(model: SkyModel, deepSky: DeepSkyObject[], inks: InkSet, lines: PlateLines) {
    this.model = model;
    this.deepSky = deepSky;
    this.inks = inks;
    this.lines = lines;
    this.paperRgb = inks.paperRgb;
    this.lineRgb = inks.lineRgb;
  }

  private ink(i: number): RGB {
    return this.inks.rgb(i);
  }

  // -- the sky --------------------------------------------------------------

  drawGraticule(r: Raster, v: PlateView): void {
    const aa = v.antialias;
    const alpha = 0.16;
    const steps = 72;
    const { pa, pb, point, lineRgb } = this;

    // Declination circles.
    for (let ring = 1; ring < 6; ring++) {
      const phi = (ring / 6) * Math.PI;
      const y = Math.cos(phi);
      const rad = Math.sin(phi);
      let started = false;
      for (let s = 0; s <= steps; s++) {
        const theta = (s / steps) * Math.PI * 2;
        vec3.set(point, rad * Math.cos(theta), y, rad * Math.sin(theta));
        v.project(point, pb);
        if (started && pa.visible && pb.visible) {
          r.line(pa.x, pa.y, pb.x, pb.y, lineRgb, { alpha, aa });
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
        const rad = Math.sin(phi);
        vec3.set(point, rad * ct, Math.cos(phi), rad * st);
        v.project(point, pb);
        if (started && pa.visible && pb.visible) {
          r.line(pa.x, pa.y, pb.x, pb.y, lineRgb, { alpha, aa });
        }
        pa.x = pb.x; pa.y = pb.y; pa.visible = pb.visible;
        started = true;
      }
    }
  }

  /** Deep-sky objects are sky, not chrome: drawn whether or not the furniture is. */
  drawDeepSky(r: Raster, v: PlateView): void {
    const aa = v.antialias;
    const zoom = Math.sqrt(clamp((110 * DEG) / v.fov, 0.3, 2.4));
    const { pa, point } = this;
    for (const object of this.deepSky) {
      const color = this.ink(object.inkIndex);
      const points = object.points;
      for (let i = 0; i < object.radii.length; i++) {
        vec3.set(point, points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!);
        v.project(point, pa);
        if (!pa.visible) continue;
        r.dot(pa.x, pa.y, object.radii[i]! * zoom, color, object.alphas[i]!, aa);
      }
    }
  }

  drawStars(r: Raster, v: PlateView, twinkle: number): void {
    const aa = v.antialias;
    const { pa, lineRgb, model } = this;
    const { cartX0, cartY0, cartX1, cartY1, roseX, roseY, roseR } = this;
    // Radius follows magnitude; the zoom widens stars a little so the sky
    // feels closer, not just cropped — clamped so the whole-sphere view
    // still resolves individual points.
    const zoom = clamp((110 * DEG) / v.fov, 0.3, 2.4);

    for (let i = 0; i < model.stars.length; i++) {
      const star = model.stars[i]!;
      v.project(star.dir, pa);
      if (!pa.visible) continue;
      // The furniture is printed onto the plate, so the sky stops at its edge.
      if (pa.x >= cartX0 && pa.x <= cartX1 && pa.y >= cartY0 && pa.y <= cartY1) continue;
      if (roseR > 0) {
        const rx = pa.x - roseX;
        const ry = pa.y - roseY;
        if (rx * rx + ry * ry <= roseR * roseR) continue;
      }

      const color = star.tint >= 0 ? this.ink(star.tint) : lineRgb;
      const radius = (0.4 + star.mag * star.mag * 2.6) * Math.sqrt(zoom);

      // Faint stars shimmer; bright ones hold steady, like real seeing.
      let alpha = 0.5 + star.mag * 0.5;
      if (star.mag < 0.45) {
        alpha *= 0.75 + 0.25 * Math.sin(twinkle * 2.1 + i * 1.7);
      }

      r.dot(pa.x, pa.y, radius, color, alpha, aa);

      // The brightest get a four-pointed diamond, built from real triangles —
      // barycentric fills earning their keep.
      if (star.mag > 0.88) {
        const s = radius * 3.2;
        r.triangle(pa.x - s, pa.y, pa.x, pa.y - radius * 0.55, pa.x, pa.y + radius * 0.55, color, alpha * 0.6, aa);
        r.triangle(pa.x + s, pa.y, pa.x, pa.y - radius * 0.55, pa.x, pa.y + radius * 0.55, color, alpha * 0.6, aa);
        r.triangle(pa.x, pa.y - s, pa.x - radius * 0.55, pa.y, pa.x + radius * 0.55, pa.y, color, alpha * 0.6, aa);
        r.triangle(pa.x, pa.y + s, pa.x - radius * 0.55, pa.y, pa.x + radius * 0.55, pa.y, color, alpha * 0.6, aa);
      }
    }
  }

  /** Project a chain of catalog stars and stroke a Catmull-Rom figure through it. */
  strokeChain(r: Raster, v: PlateView, chain: number[], color: RGB, alpha: number, bold: boolean): void {
    const aa = v.antialias;
    const { pa, model } = this;
    const points = this.chainScratch;
    points.length = 0;
    for (const idx of chain) {
      v.project(model.stars[idx]!.dir, pa);
      // A figure that wraps behind the viewer would smear across the frame —
      // stroke only runs of visible stars.
      if (!pa.visible) {
        if (points.length >= 4) r.splineStroke(points, color, { alpha, aa, bold });
        points.length = 0;
        continue;
      }
      points.push(pa.x, pa.y);
    }
    if (points.length >= 4) r.splineStroke(points, color, { alpha, aa, bold });
  }

  drawFigures(r: Raster, v: PlateView): void {
    const aa = v.antialias;
    const { pa, pb, model } = this;
    for (const constellation of model.constellations) {
      const color = this.ink(constellation.inkIndex);
      this.strokeChain(r, v, constellation.chain, color, 0.5, false);
      for (const [from, to] of constellation.branches) {
        v.project(model.stars[from]!.dir, pa);
        v.project(model.stars[to]!.dir, pb);
        if (pa.visible && pb.visible) {
          r.line(pa.x, pa.y, pb.x, pb.y, color, { alpha: 0.5, aa });
        }
      }
    }
  }

  // -- the instrument plate ---------------------------------------------------
  // Every piece of furniture below is drawn by the chapter's own rasterizer:
  // the lettering comes out of raster.text()'s stroke font, the compass points
  // are barycentric triangle fills, the rules and ticks are Wu lines. Drawing
  // your own chrome with the thing the chapter is about is the point.

  /** Limb ticks, compass rose, cartouche — and remember where they landed. */
  drawFurniture(r: Raster, v: PlateView): void {
    this.drawLimbTicks(r, v);
    this.drawCompassRose(r, v);
    this.drawCartouche(r, v);
  }

  /** No furniture this plate: the stars may print everywhere. */
  clearFurniture(): void {
    this.cartX1 = -1;
    this.roseR = -1;
  }

  /** A filled rectangle, out of the two triangles it is made of. */
  private fillRect(r: Raster, x0: number, y0: number, x1: number, y1: number, color: RGB, alpha: number): void {
    r.triangle(x0, y0, x1, y0, x1, y1, color, alpha, false);
    r.triangle(x0, y0, x1, y1, x0, y1, color, alpha, false);
  }

  private strokeRect(r: Raster, aa: boolean, x0: number, y0: number, x1: number, y1: number, color: RGB, alpha: number): void {
    r.line(x0, y0, x1, y0, color, { alpha, aa });
    r.line(x1, y0, x1, y1, color, { alpha, aa });
    r.line(x1, y1, x0, y1, color, { alpha, aa });
    r.line(x0, y1, x0, y0, color, { alpha, aa });
  }

  private drawCartouche(r: Raster, v: PlateView): void {
    const s = v.pxPerCss;
    const aa = v.antialias;
    const { paperRgb, lineRgb, lines } = this;
    const pad = 10 * s;
    const titleSize = 9.5 * s;
    const lineSize = 6.4 * s;
    const gap = 7 * s;

    const width = Math.max(
      r.measureText(lines.title, titleSize),
      r.measureText(lines.seed, lineSize),
      r.measureText(lines.epoch, lineSize),
    ) + pad * 2;
    const height = pad * 2 + titleSize + gap + lineSize + gap * 0.7 + lineSize;

    // Both rails of the HUD sit in the bottom corners on a wide screen, and
    // the panel takes the bottom-left on a narrow one. The clear band is the
    // bottom centre on a desktop and the top centre on a phone, so the title
    // block goes wherever the chrome is not.
    const x0 = Math.round((r.width - width) / 2);
    const y0 = Math.round(v.narrow ? 96 * s : r.height - height - 30 * s);
    const x1 = x0 + width;
    const y1 = y0 + height;
    this.cartX0 = x0; this.cartY0 = y0; this.cartX1 = x1; this.cartY1 = y1;

    // Printed *onto* the chart: the paper fill is what makes it a block of
    // type rather than a box of graticule.
    this.fillRect(r, x0, y0, x1, y1, paperRgb, 0.93);
    this.strokeRect(r, aa, x0, y0, x1, y1, lineRgb, 0.5);
    const inset = 3 * s;
    this.strokeRect(r, aa, x0 + inset, y0 + inset, x1 - inset, y1 - inset, lineRgb, 0.22);

    // Corner cuts, the way an engraved title block is finished.
    const cut = 7 * s;
    r.line(x0, y0 + cut, x0 + cut, y0, lineRgb, { alpha: 0.5, aa });
    r.line(x1 - cut, y0, x1, y0 + cut, lineRgb, { alpha: 0.5, aa });
    r.line(x0, y1 - cut, x0 + cut, y1, lineRgb, { alpha: 0.5, aa });
    r.line(x1 - cut, y1, x1, y1 - cut, lineRgb, { alpha: 0.5, aa });

    const cx = (x0 + x1) / 2;
    let y = y0 + pad;
    r.textCentered(cx, y, lines.title, titleSize, lineRgb, { alpha: 0.92, aa });
    y += titleSize + gap;
    r.textCentered(cx, y, lines.seed, lineSize, this.ink(1), { alpha: 0.85, aa });
    y += lineSize + gap * 0.7;
    r.textCentered(cx, y, lines.epoch, lineSize, lineRgb, { alpha: 0.45, aa });
  }

  /**
   * An eight-point rose. Its north is the *real* north: the celestial pole
   * projected onto the chart, measured from the rose's own position — so on a
   * planisphere, where north is a different direction in every part of the
   * frame, the rose still tells the truth.
   */
  private drawCompassRose(r: Raster, v: PlateView): void {
    const s = v.pxPerCss;
    const aa = v.antialias;
    const { pb, paperRgb, lineRgb } = this;
    const R = Math.min(50 * s, Math.min(r.width, r.height) * 0.11);
    const cx = r.width - R - 26 * s;
    const cy = 200 * s + R;
    this.roseX = cx; this.roseY = cy; this.roseR = R * 1.06;

    let north = -Math.PI / 2;
    v.project(POLE, pb);
    const dx = pb.x - cx;
    const dy = pb.y - cy;
    if (pb.visible && Math.hypot(dx, dy) > R * 0.5) north = Math.atan2(dy, dx);

    r.dot(cx, cy, R * 1.06, paperRgb, 0.9, aa);

    // Fine ticks all the way round, longer every eighth.
    for (let i = 0; i < 48; i++) {
      const a = north + (i / 48) * TAU;
      const inner = R * (i % 6 === 0 ? 0.82 : 0.9);
      r.line(
        cx + Math.cos(a) * inner, cy + Math.sin(a) * inner,
        cx + Math.cos(a) * R, cy + Math.sin(a) * R,
        lineRgb, { alpha: i % 6 === 0 ? 0.55 : 0.3, aa },
      );
    }
    r.ring(cx, cy, R * 0.78, lineRgb, 0.35, aa);
    r.ring(cx, cy, R * 0.2, lineRgb, 0.45, aa);

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
      const color = long ? this.ink(1) : lineRgb;
      r.triangle(cx, cy, tipX, tipY, cx + px, cy + py, color, 0.75, aa);
      r.triangle(cx, cy, tipX, tipY, cx - px, cy - py, color, 0.34, aa);
    }

    // Only N is lettered: four letters at this size is a smudge.
    const letter = 7 * s;
    r.textCentered(
      cx + Math.cos(north) * R * 1.3, cy + Math.sin(north) * R * 1.3 - letter / 2,
      'N', letter, this.ink(1), { alpha: 0.9, aa },
    );
  }

  /**
   * Degree ticks around the planisphere's rim — but only once the whole sphere
   * is on the page. Zoomed in, the "rim" is a circle far outside the frame and
   * the ticks are meaningless.
   */
  private drawLimbTicks(r: Raster, v: PlateView): void {
    const shortSide = Math.min(r.width, r.height);
    const R = (Math.PI / (v.fov / 2)) * CHART_EXTENT * shortSide;
    if (R > shortSide * 0.47) return;

    const s = v.pxPerCss;
    const aa = v.antialias;
    const { lineRgb } = this;
    const cx = r.width / 2;
    const cy = r.height / 2;

    r.ring(cx, cy, R, lineRgb, 0.3, aa);

    for (let deg = 0; deg < 360; deg += 5) {
      const a = (deg * Math.PI) / 180;
      const long = deg % 45 === 0;
      const mid = deg % 15 === 0;
      const len = R * (long ? 0.055 : mid ? 0.032 : 0.018);
      r.line(
        cx + Math.cos(a) * R, cy + Math.sin(a) * R,
        cx + Math.cos(a) * (R - len), cy + Math.sin(a) * (R - len),
        lineRgb, { alpha: long ? 0.5 : mid ? 0.34 : 0.2, aa },
      );
      if (long) {
        const size = 6 * s;
        const rr = R - len - size * 1.5;
        r.textCentered(
          cx + Math.cos(a) * rr, cy + Math.sin(a) * rr - size / 2,
          `${String(deg).padStart(3, '0')}°`, size, lineRgb, { alpha: 0.4, aa },
        );
      }
    }
  }
}
