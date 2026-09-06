/**
 * Drawing the planet — the GL half of Worldsmith. The parameters that define a
 * world are decided in params.ts from one Rng; this file turns them into the
 * biome ramp, the baked field map and the planet program's uniforms. The
 * chapter file only wires UI around the two.
 */

import type { Vec3 } from '../../core/math.ts';
import { Framebuffer } from '../../gl/framebuffer.ts';
import { fullscreenTriangle } from '../../gl/geometry.ts';
import { Program, registerChunk } from '../../gl/program.ts';
import type { InkSet } from '../../ui/palette.ts';
import type { PlanetParams } from './params.ts';

import fieldsChunk from './shaders/fields.glsl?raw';
import bakeVert from '../../shaders/post.vert?raw';
import bakeFrag from './shaders/bake.frag?raw';

// The noise fields are one piece of GLSL with two readers — the bake pass
// below, and (should chapter 6 ever want a field value on the fly) anything
// else that includes them. Registering at module scope means any Program
// built after this module is imported can `#include <planet-fields>`.
registerChunk('planet-fields', fieldsChunk);

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
    // The noise frequencies are gone: they were baked into the field map, and
    // everything left here is something a control can still move.
    .set('uReliefAmp', params.reliefAmp)
    .set('uSeaLevel', params.seaLevel)
    .set('uIceCap', params.iceCap)
    .set('uCloudCover', params.cloudCover)
    .set('uAtmosphere', params.atmosphere)
    .set('uRampTexels', RAMP_TEXELS)
    .set('uInkShadow', inks.shadow)
    .set('uInkIce', inks.ink(0))
    .set('uInkCloud', inks.ink(0))
    .set('uInkGlint', inks.ink(0))
    .set('uInkAtmo', inks.ink(params.scheme.atmo));
}

// -- the baked field map ------------------------------------------------------

/**
 * The map's size. An equirectangular map wants twice the width of its height,
 * and this is the resolution at which the finest relief octave still lands
 * roughly two texels wide — the bump reads it, so undersampling it shows.
 */
export const FIELD_MAP_WIDTH = 1024;
export const FIELD_MAP_HEIGHT = FIELD_MAP_WIDTH / 2;

/** The seed's noise parameters — the bake pass's entire input. */
function applyFieldUniforms(program: Program, params: PlanetParams): void {
  program
    .set('uNoiseOffset', params.noiseOffset)
    .set('uContinentFreq', params.continentFreq)
    .set('uWarp', params.warp)
    .set('uReliefFreq', params.reliefFreq)
    .set('uReliefAmp', params.reliefAmp)
    .set('uCloudFreq', params.cloudFreq);
}

/**
 * Roll the seed's static fields into an equirectangular map, once.
 *
 * Height, relief and cloud cost about twenty-nine octaves of value noise
 * between them, and none of them changes after the seed is drawn — so paying
 * for them per fragment per frame was paying for the same answer sixty times a
 * second. One offscreen fullscreen pass at load answers them for good; every
 * control the panel exposes still runs live against the result.
 *
 * The caller owns the returned target and must dispose it. Its texture wraps
 * in u, because the map's left and right edges are the same meridian, and
 * clamps in v.
 */
export function bakePlanetFields(gl: WebGL2RenderingContext, params: PlanetParams): Framebuffer {
  const target = new Framebuffer(gl, FIELD_MAP_WIDTH, FIELD_MAP_HEIGHT, { samples: 0, depth: false });
  const program = Program.cached(gl, bakeVert, bakeFrag, 'worldsmith.bake');
  const quad = fullscreenTriangle(gl);

  target.bind();
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  program.use();
  applyFieldUniforms(program, params);
  quad.draw();

  // Set once, after the render: Framebuffer only recreates its texture on a
  // resize, and this target never resizes.
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  quad.dispose();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.enable(gl.CULL_FACE);
  return target;
}
