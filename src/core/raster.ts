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

  /**
   * Copy the whole image out / back in — one memcpy each way. This is what
   * lets a chapter bake everything that only changes with the *view* (a
   * graticule, say) and pay per frame only for what actually animates.
   * The returned buffer is only valid until the next resize.
   */
  snapshot(into?: Uint32Array): Uint32Array {
    const buf = into && into.length === this.data32.length ? into : new Uint32Array(this.data32.length);
    buf.set(this.data32);
    return buf;
  }

  restore(snap: Uint32Array): void {
    if (snap.length === this.data32.length) this.data32.set(snap);
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
   *
   * Written as two straight loops rather than one with a `put` closure: the
   * closure and the destructuring swaps allocated on every call, and a chart
   * frame makes thousands of calls — the allocations cost more than the
   * pixels did.
   */
  lineAA(x0: number, y0: number, x1: number, y1: number, color: RGB, alpha = 1): void {
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    let ax: number, ay: number, bx: number, by: number;
    if (steep) {
      ax = y0; ay = x0; bx = y1; by = x1;
    } else {
      ax = x0; ay = y0; bx = x1; by = y1;
    }
    if (ax > bx) {
      const tx = ax, ty = ay;
      ax = bx; ay = by; bx = tx; by = ty;
    }

    const dx = bx - ax;
    const gradient = dx === 0 ? 0 : (by - ay) / dx;

    let y = ay + gradient * (Math.round(ax) - ax);
    const xEnd = Math.round(bx);
    if (steep) {
      for (let x = Math.round(ax); x <= xEnd; x++) {
        const iy = Math.floor(y);
        const f = y - iy;
        this.blend(iy, x, color, (1 - f) * alpha);
        this.blend(iy + 1, x, color, f * alpha);
        y += gradient;
      }
    } else {
      for (let x = Math.round(ax); x <= xEnd; x++) {
        const iy = Math.floor(y);
        const f = y - iy;
        this.blend(x, iy, color, (1 - f) * alpha);
        this.blend(x, iy + 1, color, f * alpha);
        y += gradient;
      }
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

    // Each edge as precomputed coefficients: e(p) = A·px + B·py + C. Same
    // signed-area test as before, but the inner loop is pure arithmetic —
    // the tap table and the edge closure used to allocate per *call* and
    // iterate per *pixel*, which dominated the fill for small triangles.
    const a0 = ay - by, b0 = bx - ax, c0 = -(a0 * ax + b0 * ay);
    const a1 = by - cy, b1 = cx - bx, c1 = -(a1 * bx + b1 * by);
    const a2 = cy - ay, b2 = ax - cx, c2 = -(a2 * cx + b2 * cy);

    if (aa) {
      for (let y = minY; y <= maxY; y++) {
        const y1 = y + 0.25, y2 = y + 0.75;
        for (let x = minX; x <= maxX; x++) {
          const x1 = x + 0.25, x2 = x + 0.75;
          let hits = 0;
          if (a0 * x1 + b0 * y1 + c0 >= 0 && a1 * x1 + b1 * y1 + c1 >= 0 && a2 * x1 + b2 * y1 + c2 >= 0) hits++;
          if (a0 * x2 + b0 * y1 + c0 >= 0 && a1 * x2 + b1 * y1 + c1 >= 0 && a2 * x2 + b2 * y1 + c2 >= 0) hits++;
          if (a0 * x1 + b0 * y2 + c0 >= 0 && a1 * x1 + b1 * y2 + c1 >= 0 && a2 * x1 + b2 * y2 + c2 >= 0) hits++;
          if (a0 * x2 + b0 * y2 + c0 >= 0 && a1 * x2 + b1 * y2 + c1 >= 0 && a2 * x2 + b2 * y2 + c2 >= 0) hits++;
          if (hits > 0) this.blend(x, y, color, alpha * (hits * 0.25));
        }
      }
    } else {
      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5;
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          if (a0 * px + b0 * py + c0 >= 0 && a1 * px + b1 * py + c1 >= 0 && a2 * px + b2 * py + c2 >= 0) {
            this.blend(x, y, color, alpha);
          }
        }
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

    // Distances stay squared until a pixel lands in the half-pixel AA band at
    // the rim — everywhere else the classification needs no square root, and
    // the interior of every disc is "everywhere else".
    const rIn = radius - 0.5;
    const rIn2 = rIn > 0 ? rIn * rIn : -1;
    const rOut = radius + 0.5;
    const rOut2 = rOut * rOut;
    const r2 = radius * radius;

    for (let y = minY; y <= maxY; y++) {
      const dy = y + 0.5 - cy;
      const dy2 = dy * dy;
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const d2 = dx * dx + dy2;
        if (aa) {
          if (d2 >= rOut2) continue;
          if (d2 <= rIn2) this.blend(x, y, color, alpha);
          else this.blend(x, y, color, alpha * Math.min(1, radius - Math.sqrt(d2) + 0.5));
        } else if (d2 <= r2) {
          this.blend(x, y, color, alpha);
        }
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
