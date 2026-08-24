#version 300 es
precision highp float;

// The background sky: a printed star chart.
//
// Stars are found by hashing cells of a spherical grid rather than by storing
// any geometry, so the field is infinitely sharp, costs no memory, and is
// identical every frame — it does not swim when the camera moves.

#include <math>
#include <ink>

uniform vec3  uInkStar;
uniform vec3  uInkDust;
uniform vec3  uPaper;
uniform float uDensity;
uniform float uGalaxy;

in vec3 vRay;

out vec4 fragColor;

// One layer of stars. `density` sets the grid resolution; `threshold` how many
// cells actually contain a star. `sparkle` turns round dots into four-pointed
// printed stars — reserved for the brightest layer.
float starLayer(vec2 spherical, float density, float threshold, float size, float sparkle) {
  vec2 grid = vec2(density * 2.0, density);
  vec2 p = spherical * grid;
  vec2 cell = floor(p);
  vec2 f = fract(p);

  float present = hash12(cell);
  if (present < threshold) return 0.0;

  // Jitter within the cell so the field does not look like a lattice. The
  // margin keeps stars away from cell edges, where they would clip.
  vec2 offset = 0.2 + hash22(cell + 1.7) * 0.6;
  vec2 delta = f - offset;
  float magnitude = hash12(cell + 5.3);
  float radius = size * (0.35 + magnitude * 0.65);

  // One-pixel anti-aliasing via derivatives: crisp ink, but no shimmer when
  // the camera moves. Derivatives come from the *continuous* coordinate `p` —
  // fract() jumps at every cell edge, and fwidth of that draws a faint box
  // around each cell. Clamped so the seam of atan() can't wash a star out.
  float aa = clamp(max(fwidth(p.x), fwidth(p.y)) * 0.7, 1e-4, radius * 0.75);

  float star = smoothstep(radius + aa, radius - aa, length(delta));

  if (sparkle > 0.0 && magnitude > 0.6) {
    // Diamond spikes: thin along one axis, long along the other.
    float thin = radius * 0.28;
    float long_ = radius * sparkle;
    float armX = smoothstep(thin + aa, thin - aa, abs(delta.y)) *
                 smoothstep(long_ + aa, long_ - aa, abs(delta.x));
    float armY = smoothstep(thin + aa, thin - aa, abs(delta.x)) *
                 smoothstep(long_ + aa, long_ - aa, abs(delta.y));
    star = max(star, max(armX, armY));
  }

  return star * (0.35 + magnitude * 0.65);
}

void main() {
  vec3 dir = normalize(vRay);

  // Equirectangular coordinates. Cells bunch up toward the poles; at these
  // densities the clustering is invisible and the alternative costs far more.
  vec2 spherical = vec2(
    atan(dir.z, dir.x) / TAU + 0.5,
    acos(clamp(dir.y, -1.0, 1.0)) / PI
  );

  vec3 color = uPaper;

  // --- The galactic band -------------------------------------------------
  // A great circle tilted off the ecliptic. A whisper of dust only — big flat
  // fills read as broken slabs against the paper, so the band's presence comes
  // almost entirely from the extra stars packed inside it.
  vec3 galacticNormal = normalize(vec3(0.42, 0.78, -0.46));
  float fromPlane = abs(dot(dir, galacticNormal));
  float clumps = fbm(dir * 7.0, 4, 2.2, 0.55);
  float band = 1.0 - smoothstep(0.0, 0.2 + clumps * 0.16, fromPlane);
  band *= 0.3 + clumps * 0.8;
  color = mix(color, uInkDust, posterize(band, 3.0) * 0.1 * uGalaxy);

  // The equirectangular grid degenerates at the poles — cells compress until
  // stars smear into streaks — so the field fades out approaching them.
  float polarFade = smoothstep(0.03, 0.16, spherical.y) * smoothstep(0.97, 0.84, spherical.y);

  // --- Stars -------------------------------------------------------------
  // Three layers: a few bright four-pointed ones, many faint, and dense dust.
  float stars = 0.0;
  stars += starLayer(spherical, 42.0, 0.978, 0.055, 2.6) * 1.0;
  stars += starLayer(spherical, 96.0, 0.958, 0.075, 0.0) * 0.55;
  stars += starLayer(spherical, 190.0, 0.94, 0.1, 0.0) * 0.3;
  stars *= polarFade;

  // The band is crowded with stars, which is most of why it reads as a galaxy.
  stars *= uDensity * (1.0 + band * 1.4);

  color = mix(color, uInkStar, clamp(stars, 0.0, 1.0));

  fragColor = vec4(color, 1.0);
}
