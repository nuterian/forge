/**
 * Ink palettes. Everything on screen — 3D and DOM alike — draws from these,
 * which is what keeps six independent chapters looking like one production.
 *
 * Colours are authored and used directly in sRGB. A physically-correct linear
 * workflow would fight the flat, printed look rather than help it.
 */

import { vec3, type Vec3 } from '../core/math.ts';
import type { RGB } from '../core/raster.ts';

export interface Palette {
  id: string;
  name: string;
  /** Background — the "paper" the inks are printed on. */
  paper: string;
  /** The deepest shadow ink; used where light does not reach. */
  shadow: string;
  /**
   * Accent inks, roughly ordered warm → cool.
   *
   * One hard constraint binds every palette: inks 2 → 1 → 0 must run
   * dark-to-bright. The shared sun shader prints its three-tone fire gradient
   * (core → hot → flare) from exactly those three, in that order, and a set
   * that inverts them stops reading as fire from every angle. See StarParams
   * in chapters/03-worldsmith/planet.ts.
   */
  inks: string[];
  /** Text/linework ink. */
  line: string;
}

export const PALETTES: Palette[] = [
  {
    id: 'observatory',
    name: 'Observatory',
    paper: '#0a0c13',
    shadow: '#161b2e',
    inks: ['#f4e9d4', '#ffb03a', '#e8624a', '#4ec9e0', '#8b7fd4'],
    line: '#f4e9d4',
  },
  {
    id: 'ferrous',
    name: 'Ferrous',
    paper: '#100a0a',
    shadow: '#2a1616',
    inks: ['#f6e7cf', '#ff8c42', '#d94f2b', '#6fb3a0', '#b06a9e'],
    line: '#f6e7cf',
  },
  {
    id: 'cyanotype',
    name: 'Cyanotype',
    paper: '#060d16',
    shadow: '#10233d',
    inks: ['#e6f2f7', '#7ad3e8', '#3f8fc4', '#f2c14e', '#a8b8d8'],
    line: '#e6f2f7',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    paper: '#050f0e',
    shadow: '#0f2830',
    inks: ['#e9f7ea', '#5fe0a8', '#2f9d8f', '#a07ff0', '#3fb5d6'],
    line: '#e9f7ea',
  },
  {
    id: 'heliograph',
    name: 'Heliograph',
    paper: '#120806',
    shadow: '#2c1209',
    inks: ['#fbeccf', '#f0b429', '#b3301f', '#6f9b8f', '#c1697e'],
    line: '#fbeccf',
  },
];

export const DEFAULT_PALETTE = PALETTES[0]!;

/** #rrggbb → vec3 in [0,1]. */
export function hexToVec3(hex: string, out: Vec3 = vec3.create()): Vec3 {
  const h = hex.replace('#', '');
  out[0] = parseInt(h.slice(0, 2), 16) / 255;
  out[1] = parseInt(h.slice(2, 4), 16) / 255;
  out[2] = parseInt(h.slice(4, 6), 16) / 255;
  return out;
}

/** Blend two hex colours in sRGB and return a new hex string. */
export function mixHex(a: string, b: string, t: number): string {
  const av = hexToVec3(a);
  const bv = hexToVec3(b);
  const to = (x: number) =>
    Math.round(Math.max(0, Math.min(255, x * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(av[0]! + (bv[0]! - av[0]!) * t)}${to(av[1]! + (bv[1]! - av[1]!) * t)}${to(
    av[2]! + (bv[2]! - av[2]!) * t,
  )}`;
}

/** #rrggbb → an RGB triple in 0–255, for the CPU rasterizer. */
function hexToRgb255(hex: string): RGB {
  const v = hexToVec3(hex);
  return [v[0]! * 255, v[1]! * 255, v[2]! * 255];
}

/**
 * A resolved palette, cached per palette id: GPU-ready vec3s in 0–1 for
 * shaders, and RGB triples in 0–255 for any chapter using core/raster's
 * software rasterizer (ch.1 now; ch.6's poster mode later).
 */
export class InkSet {
  readonly palette: Palette;
  readonly paper: Vec3;
  readonly shadow: Vec3;
  readonly line: Vec3;
  readonly inks: Vec3[];

  readonly paperRgb: RGB;
  readonly lineRgb: RGB;
  private readonly inksRgb: RGB[];

  constructor(palette: Palette) {
    this.palette = palette;
    this.paper = hexToVec3(palette.paper);
    this.shadow = hexToVec3(palette.shadow);
    this.line = hexToVec3(palette.line);
    this.inks = palette.inks.map((c) => hexToVec3(c));

    this.paperRgb = hexToRgb255(palette.paper);
    this.lineRgb = hexToRgb255(palette.line);
    this.inksRgb = palette.inks.map(hexToRgb255);
  }

  /** Wraps, so callers can index by an arbitrary body number. */
  ink(index: number): Vec3 {
    return this.inks[((index % this.inks.length) + this.inks.length) % this.inks.length]!;
  }

  hex(index: number): string {
    const inks = this.palette.inks;
    return inks[((index % inks.length) + inks.length) % inks.length]!;
  }

  /** Same wrap-around indexing as ink(), as a 0–255 RGB triple. */
  rgb(index: number): RGB {
    return this.inksRgb[((index % this.inksRgb.length) + this.inksRgb.length) % this.inksRgb.length]!;
  }
}

/**
 * Publish the palette to CSS custom properties so the HUD, panels and labels
 * restyle themselves whenever the palette changes.
 */
export function applyPaletteToCss(palette: Palette, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--paper', palette.paper);
  root.style.setProperty('--shadow', palette.shadow);
  root.style.setProperty('--line', palette.line);
  palette.inks.forEach((ink, i) => root.style.setProperty(`--ink-${i}`, ink));
  root.style.setProperty('--ink', palette.inks[1] ?? palette.inks[0]!);
  root.style.setProperty('--line-dim', mixHex(palette.line, palette.paper, 0.55));
  root.style.setProperty('--line-faint', mixHex(palette.line, palette.paper, 0.78));
}
