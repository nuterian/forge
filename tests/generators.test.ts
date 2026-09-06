/**
 * Same seed, same sky, forever.
 *
 * Every generator in the project draws from one Rng in an order that is fixed
 * for good — a single extra draw in the wrong place moves every star after
 * it, silently, and breaks every seed URL anyone has ever shared. These tests
 * pin each generator's output for fixed seeds to a committed fingerprint.
 *
 * When one fails, the question is not "how do I make it pass" but "did I mean
 * to change every sky ever printed?" If yes — a deliberate change to a
 * generator — update the fingerprint in the same commit and say so. If no, a
 * draw slipped in somewhere, and the fix is to move it onto its own stream
 * (`new Rng(\`something:${seed}\`)`), the way deepsky.ts and the ink plates do.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng, hashString, randomSeedString } from '../src/core/rng.ts';
import { constellationName, starName, bodyName } from '../src/core/names.ts';
import { generateSky } from '../src/chapters/01-star-chart/sky.ts';
import { generateDeepSky } from '../src/chapters/01-star-chart/deepsky.ts';
import { classifyPlanet, generatePlanet, generateStar } from '../src/chapters/03-worldsmith/params.ts';
import { fingerprint } from './fingerprint.ts';

test('the seed hash and the Rng stream are bit-exact', () => {
  assert.equal(hashString('VELA-2015'), 2569835138);
  assert.equal(hashString(''), 2166136261, 'the FNV offset basis, for an empty seed');

  const rng = new Rng('VELA-2015');
  assert.deepEqual(
    [rng.next(), rng.next(), rng.next()],
    [0.7980812378227711, 0.1493796636350453, 0.8188047760631889],
  );
  assert.equal(fingerprint(Array.from({ length: 64 }, () => rng.next())), '99e42cffe8a05b27');

  // A numeric seed of zero must not produce a dead generator.
  const zero = new Rng(0);
  assert.notEqual(zero.next(), zero.next());
});

test('randomSeedString reads like a seed', () => {
  for (let i = 0; i < 20; i++) assert.match(randomSeedString(), /^[A-Z]+-[0-9A-F]{4}$/);
});

test('the sky catalogue is what it always was', () => {
  const vela = generateSky('VELA-2015');
  assert.equal(vela.stars.length, 3862);
  assert.equal(vela.constellations.length, 10);
  assert.equal(vela.inks.name, 'Duotone');
  assert.equal(fingerprint(vela), 'bda301cca78f5e84');

  const arc = generateSky('ARC-0001');
  assert.equal(arc.stars.length, 3874);
  assert.equal(arc.constellations.length, 12);
  assert.equal(arc.inks.name, 'Wide plate');
  assert.equal(fingerprint(arc), '9623ea2c6038328c');
});

test('the sky is well-formed for any seed', () => {
  for (const seed of ['VELA-2015', 'ARC-0001', 'KEPLER-1AAD', 'x', '']) {
    const sky = generateSky(seed);
    for (const star of sky.stars) {
      const len = Math.hypot(star.dir[0]!, star.dir[1]!, star.dir[2]!);
      assert.ok(Math.abs(len - 1) < 1e-5, `${seed}: a star direction is not unit length`);
      assert.ok(star.mag >= 0 && star.mag <= 1);
    }
    for (const c of sky.constellations) {
      assert.ok(c.chain.length >= 4 && c.chain.length <= 8);
      assert.equal(new Set(c.chain).size, c.chain.length, 'a figure visits each star once');
      for (const idx of c.chain) assert.ok(idx >= 0 && idx < sky.stars.length);
      // Ink 0 is the stars' own line ink; a figure the same colour as the field it
      // crosses is a figure nobody can follow.
      assert.notEqual(c.inkIndex, 0);
      for (const [from, to] of c.branches) {
        assert.ok(c.chain.includes(from) && c.chain.includes(to));
      }
    }
  }
});

test('deep-sky objects are what they always were', () => {
  const vela = generateDeepSky('VELA-2015');
  assert.deepEqual(vela.map((o) => o.kind), ['cluster']);
  assert.equal(fingerprint(vela), '1e7657d1ae229f19');

  // ARC-0001 grows a comet, so the rarest builder is covered too.
  const arc = generateDeepSky('ARC-0001');
  assert.deepEqual(arc.map((o) => o.kind), ['cluster', 'comet']);
  assert.equal(fingerprint(arc), '701cf76a1f93d41a');

  for (const object of [...vela, ...arc]) {
    assert.equal(object.points.length, object.radii.length * 3);
    assert.equal(object.alphas.length, object.radii.length);
  }
});

test('the deep sky is its own stream: it cannot move a star', () => {
  // Generating the deep sky first, or twice, changes nothing about the catalogue.
  const before = fingerprint(generateSky('VELA-2015'));
  generateDeepSky('VELA-2015');
  generateDeepSky('VELA-2015');
  assert.equal(fingerprint(generateSky('VELA-2015')), before);
});

test('the star and its world are what they always were', () => {
  // The chapter draws the star first and the planet second, from one stream.
  const vela = new Rng('VELA-2015');
  const velaSystem = { star: generateStar(vela), planet: generatePlanet(vela) };
  assert.equal(velaSystem.planet.name, 'SAlu');
  assert.equal(velaSystem.planet.moons.length, 1);
  assert.equal(velaSystem.planet.rings, null);
  assert.equal(classifyPlanet(velaSystem.planet), 'temperate world');
  assert.equal(fingerprint(velaSystem), '86ea814489ddf224');

  const arc = new Rng('ARC-0001');
  const arcSystem = { star: generateStar(arc), planet: generatePlanet(arc) };
  assert.equal(arcSystem.planet.name, 'Irio');
  assert.equal(fingerprint(arcSystem), '78d89605a916f6cd');
});

test('every world is plausible', () => {
  for (let i = 0; i < 40; i++) {
    const rng = new Rng(`world-${i}`);
    const star = generateStar(rng);
    const p = generatePlanet(rng);
    assert.ok(star.radius >= 3 && star.radius <= 8);
    assert.ok(p.seaLevel > 0 && p.seaLevel < 1);
    assert.ok(p.orbit.a > star.radius * 2, 'the planet orbits well outside its star');
    assert.ok(p.orbit.e >= 0 && p.orbit.e < 0.25);
    for (const moon of p.moons) assert.ok(moon.distance > 2, 'moons clear the planet');
    if (p.rings) assert.ok(p.rings.outer > p.rings.inner && p.rings.inner > 1);
  }
});

test('invented names are what they always were', () => {
  const rng = new Rng('names');
  assert.equal(
    fingerprint([constellationName(rng), starName(rng), bodyName(rng), constellationName(rng)]),
    '6d838f578839449f',
  );
});
