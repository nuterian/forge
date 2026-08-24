/**
 * Catmull-Rom splines — the descendant of the 2015 spline-painting assignment.
 * Used for camera tours (ch.2) and constellation strokes (ch.1).
 */

import { vec3, type Vec3 } from './math.ts';

/** Catmull-Rom basis for one segment, t in [0,1]. */
export function catmullRom(out: Vec3, p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  for (let i = 0; i < 3; i++) {
    out[i] =
      0.5 *
      (2 * p1[i] +
        (-p0[i] + p2[i]) * t +
        (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
        (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  }
  return out;
}

/** Cubic Bezier — the 2015 painter's actual curve, kept for ch.1. */
export function bezier(out: Vec3, p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  for (let i = 0; i < 3; i++) {
    out[i] = b0 * p0[i] + b1 * p1[i] + b2 * p2[i] + b3 * p3[i];
  }
  return out;
}

/**
 * A Catmull-Rom path through control points, with an arc-length table so that
 * travelling at constant `u` means travelling at constant speed — otherwise
 * the camera lurches through tightly-spaced control points.
 */
export class Spline {
  readonly points: Vec3[];
  readonly closed: boolean;
  private lengths: number[] = [];
  private total = 0;
  private readonly samplesPerSegment: number;

  constructor(points: Vec3[], closed = false, samplesPerSegment = 24) {
    this.points = points;
    this.closed = closed;
    this.samplesPerSegment = samplesPerSegment;
    this.rebuild();
  }

  get length(): number {
    return this.total;
  }

  private controlAt(i: number): Vec3 {
    const n = this.points.length;
    if (this.closed) return this.points[((i % n) + n) % n]!;
    return this.points[Math.max(0, Math.min(n - 1, i))]!;
  }

  private get segmentCount(): number {
    return this.closed ? this.points.length : this.points.length - 1;
  }

  /** Position at raw parameter t in [0,1], NOT arc-length corrected. */
  at(out: Vec3, t: number): Vec3 {
    const segs = this.segmentCount;
    if (segs <= 0) return vec3.copy(out, this.points[0] ?? vec3.create());

    let x = t * segs;
    if (this.closed) {
      x = ((x % segs) + segs) % segs;
    } else {
      x = Math.max(0, Math.min(segs - 1e-6, x));
    }
    const i = Math.floor(x);
    const local = x - i;

    return catmullRom(
      out,
      this.controlAt(i - 1),
      this.controlAt(i),
      this.controlAt(i + 1),
      this.controlAt(i + 2),
      local,
    );
  }

  /** Position at arc-length fraction u in [0,1] — constant speed along the path. */
  atDistance(out: Vec3, u: number): Vec3 {
    return this.at(out, this.tForDistance(u));
  }

  /** Forward-difference tangent at arc-length fraction u, normalized. */
  tangentAt(out: Vec3, u: number, eps = 1e-3): Vec3 {
    const a = this.atDistance(vec3.create(), Math.max(0, u - eps));
    const b = this.atDistance(vec3.create(), Math.min(1, u + eps));
    return vec3.normalize(out, vec3.sub(out, b, a));
  }

  /** Map arc-length fraction → raw curve parameter using the length table. */
  private tForDistance(u: number): number {
    if (this.total <= 0) return 0;
    const target = (this.closed ? ((u % 1) + 1) % 1 : Math.max(0, Math.min(1, u))) * this.total;

    // The table is monotonic, so binary search it.
    let lo = 0;
    let hi = this.lengths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.lengths[mid]! < target) lo = mid + 1;
      else hi = mid;
    }

    const i = Math.max(1, lo);
    const prev = this.lengths[i - 1]!;
    const curr = this.lengths[i]!;
    const span = curr - prev;
    const frac = span > 0 ? (target - prev) / span : 0;
    return (i - 1 + frac) / (this.lengths.length - 1);
  }

  private rebuild(): void {
    const segs = this.segmentCount;
    this.lengths = [];
    this.total = 0;
    if (segs <= 0) return;

    const steps = segs * this.samplesPerSegment;
    const a = vec3.create();
    const b = vec3.create();

    this.at(a, 0);
    this.lengths.push(0);
    for (let i = 1; i <= steps; i++) {
      this.at(b, i / steps);
      this.total += vec3.dist(a, b);
      this.lengths.push(this.total);
      vec3.copy(a, b);
    }
  }

  /** Sample the whole path into a flat position array — feeds the line renderer. */
  sample(count: number): Float32Array {
    const out = new Float32Array(count * 3);
    const p = vec3.create();
    for (let i = 0; i < count; i++) {
      const u = this.closed ? i / count : i / (count - 1);
      this.atDistance(p, u);
      out[i * 3] = p[0];
      out[i * 3 + 1] = p[1];
      out[i * 3 + 2] = p[2];
    }
    return out;
  }
}
