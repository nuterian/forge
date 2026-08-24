/**
 * Uploads a CPU Raster to a texture and draws it over the viewport.
 * Chapter 01's entire output path; later chapters use it for any CPU-built
 * image (poster composition, chart overlays).
 */

import { Program } from './program.ts';
import { Mesh } from './mesh.ts';
import { fullscreenTriangle } from './geometry.ts';
import type { Raster } from '../core/raster.ts';

import blitVert from '../shaders/post.vert?raw';
import blitFrag from '../shaders/blit.frag?raw';

export class RasterBlitter {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: Program;
  private readonly quad: Mesh;
  private texture: WebGLTexture;
  private texWidth = 0;
  private texHeight = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = new Program(gl, blitVert, blitFrag, 'blit');
    this.quad = fullscreenTriangle(gl);
    const tex = gl.createTexture();
    if (!tex) throw new Error('RasterBlitter: texture allocation failed');
    this.texture = tex;
  }

  /** Upload the raster's pixels, reallocating only when its size changed. */
  upload(raster: Raster): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (raster.width !== this.texWidth || raster.height !== this.texHeight) {
      this.texWidth = raster.width;
      this.texHeight = raster.height;
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA8, raster.width, raster.height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, raster.data,
      );
      // Nearest: the CPU pixels are the artefact; smoothing them would lie.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, 0, raster.width, raster.height,
        gl.RGBA, gl.UNSIGNED_BYTE, raster.data,
      );
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Draw the uploaded image across the currently bound framebuffer. */
  draw(): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.program.use().setTexture('uImage', this.texture, 0);
    this.quad.draw();
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
    this.program.dispose();
    this.quad.dispose();
  }
}
