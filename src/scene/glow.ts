/**
 * A camera-facing glow — the stepped contour bands of glow.frag on the quad
 * that billboard.vert expands. A star's corona and a planet's atmosphere are
 * the same object at two sizes: the only real difference is how far the bands
 * reach, and whether that reach leans toward the sun.
 *
 * The caller owns the blend state (these are additive passes drawn late); this
 * owns the program, the quad, and the camera axes the billboard rides on.
 */

import type { OrbitCamera } from '../core/camera.ts';
import { vec3, type Vec3 } from '../core/math.ts';
import { billboardQuad } from '../gl/geometry.ts';
import type { Mesh } from '../gl/mesh.ts';
import { Program } from '../gl/program.ts';

import billboardVert from './shaders/billboard.vert?raw';
import glowFrag from './shaders/glow.frag?raw';

export interface GlowOptions {
  /** World-space centre of the glowing body. */
  center: Vec3;
  /** Half-width of the quad in world units — the glow's outer limit. */
  scale: number;
  /** The body's own radius as a fraction of `scale`; bands start there. */
  inner: number;
  ink: Vec3;
  opacity: number;
  /** Seconds on a clock that never pauses. */
  time: number;
  /** How far the bands reach, in annulus units. Defaults suit a corona. */
  reachMin?: number;
  reachMax?: number;
  /** World-space direction to the light; only read when sunBias > 0. */
  sunDir?: Vec3;
  /** 0 reaches out evenly, 1 keeps only a rim on the night side. */
  sunBias?: number;
  /**
   * A prominence rising off the limb: the angle it rises at, in the
   * billboard's own plane, and how far past the ordinary corona it reaches.
   * Omitted or zero-reach means none, which is nearly always.
   */
  prominenceAngle?: number;
  prominenceReach?: number;
  /** How tight the arc is, 0–1. Larger is narrower. */
  prominenceArc?: number;
}

export class GlowBillboard {
  private readonly program: Program;
  private readonly quad: Mesh;
  private readonly right = vec3.create();
  private readonly up = vec3.create();
  private readonly sunDir2D = new Float32Array([1, 0]);
  private readonly prominence = new Float32Array([1, 0, 0, 0.5]);

  constructor(gl: WebGL2RenderingContext, name = 'scene.glow') {
    this.program = new Program(gl, billboardVert, glowFrag, name);
    this.quad = billboardQuad(gl);
  }

  draw(camera: OrbitCamera, options: GlowOptions): void {
    camera.billboardAxes(this.right, this.up);

    const sunBias = options.sunBias ?? 0;
    if (sunBias > 0 && options.sunDir) {
      // Flatten the light direction into the billboard's own plane, so the
      // glow's long side faces the sun no matter where the camera orbits.
      const x = vec3.dot(options.sunDir, this.right);
      const y = vec3.dot(options.sunDir, this.up);
      const len = Math.hypot(x, y);
      // Looking straight down the light: no side is sunward, so pick one.
      this.sunDir2D[0] = len > 1e-4 ? x / len : 1;
      this.sunDir2D[1] = len > 1e-4 ? y / len : 0;
    }

    const reach = options.prominenceReach ?? 0;
    if (reach > 0) {
      const angle = options.prominenceAngle ?? 0;
      this.prominence[0] = Math.cos(angle);
      this.prominence[1] = Math.sin(angle);
    }
    this.prominence[2] = reach;
    this.prominence[3] = options.prominenceArc ?? 0.06;

    this.program
      .use()
      .set('uViewProjection', camera.viewProjection)
      .set('uCenter', options.center)
      .set('uCameraRight', this.right)
      .set('uCameraUp', this.up)
      .set('uScale', options.scale)
      .set('uInner', options.inner)
      .set('uReachMin', options.reachMin ?? 0.24)
      .set('uReachMax', options.reachMax ?? 0.96)
      .set('uTime', options.time)
      .set('uInk', options.ink)
      .set('uOpacity', options.opacity)
      .set('uSunDir', this.sunDir2D)
      .set('uSunBias', sunBias)
      .set('uProminence', this.prominence);
    this.quad.draw();
  }

  dispose(): void {
    this.program.dispose();
    this.quad.dispose();
  }
}
