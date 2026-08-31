/**
 * The shared print pass. Owns the look that unifies every chapter.
 */

import { Program } from './program.ts';
import { Mesh } from './mesh.ts';
import { fullscreenTriangle } from './geometry.ts';
import type { Framebuffer } from './framebuffer.ts';
import { vec3, type Vec3 } from '../core/math.ts';

import vertSource from '../shaders/post.vert?raw';
import fragSource from '../shaders/post.frag?raw';

export interface PrintSettings {
  ditherLevels: number;
  ditherAmount: number;
  grain: number;
  paperGrain: number;
  vignette: number;
  misregister: number;
  halftone: number;
}

export const DEFAULT_PRINT: PrintSettings = {
  ditherLevels: 14,
  ditherAmount: 0.85,
  grain: 0.018,
  paperGrain: 0.03,
  vignette: 0.55,
  misregister: 0.9,
  halftone: 0.35,
};

export class PrintPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: Program;
  private readonly quad: Mesh;
  private readonly resolution = new Float32Array(2);

  settings: PrintSettings = { ...DEFAULT_PRINT };
  paper: Vec3 = vec3.create(0.04, 0.05, 0.07);
  /**
   * How much of the frame has been printed, 0–1. The shell runs this from 0 to
   * 1 over half a second when you arrive at a chapter and leaves it at 1 for
   * the rest of the session; see the wipe in post.frag. It is not a print
   * setting — settings are the chapter's to tune, and this is the shell's.
   */
  reveal = 1;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = new Program(gl, vertSource, fragSource, 'print');
    this.quad = fullscreenTriangle(gl);
  }

  /** Draw `source` to the currently bound framebuffer, through the press. */
  render(source: Framebuffer, width: number, height: number, time: number): void {
    const gl = this.gl;
    const s = this.settings;

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, width, height);

    this.resolution[0] = width;
    this.resolution[1] = height;

    this.program
      .use()
      .set('uResolution', this.resolution)
      .set('uTime', time)
      .set('uPaper', this.paper)
      .set('uDitherLevels', s.ditherLevels)
      .set('uDitherAmount', s.ditherAmount)
      .set('uGrain', s.grain)
      .set('uPaperGrain', s.paperGrain)
      .set('uVignette', s.vignette)
      .set('uMisregister', s.misregister)
      .set('uHalftone', s.halftone)
      .set('uReveal', this.reveal)
      .setTexture('uScene', source.texture, 0);

    this.quad.draw();
  }

  dispose(): void {
    this.program.dispose();
    this.quad.dispose();
  }
}
