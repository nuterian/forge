#version 300 es

// Fullscreen triangle. The view ray is reconstructed in the fragment shader
// from the inverse view-projection, so the star field is fixed to the sky
// rather than to the screen.

in vec3 aPosition;

uniform mat4 uInvViewProjection;
uniform vec3 uCameraPos;

out vec3 vRay;

void main() {
  vec4 farPoint = uInvViewProjection * vec4(aPosition.xy, 1.0, 1.0);
  vRay = farPoint.xyz / farPoint.w - uCameraPos;
  gl_Position = vec4(aPosition.xy, 1.0, 1.0);
}
