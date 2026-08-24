#version 300 es
precision highp float;

// A whole star in one fragment shader — the direct descendant of the 2015
// "Introduction to shaders" assignment, which drew a procedural sun into a
// single quad. Same idea, now wrapped onto a sphere and printed in inks.

#include <math>
#include <ink>

uniform float uTime;
uniform vec3  uCameraPos;
uniform vec3  uInkCore;   // deep ember — the coolest ink
uniform vec3  uInkHot;    // golden amber — the working surface
uniform vec3  uInkFlare;  // near-white gold — hottest cells and the limb
uniform float uBands;

in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vObjectPos;

out vec4 fragColor;

void main() {
  vec3 p = vObjectPos;

  // Two scales of convection drifting at different rates: large granules
  // under fine filaments. Time enters as a slow translation through the noise
  // field, so the surface simmers rather than pulses.
  float granules = fbm(p * 3.4 + vec3(0.0, 0.0, uTime * 0.035), 4, 2.2, 0.55);
  float filaments = fbm(p * 8.5 - vec3(uTime * 0.055, 0.0, uTime * 0.02), 3, 2.4, 0.5);
  float heat = granules * 0.55 + filaments * 0.45;
  heat = clamp((heat - 0.5) * 3.2 + 0.5, 0.0, 1.0);

  // Cel shading, properly: four flat cells, each one ink, chosen with hard
  // steps. No gradients inside a cell and no blending between inks — which is
  // exactly what keeps the surface from reading as blurry patches.
  float band = posterize(heat, 4.0);
  vec3 gold = mix(uInkHot, uInkFlare, 0.55);
  vec3 color = uInkCore;
  color = mix(color, uInkHot, step(0.25, band));
  color = mix(color, gold, step(0.58, band));
  color = mix(color, uInkFlare, step(0.92, band));

  // Sunspots: rare cool cells, printed in the ember ink.
  float spots = step(granules, 0.2);
  color = mix(color, uInkCore * 0.72, spots);

  // One hard limb band: the edge burns hotter, handing off to the corona.
  vec3 viewDir = normalize(uCameraPos - vWorldPos);
  float limb = 1.0 - clamp(dot(normalize(vNormal), viewDir), 0.0, 1.0);
  color = mix(color, gold, step(0.72, limb) * 0.65);

  fragColor = vec4(color, 1.0);
}
