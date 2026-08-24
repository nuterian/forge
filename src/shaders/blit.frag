#version 300 es
precision highp float;

// Draws a CPU-rasterized buffer to the screen. The buffer's row 0 is the top
// of the image; texture v runs bottom-up, hence the flip.

uniform sampler2D uImage;

in vec2 vUv;
out vec4 fragColor;

void main() {
  fragColor = texture(uImage, vec2(vUv.x, 1.0 - vUv.y));
}
