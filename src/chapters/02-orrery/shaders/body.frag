#version 300 es
precision highp float;

// Planets and moons. One light (the sun, at the origin), quantized into a
// handful of ink levels. The whole "look" of the chapter is three lines of
// posterize() plus a rim term.

#include <math>
#include <ink>

uniform vec3  uLightPos;
uniform vec3  uCameraPos;

uniform vec3  uInkShadow;
uniform vec3  uInkBase;
uniform vec3  uInkHighlight;

uniform float uBands;       // number of light steps
uniform float uSoftness;    // how hard the terminator is
uniform float uAtmosphere;  // rim strength
uniform int   uStyle;       // 0 rocky, 1 banded, 2 icy
uniform float uPattern;     // surface pattern strength
uniform float uShadeMode;   // 0 banded ink, 1 lambert, 2 blinn-phong

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in vec3 vObjectPos;

out vec4 fragColor;

// Surface markings in object space. Deliberately cheap: this chapter is about
// transforms, not texturing — chapter 3 is where surfaces get their due.
float surfacePattern(vec3 p) {
  if (uStyle == 1) {
    // Gas giant: latitude bands, warped so they don't read as a barcode.
    float warp = fbm(p * 2.4) * 0.35;
    float lat = p.y * 6.0 + warp * 3.0;
    float bands = sin(lat) * 0.5 + 0.5;
    return posterize(bands, 5.0);
  }
  if (uStyle == 2) {
    // Ice giant: soft, sparse mottling.
    return posterize(fbm(p * 2.0), 3.0) * 0.6;
  }
  // Rocky: continents/craters.
  return posterize(fbm(p * 3.1, 5, 2.1, 0.55), 4.0);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(uLightPos - vWorldPos);
  vec3 viewDir = normalize(uCameraPos - vWorldPos);
  float ndl = dot(normal, lightDir);

  float pattern = surfacePattern(vObjectPos) * uPattern;
  vec3 litInk = mix(uInkBase, uInkHighlight, pattern);

  vec3 color;
  if (uShadeMode < 0.5) {
    // The house style: light and shadow are two inks, stepped.
    color = inkShade(uInkShadow, litInk, ndl, uBands, uSoftness);
  } else if (uShadeMode < 1.5) {
    // Plain Lambert, for comparison.
    color = mix(uInkShadow, litInk, clamp(ndl, 0.0, 1.0));
  } else {
    // Blinn-Phong, for comparison.
    vec3 halfway = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfway), 0.0), 48.0);
    color = mix(uInkShadow, litInk, clamp(ndl, 0.0, 1.0)) + uInkHighlight * spec * 0.5;
  }

  // Atmosphere: a banded rim that only lights up where the sun actually is,
  // so the crescent of a backlit planet glows and the dark limb does not.
  if (uAtmosphere > 0.001) {
    float rim = inkRim(normal, viewDir, 2.4, 4.0);
    float facing = smoothstep(-0.05, 0.55, ndl);
    color += uInkHighlight * rim * facing * uAtmosphere * 0.55;
  }

  fragColor = vec4(color, 1.0);
}
