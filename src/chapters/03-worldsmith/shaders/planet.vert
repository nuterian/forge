#version 300 es

in vec3 aPosition;
in vec3 aNormal;

uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat3 uNormalMatrix;

out vec3 vWorldPos;
out vec3 vNormal;
// Object space is where the terrain lives, so it spins with the planet.
out vec3 vObjectPos;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(uNormalMatrix * aNormal);
  vObjectPos = normalize(aPosition);
  gl_Position = uViewProjection * world;
}
