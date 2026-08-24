#version 300 es
precision highp float;

// The house glow: stepped contour bands that swell, split and merge as noise
// flows through them. No rays, no blur — hard ink bands whose shape is never
// still, like a slow flame seen in print.
//
// One shader covers both scales the project needs. A star's corona reaches
// out evenly in every direction (uSunBias = 0); a planet's atmosphere reaches
// farthest on the sunlit side and keeps only a rim on the night limb
// (uSunBias = 1, uSunDir pointing at the star). Everything else is the same
// field, so the two read as one visual idea at two sizes.

#include <math>
#include <ink>

uniform float uTime;
uniform vec3  uInk;
uniform float uOpacity;
uniform float uInner;     // the body's disk radius in quad units — bands start here
uniform float uReachMin;  // how far the glow reaches where the field is coldest
uniform float uReachMax;  // ...and where it is hottest, both in annulus units
uniform vec2  uSunDir;    // sun direction projected into the billboard plane
uniform float uSunBias;   // 0 omnidirectional, 1 fully sun-sided

in vec2 vLocal;

out vec4 fragColor;

void main() {
  float r = length(vLocal);
  // The billboard plane cuts through the sphere, so without the inner cutoff
  // the quad's near half wins the depth test at grazing pixels and draws over
  // the disk itself.
  if (r > 1.0 || r < uInner) discard;

  vec2 dir = vLocal / max(r, 1e-4);
  // Distance outward from the disk edge, normalized to [0,1].
  float d = (r - uInner) / (1.0 - uInner);

  // Sample the noise on the unit circle so there is no seam at ±π. Folding
  // the radius into the first sample point makes each band's edge wander on
  // its own instead of all bands sharing one silhouette.
  vec3 sample1 = vec3(dir * (2.0 + d * 0.9), uTime * 0.42);
  vec3 sample2 = vec3(dir * 4.2, 7.0 - uTime * 0.28);

  // Two fields flowing at different scales and directions. Their sum makes
  // lobes that swell, split and merge rather than rotate rigidly.
  float flow = fbm(sample1, 3, 2.0, 0.55) * 0.62 + fbm(sample2, 3, 2.0, 0.5) * 0.38;

  // How far the heat reaches at this angle, right now — pulled back on the
  // night side by as much as uSunBias asks for.
  float sunward = clamp(dot(dir, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  float phase = mix(0.22, 1.0, smoothstep(0.12, 0.85, sunward));
  float reach = mix(uReachMin, uReachMax, flow) * mix(1.0, phase, uSunBias);

  float energy = 1.0 - smoothstep(0.0, reach, d);
  // Three contour bands, one ink — the disk's own limb supplies the hot
  // centre, so the glow needs no white of its own.
  float stepped = posterize(pow(energy, 1.25), 3.0);

  float alpha = stepped * uOpacity;
  if (alpha < 0.01) discard;

  fragColor = vec4(uInk * (0.58 + 0.42 * stepped), alpha);
}
