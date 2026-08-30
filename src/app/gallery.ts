/**
 * The index: a printer's proof sheet. Each chapter is a plate — a monochrome
 * line engraving when at rest, and on hover the plate is *inked*: color
 * floods in and the drawing starts to move.
 *
 * Every vignette is a small 2D-canvas drawing, deterministic per chapter, so
 * the resting state costs one draw and only the hovered plate animates.
 */

import { CHAPTERS } from '../chapters/registry.ts';
import type { ChapterDef } from './chapter.ts';
import { PALETTES, DEFAULT_PALETTE, mixHex, type Palette } from '../ui/palette.ts';
import { Rng } from '../core/rng.ts';
import { TAU } from '../core/math.ts';

interface VignetteInk {
  paper: string;
  line: string;
  faint: string;
  inks: string[];
}

type Vignette = (
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  ink: VignetteInk,
  rng: Rng,
) => void;

/** Resolve a chapter's palette into the vignette's ink set. */
function inksFor(def: ChapterDef, colored: boolean): VignetteInk {
  const palette: Palette = PALETTES.find((p) => p.id === def.palette) ?? DEFAULT_PALETTE;
  if (colored) {
    return {
      paper: palette.paper,
      line: palette.line,
      faint: mixHex(palette.line, palette.paper, 0.7),
      inks: palette.inks,
    };
  }
  // The resting plate: pure line-work, no color anywhere.
  const mono = mixHex(palette.line, palette.paper, 0.45);
  return {
    paper: palette.paper,
    line: mono,
    faint: mixHex(palette.line, palette.paper, 0.78),
    inks: [mono, mono, mono, mono, mono],
  };
}

// ---------------------------------------------------------------------------
// The vignettes, one per chapter.
// ---------------------------------------------------------------------------

const starChart: Vignette = (g, w, h, t, ink, rng) => {
  // Field stars.
  for (let i = 0; i < 110; i++) {
    const x = rng.range(0.04, 0.96) * w;
    const y = rng.range(0.06, 0.94) * h;
    const r = rng.power(0.4, 1.6, 2);
    const twinkle = 0.55 + 0.45 * Math.sin(t * 2 + i * 1.7);
    g.globalAlpha = (0.25 + rng.next() * 0.5) * (r < 0.8 ? twinkle : 1);
    g.fillStyle = ink.line;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  // Three constellations that draw themselves in.
  for (let c = 0; c < 3; c++) {
    const cx = (0.22 + c * 0.28) * w;
    const cy = (0.3 + rng.next() * 0.4) * h;
    const n = 4 + rng.int(0, 2);
    const points: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      points.push([cx + rng.gaussian() * w * 0.07, cy + rng.gaussian() * h * 0.14]);
    }

    g.strokeStyle = ink.inks[1 + c]!;
    g.fillStyle = ink.inks[1 + c]!;
    g.lineWidth = 1.2;

    // Stroke progress: the figure inks itself over the first moments of hover.
    const progress = Math.min(1, t * 0.7 + 0.001);
    const visible = Math.max(2, Math.ceil(n * progress));

    g.globalAlpha = 0.8;
    g.beginPath();
    points.slice(0, visible).forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    g.stroke();

    for (const [x, y] of points) {
      g.globalAlpha = 0.95;
      g.beginPath();
      g.arc(x, y, 2.1, 0, TAU);
      g.fill();
    }
  }
};

const orrery: Vignette = (g, w, h, t, ink, rng) => {
  const cx = w / 2;
  const cy = h / 2;

  // The sun, with breathing contour lobes.
  for (let band = 3; band >= 1; band--) {
    g.globalAlpha = band === 1 ? 0.9 : 0.16 * band;
    g.fillStyle = band === 1 ? ink.inks[1]! : ink.inks[1]!;
    g.beginPath();
    const r0 = 9 + band * 7;
    for (let s = 0; s <= 40; s++) {
      const a = (s / 40) * TAU;
      const wob = band === 1 ? 0 : Math.sin(a * 3 + t * 0.9 + band) * 2.4 + Math.sin(a * 5 - t * 0.7) * 1.6;
      const r = r0 + wob;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      s === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  }

  // Orbits and planets.
  for (let o = 0; o < 4; o++) {
    const rx = 34 + o * 22;
    const ry = rx * 0.38;
    g.globalAlpha = 0.35;
    g.strokeStyle = ink.faint;
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    g.stroke();

    const phase = rng.next() * TAU;
    const speed = 0.9 / Math.pow(1 + o, 1.4);
    const a = phase + t * speed;
    const px = cx + Math.cos(a) * rx;
    const py = cy + Math.sin(a) * ry;

    g.globalAlpha = 1;
    g.fillStyle = ink.inks[o % ink.inks.length]!;
    g.beginPath();
    g.arc(px, py, 3.4 + (o === 2 ? 1.6 : 0), 0, TAU);
    g.fill();

    // A ring for the third planet.
    if (o === 2) {
      g.globalAlpha = 0.8;
      g.strokeStyle = ink.inks[o % ink.inks.length]!;
      g.beginPath();
      g.ellipse(px, py, 9, 3, -0.4, 0, TAU);
      g.stroke();
    }
  }
};

const worldsmith: Vignette = (g, w, h, t, ink, rng) => {
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.36;

  // Continents: radial blobs that slide across the disc as the world turns.
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.clip();

  g.fillStyle = ink.paper;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.globalAlpha = 1;
  g.fillStyle = ink.inks[3] ?? ink.line;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);

  g.fillStyle = ink.inks[1]!;
  const spin = t * 0.35;
  for (let blob = 0; blob < 6; blob++) {
    const lon = rng.range(0, TAU) + spin;
    const lat = rng.range(-0.7, 0.7);
    // Longitude → x across the disc; blobs vanish around the limb.
    const x = cx + Math.sin(lon) * R * 0.85;
    const y = cy + lat * R;
    const facing = Math.cos(lon);
    if (facing < 0.05) continue;
    const size = rng.range(0.25, 0.5) * R * facing;
    g.globalAlpha = 0.9;
    g.beginPath();
    for (let s = 0; s <= 20; s++) {
      const a = (s / 20) * TAU;
      const r = size * (0.7 + 0.3 * Math.sin(a * 3 + blob * 2.1) * Math.cos(a * 2 - blob));
      s === 0 ? g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  }

  // Terminator: night falls over the trailing limb.
  g.globalAlpha = 0.55;
  g.fillStyle = ink.paper;
  g.beginPath();
  g.ellipse(cx - R * 0.55, cy, R * 0.9, R * 1.1, 0, 0, TAU);
  g.fill();
  g.restore();

  // Limb line.
  g.globalAlpha = 0.9;
  g.strokeStyle = ink.line;
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.stroke();
};

const groundside: Vignette = (g, w, h, t, ink, rng) => {
  // A sun climbing behind drifting ridge lines.
  const sunY = h * (0.42 - Math.min(0.14, t * 0.02));
  g.globalAlpha = 0.95;
  g.fillStyle = ink.inks[1]!;
  g.beginPath();
  g.arc(w * 0.62, sunY, 13, 0, TAU);
  g.fill();
  for (let ray = 0; ray < 8; ray++) {
    const a = (ray / 8) * TAU + t * 0.15;
    g.globalAlpha = 0.5;
    g.strokeStyle = ink.inks[1]!;
    g.beginPath();
    g.moveTo(w * 0.62 + Math.cos(a) * 17, sunY + Math.sin(a) * 17);
    g.lineTo(w * 0.62 + Math.cos(a) * 24, sunY + Math.sin(a) * 24);
    g.stroke();
  }

  // Three parallax ridges.
  for (let ridge = 0; ridge < 3; ridge++) {
    const base = h * (0.55 + ridge * 0.14);
    const drift = t * (4 + ridge * 7);
    const seedOff = rng.range(0, 100);
    g.globalAlpha = 0.75 + ridge * 0.1;
    g.fillStyle = ridge === 2 ? ink.paper : 'transparent';
    g.strokeStyle = ridge === 0 ? ink.faint : ink.line;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-4, h + 4);
    for (let x = -4; x <= w + 4; x += 4) {
      const u = (x + drift) * 0.02 + seedOff;
      const y = base
        - Math.abs(Math.sin(u) * 14 + Math.sin(u * 2.7) * 7 + Math.sin(u * 0.6) * 10)
        * (1 - ridge * 0.18);
      g.lineTo(x, y);
    }
    g.lineTo(w + 4, h + 4);
    g.closePath();
    if (ridge > 0) {
      g.save();
      g.globalAlpha = 1;
      g.fillStyle = ink.paper;
      g.fill();
      g.restore();
    }
    g.stroke();
  }
};

const galaxyLoom: Vignette = (g, w, h, t, ink, rng) => {
  const cx = w / 2;
  const cy = h / 2;
  const rot = t * 0.12;

  for (let i = 0; i < 340; i++) {
    const arm = i % 2;
    const along = rng.power(0.05, 1, 1.4);
    const radius = along * Math.min(w, h) * 0.46;
    const angle = arm * Math.PI + along * 4.4 + rot * (1.6 - along) + rng.gaussian() * 0.22;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius * 0.5;

    const core = along < 0.25;
    g.globalAlpha = core ? 0.9 : 0.3 + (1 - along) * 0.5;
    g.fillStyle = core ? ink.inks[3] ?? ink.line : rng.bool(0.15) ? ink.inks[1]! : ink.line;
    const r = core ? rng.range(0.8, 1.8) : rng.range(0.5, 1.3);
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
};

const forge: Vignette = (g, w, h, t, ink, rng) => {
  // A travel poster printing itself: frame, headline planet, orbit diagram.
  const m = 13;
  g.globalAlpha = 0.9;
  g.strokeStyle = ink.line;
  g.lineWidth = 1.4;
  g.strokeRect(m, m, w - m * 2, h - m * 2);
  g.globalAlpha = 0.4;
  g.strokeRect(m + 4, m + 4, w - m * 2 - 8, h - m * 2 - 8);

  const cx = w * 0.5;
  const cy = h * 0.46;
  const R = Math.min(w, h) * 0.21;

  // Rays behind the planet.
  for (let ray = 0; ray < 14; ray++) {
    const a = (ray / 14) * TAU + t * 0.1;
    g.globalAlpha = 0.35;
    g.strokeStyle = ink.inks[1]!;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (R + 6), cy + Math.sin(a) * (R + 6));
    g.lineTo(cx + Math.cos(a) * (R + 15 + 6 * Math.sin(t + ray)), cy + Math.sin(a) * (R + 15 + 6 * Math.sin(t + ray)));
    g.stroke();
  }

  // The planet and its ring.
  g.globalAlpha = 1;
  g.fillStyle = ink.inks[2]!;
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.fill();
  g.globalAlpha = 0.55;
  g.fillStyle = ink.paper;
  g.beginPath();
  g.arc(cx - R * 0.35, cy, R * 0.95, 0, TAU);
  g.fill();

  g.globalAlpha = 0.95;
  g.strokeStyle = ink.inks[0]!;
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(cx, cy, R * 1.7, R * 0.42, -0.28 + Math.sin(t * 0.4) * 0.05, 0, TAU);
  g.stroke();

  // Moons on the ring plane.
  for (let moon = 0; moon < 2; moon++) {
    const a = rng.range(0, TAU) + t * (0.5 + moon * 0.3);
    g.globalAlpha = 1;
    g.fillStyle = ink.inks[3 + moon] ?? ink.line;
    g.beginPath();
    g.arc(cx + Math.cos(a) * R * 1.7, cy + Math.sin(a) * R * 0.42, 3, 0, TAU);
    g.fill();
  }

  // Caption rules, like unset poster type.
  g.globalAlpha = 0.7;
  g.strokeStyle = ink.line;
  g.lineWidth = 2;
  const baseline = h - m - 16;
  g.beginPath();
  g.moveTo(w * 0.3, baseline);
  g.lineTo(w * 0.7, baseline);
  g.stroke();
  g.lineWidth = 1;
  g.globalAlpha = 0.45;
  g.beginPath();
  g.moveTo(w * 0.38, baseline + 7);
  g.lineTo(w * 0.62, baseline + 7);
  g.stroke();
};

const VIGNETTES: Record<string, Vignette> = {
  'star-chart': starChart,
  orrery,
  worldsmith,
  groundside,
  'galaxy-loom': galaxyLoom,
  forge,
};

// ---------------------------------------------------------------------------
// The proof sheet itself.
// ---------------------------------------------------------------------------

interface Tile {
  def: ChapterDef;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  hovered: boolean;
  hoverStart: number;
}

export class Gallery {
  readonly element: HTMLElement;
  private tiles: Tile[] = [];
  private frameId = 0;
  private animating = false;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'gallery';

    const header = document.createElement('header');
    header.className = 'gallery-header';
    header.innerHTML = `
      <h1 class="gallery-title">The Forge</h1>
      <p class="gallery-subtitle">A generated cosmos — six chapters of fundamental
      computer graphics, hand-set in WebGL2 and WebGPU and printed in ink.</p>`;

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';

    for (const def of CHAPTERS) {
      if (def.hidden) continue;
      grid.append(this.buildTile(def));
    }

    this.element.append(header, grid);
  }

  private buildTile(def: ChapterDef): HTMLElement {
    const tile = document.createElement(def.available ? 'a' : 'div');
    tile.className = 'plate';
    if (def.available) {
      (tile as HTMLAnchorElement).href = `#/${def.id}`;
    } else {
      tile.classList.add('is-unprinted');
    }

    const frame = document.createElement('div');
    frame.className = 'plate-frame';

    const canvas = document.createElement('canvas');
    frame.append(canvas);

    if (!def.available) {
      const stamp = document.createElement('span');
      stamp.className = 'plate-stamp';
      stamp.textContent = 'In press';
      frame.append(stamp);
    }

    const caption = document.createElement('div');
    caption.className = 'plate-caption';
    caption.innerHTML = `
      <span class="plate-num">${String(def.index).padStart(2, '0')}</span>
      <span class="plate-name">${def.title}</span>
      <span class="plate-api">${def.api}</span>`;

    tile.append(frame, caption);

    const g = canvas.getContext('2d');
    if (g) {
      const entry: Tile = { def, canvas, g, hovered: false, hoverStart: 0 };
      this.tiles.push(entry);

      tile.addEventListener('pointerenter', () => {
        entry.hovered = true;
        entry.hoverStart = performance.now();
        this.ensureAnimating();
      });
      tile.addEventListener('pointerleave', () => {
        entry.hovered = false;
        this.renderTile(entry, 0);
      });
    }

    return tile;
  }

  /** Draw one plate. t > 0 means hovered (inked and moving). */
  private renderTile(tile: Tile, t: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = tile.canvas.getBoundingClientRect();
    if (rect.width < 2) return;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (tile.canvas.width !== w || tile.canvas.height !== h) {
      tile.canvas.width = w;
      tile.canvas.height = h;
    }

    const g = tile.g;
    const colored = t > 0;
    const ink = inksFor(tile.def, colored);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = ink.paper;
    g.fillRect(0, 0, rect.width, rect.height);

    const vignette = VIGNETTES[tile.def.id];
    if (vignette) {
      // Deterministic: the same plate every visit.
      vignette(g, rect.width, rect.height, t, ink, new Rng(`plate-${tile.def.id}`));
    }
    g.globalAlpha = 1;
  }

  /** Animation runs only while at least one plate is hovered. */
  private ensureAnimating(): void {
    if (this.animating) return;
    this.animating = true;
    const tick = (now: number) => {
      let any = false;
      for (const tile of this.tiles) {
        if (!tile.hovered) continue;
        any = true;
        this.renderTile(tile, (now - tile.hoverStart) / 1000 + 0.001);
      }
      if (any && this.element.isConnected && this.element.style.display !== 'none') {
        this.frameId = requestAnimationFrame(tick);
      } else {
        this.animating = false;
      }
    };
    this.frameId = requestAnimationFrame(tick);
  }

  show(): void {
    this.element.style.display = '';
    // Fonts/layout settle before first paint of the plates.
    requestAnimationFrame(() => {
      for (const tile of this.tiles) this.renderTile(tile, 0);
    });
  }

  hide(): void {
    this.element.style.display = 'none';
    cancelAnimationFrame(this.frameId);
    this.animating = false;
  }
}
