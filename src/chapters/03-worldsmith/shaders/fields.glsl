// The world's noise fields — the expensive half of the planet, and the half
// that never changes once a seed is drawn. Registered as `<planet-fields>` by
// planet.ts and included by the bake pass, which evaluates all of this once
// into an equirectangular map; the live shader reads that map instead.
//
// Include `<math>` before this — fbm() lives there, and declaring it twice is
// a compile error.

uniform vec3  uNoiseOffset;   // the seed, spatialized
uniform float uContinentFreq;
uniform float uWarp;
uniform float uReliefFreq;
uniform float uReliefAmp;
uniform float uCloudFreq;

// Continents: FBM sampled through an FBM-warped domain. The warp is what
// turns fractal blobs into coastlines that look weathered rather than noisy.
float continents(vec3 p) {
  vec3 q = vec3(
    fbm(p, 3, 2.0, 0.5),
    fbm(p + vec3(5.2, 1.3, 2.7), 3, 2.0, 0.5),
    fbm(p + vec3(1.7, 9.2, 4.1), 3, 2.0, 0.5));
  return fbm(p + q * uWarp * 2.0, 4, 2.05, 0.5);
}

// Mountain-scale detail, kept separate: it is both the top end of the height
// field and, on its own, the bump source.
float relief(vec3 p) {
  return fbm(p * uReliefFreq + uNoiseOffset.yzx, 4, 2.15, 0.55);
}

// The cloud deck, baked undrifted — the deck's rotation about Y is exactly a
// shift in longitude, so the live shader drifts it by offsetting u.
float clouds(vec3 p) {
  return fbm(p * uCloudFreq + uNoiseOffset.zxy, 4, 2.3, 0.55);
}

/**
 * Everything a direction on the unit sphere is worth knowing, in one go:
 *   x = h, the combined height (continents plus relief, sea-level agnostic)
 *   y = r, the raw relief field — bump source and ice-edge wobble
 *   z = the cloud field
 */
vec3 planetFields(vec3 dir) {
  float r = relief(dir);
  float h = clamp(continents(dir * uContinentFreq + uNoiseOffset) + (r - 0.5) * uReliefAmp, 0.0, 1.0);
  return vec3(h, r, clouds(dir));
}
