/**
 * The planet generator — the chapter's core, and (by design) the component
 * chapter 6 lifts verbatim. Everything that defines a world lives in
 * PlanetParams; everything that draws one lives in planet.vert/planet.frag
 * plus the biome ramp built here. The chapter file only wires UI around it.
 */

import { DEG, TAU, vec3, type Vec3 } from '../../core/math.ts';
import { bodyName, starName } from '../../core/names.ts';
import type { Rng } from '../../core/rng.ts';
import type { Program } from '../../gl/program.ts';
import type { InkSet } from '../../ui/palette.ts';
import type { OrbitalElements } from '../../core/kepler.ts';

export interface MoonParams {
  name: string;
  /** In planet radii. */
  radius: number;
  distance: number;
  /** Revolutions per visual-clock second. */
  rate: number;
  phase0: number;
  /** Radians off the equatorial plane. */
  inclination: number;
  inkIndex: number;
}

export interface RingParams {
  /** Radii in planet radii — the annulus mesh is built from these. */
  inner: number;
  outer: number;
  opacity: number;
  /** Offsets the ringlet noise so no two ring systems band alike. */
  seed: number;
}

/** Which palette inks print which part of the world. */
export interface InkScheme {
  ocean: number;
  low: number;
  high: number;
  atmo: number;
}

export interface PlanetParams {
  name: string;
  /** Where this world lives in the shared noise field — the seed, spatialized. */
  noiseOffset: Vec3;
  continentFreq: number;
  /** Domain-warp strength: how weathered the coastlines look. */
  warp: number;
  reliefFreq: number;
  reliefAmp: number;
  /** Mutable at runtime — the chapter's sliders write straight into these. */
  seaLevel: number;
  /** Polar cap extent as a fraction of |latitude|, 0–0.45. */
  iceCap: number;
  cloudCover: number;
  cloudFreq: number;
  /** Radians of cloud drift per visual-clock second. */
  cloudDriftRate: number;
  atmosphere: number;
  /** Radians. */
  axialTilt: number;
  /** Planet revolutions per visual-clock second. */
  spinRate: number;
  scheme: InkScheme;
  moons: MoonParams[];
  rings: RingParams | null;
  /**
   * The world's path around its star: real orbital elements, solved by the
   * shared Kepler module. Units are world units and visual seconds — `a` in
   * planet radii from the star, `period` in seconds at pace 1.
   */
  orbit: OrbitalElements;
}

/**
 * The star a world answers to. Rendered with the shared sun shader, whose
 * three-tone fire gradient (core → hot → flare) has to run dark-to-bright or
 * it stops reading as fire — so unlike the planet's ink scheme, the star
 * always uses that shader's fixed mapping (ink 2 → 1 → 0), the one ordering
 * guaranteed to hold across every palette. Class only varies size and corona
 * reach, never hue.
 */
export interface StarParams {
  name: string;
  /** In planet radii. */
  radius: number;
  corona: number;
}

/**
 * Three curated stellar classes — chosen rather than shuffled so every star
 * prints as a plausible object. Chapter 6 draws from the same well.
 */
const STAR_CLASSES = [
  { radius: [4.2, 6.5], corona: [0.45, 0.7] },  // main-sequence
  { radius: [3.0, 4.2], corona: [0.35, 0.55] }, // dwarf
  { radius: [5.5, 8.0], corona: [0.55, 0.85] }, // giant
] as const;

export function generateStar(rng: Rng): StarParams {
  const cls = rng.pick(STAR_CLASSES);
  return {
    name: starName(rng),
    radius: rng.range(cls.radius[0], cls.radius[1]),
    corona: rng.range(cls.corona[0], cls.corona[1]),
  };
}

/**
 * Curated ink assignments rather than random permutations: any of these reads
 * as a plausible silkscreened world, which a shuffled palette does not.
 * Indices are into the active palette's ink list (ferrous, for this chapter).
 */
const SCHEMES: InkScheme[] = [
  { ocean: 3, low: 1, high: 2, atmo: 3 }, // teal seas, amber-to-rust land
  { ocean: 4, low: 1, high: 2, atmo: 1 }, // violet seas under an amber haze
  { ocean: 3, low: 2, high: 4, atmo: 4 }, // rust lowlands rising to violet ranges
];

const NUMERALS = ['I', 'II', 'III'];

export function generatePlanet(rng: Rng): PlanetParams {
  const name = bodyName(rng);

  const moonCount = rng.int(0, 2);
  const moons: MoonParams[] = [];
  for (let i = 0; i < moonCount; i++) {
    const distance = 2.1 + i * 1.15 + rng.range(0, 0.5);
    moons.push({
      name: `${name} ${NUMERALS[i]!}`,
      radius: rng.range(0.07, 0.16),
      distance,
      // Kepler-flavoured: outer moons visibly slower.
      rate: 0.05 * Math.pow(2.5 / distance, 1.5),
      phase0: rng.range(0, TAU),
      inclination: rng.gaussian() * 4 * DEG,
      inkIndex: rng.bool(0.6) ? 0 : 4,
    });
  }

  const inner = rng.range(1.5, 1.8);

  return {
    name,
    noiseOffset: vec3.create(rng.range(-32, 32), rng.range(-32, 32), rng.range(-32, 32)),
    continentFreq: rng.range(1.7, 3.1),
    warp: rng.range(0.3, 0.9),
    reliefFreq: rng.range(4.5, 8),
    reliefAmp: rng.range(0.2, 0.42),
    seaLevel: rng.range(0.3, 0.68),
    iceCap: rng.power(0, 0.45, 1.6),
    cloudCover: rng.power(0, 0.65, 1.3),
    cloudFreq: rng.range(2.2, 3.6),
    cloudDriftRate: rng.range(0.006, 0.02),
    atmosphere: rng.range(0.4, 1),
    axialTilt: rng.range(0, 30) * DEG,
    spinRate: rng.range(0.012, 0.032),
    scheme: rng.pick(SCHEMES),
    moons,
    rings: rng.bool(0.28)
      ? {
          inner,
          outer: inner + rng.range(0.5, 1.1),
          opacity: rng.range(0.5, 0.85),
          seed: rng.range(0, 40),
        }
      : null,
    orbit: {
      a: rng.range(26, 48),
      e: rng.power(0, 0.24, 1.5),
      i: rng.gaussian() * 4,
      node: rng.range(0, 360),
      peri: rng.range(0, 360),
      L0: rng.range(0, 360),
      // "Days" are visual seconds here: one year in a few unhurried minutes.
      period: rng.range(160, 260),
    },
  };
}

/** A field-guide reading of the seeded numbers, for the label. */
export function classifyPlanet(p: PlanetParams): string {
  if (p.iceCap > 0.3) return 'glacial world';
  if (p.seaLevel > 0.62) return 'ocean world';
  if (p.seaLevel < 0.34) return 'desert world';
  if (p.cloudCover > 0.5) return 'veiled world';
  return 'temperate world';
}

/** Texels across the biome ramp. The shader needs the same number. */
export const RAMP_TEXELS = 16;

/**
 * The biome colour ramp as a 16×1 texture: texels 0–7 are ocean depths,
 * 8–15 climb from coast to peak. The shader remaps elevation so sea level
 * always lands exactly on the 7/8 boundary — the sea-level slider moves the
 * coastline without ever recolouring the ramp.
 */
export function buildRampColors(params: PlanetParams, inks: InkSet): Uint8Array {
  const scheme = params.scheme;
  const ocean = inks.ink(scheme.ocean);
  const low = inks.ink(scheme.low);
  const high = inks.ink(scheme.high);
  const cream = inks.ink(0);
  const shadow = inks.shadow;

  const mix3 = (a: Vec3, b: Vec3, t: number): [number, number, number] => [
    a[0]! + (b[0]! - a[0]!) * t,
    a[1]! + (b[1]! - a[1]!) * t,
    a[2]! + (b[2]! - a[2]!) * t,
  ];

  const bands: Array<[number, number, number]> = [
    // Ocean: four steps of the same ink sinking toward the shadow ink.
    mix3(ocean, shadow, 0.72), mix3(ocean, shadow, 0.72),
    mix3(ocean, shadow, 0.5), mix3(ocean, shadow, 0.5),
    mix3(ocean, shadow, 0.28), mix3(ocean, shadow, 0.28),
    mix3(ocean, shadow, 0), mix3(ocean, shadow, 0),
    // Land: a bright coast line, then lowland ink climbing to the highland
    // ink, capped with near-cream peaks.
    mix3(cream, low, 0.4),
    mix3(low, low, 0), mix3(low, low, 0),
    mix3(low, high, 0.5),
    mix3(high, high, 0), mix3(high, high, 0),
    mix3(high, cream, 0.35),
    mix3(high, cream, 0.7),
  ];

  const data = new Uint8Array(RAMP_TEXELS * 4);
  bands.forEach((c, i) => {
    data[i * 4] = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
    data[i * 4 + 3] = 255;
  });
  return data;
}

/**
 * The ramp as a GL texture. LINEAR filtering on purpose: the shader's
 * "stepped ink" mode sharpens the sample coordinate so bands stay hard with a
 * one-pixel antialiased seam, and its "blended" mode samples plainly — the
 * filtering comparison the controls expose.
 */
export function createRampTexture(
  gl: WebGL2RenderingContext,
  params: PlanetParams,
  inks: InkSet,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('worldsmith: createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA8, RAMP_TEXELS, 1, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, buildRampColors(params, inks),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/**
 * Push everything a PlanetParams defines into the planet program. Runtime
 * state — matrices, light, camera, clocks, shading mode, ramp texture unit —
 * stays with the caller, so chapter 6 can drive many planets with one program.
 */
export function applyPlanetUniforms(program: Program, params: PlanetParams, inks: InkSet): void {
  program
    .set('uNoiseOffset', params.noiseOffset)
    .set('uContinentFreq', params.continentFreq)
    .set('uWarp', params.warp)
    .set('uReliefFreq', params.reliefFreq)
    .set('uReliefAmp', params.reliefAmp)
    .set('uSeaLevel', params.seaLevel)
    .set('uIceCap', params.iceCap)
    .set('uCloudCover', params.cloudCover)
    .set('uCloudFreq', params.cloudFreq)
    .set('uAtmosphere', params.atmosphere)
    .set('uRampTexels', RAMP_TEXELS)
    .set('uInkShadow', inks.shadow)
    .set('uInkIce', inks.ink(0))
    .set('uInkCloud', inks.ink(0))
    .set('uInkGlint', inks.ink(0))
    .set('uInkAtmo', inks.ink(params.scheme.atmo));
}
