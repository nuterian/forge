/**
 * A software rasterizer: a CPU framebuffer with hand-written primitives.
 *
 * This is chapter 01's subject — lines by DDA/Wu, triangles by barycentric
 * edge functions, discs by coverage — but it lives in core/ as a reusable
 * library: later chapters borrow it wherever a CPU-drawn image is the right
 * tool (chart overlays, poster composition).
 *
 * Convention: pixel (0,0) is top-left; colors are [r,g,b] in 0–255.
 */

import { catmullRom } from './spline.ts';
import { vec3, type Vec3 } from './math.ts';

export type RGB = readonly [number, number, number];

export interface StrokeOptions {
  alpha?: number;
  /** Anti-aliased (Wu) or naive integer (Bresenham) — the chapter's toggle. */
  aa?: boolean;
}

export class Raster {
  width = 0;
  height = 0;
  /** RGBA, row-major from the top. Uploaded straight into a texture. */
  data!: Uint8ClampedArray;
  private data32!: Uint32Array;

  constructor(width: number, height: number) {
    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.data32 = new Uint32Array(this.data.buffer);
  }

  /** Fill the whole buffer with an opaque color. */
  clear(color: RGB): void {
    // Pack through the byte view once so platform endianness never matters.
    this.data[0] = color[0];
    this.data[1] = color[1];
    this.data[2] = color[2];
    this.data[3] = 255;
    this.data32.fill(this.data32[0]!);
  }

  /** Source-over blend a single pixel. The workhorse everything else calls. */
  blend(x: number, y: number, color: RGB, alpha: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || alpha <= 0) return;
    const i = (y * this.width + x) * 4;
    const a = alpha > 1 ? 1 : alpha;
    const d = this.data;
    d[i] = d[i]! + (color[0] - d[i]!) * a;
    d[i + 1] = d[i + 1]! + (color[1] - d[i + 1]!) * a;
    d[i + 2] = d[i + 2]! + (color[2] - d[i + 2]!) * a;
  }

  // -- lines ---------------------------------------------------------------

  /**
   * Naive line: step one pixel at a time along the major axis (DDA). Every
   * pixel is either fully on or off — this is where the jaggies come from.
   */
  lineNaive(x0: number, y0: number, x1: number, y1: number, color: RGB, alpha = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy)) | 0;
    if (steps === 0) {
      this.blend(Math.round(x0), Math.round(y0), color, alpha);
      return;
    }
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.blend(Math.round(x0 + dx * t), Math.round(y0 + dy * t), color, alpha);
    }
  }

  /**
   * Wu's anti-aliased line: the same march, but the fractional distance from
   * the ideal line is spent as coverage across the two nearest pixels.
   */
  lineAA(x0: number, y0: number, x1: number, y1: number, color: RGB, alpha = 1): void {
    let steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (steep) {
      [x0, y0] = [y0, x0];
      [x1, y1] = [y1, x1];
    }
    if (x0 > x1) {
      [x0, x1] = [x1, x0];
      [y0, y1] = [y1, y0];
    }

    const dx = x1 - x0;
    const gradient = dx === 0 ? 0 : (y1 - y0) / dx;

    const put = (x: number, y: number, a: number) => {
      if (steep) this.blend(y, x, color, a * alpha);
      else this.blend(x, y, color, a * alpha);
    };

    let y = y0 + gradient * (Math.round(x0) - x0);
    const xEnd = Math.round(x1);
    for (let x = Math.round(x0); x <= xEnd; x++) {
      const iy = Math.floor(y);
      const f = y - iy;
      put(x, iy, 1 - f);
      put(x, iy + 1, f);
      y += gradient;
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: RGB, opts: StrokeOptions = {}): void {
    if (opts.aa === false) this.lineNaive(x0, y0, x1, y1, color, opts.alpha ?? 1);
    else this.lineAA(x0, y0, x1, y1, color, opts.alpha ?? 1);
  }

  /** A doubled Wu line reads as a heavier printed stroke. */
  lineBold(x0: number, y0: number, x1: number, y1: number, color: RGB, opts: StrokeOptions = {}): void {
    this.line(x0, y0, x1, y1, color, opts);
    // Offset perpendicular by ~0.7px.
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * 0.7;
    const oy = (dx / len) * 0.7;
    this.line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, color, { ...opts, alpha: (opts.alpha ?? 1) * 0.6 });
  }

  // -- triangles -----------------------------------------------------------

  /**
   * Triangle fill by barycentric edge functions: a pixel is inside when all
   * three signed areas agree. With `aa`, each pixel takes four subsamples and
   * spends the hit fraction as coverage.
   */
  triangle(
    ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
    color: RGB, alpha = 1, aa = true,
  ): void {
    // Orient consistently so the edge tests don't depend on winding.
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) return;
    if (area < 0) {
      [bx, cx] = [cx, bx];
      [by, cy] = [cy, by];
    }

    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(ay, by, cy)));

    const edge = (px: number, py: number, x0: number, y0: number, x1: number, y1: number) =>
      (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);

    const taps: ReadonlyArray<readonly [number, number]> = aa
      ? [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]
      : [[0.5, 0.5]];

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let hits = 0;
        for (const [sx, sy] of taps) {
          const px = x + sx;
          const py = y + sy;
          if (
            edge(px, py, ax, ay, bx, by) >= 0 &&
            edge(px, py, bx, by, cx, cy) >= 0 &&
            edge(px, py, cx, cy, ax, ay) >= 0
          ) {
            hits++;
          }
        }
        if (hits > 0) this.blend(x, y, color, alpha * (hits / taps.length));
      }
    }
  }

  // -- discs ---------------------------------------------------------------

  /** A filled disc with coverage-based edges — the star primitive. */
  dot(cx: number, cy: number, radius: number, color: RGB, alpha = 1, aa = true): void {
    if (radius <= 0.6) {
      // Sub-pixel star: one pixel whose alpha is the disc's area.
      this.blend(Math.round(cx), Math.round(cy), color, alpha * Math.min(1, radius * radius * 4));
      return;
    }
    const minX = Math.max(0, Math.floor(cx - radius - 1));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + radius + 1));
    const minY = Math.max(0, Math.floor(cy - radius - 1));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + radius + 1));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const coverage = aa ? Math.min(1, Math.max(0, radius - d + 0.5)) : d <= radius ? 1 : 0;
        if (coverage > 0) this.blend(x, y, color, alpha * coverage);
      }
    }
  }

  /** A ring outline, for planet symbols and compass roses. */
  ring(cx: number, cy: number, radius: number, color: RGB, alpha = 1, aa = true): void {
    const steps = Math.max(24, Math.ceil(radius * 4));
    let px = cx + radius;
    let py = cy;
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const nx = cx + Math.cos(a) * radius;
      const ny = cy + Math.sin(a) * radius;
      this.line(px, py, nx, ny, color, { alpha, aa });
      px = nx;
      py = ny;
    }
  }

  // -- splines -------------------------------------------------------------

  /**
   * A Catmull-Rom stroke through 2D points — the constellation figures.
   * Points are [x0,y0, x1,y1, ...]; the curve passes through every one.
   */
  splineStroke(points: number[], color: RGB, opts: StrokeOptions & { samplesPerSegment?: number; bold?: boolean } = {}): void {
    const n = points.length / 2;
    if (n < 2) return;
    const samples = opts.samplesPerSegment ?? 10;

    const p = (i: number, out: Vec3): Vec3 => {
      const c = Math.max(0, Math.min(n - 1, i));
      return vec3.set(out, points[c * 2]!, points[c * 2 + 1]!, 0);
    };

    const p0 = vec3.create();
    const p1 = vec3.create();
    const p2 = vec3.create();
    const p3 = vec3.create();
    const out = vec3.create();

    let prevX = points[0]!;
    let prevY = points[1]!;

    for (let seg = 0; seg < n - 1; seg++) {
      p(seg - 1, p0);
      p(seg, p1);
      p(seg + 1, p2);
      p(seg + 2, p3);
      for (let s = 1; s <= samples; s++) {
        catmullRom(out, p0, p1, p2, p3, s / samples);
        if (opts.bold) this.lineBold(prevX, prevY, out[0]!, out[1]!, color, opts);
        else this.line(prevX, prevY, out[0]!, out[1]!, color, opts);
        prevX = out[0]!;
        prevY = out[1]!;
      }
    }
  }
}
