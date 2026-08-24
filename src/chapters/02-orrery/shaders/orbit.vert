#version 300 es

// Orbit traces, drawn as widened screen-space ribbons so they read as ink
// strokes instead of the 1px hairlines gl.LINES is limited to.

#include <polyline>

in vec3 aPosition;
in vec3 aPrev;
in vec3 aNext;
in float aSide;
in float aParam;

uniform mat4 uViewProjection;
uniform vec2 uResolution;
uniform float uLineWidth;

out float vParam;

void main() {
  vParam = aParam;

  vec4 curr = uViewProjection * vec4(aPosition, 1.0);
  vec4 prev = uViewProjection * vec4(aPrev, 1.0);
  vec4 next = uViewProjection * vec4(aNext, 1.0);

  gl_Position = expandPolyline(curr, prev, next, aSide, uResolution, uLineWidth);
}
