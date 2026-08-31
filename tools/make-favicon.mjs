// Generates public/favicon.png: the four-pointed printed star from the star
// chart, amber ink on paper. No dependencies — the PNG is encoded by hand with
// node's own zlib, the same spirit as everything else in this repo.
//
//   node tools/make-favicon.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 64;
const PAPER = [10, 12, 19];    // #0a0c13
const INK = [255, 176, 58];    // #ffb03a
const LINE = [244, 233, 212];  // #f4e9d4

// --- the image ---------------------------------------------------------------

// A four-pointed star as the union of two thin diamonds, drawn with 4×4
// supersampled coverage so the spikes stay crisp at tab size.
const cx = 32, cy = 32;
const reach = 26;  // spike length from centre
const waist = 5.5; // half-thickness at the centre

function insideDiamond(x, y, longAxisX) {
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  const [along, across] = longAxisX ? [dx, dy] : [dy, dx];
  if (along > reach) return false;
  // Straight-edged taper: full waist at the centre, a point at the tip.
  return across <= waist * (1 - along / reach);
}

function coverage(px, py) {
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const x = px + (sx + 0.5) / 4;
      const y = py + (sy + 0.5) / 4;
      if (insideDiamond(x, y, true) || insideDiamond(x, y, false)) hits++;
    }
  }
  return hits / 16;
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const a = coverage(x, y);
    // A faint companion dot, upper right — the second star on the plate.
    const d = Math.hypot(x + 0.5 - 49, y + 0.5 - 15);
    const dot = Math.min(1, Math.max(0, 2.6 - d));
    const i = (y * SIZE + x) * 4;
    for (let c = 0; c < 3; c++) {
      let v = PAPER[c] + (INK[c] - PAPER[c]) * a;
      v = v + (LINE[c] - v) * dot * 0.8 * (1 - a);
      pixels[i + c] = Math.round(v);
    }
    pixels[i + 3] = 255;
  }
}

// --- PNG encoding ------------------------------------------------------------

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // truecolour + alpha
// compression 0, filter 0, interlace 0

// Scanlines, each prefixed with filter type 0 (none).
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(new URL('../public/favicon.png', import.meta.url), png);
console.log(`public/favicon.png: ${SIZE}×${SIZE}, ${png.length} bytes`);
