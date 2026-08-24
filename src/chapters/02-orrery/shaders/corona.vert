#version 300 es

// A camera-facing quad built in the vertex shader: take the view matrix's
// right and up axes and expand the corners along them. No CPU billboarding.

in vec3 aPosition;
in vec2 aUv;

uniform mat4 uViewProjection;
uniform vec3 uCenter;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uScale;

out vec2 vUv;
out vec2 vLocal;

void main() {
  vLocal = aPosition.xy;
  vUv = aUv;
  vec3 world = uCenter + (uCameraRight * aPosition.x + uCameraUp * aPosition.y) * uScale;
  gl_Position = uViewProjection * vec4(world, 1.0);
}
