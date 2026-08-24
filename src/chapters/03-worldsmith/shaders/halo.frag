#version 300 es
precision highp float;

// The atmosphere beyond the limb: stepped contour bands that swell and thin
// as noise flows through them — the corona's technique at planetary scale.
// The bands reach farthest on the sunlit side and shrink to a sliver on the
// night limb, so the halo respects the phase.

#include <math>
#include <ink>

uniform float uTime;
uniform vec3  uInk;
uniform float uOpacity;
uniform float uInner;   // the planet disk's radius in quad units
uniform vec2  uSunDir;  // sun direction projected into the billboard plane

in vec2 vLocal;

out vec4 fragColor;

void main() {
  float r = length(vLocal);
  // The quad passes through the planet's centre; discarding inside the disk
  // keeps its near half from winning the depth test over the surface.
  if (r > 1.0 || r < uInner) discard;

  vec2 dir = vLocal / max(r, 1e-4);
  float d = (r - uInner) / (1.0 - uInner);

  // Noise sampled on the unit circle — no seam — flowing slowly, so the bands
  // mould and breathe rather than rotate rigidly.
  float flow = fbm(vec3(dir * 2.6, uTime * 0.35), 3, 2.0, 0.55) * 0.65 +
               fbm(vec3(dir * 5.1, 4.0 - uTime * 0.22), 3, 2.0, 0.5) * 0.35;

  // Day side reaches out; the night limb keeps only a rim.
  float sunward = clamp(dot(dir, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  float reach = (0.16 + flow * 0.5) * mix(0.22, 1.0, smoothstep(0.12, 0.85, sunward));

  float energy = 1.0 - smoothstep(0.0, reach, d);
  float stepped = posterize(pow(energy, 1.2), 3.0);

  float alpha = stepped * uOpacity;
  if (alpha < 0.01) discard;

  fragColor = vec4(uInk * (0.6 + 0.4 * stepped), alpha);
}
