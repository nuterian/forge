#version 300 es
precision highp float;

// Planetary rings: a parametric annulus, banded radially, with the planet's
// own shadow falling across them.
//
// The shadow is worth the eight lines it costs — it is the detail that makes
// Saturn read as a solid object sitting in a light field rather than a sticker.

#include <math>
#include <ink>

uniform vec3  uInk;
uniform vec3  uInkDark;
uniform float uOpacity;
uniform float uSeed;

uniform vec3  uPlanetCenter;
uniform float uPlanetRadius;
uniform vec3  uLightPos;
uniform vec3  uCameraPos;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;   // u = radial position across the ring, v = angle

out vec4 fragColor;

void main() {
  float radial = vUv.x;

  // Radial structure: several octaves of 1-D noise, then hard-stepped into
  // discrete ringlets.
  float fine = fbm(vec3(radial * 46.0 + uSeed, 0.0, 0.0), 4, 2.2, 0.55);
  float coarse = fbm(vec3(radial * 9.0 + uSeed, 3.7, 0.0), 3, 2.0, 0.5);
  float density = posterize(fine * 0.55 + coarse * 0.45, 6.0);

  // Divisions: a wide gap about two-thirds out, plus a soft inner edge.
  float cassini = smoothstep(0.02, 0.06, abs(radial - 0.63));
  density *= cassini;
  density *= smoothstep(0.0, 0.07, radial) * (1.0 - smoothstep(0.9, 1.0, radial));

  if (density < 0.02) discard;

  // --- Planet shadow ----------------------------------------------------
  // Project the ring point onto the light direction. If it lies behind the
  // planet and within its silhouette, it is in shadow.
  vec3 toPoint = vWorldPos - uPlanetCenter;
  vec3 lightDir = normalize(uLightPos - uPlanetCenter);
  float along = dot(toPoint, lightDir);
  float shadow = 1.0;
  if (along < 0.0) {
    float perpendicular = length(toPoint - lightDir * along);
    shadow = smoothstep(uPlanetRadius * 0.92, uPlanetRadius * 1.12, perpendicular);
  }

  // Rings are thin and translucent: they are brighter seen face-on, and the
  // edge-on case is handled for free by their vanishing pixel coverage.
  vec3 viewDir = normalize(uCameraPos - vWorldPos);
  float facing = abs(dot(normalize(vNormal), viewDir));
  float lit = mix(0.45, 1.0, posterize(facing, 4.0)) * mix(0.18, 1.0, shadow);

  vec3 color = mix(uInkDark, uInk, posterize(density, 4.0)) * lit;
  float alpha = clamp(density * uOpacity * mix(0.55, 1.0, facing), 0.0, 1.0);

  fragColor = vec4(color, alpha);
}
