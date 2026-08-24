#version 300 es
precision highp float;

// The stroke is brightest just behind the planet and fades the further back
// along the orbit you look — so a still frame still tells you which way
// everything is travelling.

#include <ink>

uniform vec3  uInk;
uniform float uOpacity;
uniform float uPhase;    // where the body currently sits, 0–1 along the trace
uniform float uTrail;    // how much of the orbit the bright trail covers
uniform float uDashes;   // 0 = solid, >0 = dashes per revolution

in float vParam;

out vec4 fragColor;

void main() {
  // Distance *backwards* from the body, wrapped into [0,1).
  float behind = fract(uPhase - vParam);

  float trail = 1.0 - smoothstep(0.0, max(uTrail, 1e-4), behind);
  float base = 0.22;
  float intensity = base + trail * 0.78;

  if (uDashes > 0.5) {
    // Dashes are cut in parameter space, so they travel with the body.
    float dash = step(0.5, fract(vParam * uDashes));
    intensity *= mix(0.25, 1.0, dash);
  }

  // Step it, like everything else, so the trace matches the printed surfaces.
  intensity = posterizeSoft(intensity, 5.0, 0.25);

  float alpha = intensity * uOpacity;
  if (alpha < 0.004) discard;

  fragColor = vec4(uInk * intensity, alpha);
}
