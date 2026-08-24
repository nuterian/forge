#version 300 es
precision highp float;

// The corona as living heat: stepped contour bands that swell, split and
// merge as noise flows through them. No rays, no blur — hard ink bands whose
// shape is never still, like a slow flame seen in print.

#include <math>
#include <ink>

uniform float uTime;
uniform vec3  uInk;      // amber — the body of the glow
uniform float uOpacity;
uniform float uInner;    // the sun disk's radius in quad units — bands start here

in vec2 vLocal;

out vec4 fragColor;

void main() {
  float r = length(vLocal);
  // The billboard plane cuts through the sphere, so without the inner cutoff
  // the quad's near half wins the depth test at grazing pixels and draws over
  // the disk itself.
  if (r > 1.0 || r < uInner) discard;

  float angle = atan(vLocal.y, vLocal.x);
  // Distance outward from the disk edge, normalized to [0,1].
  float d = (r - uInner) / (1.0 - uInner);

  // Sample the noise on the unit circle so there is no seam at ±π. Folding
  // the radius into the sample point makes each band's edge wander on its
  // own instead of all bands sharing one silhouette.
  vec2 dir = vec2(cos(angle), sin(angle));
  vec3 sample1 = vec3(dir * (1.8 + d * 0.9), uTime * 0.5);
  vec3 sample2 = vec3(dir * 3.6, 7.0 - uTime * 0.34);

  // Two fields flowing at different scales and directions. Their sum makes
  // lobes that swell, split and merge rather than rotate rigidly.
  float flow = fbm(sample1, 3, 2.0, 0.55) * 0.6 + fbm(sample2, 3, 2.0, 0.5) * 0.4;

  // How far the heat reaches at this angle, right now.
  float reach = 0.24 + flow * 0.72;

  float energy = 1.0 - smoothstep(0.0, reach, d);
  // Three contour bands of heat, amber only — the disk's own limb supplies
  // the hot centre, so the corona needs no white of its own.
  float stepped = posterize(pow(energy, 1.3), 3.0);

  float alpha = stepped * uOpacity;
  if (alpha < 0.01) discard;

  fragColor = vec4(uInk * (0.55 + 0.45 * stepped), alpha);
}
