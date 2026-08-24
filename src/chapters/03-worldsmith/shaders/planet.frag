#version 300 es
precision highp float;

// A whole world in one fragment shader — the 2015 seeded Perlin-terrain
// generator, hand-rolled again and wrapped onto a sphere.
//
// The noise itself is no longer evaluated here: bake.frag rolls the seed's
// static fields into an equirectangular map once at load (see fields.glsl),
// and this shader reads them. Everything a control can still move stays
// live — sea level relocates the coastline, the ramp prints the biomes, the
// relief field bends the normal in tangent space, ice creeps, clouds drift,
// and the shading model itself is a switch.
//
// Chapter 6 reuses this shader verbatim; everything seeded arrives as
// uniforms via applyPlanetUniforms() and the baked map.

#include <math>
#include <ink>

uniform vec3  uLightPos;
uniform vec3  uCameraPos;
uniform mat3  uNormalMatrix;

uniform sampler2D uRamp;    // 16×1 biome ramp: texels 0–7 ocean, 8–15 land
uniform float uRampTexels;
// The baked fields: R+G height, B relief, A cloud. LINEAR, no mips, wrapping
// in u (the longitude seam) and clamped in v (the poles).
uniform sampler2D uFields;

uniform vec3  uInkShadow;
uniform vec3  uInkIce;
uniform vec3  uInkCloud;
uniform vec3  uInkAtmo;
uniform vec3  uInkGlint;

uniform float uReliefAmp;
uniform float uSeaLevel;
uniform float uIceCap;        // polar cap extent in |latitude|, 0–0.45
uniform float uCloudCover;
uniform float uCloudDrift;    // radians the cloud deck has drifted
uniform float uAtmosphere;

uniform float uRelief;        // runtime bump multiplier
uniform float uShadeMode;     // 0 banded ink, 1 lambert, 2 blinn-phong
uniform float uBands;
uniform float uSoftness;
uniform float uFilterMode;    // 0 stepped ink (sharpened), 1 blended (linear)

in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vObjectPos;

out vec4 fragColor;

// --- the baked map ----------------------------------------------------------

// Direction on the unit sphere → the map's coordinates. The inverse of
// bake.frag's texel → direction. Nothing downstream ever takes a derivative of
// this: u is discontinuous at the ±π seam even though the field it addresses
// is not, so AA widths come from the sampled *values* instead.
vec2 sphereUv(vec3 p) {
  return vec2(atan(p.z, p.x) / TAU + 0.5, asin(clamp(p.y, -1.0, 1.0)) / PI + 0.5);
}

// One height texel, decoded from its two bytes. texelFetch ignores the
// sampler's wrap mode, so the wrap is done here: longitude comes back around,
// latitude stops at the pole row.
float heightTexel(ivec2 c) {
  ivec2 size = textureSize(uFields, 0);
  c.x = (c.x % size.x + size.x) % size.x;
  c.y = clamp(c.y, 0, size.y - 1);
  vec2 bytes = texelFetch(uFields, c, 0).rg;
  return bytes.r + bytes.g / 255.0;
}

// Height, blended by hand. The hardware would filter the two bytes
// independently — nonsense wherever the high byte steps — so the four texels
// are decoded first and interpolated after. Relief and cloud have a channel
// each and take plain hardware LINEAR.
float heightAt(vec2 uv) {
  vec2 t = uv * vec2(textureSize(uFields, 0)) - 0.5;
  vec2 f = fract(t);
  ivec2 b = ivec2(floor(t));
  return mix(
    mix(heightTexel(b), heightTexel(b + ivec2(1, 0)), f.x),
    mix(heightTexel(b + ivec2(0, 1)), heightTexel(b + ivec2(1, 1)), f.x),
    f.y);
}

// --- the biome ramp -----------------------------------------------------------

// Fetch one ramp texel, clamped to the ramp's ends.
vec3 rampTexel(float i) {
  int n = int(uRampTexels);
  return texelFetch(uRamp, ivec2(clamp(int(i), 0, n - 1), 0), 0).rgb;
}

// Sample the ramp. Stepped mode is nearest-neighbour with a one-pixel
// antialiased seam: band boundaries sit at integer texel coordinates, and the
// blend width comes from screen-space derivatives of the *continuous*
// coordinate — never of anything fract()'d. Blended mode is plain hardware
// LINEAR, the filtering comparison the panel exposes.
vec3 sampleRamp(float t) {
  if (uFilterMode > 0.5) {
    return texture(uRamp, vec2(clamp(t, 0.0, 1.0), 0.5)).rgb;
  }
  float x = clamp(t, 0.0, 1.0) * uRampTexels;
  float aa = clamp(fwidth(x) * 0.6, 1e-4, 0.5);
  float boundary = floor(x + 0.5);
  float m = smoothstep(-aa, aa, x - boundary);
  return mix(rampTexel(boundary - 1.0), rampTexel(boundary), m);
}

void main() {
  vec3 p = normalize(vObjectPos);
  vec2 uv = sphereUv(p);

  // --- elevation -----------------------------------------------------------
  float h = heightAt(uv);
  float r0 = texture(uFields, uv).b;

  // Sea-relative ramp coordinate: sea level always maps to the ramp's ocean/
  // land boundary, so the slider moves coastlines, not colours.
  float t = h < uSeaLevel
    ? 0.5 * h / max(uSeaLevel, 1e-3)
    : 0.5 + 0.5 * (h - uSeaLevel) / max(1.0 - uSeaLevel, 1e-3);

  float land = smoothstep(uSeaLevel - 0.004, uSeaLevel + 0.004, h);

  vec3 surfInk = sampleRamp(t);

  // --- ice caps --------------------------------------------------------------
  // The cap edge follows |latitude| wobbled by the relief field, so it meanders
  // like pack ice instead of cutting a ruler line across the globe.
  float iceField = abs(p.y) + (r0 - 0.5) * 0.3;
  float iceLine = 1.0 - uIceCap * 2.0;
  float iceAa = max(fwidth(iceField) * 1.5, 0.003);
  float ice = uIceCap < 1e-3 ? 0.0 : smoothstep(iceLine, iceLine + iceAa, iceField);
  surfInk = mix(surfInk, uInkIce, ice);

  // --- normal mapping in tangent space ---------------------------------------
  // Build the sphere's tangent frame (east, north), re-read the relief field a
  // step along each axis, and tip the object-space normal by the slope. The
  // perturbed normal then goes through the same normal matrix as the vertex one.
  //
  // The taps are the same arc apart as they were when relief() was evaluated
  // here directly; converting that arc into map coordinates is where the
  // latitude divisor comes from (meridians crowd together toward the poles).
  vec3 eastRaw = cross(vec3(0.0, 1.0, 0.0), p);
  vec3 east = length(eastRaw) > 1e-4 ? normalize(eastRaw) : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(p, east);

  vec3 shadeN = normalize(vNormal);
  float bumpAmp = uReliefAmp * uRelief * land;
  if (bumpAmp > 1e-3) {
    const float EPS = 0.025;
    float cosLat = max(sqrt(max(1.0 - p.y * p.y, 0.0)), 1e-3);
    // east runs toward decreasing longitude, north toward increasing latitude.
    float du = min(EPS / (TAU * cosLat), 0.25);
    float dv = EPS / PI;
    float dE = texture(uFields, vec2(uv.x - du, uv.y)).b - r0;
    float dN = texture(uFields, vec2(uv.x, uv.y + dv)).b - r0;
    vec3 bumped = normalize(p - (east * dE + north * dN) * (bumpAmp * 0.55 / EPS));
    shadeN = normalize(uNormalMatrix * bumped);
  }

  // --- lighting ---------------------------------------------------------------
  vec3 lightDir = normalize(uLightPos - vWorldPos);
  vec3 viewDir = normalize(uCameraPos - vWorldPos);
  vec3 sphereN = normalize(vNormal);

  // The bump is strong enough to tip a fragment across the day/night boundary
  // on its own, and a band edge that wanders by one fragment prints as black
  // flecks scattered along the lit limb. So the bump's say in N·L fades out as
  // the *unperturbed* N·L approaches zero: the terminator stays one clean edge
  // where the geometry puts it, and relief keeps all its bite in full light.
  float baseNdl = dot(sphereN, lightDir);
  float ndl = mix(baseNdl, dot(shadeN, lightDir), smoothstep(0.02, 0.25, baseNdl));

  // Water and ice are the glossy surfaces; land prints matte.
  float gloss = (1.0 - land) * (1.0 - ice * 0.6) + ice * 0.25;

  vec3 color;
  if (uShadeMode < 0.5) {
    // The house style: two inks, hard steps.
    color = inkShade(uInkShadow, surfInk, ndl, uBands, uSoftness);
    // One banded glint where the sun strikes open water.
    vec3 halfway = normalize(lightDir + viewDir);
    float spec = pow(max(dot(shadeN, halfway), 0.0), 110.0);
    color += uInkGlint * posterize(spec, 2.0) * gloss * 0.4 * step(0.0, ndl);
  } else if (uShadeMode < 1.5) {
    color = mix(uInkShadow, surfInk, clamp(ndl, 0.0, 1.0));
  } else {
    vec3 halfway = normalize(lightDir + viewDir);
    float spec = pow(max(dot(shadeN, halfway), 0.0), mix(28.0, 130.0, gloss));
    color = mix(uInkShadow, surfInk, clamp(ndl, 0.0, 1.0)) + uInkGlint * spec * mix(0.1, 0.65, gloss);
  }

  // --- clouds ------------------------------------------------------------------
  // The deck rotates independently of the surface. Baked undrifted, that
  // rotation about Y is exactly a shift in longitude — one texture offset.
  // Lit by the smooth sphere normal: the deck rides above the relief.
  if (uCloudCover > 1e-3) {
    float cl = texture(uFields, vec2(uv.x + uCloudDrift / TAU, uv.y)).a;
    float threshold = 0.9 - uCloudCover * 0.7;
    float cloudAa = max(fwidth(cl) * 1.2, 0.004);
    float cloud = smoothstep(threshold, threshold + cloudAa, cl);

    float cloudNdl = dot(sphereN, lightDir);
    vec3 cloudColor = uShadeMode < 0.5
      ? inkShade(uInkShadow, uInkCloud, cloudNdl, max(uBands - 1.0, 2.0), uSoftness)
      : mix(uInkShadow, uInkCloud, clamp(cloudNdl, 0.0, 1.0));
    color = mix(color, cloudColor, cloud * 0.92);
  }

  // --- atmosphere ---------------------------------------------------------------
  // A banded rim that only lights where the sun actually reaches, so a crescent
  // world glows along its lit limb and stays dark along the night one.
  if (uAtmosphere > 1e-3) {
    float rim = inkRim(sphereN, viewDir, 2.2, 4.0);
    float facing = smoothstep(-0.08, 0.5, dot(sphereN, lightDir));
    color += uInkAtmo * rim * facing * uAtmosphere * 0.5;
  }

  fragColor = vec4(color, 1.0);
}
