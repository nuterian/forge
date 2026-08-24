// The art direction, in code.
//
// Quantizing N·L into a few hard steps is the single decision that makes
// everything read as screen-printed rather than rendered — and it costs one
// floor(). Light and shadow are two *inks*, not a colour and a darker version
// of it, which is what keeps the palette coherent across chapters.

// Quantize x in [0,1] to `steps` discrete levels, still spanning [0,1].
// The min() matters: at x == 1.0 the band index reaches `steps`, and without
// the clamp the result exceeds 1 — which extrapolates past the target ink in
// mix() and washes fully-lit surfaces toward white.
float posterize(float x, float steps) {
  return min(floor(clamp(x, 0.0, 1.0) * steps), steps - 1.0) / max(steps - 1.0, 1.0);
}

// Softly quantize: keeps a hair of gradient inside each band so that large,
// gently curved surfaces don't show a stair-stepped band boundary.
float posterizeSoft(float x, float steps, float softness) {
  float scaled = clamp(x, 0.0, 1.0) * steps;
  float band = floor(scaled);
  float frac = scaled - band;
  float smoothed = smoothstep(0.5 - softness, 0.5 + softness, frac);
  return min((band + smoothed) / max(steps - 1.0, 1.0), 1.0);
}

// The core shading model for every lit surface in the project.
// N·L is clamped at zero before banding: the entire night hemisphere stays in
// the shadow ink, and the bands divide only the lit side. Spreading the bands
// across the full -1..1 range instead drags the visible terminator deep into
// the night side, which reads as wrong from every angle.
vec3 inkShade(vec3 shadowInk, vec3 lightInk, float ndl, float steps, float softness) {
  float lit = posterizeSoft(clamp(ndl, 0.0, 1.0), steps, softness);
  // Phases must read like the moon's: the lit region prints near full ink,
  // with the bands as structure *inside* the brightness — not as a dim ramp
  // up from shadow, which leaves the whole planet looking underexposed.
  lit = lit <= 0.001 ? 0.0 : mix(0.62, 1.0, lit);
  return mix(shadowInk, lightInk, lit);
}

// Rim term for atmospheres and backlit limbs — banded to match.
float inkRim(vec3 normal, vec3 viewDir, float power, float steps) {
  float rim = 1.0 - clamp(dot(normal, viewDir), 0.0, 1.0);
  return posterize(pow(rim, power), steps);
}

// 8x8 Bayer ordered dither, built by bit-interleaving instead of a lookup
// table. Ordered (not random) dithering is what gives the print its regular,
// deliberate texture rather than looking like sensor noise.
float bayer8(vec2 pixel) {
  vec2 p = floor(mod(pixel, 8.0));
  float sum = 0.0;
  float scale = 1.0;
  for (int i = 0; i < 3; i++) {
    vec2 bits = mod(p, 2.0);
    p = floor(p * 0.5);
    scale *= 0.25;
    sum += scale * (2.0 * bits.x + 3.0 * bits.y - 4.0 * bits.x * bits.y);
  }
  return sum;
}

// Classic halftone: dot radius follows luminance, on a rotated screen.
float halftone(vec2 pixel, float value, float scale, float angle) {
  float c = cos(angle), s = sin(angle);
  vec2 rotated = mat2(c, -s, s, c) * pixel / scale;
  vec2 cell = fract(rotated) - 0.5;
  float radius = sqrt(clamp(1.0 - value, 0.0, 1.0)) * 0.72;
  return smoothstep(radius + 0.03, radius - 0.03, length(cell));
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
