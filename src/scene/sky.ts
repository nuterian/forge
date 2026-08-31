/**
 * The star field behind every space chapter.
 *
 * One fullscreen triangle whose view ray is reconstructed from the inverse
 * view-projection, so the sky is fixed to the world rather than the screen.
 * It owns its own pass state — depth off, blend off — because it is always
 * the first thing drawn and nothing behind it can matter.
 */

import type { OrbitCamera } from '../core/camera.ts';
import { mat4 } from '../core/math.ts';
import { fullscreenTriangle } from '../gl/geometry.ts';
import type { Mesh } from '../gl/mesh.ts';
import { Program } from '../gl/program.ts';
import type { InkSet } from '../ui/palette.ts';

import skyVert from './shaders/sky.vert?raw';
import skyFrag from './shaders/sky.frag?raw';

export interface SkyOptions {
  /** Star count multiplier, 1 = the tuned default. */
  density: number;
  /** How strongly the galactic band prints, 0–1. */
  galaxy: number;
  /** Palette ink index for the band's dust. Defaults to the cool accent. */
  dust?: number;
}

export class SkyPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: Program;
  private readonly quad: Mesh;
  private readonly invViewProjection = mat4.create();

  constructor(gl: WebGL2RenderingContext, name = 'scene.sky') {
    this.gl = gl;
    this.program = new Program(gl, skyVert, skyFrag, name);
    this.quad = fullscreenTriangle(gl);
  }

  draw(camera: OrbitCamera, inks: InkSet, options: SkyOptions): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    mat4.invert(this.invViewProjection, camera.viewProjection);
    this.program
      .use()
      .set('uInvViewProjection', this.invViewProjection)
      .set('uCameraPos', camera.position)
      .set('uInkStar', inks.ink(0))
      .set('uInkDust', inks.ink(options.dust ?? 4))
      .set('uPaper', inks.paper)
      .set('uDensity', options.density)
      .set('uGalaxy', options.galaxy);
    this.quad.draw();
  }

  dispose(): void {
    this.program.dispose();
    this.quad.dispose();
  }
}
