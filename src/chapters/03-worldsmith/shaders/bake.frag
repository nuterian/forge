#version 300 es
precision highp float;

// Bake the world's static fields into an equirectangular map, once per seed.
//
// The live shader used to evaluate ~29 octaves of value noise per fragment per
// frame to answer questions whose answers never change. This pass answers them
// all in one fullscreen triangle at load: texel → direction on the unit
// sphere → height, relief, cloud. Everything that a slider can still move —
// sea level, biome ramp, ice, clouds, shading — stays live in planet.frag.

#include <math>
#include <planet-fields>

in vec2 vUv;

out vec4 fragColor;

void main() {
  // Equirectangular: u spans longitude, v spans latitude. The live shader
  // inverts this exactly (atan for u, asin for v), and u wraps because the
  // map does.
  float lon = (vUv.x - 0.5) * TAU;
  float lat = (vUv.y - 0.5) * PI;
  float cosLat = cos(lat);
  vec3 dir = vec3(cosLat * cos(lon), sin(lat), cosLat * sin(lon));

  vec3 f = planetFields(dir);

  // Height gets two channels. One byte terraces the coastline visibly once you
  // are close enough to see a continent's edge: every contour the live shader
  // draws — the shoreline, all sixteen biome boundaries — is an isoline of
  // this number, and at 1/255 they snap to the quantization instead of
  // following the land. The high byte goes in R, the remainder in G; relief
  // and cloud keep a channel each.
  float v = clamp(f.x, 0.0, 1.0) * 255.0;
  fragColor = vec4(floor(v) / 255.0, fract(v), f.y, f.z);
}
