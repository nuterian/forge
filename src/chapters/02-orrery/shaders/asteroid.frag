#version 300 es
precision highp float;

#include <ink>

uniform vec3 uInkShadow;
uniform vec3 uInkBase;
uniform vec3 uInkHighlight;

in vec3 vNormal;
in vec3 vWorldPos;
in float vTint;

out vec4 fragColor;

void main() {
  // The sun sits at the origin, so the light direction is free.
  vec3 lightDir = normalize(-vWorldPos);
  float ndl = dot(normalize(vNormal), lightDir);

  // Kept muted: two and a half thousand cream-bright rocks would out-shout
  // the planets they are meant to frame.
  vec3 base = mix(uInkBase, uInkHighlight, vTint) * 0.62;

  // Two bands only: at this size, more steps just alias.
  fragColor = vec4(inkShade(uInkShadow, base, ndl, 2.0, 0.12), 1.0);
}
