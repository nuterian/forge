/**
 * The hand-rolled engine: the software rasterizer, Kepler's problem, splines,
 * the OBJ parser and the ink palettes. Where a real answer exists (planet
 * positions at J2000) the code is checked against it; where the output is the
 * artefact (a rasterized plate) it is checked against itself, byte for byte.
 *
 * The raster fingerprint is the one that makes "optimized, bit-identically" a
 * claim that can be checked rather than asserted: any change to a primitive
 * that alters a single channel of a single pixel moves it.
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Raster, type RGB } from '../src/core/raster.ts';
import { positionAt, positionAtAnomaly, meanAnomalyAt, eccentricAnomaly, satelliteOffset, daysFromDate, dateFromDays } from '../src/core/kepler.ts';
import { PLANETS } from '../src/chapters/02-orrery/bodies.ts';
import { Spline } from '../src/core/spline.ts';
import { vec3, TAU } from '../src/core/math.ts';
import { parseObj, normalizeGeometry } from '../src/gl/obj.ts';
import { InkSet, PALETTES, mixHex } from '../src/ui/palette.ts';
import { fingerprint, fingerprintBytes } from './fingerprint.ts';

const PAPER: RGB = [10, 12, 19];
const LINE: RGB = [244, 233, 212];
const INK: RGB = [255, 176, 58];

/** One of everything the rasterizer draws, on a small plate. */
function plate(): Raster {
  const r = new Raster(160, 96);
  r.clear(PAPER);
  r.line(4.3, 5.7, 150.2, 40.9, LINE, { alpha: 0.8, aa: true });
  r.line(4.3, 90.1, 150.2, 55.4, LINE, { alpha: 0.8, aa: false });
  r.lineBold(20, 20, 60, 80, INK, { alpha: 0.9 });
  r.triangle(70.5, 10.2, 120.8, 30.1, 90.3, 60.7, INK, 0.7, true);
  r.triangle(100.5, 60.2, 150.8, 70.1, 120.3, 90.7, LINE, 0.5, false);
  r.dot(30.5, 50.5, 0.4, LINE, 1, true);
  r.dot(40.2, 50.7, 3.3, INK, 0.9, true);
  r.dot(52.6, 50.1, 2.6, LINE, 0.6, false);
  r.ring(80, 50, 9.5, LINE, 0.7, true);
  r.splineStroke([10, 70, 30, 60, 50, 75, 70, 62, 90, 80], INK, { alpha: 0.6, bold: true });
  r.text(6, 6, 'Uranographia 0123 · 90°', 6.4, LINE, { alpha: 0.85 });
  r.textCentered(80, 84, 'PLATE', 8, INK, { alpha: 0.7, aa: false, tracking: 2.2 });
  return r;
}

test('the rasterizer prints the same plate, byte for byte', () => {
  const r = plate();
  assert.equal(fingerprintBytes(r.data), 'e8338c6651ca05e6');
  // One pixel spelled out, so a failure here points at a channel and not a hash.
  const i = (50 * r.width + 40) * 4;
  assert.deepEqual(Array.from(r.data.slice(i, i + 4)), [253, 174, 58, 255], 'the centre of the amber dot');
});

test('the rasterizer respects its edges and its alpha', () => {
  const r = new Raster(8, 8);
  r.clear(PAPER);
  // Drawing far outside the buffer is a no-op, not a write past the end.
  r.line(-50, -50, 200, 200, LINE);
  r.dot(-3, 4, 2, LINE);
  r.triangle(100, 100, 120, 100, 110, 130, LINE);
  r.text(-40, -40, 'OUT', 6, LINE);
  const after = fingerprintBytes(r.data);
  r.clear(PAPER);
  r.line(-50, -50, 200, 200, LINE);
  assert.equal(fingerprintBytes(r.data), after, 'off-plate primitives leave nothing behind');

  // Alpha above one clamps; alpha at zero draws nothing.
  r.clear(PAPER);
  r.blend(2, 2, LINE, 7);
  assert.deepEqual(Array.from(r.data.slice((2 * 8 + 2) * 4, (2 * 8 + 2) * 4 + 3)), [244, 233, 212]);
  r.blend(3, 3, LINE, 0);
  assert.deepEqual(Array.from(r.data.slice((3 * 8 + 3) * 4, (3 * 8 + 3) * 4 + 3)), [10, 12, 19]);
});

test('snapshot and restore round-trip the plate exactly', () => {
  const r = plate();
  const before = fingerprintBytes(r.data);
  const snap = r.snapshot();
  r.clear(INK);
  assert.notEqual(fingerprintBytes(r.data), before);
  r.restore(snap);
  assert.equal(fingerprintBytes(r.data), before);
});

test('measureText agrees with what text() advances by', () => {
  const r = new Raster(400, 40);
  for (const [s, size] of [['URANOGRAPHIA', 9.5], ['F 101', 6.4], ['N', 7], ['', 5]] as const) {
    assert.ok(Math.abs(r.text(0, 0, s, size, LINE) - r.measureText(s, size)) < 1e-9, s);
  }
});

test('Kepler puts the planets where JPL says they were at J2000', () => {
  // Heliocentric ecliptic x, y in AU at 2000-01-01 12:00 TT. Our world frame
  // stores the ecliptic plane in x and z, so y (ecliptic) is out[2].
  const expected: Record<string, [number, number]> = {
    mercury: [-0.1300, -0.4472],
    venus: [-0.7183, -0.0327],
    earth: [-0.1771, 0.9672],
    mars: [1.3907, -0.0134],
  };
  const out = vec3.create();
  for (const [id, [x, y]] of Object.entries(expected)) {
    const body = PLANETS.find((p) => p.id === id)!;
    positionAt(out, body.elements, 0);
    assert.ok(Math.abs(out[0]! - x) < 2e-3, `${id} x: ${out[0]} vs ${x}`);
    assert.ok(Math.abs(out[2]! - y) < 2e-3, `${id} y: ${out[2]} vs ${y}`);
  }
});

test('the Kepler solver inverts its own equation', () => {
  for (const e of [0, 0.05, 0.2, 0.6, 0.93]) {
    for (let k = 0; k < 24; k++) {
      const m = (k / 24) * TAU - Math.PI;
      const E = eccentricAnomaly(m, e);
      assert.ok(Math.abs(E - e * Math.sin(E) - m) < 1e-9, `e=${e} M=${m}`);
    }
  }
});

test('an orbit sampled by anomaly passes through the body', () => {
  const earth = PLANETS.find((p) => p.id === 'earth')!.elements;
  const a = vec3.create();
  const b = vec3.create();
  for (const days of [0, 100.5, 3650.25, -800]) {
    positionAt(a, earth, days);
    positionAtAnomaly(b, earth, meanAnomalyAt(earth, days));
    assert.ok(vec3.dist(a, b) < 1e-9);
    assert.ok(Math.abs(vec3.len(a) - 1) < 0.02, 'Earth stays about one AU out');
  }
});

test('satellite offsets keep their distance, and the epoch round-trips', () => {
  const out = vec3.create();
  for (const angle of [0, 1, 2.5, 5]) {
    satelliteOffset(out, angle, 3.2, 0.4);
    assert.ok(Math.abs(vec3.len(out) - 3.2) < 1e-6);
  }
  const date = new Date(Date.UTC(2026, 8, 5, 20, 0, 0));
  assert.equal(dateFromDays(daysFromDate(date)).getTime(), date.getTime());
});

test('the Catmull-Rom spline is what it always was, and runs end to end', () => {
  const spline = new Spline(
    [vec3.create(0, 0, 0), vec3.create(1, 2, 0), vec3.create(3, 1, -1), vec3.create(4, 3, 2)],
    false, 16,
  );
  assert.equal(fingerprint(spline.sample(24)), '62078aa73d51478f');
  assert.equal(spline.length, 8.64724601478762);

  const p = vec3.create();
  assert.ok(vec3.dist(spline.atDistance(p, 0), spline.points[0]!) < 1e-6);
  // at() clamps the parameter a hair inside the last segment, so the end lands
  // near the last point rather than exactly on it.
  assert.ok(vec3.dist(spline.atDistance(p, 1), spline.points[3]!) < 1e-4);

  // Constant speed: equal steps in u are equal steps in distance.
  const a = vec3.create();
  const b = vec3.create();
  const steps: number[] = [];
  for (let i = 0; i < 20; i++) {
    spline.atDistance(a, i / 20);
    spline.atDistance(b, (i + 1) / 20);
    steps.push(vec3.dist(a, b));
  }
  const mean = steps.reduce((s, x) => s + x, 0) / steps.length;
  // Measured at 4.6% for this path: what is left is chord-versus-arc error in
  // the 20-step measurement itself, not the table.
  for (const s of steps) assert.ok(Math.abs(s - mean) / mean < 0.08, 'arc-length table holds speed within 8%');
});

test('the OBJ parser reads the probe, and small files exactly', () => {
  const geo = normalizeGeometry(parseObj(readFileSync(new URL('../public/probe.obj', import.meta.url), 'utf8')), 1);
  assert.equal(geo.positions.length / 3, 235);
  assert.equal(geo.indices.length / 3, 416);
  assert.equal(fingerprint(geo), '51bb7d5ad78df3fa');

  // Quads fan into two triangles; negative indices count from the end; missing
  // normals are computed, area-weighted, and unit length.
  const quad = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\nf -4 -3 -2\n');
  assert.equal(quad.positions.length / 3, 4);
  assert.deepEqual(Array.from(quad.indices), [0, 1, 2, 0, 2, 3, 0, 1, 2]);
  for (let i = 0; i < quad.normals.length; i += 3) {
    assert.ok(Math.abs(quad.normals[i + 2]! - 1) < 1e-6, 'a flat quad in XY faces +Z');
  }
});

test('ink palettes resolve consistently for the GPU and the CPU', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  for (const palette of PALETTES) {
    const inks = new InkSet(palette);
    assert.equal(inks.inks.length, palette.inks.length);
    for (let i = 0; i < palette.inks.length; i++) {
      const gpu = inks.ink(i);
      const cpu = inks.rgb(i);
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(gpu[c]! * 255 - cpu[c]!) < 1e-3);
      assert.equal(inks.ink(i + palette.inks.length), gpu, 'indices wrap');
      assert.equal(inks.hex(-1), palette.inks[palette.inks.length - 1]);
    }
  }
});
