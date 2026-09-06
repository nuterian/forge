/**
 * Generates public/og.png: the link-preview card, 1200×630.
 *
 * Drawn by the project's own software rasterizer rather than by any image
 * tool — a real seeded sky from chapter 1, projected the way the Star Chart
 * projects it, with the title lettered in the chart's own stroke font. The
 * card that stands for the site is a plate the site could have printed.
 *
 *   node --experimental-strip-types tools/make-og.mts
 *
 * The PNG is encoded by hand with node's zlib, like the favicon.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

import { Raster, type RGB } from '../src/core/raster.ts';
import { DEG, TAU, vec3, type Vec3 } from '../src/core/math.ts';
import { generateSky } from '../src/chapters/01-star-chart/sky.ts';
import { InkSet, PALETTES } from '../src/ui/palette.ts';

const W = 1200;
const H = 630;
const SEED = 'VELA-2015';

const inks = new InkSet(PALETTES.find((p) => p.id === 'observatory')!);
const paper = inks.paperRgb;
const line = inks.lineRgb;

const raster = new Raster(W, H);
raster.clear(paper);

// --- the sky ------------------------------------------------------------------
// The chart's azimuthal projection, aimed at a stretch of sky with a few good
// figures in it, wide enough that the card is full of stars edge to edge.

const sky = generateSky(SEED);
const yaw = 2.35;
const pitch = 0.18;
const forward = vec3.create(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
const right = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), forward, vec3.create(0, 1, 0)));
const up = vec3.cross(vec3.create(), right, forward);
const halfFov = (150 * DEG) / 2;

const projected = { x: 0, y: 0, visible: false };
function project(dir: Vec3): void {
  const f = Math.min(1, Math.max(-1, vec3.dot(dir, forward)));
  const rx = vec3.dot(dir, right);
  const ry = vec3.dot(dir, up);
  const theta = Math.acos(f);
  const s = (theta / halfFov) * 0.46;
  const sinT = Math.hypot(rx, ry);
  const ux = sinT > 1e-6 ? rx / sinT : 0;
  const uy = sinT > 1e-6 ? ry / sinT : 0;
  projected.x = (0.5 + ux * s * (H / W)) * W;
  projected.y = (0.5 - uy * s) * H;
  projected.visible = theta < Math.PI * 0.999 && projected.x > -20 && projected.x < W + 20 && projected.y > -20 && projected.y < H + 20;
}

// Graticule, faint.
{
  const point = vec3.create();
  let px = 0, py = 0, pv = false;
  for (let ring = 1; ring < 6; ring++) {
    const phi = (ring / 6) * Math.PI;
    for (let s = 0; s <= 96; s++) {
      const theta = (s / 96) * TAU;
      vec3.set(point, Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      project(point);
      if (s > 0 && pv && projected.visible) raster.line(px, py, projected.x, projected.y, line, { alpha: 0.13 });
      px = projected.x; py = projected.y; pv = projected.visible;
    }
  }
  for (let m = 0; m < 12; m++) {
    const theta = (m / 12) * TAU;
    for (let s = 0; s <= 48; s++) {
      const phi = (s / 48) * Math.PI;
      vec3.set(point, Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      project(point);
      if (s > 0 && pv && projected.visible) raster.line(px, py, projected.x, projected.y, line, { alpha: 0.13 });
      px = projected.x; py = projected.y; pv = projected.visible;
    }
  }
}

// Stars, with the chart's radius and alpha rules and diamond spikes on the bright ones.
for (const star of sky.stars) {
  project(star.dir);
  if (!projected.visible) continue;
  const color = star.tint >= 0 ? inks.rgb(star.tint) : line;
  const radius = (0.5 + star.mag * star.mag * 3.2) * 1.15;
  const alpha = 0.55 + star.mag * 0.45;
  raster.dot(projected.x, projected.y, radius, color, alpha);
  if (star.mag > 0.88) {
    const s = radius * 3.4;
    const { x, y } = projected;
    raster.triangle(x - s, y, x, y - radius * 0.55, x, y + radius * 0.55, color, alpha * 0.6);
    raster.triangle(x + s, y, x, y - radius * 0.55, x, y + radius * 0.55, color, alpha * 0.6);
    raster.triangle(x, y - s, x - radius * 0.55, y, x + radius * 0.55, y, color, alpha * 0.6);
    raster.triangle(x, y + s, x - radius * 0.55, y, x + radius * 0.55, y, color, alpha * 0.6);
  }
}

// Figures, and their names.
for (const constellation of sky.constellations) {
  const color = inks.rgb(constellation.inkIndex);
  const points: number[] = [];
  for (const idx of constellation.chain) {
    project(sky.stars[idx]!.dir);
    if (projected.visible) points.push(projected.x, projected.y);
  }
  if (points.length >= 4) raster.splineStroke(points, color, { alpha: 0.55, bold: true });
  for (const [from, to] of constellation.branches) {
    project(sky.stars[from]!.dir);
    const ax = projected.x, ay = projected.y, av = projected.visible;
    project(sky.stars[to]!.dir);
    if (av && projected.visible) raster.lineBold(ax, ay, projected.x, projected.y, color, { alpha: 0.55 });
  }
  project(constellation.centroid);
  if (projected.visible) raster.text(projected.x + 14, projected.y - 22, constellation.name, 11, color, { alpha: 0.8 });
}

// --- the title block ----------------------------------------------------------
// Lettered in the stroke font. A Wu line is a hairline at any size, so the
// display sizes are struck several times a pixel apart, the way a heavy
// letter is built up on an engraved plate.

function letter(x: number, y: number, text: string, size: number, color: RGB, weight: number, alpha: number, tracking?: number): void {
  const r = weight / 2;
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy > r * r + 0.5) continue;
      raster.textCentered(x + dx, y + dy, text, size, color, { alpha, tracking });
    }
  }
}

{
  const cx = W / 2;
  const boxW = 720, boxH = 300;
  const x0 = cx - boxW / 2, y0 = H / 2 - boxH / 2 + 4;
  const x1 = x0 + boxW, y1 = y0 + boxH;

  // Paper behind the type, so the sky does not print through the title.
  raster.triangle(x0, y0, x1, y0, x1, y1, paper, 0.94, false);
  raster.triangle(x0, y0, x1, y1, x0, y1, paper, 0.94, false);
  for (const [inset, alpha] of [[0, 0.55], [6, 0.24]] as const) {
    const a = x0 + inset, b = y0 + inset, c = x1 - inset, d = y1 - inset;
    raster.line(a, b, c, b, line, { alpha }); raster.line(c, b, c, d, line, { alpha });
    raster.line(c, d, a, d, line, { alpha }); raster.line(a, d, a, b, line, { alpha });
  }
  const cut = 14;
  for (const [sx, sy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const dx = sx === x0 ? 1 : -1, dy = sy === y0 ? 1 : -1;
    raster.line(sx, sy + dy * cut, sx + dx * cut, sy, line, { alpha: 0.55 });
  }

  letter(cx, y0 + 44, 'THE', 22, line, 2, 0.75, 5);
  letter(cx, y0 + 92, 'FORGE', 118, inks.rgb(1), 7, 0.96, 3.2);
  raster.line(cx - 120, y0 + 236, cx + 120, y0 + 236, line, { alpha: 0.5 });
  letter(cx, y0 + 252, 'A GENERATED COSMOS', 15, line, 1, 0.8, 3.6);
}

// The colophon, in the bottom trim.
raster.text(48, H - 40, 'SIX CHAPTERS OF FUNDAMENTAL COMPUTER GRAPHICS', 10, line, { alpha: 0.55 });
{
  const s = `SEED ${SEED} · JUGALM.COM/FORGE`;
  raster.text(W - 48 - raster.measureText(s, 10), H - 40, s, 10, inks.rgb(1), { alpha: 0.8 });
}

// --- the press --------------------------------------------------------------------
// A vignette toward the paper, and the paper's own fibre — the print pass's
// two cheapest habits, so the card matches the pages it links to.

const data = raster.data;
let h = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const nx = (x / W - 0.5) * 2, ny = (y / H - 0.5) * 2;
    const falloff = Math.max(0, 1 - (nx * nx + ny * ny) * 0.32);
    // Static fibre, locked to a 2px grid and quantized to five levels: paper
    // texture, not noise — and deflate has to be able to fold it, since a
    // per-pixel random grain is what turns a 150 KB card into a 560 KB one.
    h = Math.imul(((x >> 1) * 7 + (y >> 1) * 131 + 2166136261) >>> 0, 16777619) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 16777619) >>> 0;
    const fibre = Math.round(((h >>> 8) / 16777216 - 0.5) * 4) * 2;
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      const v = paper[c]! + (data[i + c]! - paper[c]!) * falloff + fibre;
      data[i + c] = v;
    }
  }
}

// --- PNG ----------------------------------------------------------------------------

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf: Uint8Array): number {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type: string, body: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // truecolour, no alpha: the card is opaque paper

// Scanlines: filter byte 0, then RGB.
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  const row = y * (W * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    raw[row + 1 + x * 3] = data[i]!;
    raw[row + 2 + x * 3] = data[i + 1]!;
    raw[row + 3 + x * 3] = data[i + 2]!;
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = new URL('../public/og.png', import.meta.url);
writeFileSync(out, png);
console.log(`public/og.png: ${W}×${H}, ${(png.length / 1024).toFixed(0)} KB`);
