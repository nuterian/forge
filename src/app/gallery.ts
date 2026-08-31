/**
 * The index: a printer's proof sheet, and the sheet is *printed* in front of
 * you. On arrival the press runs — the plates ink themselves in sequence, each
 * one flooded by a colour front whose leading edge is an ordered-dither screen
 * rather than a gradient — and then the sheet rests, inked and still.
 *
 * Resting inked is the whole point of the change. The old sheet was monochrome
 * until you hovered a plate, which meant every phone and tablet in the world
 * saw a grey page and nothing else: the front door of a project about colour,
 * with the colour behind an interaction those devices do not have. Hover still
 * does something (the plate starts moving, and lifts), but it is no longer
 * what stands between a visitor and the ink.
 *
 * The whole sheet prints in the *active* palette, not one palette per plate.
 * A proof sheet is one sheet of paper through one press: mixing three papers
 * and three ink sets across six plates read as six unrelated thumbnails, and
 * it left the swatch strip below describing colours that appeared nowhere on
 * the page. Each plate's identity is carried by its drawing, which is more
 * than distinct enough.
 *
 * Every vignette is a small 2D-canvas drawing, deterministic per chapter, so
 * the rested sheet costs one draw per plate and the rAF loop goes idle the
 * moment nothing is moving.
 */

import { CHAPTERS } from '../chapters/registry.ts';
import type { ChapterDef } from './chapter.ts';
import { DEFAULT_PALETTE, mixHex, type Palette } from '../ui/palette.ts';
import { Rng } from '../core/rng.ts';
import { TAU } from '../core/math.ts';
import { Starfield } from './starfield.ts';

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

/** Resolve the sheet's palette into the vignette's ink set. */
function inksFor(palette: Palette, colored: boolean): VignetteInk {
  if (colored) {
    return {
      paper: palette.paper,
      line: palette.line,
      faint: mixHex(palette.line, palette.paper, 0.7),
      inks: palette.inks,
    };
  }
  // The un-inked plate: pure line-work, no colour anywhere. This is the state
  // the press floods over, and the one unbuilt plates never leave.
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

/**
 * The sky behind a plate. Every built chapter is set in space and every one of
 * them draws a star field on the real page, so a plate without one reads as a
 * diagram of the chapter rather than a picture of it.
 *
 * Its own Rng stream, keyed by plate: adding draws to the front of a vignette's
 * shared stream would have shifted every position after it and rearranged
 * drawings that were already composed.
 */
function plateSky(
  g: CanvasRenderingContext2D, w: number, h: number, t: number,
  ink: VignetteInk, id: string, count: number,
): void {
  const rng = new Rng(`sky-${id}`);
  for (let i = 0; i < count; i++) {
    const x = rng.range(0.01, 0.99) * w;
    const y = rng.range(0.02, 0.98) * h;
    const r = rng.power(0.35, 1.5, 2.2);
    const twinkle = 0.45 + 0.55 * Math.sin(t * 1.7 + i * 2.3);
    g.globalAlpha = (0.16 + rng.next() * 0.34) * (r < 0.9 ? twinkle : 1);
    g.fillStyle = rng.bool(0.12) ? ink.inks[1]! : ink.line;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
}

const starChart: Vignette = (g, w, h, t, ink, rng) => {
  // The one motion a star chart has is the sky turning, so the whole plate is
  // drawn through a slow rotation about its centre. The field is scattered
  // well past the frame — otherwise the corners swing out to bare paper.
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(t * 0.035);
  g.translate(-w / 2, -h / 2);

  // Field stars.
  for (let i = 0; i < 150; i++) {
    const x = rng.range(-0.15, 1.15) * w;
    const y = rng.range(-0.25, 1.25) * h;
    const r = rng.power(0.4, 1.6, 2);
    const twinkle = 0.4 + 0.6 * Math.sin(t * 2 + i * 1.7);
    g.globalAlpha = (0.25 + rng.next() * 0.5) * (r < 1 ? twinkle : 1);
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

  g.restore();
};

const orrery: Vignette = (g, w, h, t, ink, rng) => {
  const cx = w / 2;
  const cy = h / 2;

  plateSky(g, w, h, t, ink, 'orrery', 90);

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

  plateSky(g, w, h, t, ink, 'worldsmith', 110);

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

/**
 * The press screen: an 8×8 ordered-dither cell, at `level`/8 coverage, as a
 * repeating pattern. The flood's leading edge is drawn as a short ramp of
 * these, which is what makes it read as a screen breaking up rather than a
 * gradient fading in — the same idea as the print pass's bayer8(), in DOM.
 *
 * Built at device resolution so the dots stay crisp on a retina panel while
 * keeping the same physical size on the page.
 */
const BAYER8 = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

/** Coverage steps in the flood's edge — one pattern each, built once. */
const SCREEN_STEPS = 7;

function buildScreens(g: CanvasRenderingContext2D, scale: number): CanvasPattern[] {
  const size = 8 * scale;
  const patterns: CanvasPattern[] = [];
  for (let level = 1; level <= SCREEN_STEPS; level++) {
    const cell = document.createElement('canvas');
    cell.width = size;
    cell.height = size;
    const cg = cell.getContext('2d')!;
    const image = cg.createImageData(size, size);
    const cut = (level / 8) * 64;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const on = BAYER8[((y / scale) | 0) * 8 + ((x / scale) | 0)]! < cut;
        const i = (y * size + x) * 4;
        image.data[i] = 255;
        image.data[i + 1] = 255;
        image.data[i + 2] = 255;
        image.data[i + 3] = on ? 255 : 0;
      }
    }
    cg.putImageData(image, 0, 0);
    patterns.push(g.createPattern(cell, 'repeat')!);
  }
  return patterns;
}

/** The squeegee's angle. One direction for the whole sheet: one pull, one press. */
const FLOOD_ANGLE = -0.36;
/** How long a single plate takes to ink, and how far apart the plates start. */
const FLOOD_MS = 620;
const FLOOD_STAGGER = 120;
/** Width of the dithered edge, as a fraction of the sweep's length. */
const FLOOD_EDGE = 0.34;

/**
 * The vignette clock a rested plate is frozen at. Far enough in that every
 * figure has finished drawing itself, and hover picks up from exactly here,
 * so nothing jumps when the pointer arrives.
 */
const REST_T = 3.2;

interface Tile {
  def: ChapterDef;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  /** Plates ink in sheet order; unbuilt ones never do. */
  order: number;
  inkable: boolean;
  hovered: boolean;
  /** The vignette clock. Frozen except while this plate is hovered. */
  t: number;
  /** performance.now() when the current hover began, and the clock then. */
  hoverStart: number;
  hoverBaseT: number;
}

export class Gallery {
  readonly element: HTMLElement;
  private tiles: Tile[] = [];
  private frameId = 0;
  private animating = false;

  private palette: Palette = DEFAULT_PALETTE;
  /** The palette the sheet on screen was printed in, or null if unprinted. */
  private printedIn: string | null = null;
  /** performance.now() at the start of the press run, or 0 when not running. */
  private pressStart = 0;

  private readonly swatchStrip: HTMLElement;
  private header!: HTMLElement;
  private readonly sky = new Starfield();
  /** rAF timestamp of the previous frame, for the sky's dt. */
  private lastFrame = 0;

  // Press scratch, allocated once: the colour plate, and the mask that decides
  // how much of it has landed. Both track the tile size.
  private readonly scratch = document.createElement('canvas');
  private readonly mask = document.createElement('canvas');
  private screens: CanvasPattern[] | null = null;
  private screenScale = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'gallery';

    // The masthead is set the way a poster's would be: the article tiny and
    // widely letterspaced, the name enormous and tightly tracked. The size
    // jump between the two words is the whole effect.
    const header = document.createElement('header');
    header.className = 'gallery-header';
    header.innerHTML = `
      <h1 class="gallery-title">
        <span class="gallery-title-the">The</span>
        <span class="gallery-title-forge">Forge</span>
      </h1>
      <p class="gallery-subtitle">A generated cosmos — six chapters of fundamental
      computer graphics, hand-set in WebGL2 and WebGPU and printed in ink.</p>`;
    this.header = header;

    // The colour bar: the cans open on the press today, as physical chips.
    // Every colour is a custom property, so switching palettes reprints it for
    // free. It belongs in the bottom trim with the job line, which is where a
    // real press sheet carries it — under the masthead it read as a control,
    // and there is no ink selector on the index for it to control.
    this.swatchStrip = document.createElement('div');
    this.swatchStrip.className = 'ink-strip';

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';

    let order = 0;
    for (const def of CHAPTERS) {
      if (def.hidden) continue;
      grid.append(this.buildTile(def, order++));
    }

    // One sheet holding header and grid, centered in the viewport by auto
    // margins — see .gallery-sheet in the stylesheet for why margins and not
    // justify-content.
    const sheet = document.createElement('div');
    sheet.className = 'gallery-sheet';
    const colophon = document.createElement('div');
    colophon.className = 'colophon';
    colophon.append(this.swatchStrip, editionLine());

    sheet.append(header, grid, colophon);
    // The sky goes behind everything, including the paper the plates sit on.
    this.element.append(this.sky.element, sheet);
  }

  private buildTile(def: ChapterDef, order: number): HTMLElement {
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
      const entry: Tile = {
        def, canvas, g, order,
        inkable: def.available,
        hovered: false,
        t: REST_T,
        hoverStart: 0,
        hoverBaseT: REST_T,
      };
      this.tiles.push(entry);

      const enter = (): void => {
        entry.hovered = true;
        entry.hoverStart = performance.now();
        entry.hoverBaseT = entry.t;
        this.ensureAnimating();
      };
      // Leaving freezes the plate wherever it got to rather than snapping it
      // back to REST_T: a rested plate is *any* still frame of itself, and a
      // jump on pointer-out reads as a glitch.
      const leave = (): void => {
        entry.hovered = false;
        this.renderTile(entry, 1);
      };

      tile.addEventListener('pointerenter', enter);
      tile.addEventListener('pointerleave', leave);
      // Keyboard reaches the same state the pointer does.
      tile.addEventListener('focus', enter);
      tile.addEventListener('blur', leave);
    }

    return tile;
  }

  /**
   * Draw one plate. `flood` is how much of the colour plate has landed:
   * 0 is bare line-work, 1 is fully inked, and anything between paints the
   * colour over the line-work through the press screen.
   */
  private renderTile(tile: Tile, flood: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = tile.canvas.getBoundingClientRect();
    if (rect.width < 2) return;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (tile.canvas.width !== w || tile.canvas.height !== h) {
      tile.canvas.width = w;
      tile.canvas.height = h;
    }

    // The un-inked plate, always: it is both the resting state of an unbuilt
    // chapter and the surface everything else is printed onto.
    this.paint(tile.g, tile.def, rect.width, rect.height, tile.t, false, dpr);
    if (flood <= 0.001) return;

    if (flood >= 0.999) {
      this.paint(tile.g, tile.def, rect.width, rect.height, tile.t, true, dpr);
      return;
    }

    // Partial: the colour plate, masked by the screen, composited on top.
    if (this.scratch.width !== w || this.scratch.height !== h) {
      this.scratch.width = w;
      this.scratch.height = h;
      this.mask.width = w;
      this.mask.height = h;
    }
    const sg = this.scratch.getContext('2d')!;
    const mg = this.mask.getContext('2d')!;

    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.globalCompositeOperation = 'source-over';
    sg.clearRect(0, 0, w, h);
    this.paint(sg, tile.def, rect.width, rect.height, tile.t, true, dpr);

    this.paintMask(mg, w, h, flood, dpr);

    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.globalAlpha = 1;
    sg.globalCompositeOperation = 'destination-in';
    sg.drawImage(this.mask, 0, 0);
    sg.globalCompositeOperation = 'source-over';

    tile.g.setTransform(1, 0, 0, 1, 0, 0);
    tile.g.globalAlpha = 1;
    tile.g.drawImage(this.scratch, 0, 0);
  }

  /** One vignette, on its paper, in the given ink state. */
  private paint(
    g: CanvasRenderingContext2D,
    def: ChapterDef,
    w: number,
    h: number,
    t: number,
    colored: boolean,
    dpr: number,
  ): void {
    const ink = inksFor(this.palette, colored);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = ink.paper;
    g.fillRect(0, 0, w, h);

    const vignette = VIGNETTES[def.id];
    // Deterministic: the same plate every visit.
    if (vignette) vignette(g, w, h, t, ink, new Rng(`plate-${def.id}`));
    g.globalAlpha = 1;
  }

  /**
   * The flood's coverage, in device pixels: opaque where the colour has
   * fully landed, then a short ramp of dither screens along the leading edge,
   * then nothing. Eight fills, whatever the size of the plate.
   */
  private paintMask(g: CanvasRenderingContext2D, w: number, h: number, flood: number, dpr: number): void {
    const scale = Math.max(1, Math.round(dpr));
    if (!this.screens || this.screenScale !== scale) {
      this.screens = buildScreens(g, scale);
      this.screenScale = scale;
    }

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const dx = Math.cos(FLOOD_ANGLE);
    const dy = Math.sin(FLOOD_ANGLE);
    // Half-extents of the plate along the sweep and across it.
    const reach = Math.abs(w * dx) / 2 + Math.abs(h * dy) / 2;
    const across = (Math.abs(w * dy) + Math.abs(h * dx)) / 2 + 2;
    const edge = reach * 2 * FLOOD_EDGE;
    // The front travels from just off one side to just off the other, so the
    // last plate pixel is covered exactly when flood hits 1.
    const front = -reach - edge + flood * (reach * 2 + edge);

    // P(u, s) = centre + along*u + across*s, so a strip of the sweep is one
    // quad in unrotated space — which keeps the screen's own grid axis-aligned
    // instead of shearing it with the squeegee.
    const quad = (u0: number, u1: number): void => {
      g.beginPath();
      g.moveTo(cx + dx * u0 - dy * across, cy + dy * u0 + dx * across);
      g.lineTo(cx + dx * u1 - dy * across, cy + dy * u1 + dx * across);
      g.lineTo(cx + dx * u1 + dy * across, cy + dy * u1 - dx * across);
      g.lineTo(cx + dx * u0 + dy * across, cy + dy * u0 - dx * across);
      g.closePath();
      g.fill();
    };

    const span = reach + edge;
    g.fillStyle = '#fff';
    quad(-span, front);

    for (let k = 0; k < SCREEN_STEPS; k++) {
      const u0 = front + (edge * k) / SCREEN_STEPS;
      const u1 = front + (edge * (k + 1)) / SCREEN_STEPS;
      if (u0 > span) break;
      g.fillStyle = this.screens[SCREEN_STEPS - 1 - k]!;
      quad(u0, u1);
    }
  }

  /** Runs while the press is running or a plate is hovered — never otherwise. */
  private ensureAnimating(): void {
    if (this.animating) return;
    this.animating = true;
    const tick = (now: number): void => {
      const dt = this.lastFrame === 0 ? 0.016 : Math.min((now - this.lastFrame) / 1000, 0.05);
      this.lastFrame = now;

      // The approach runs for as long as the sheet is on screen. The plates do
      // not: they are struck once and then sit still, and everything below
      // this is about which of them, if any, still needs redrawing.
      this.layoutSky();
      this.sky.frame(dt, this.palette.paper);

      if (this.pressStart > 0) {
        let done = true;
        for (const tile of this.tiles) {
          if (!tile.inkable) continue;
          const flood = clamp01((now - this.pressStart - tile.order * FLOOD_STAGGER) / FLOOD_MS);
          if (flood < 1) done = false;
          // A plate the pointer has already found animates on its own below.
          if (!tile.hovered) this.renderTile(tile, flood);
        }
        if (done) this.pressStart = 0;
      }

      for (const tile of this.tiles) {
        if (!tile.hovered) continue;
        tile.t = tile.hoverBaseT + (now - tile.hoverStart) / 1000;
        this.renderTile(tile, tile.inkable && this.pressStart === 0 ? 1 : this.floodOf(tile, now));
      }

      if (this.element.isConnected && this.element.style.display !== 'none') {
        this.frameId = requestAnimationFrame(tick);
      } else {
        this.animating = false;
      }
    };
    this.frameId = requestAnimationFrame(tick);
  }

  /** Track the viewport, and aim the vanishing point at the masthead. */
  private layoutSky(): void {
    const rect = this.element.getBoundingClientRect();
    const title = this.header.getBoundingClientRect();
    this.sky.resize(
      rect.width, rect.height,
      title.left - rect.left + title.width / 2,
      title.top - rect.top + title.height * 0.42,
    );
  }

  private floodOf(tile: Tile, now: number): number {
    if (!tile.inkable) return 0;
    if (this.pressStart === 0) return 1;
    return clamp01((now - this.pressStart - tile.order * FLOOD_STAGGER) / FLOOD_MS);
  }

  show(palette: Palette): void {
    this.element.style.display = '';
    this.palette = palette;
    this.sky.setPalette(palette);
    this.lastFrame = 0;
    this.element.style.cursor = registrationCursor(palette);
    this.paintSwatches();
    this.runMasthead();

    // A sheet is printed once. It goes back through the press only when the
    // inks change — which is the one thing that makes the sheet on screen
    // wrong rather than merely already-seen.
    const reprint = this.printedIn !== palette.id;
    this.printedIn = palette.id;

    // Fonts and layout settle before the first plate is drawn.
    requestAnimationFrame(() => {
      if (reprint) {
        for (const tile of this.tiles) tile.t = REST_T;
        // The press only runs over plates that can take ink, so the unbuilt
        // ones have to be struck here — otherwise nothing ever draws them and
        // they sit blank until a pointer happens to find them.
        for (const tile of this.tiles) if (!tile.inkable) this.renderTile(tile, 0);
        this.pressStart = performance.now();
        this.ensureAnimating();
      } else if (this.pressStart === 0) {
        // Only when nothing is running: show() can be called twice for one
        // arrival (a route sync and a hashchange), and the second call must
        // not paint a finished sheet over a press run still in progress.
        for (const tile of this.tiles) this.renderTile(tile, tile.inkable ? 1 : 0);
      }
      // The sky needs the loop whether or not any plate does.
      this.ensureAnimating();
    });
  }

  /**
   * Re-run the masthead's entrance. CSS animations only fire when an element
   * is created or its animation changes, so the class comes off, the layout is
   * flushed, and it goes back on.
   */
  private runMasthead(): void {
    this.header.classList.remove('is-printing');
    void this.header.offsetWidth;
    this.header.classList.add('is-printing');
  }

  private paintSwatches(): void {
    this.swatchStrip.replaceChildren();
    this.palette.inks.forEach((_, i) => {
      const chip = document.createElement('span');
      chip.className = 'ink-chip';
      chip.style.background = `var(--ink-${i})`;
      this.swatchStrip.append(chip);
    });
  }

  hide(): void {
    this.element.style.display = 'none';
    cancelAnimationFrame(this.frameId);
    this.animating = false;
    this.lastFrame = 0;
    // Abandoning a half-printed sheet would leave it half-inked on return.
    this.pressStart = 0;
    this.printedIn = null;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** The colophon: what this sheet is, and when it came off the press. */
function editionLine(): HTMLElement {
  const el = document.createElement('p');
  el.className = 'edition-line';
  const now = new Date();
  const stamp =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-` +
    `${String(now.getDate()).padStart(2, '0')}`;
  el.textContent = `Proof sheet · The Forge Press · Printed ${stamp}`;
  return el;
}

/**
 * The registration target, as the pointer.
 *
 * It started as furniture printed on the sheet — trim marks at the corners,
 * targets top and bottom — and that was one decoration too many: it crowded
 * the plates, and the bottom-left mark ran a rule straight through the
 * edition line. The mark is better used than displayed. Here it is the cursor,
 * so the reader lines the sheet up themselves.
 *
 * A cursor cannot read a custom property, so the target is built from the
 * active palette's line ink each time the sheet is printed.
 */
function registrationCursor(palette: Palette): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" ` +
    `stroke="${palette.line}" stroke-width="1.25" opacity="0.9">` +
    `<circle cx="12" cy="12" r="6"/><path d="M12 1v7M12 16v7M1 12h7M16 12h7"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
}
