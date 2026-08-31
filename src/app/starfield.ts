/**
 * The approach: the sheet's own sky, and the only thing on the index that
 * never stops moving.
 *
 * A classic perspective star field with its vanishing point behind the
 * masthead, so the drift reads as travel *toward* the title rather than as
 * decoration sliding around. Stars accelerate outward as they pass — the whole
 * effect is that one number, z, shrinking — and the speed is deliberately slow
 * enough that you notice it only after a second or two. Occasionally one of
 * them streaks: a shooting star, drawn as a run of separating dots rather than
 * a tapered line, because a smooth gradient is the one thing this production
 * does not print.
 *
 * Everything is drawn in the active palette's line ink and one accent, at
 * alphas low enough that the plates always win the page.
 */

import { Rng } from '../core/rng.ts';
import { TAU } from '../core/math.ts';
import type { Palette } from '../ui/palette.ts';

/** Stars in flight. Enough to read as a field, few enough to be free. */
const STAR_COUNT = 240;
/** How fast z closes. One star crosses the frame in roughly half a minute. */
const SPEED = 0.045;
/** Seconds between shooting stars, picked uniformly in this range. */
const STREAK_MIN = 7;
const STREAK_MAX = 19;
/** How long a streak lives, and how many dots it is drawn with. */
const STREAK_LIFE = 0.62;
const STREAK_DOTS = 16;

export class Starfield {
  readonly element: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;

  // Flat arrays rather than objects: this is the one thing on the page that
  // runs every frame, and it has no business allocating in a loop.
  private readonly x = new Float32Array(STAR_COUNT);
  private readonly y = new Float32Array(STAR_COUNT);
  private readonly z = new Float32Array(STAR_COUNT);
  /** 0 = line ink, 1 = accent ink. */
  private readonly tint = new Uint8Array(STAR_COUNT);

  private readonly rng = new Rng('approach');

  private width = 0;
  private height = 0;
  private dpr = 1;
  /** The vanishing point, in CSS pixels — the masthead's centre. */
  private focusX = 0;
  private focusY = 0;

  private lineInk = '#ffffff';
  private accentInk = '#ffffff';

  // The current streak, if one is in flight.
  private streakWait = 3;
  private streakLife = 0;
  private streakX = 0;
  private streakY = 0;
  private streakDx = 0;
  private streakDy = 0;

  private still = false;

  constructor() {
    this.element = document.createElement('canvas');
    this.element.className = 'gallery-sky';
    this.element.setAttribute('aria-hidden', 'true');
    this.g = this.element.getContext('2d')!;

    for (let i = 0; i < STAR_COUNT; i++) this.respawn(i, true);

    this.still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  setPalette(palette: Palette): void {
    this.lineInk = palette.line;
    this.accentInk = palette.inks[1] ?? palette.line;
  }

  /**
   * Put a star somewhere in front of the camera. `spread` seeds the initial
   * field across the whole depth range; afterwards they enter from far away.
   */
  private respawn(i: number, spread: boolean): void {
    // Rejection-sample away from dead centre: a star with x and y near zero
    // sits on the vanishing point and crawls for half a minute before it moves.
    let px = 0;
    let py = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      px = this.rng.range(-1, 1);
      py = this.rng.range(-1, 1);
      if (px * px + py * py > 0.045) break;
    }
    this.x[i] = px;
    this.y[i] = py;
    this.z[i] = spread ? this.rng.range(0.05, 1) : this.rng.range(0.86, 1);
    this.tint[i] = this.rng.bool(0.13) ? 1 : 0;
  }

  resize(width: number, height: number, focusX: number, focusY: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.focusX = focusX;
    this.focusY = focusY;

    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (this.element.width !== w || this.element.height !== h) {
      this.element.width = w;
      this.element.height = h;
    }
  }

  /** Advance and draw. `dt` is seconds, clamped by the caller. */
  frame(dt: number, paper: string): void {
    const g = this.g;
    const w = this.width;
    const h = this.height;
    if (w < 2 || h < 2) return;

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = paper;
    g.fillRect(0, 0, w, h);

    // The projection scale: big enough that stars leave the frame rather than
    // piling up at the edges.
    const scale = Math.max(w, h) * 0.62;
    const step = this.still ? 0 : dt * SPEED;

    for (let i = 0; i < STAR_COUNT; i++) {
      let z = this.z[i]! - step;
      if (z <= 0.035) {
        this.respawn(i, false);
        z = this.z[i]!;
      }
      this.z[i] = z;

      const px = this.focusX + (this.x[i]! / z) * scale * 0.08;
      const py = this.focusY + (this.y[i]! / z) * scale * 0.08;
      if (px < -8 || px > w + 8 || py < -8 || py > h + 8) {
        // Off the page: send it back to the far distance rather than waiting
        // for z to run out, or half the field ends up outside the frame.
        this.respawn(i, false);
        continue;
      }

      // Nearer stars are bigger and brighter — the whole sense of depth.
      const near = 1 - z;
      const radius = 0.35 + near * near * 1.5;
      g.globalAlpha = 0.06 + near * 0.3;
      g.fillStyle = this.tint[i] ? this.accentInk : this.lineInk;
      g.beginPath();
      g.arc(px, py, radius, 0, TAU);
      g.fill();
    }

    this.drawStreak(dt, w, h);
    g.globalAlpha = 1;
  }

  /** One shooting star at a time, rare enough to stay a surprise. */
  private drawStreak(dt: number, w: number, h: number): void {
    if (this.still) return;

    if (this.streakLife <= 0) {
      this.streakWait -= dt;
      if (this.streakWait > 0) return;
      this.streakWait = this.rng.range(STREAK_MIN, STREAK_MAX);
      this.streakLife = STREAK_LIFE;
      // Enter from the upper edge and fall across, the way they actually look.
      this.streakX = this.rng.range(-0.1, 0.9) * w;
      this.streakY = this.rng.range(-0.05, 0.5) * h;
      const angle = this.rng.range(0.18, 0.62);
      const speed = this.rng.range(0.85, 1.5) * w;
      this.streakDx = Math.cos(angle) * speed;
      this.streakDy = Math.sin(angle) * speed;
      return;
    }

    this.streakLife -= dt;
    const life = Math.max(this.streakLife, 0) / STREAK_LIFE;
    this.streakX += this.streakDx * dt;
    this.streakY += this.streakDy * dt;

    // The tail is a run of separating dots: it thins by *losing* dots and
    // shrinking them, not by fading through a gradient.
    const g = this.g;
    g.fillStyle = this.lineInk;
    const fade = life * life;
    for (let d = 0; d < STREAK_DOTS; d++) {
      const along = d / STREAK_DOTS;
      const px = this.streakX - this.streakDx * along * 0.07;
      const py = this.streakY - this.streakDy * along * 0.07;
      if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
      g.globalAlpha = fade * (1 - along * 0.85) * 0.95;
      g.beginPath();
      g.arc(px, py, 1.7 * (1 - along * 0.72), 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}
