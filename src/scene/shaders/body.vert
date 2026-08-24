#version 300 es

in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;

uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat3 uNormalMatrix;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
// Object space is where the surface pattern lives, so it spins with the body
// instead of swimming across it.
out vec3 vObjectPos;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(uNormalMatrix * aNormal);
  vUv = aUv;
  vObjectPos = normalize(aPosition);
  gl_Position = uViewProjection * world;
}
