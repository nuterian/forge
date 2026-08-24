#version 300 es

// The main belt: one draw call, ~2600 instances.
//
// Each rock's orbit lives entirely in per-instance attributes and is evaluated
// here on the GPU. Nothing about the belt touches the CPU after upload, which
// is the point of the exercise — the same buffer would cost 2600 draw calls
// and 2600 matrix updates the naive way.

#include <math>

in vec3 aPosition;
in vec3 aNormal;
// x: semi-major axis (AU), y: eccentricity, z: inclination (rad), w: phase (rad)
in vec4 aOrbit;
// x: mean motion (rad/day), y: size, z: spin rate, w: tint mix
in vec4 aPhase;

uniform mat4 uViewProjection;
uniform float uTime;        // days since epoch
uniform float uOrbitScale;
uniform float uCompression;
uniform float uSizeScale;

out vec3 vNormal;
out vec3 vWorldPos;
out float vTint;

mat3 rotateAxis(vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  float t = 1.0 - c;
  return mat3(
    t * axis.x * axis.x + c,          t * axis.x * axis.y - s * axis.z, t * axis.x * axis.z + s * axis.y,
    t * axis.x * axis.y + s * axis.z, t * axis.y * axis.y + c,          t * axis.y * axis.z - s * axis.x,
    t * axis.x * axis.z - s * axis.y, t * axis.y * axis.z + s * axis.x, t * axis.z * axis.z + c
  );
}

void main() {
  float angle = aOrbit.w + aPhase.x * uTime;

  // A first-order Kepler orbit: good enough for gravel, and it avoids running
  // Newton's method 2600 times per frame.
  float radiusAu = aOrbit.x * (1.0 - aOrbit.y * cos(angle));
  vec3 orbital = vec3(radiusAu * cos(angle), 0.0, radiusAu * sin(angle));

  // Tilt the orbit about the X axis.
  float ci = cos(aOrbit.z);
  float si = sin(aOrbit.z);
  orbital = vec3(orbital.x, -orbital.z * si, orbital.z * ci);

  // Same radial compression the planets use, so the belt stays between Mars
  // and Jupiter no matter how the scale slider is set.
  float r = length(orbital);
  vec3 dir = orbital / max(r, 1e-6);
  vec3 center = dir * pow(r, uCompression) * uOrbitScale;

  // Tumble each rock about its own axis.
  vec3 axis = normalize(vec3(
    hash11(aOrbit.w) - 0.5,
    hash11(aOrbit.w + 7.31) - 0.5 + 0.6,
    hash11(aOrbit.w + 19.7) - 0.5
  ));
  mat3 spin = rotateAxis(axis, aPhase.z * uTime);

  vec3 local = spin * (aPosition * aPhase.y * uSizeScale);
  vec3 world = center + local;

  vNormal = normalize(spin * aNormal);
  vWorldPos = world;
  vTint = aPhase.w;

  gl_Position = uViewProjection * vec4(world, 1.0);
}
