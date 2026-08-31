#version 300 es
precision highp float;

// The shared print pass. Every chapter renders into a texture and then goes
// through this one shader, which is what makes six unrelated scenes look like
// they came off the same press.

#include <math>
#include <ink>

uniform sampler2D uScene;
uniform vec2  uResolution;
uniform float uTime;

uniform vec3  uPaper;
uniform float uDitherLevels;   // colour steps per channel before dithering
uniform float uDitherAmount;   // 0 = hard banding, 1 = full ordered dither
uniform float uGrain;          // animated film grain
uniform float uPaperGrain;     // static paper fibre
uniform float uVignette;
uniform float uMisregister;    // plate misalignment, in pixels
uniform float uHalftone;       // blend toward a halftone screen in the shadows
uniform float uReveal;         // 1 = printed; below that, the plate is coming down
uniform float uWarp;           // 0 = at rest; above that, the frame is in transit

in vec2 vUv;
out vec4 fragColor;

// The squeegee's angle and the width of its dithered edge. The same pull as
// the proof sheet's press run, so arriving from the index reads as one motion.
const vec2  WIPE_DIR = vec2(0.9360, -0.3520);
const float WIPE_EDGE = 0.34;

// Impressions pulled during a warp. Eight discrete copies rather than a smooth
// smear: a press at speed prints the same plate several times slightly out of
// register, and that is an artefact you can count — which is the whole
// difference between this and a radial blur.
const int   WARP_TAPS = 8;
const float WARP_REACH = 0.42;   // how far the last impression is dragged
const float WARP_SPLIT = 0.016;  // radial separation of the colour plates

void main() {
  vec2 texel = 1.0 / uResolution;
  vec2 pixel = vUv * uResolution;

  // --- Plate misregistration, or the warp -------------------------------
  // Real two-colour presses never align perfectly. Offsetting the channels by
  // a fraction of a pixel reads as "printed" far more than any filter does.
  //
  // The branch is on a uniform, so it is coherent across the entire draw and
  // the GPU takes one side or the other for the whole frame. That matters:
  // the warp costs twenty-four samples where the resting path costs three, and
  // the resting path is what runs for all but a second of a session. Unlike
  // uReveal below — which is branchless because it is nearly free — this one
  // has to be paid for only when it is used.
  vec3 color;
  vec2 fromCentre = vUv - 0.5;

  if (uWarp > 0.001) {
    // The frame is in transit: drag it outward through a run of impressions,
    // each one further out than the last, and pull the colour plates apart
    // radially as it goes. Averaging them is what leaves the streak.
    vec3 acc = vec3(0.0);
    for (int i = 0; i < WARP_TAPS; i++) {
      float t = float(i) / float(WARP_TAPS - 1);
      float scale = 1.0 + uWarp * WARP_REACH * t;
      float split = uWarp * WARP_SPLIT * t;
      acc.r += texture(uScene, 0.5 + fromCentre * (scale + split)).r;
      acc.g += texture(uScene, 0.5 + fromCentre * scale).g;
      acc.b += texture(uScene, 0.5 + fromCentre * (scale - split)).b;
    }
    color = acc / float(WARP_TAPS);
  } else {
    vec2 offset = vec2(uMisregister) * texel;
    color.r = texture(uScene, vUv + offset * vec2( 0.86,  0.5)).r;
    color.g = texture(uScene, vUv).g;
    color.b = texture(uScene, vUv - offset * vec2( 0.86, -0.5)).b;
  }

  // --- Halftone in the shadows -----------------------------------------
  // Only in dark regions, where flat ink would otherwise look dead.
  if (uHalftone > 0.001) {
    float value = luma(color);
    float dots = halftone(pixel, value * 1.35, 3.2, 0.4);
    vec3 screened = mix(uPaper, color, clamp(dots + value * 1.6, 0.0, 1.0));
    // Fade the screen out as the pixel gets brighter.
    float apply = uHalftone * (1.0 - smoothstep(0.05, 0.45, value));
    color = mix(color, screened, apply);
  }

  // --- Ordered dither + posterize --------------------------------------
  // Quantizing to a handful of levels is what gives flat ink areas; the Bayer
  // threshold breaks up the boundaries into a regular print texture instead of
  // hard steps.
  // The screen is sampled once and used twice — the wipe below reads the same
  // value, so arriving at a chapter costs no second pass over the pattern.
  float screen = bayer8(pixel);
  float threshold = (screen - 0.5) * uDitherAmount;
  vec3 quantized = floor(color * uDitherLevels + threshold + 0.5) / uDitherLevels;
  color = clamp(quantized, 0.0, 1.0);

  // --- Paper ------------------------------------------------------------
  // Static fibre, locked to the pixel grid rather than animated, so it reads as
  // the surface being printed on and not as noise in the image.
  float fibre = hash12(pixel * 0.7) - 0.5;
  color += fibre * uPaperGrain;

  // Animated grain, kept much subtler than the paper.
  float grain = hash12(pixel + vec2(uTime * 61.7, uTime * 39.1)) - 0.5;
  color += grain * uGrain;

  // --- Vignette ---------------------------------------------------------
  // Toward the paper colour, not toward black — the page has no black edges.
  float falloff = 1.0 - dot(fromCentre, fromCentre) * 1.9;
  color = mix(uPaper, color, mix(1.0, clamp(falloff, 0.0, 1.0), uVignette));

  // --- The wipe ---------------------------------------------------------
  // Arriving at a chapter, the image is pulled across the frame the way a
  // squeegee pulls ink across a screen: everything behind the front is
  // printed, everything ahead of it is bare paper, and the boundary is the
  // ordered screen itself breaking up rather than a soft edge.
  //
  // Deliberately branchless. uReveal sits at 1 for all but half a second of a
  // session, and the steady state has to cost nothing: at uReveal = 1 the
  // front has cleared the far corner, coverage saturates across the whole
  // frame, and what is left is a few ALU ops and a step() that is always
  // true. The 0.7764 normalises the diagonal sweep so u spans 0..1 corner to
  // corner.
  float u = dot(fromCentre, WIPE_DIR) * 0.7764 + 0.5;
  float front = uReveal * (1.0 + WIPE_EDGE);
  float coverage = clamp((front - u) / WIPE_EDGE, 0.0, 1.0);
  color = mix(uPaper, color, step(screen, coverage));

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
