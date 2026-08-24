/**
 * Offscreen render targets. The scene renders into a multisampled buffer,
 * resolves into a texture, and the post pass reads that texture — which is how
 * the shared grain/dither look gets applied to every chapter identically.
 */

export interface FramebufferOptions {
  /** 0 disables multisampling. */
  samples?: number;
  depth?: boolean;
  /** Defaults to gl.RGBA8. Use gl.RGBA16F for HDR chapters. */
  internalFormat?: number;
  filter?: number;
}

export class Framebuffer {
  readonly gl: WebGL2RenderingContext;
  width = 0;
  height = 0;

  /** The resolved, sampleable color texture. */
  texture: WebGLTexture;
  private resolveFbo: WebGLFramebuffer;
  private msaaFbo: WebGLFramebuffer | null = null;
  private colorRb: WebGLRenderbuffer | null = null;
  private depthRb: WebGLRenderbuffer | null = null;

  private readonly samples: number;
  private readonly useDepth: boolean;
  private readonly internalFormat: number;
  private readonly filter: number;

  constructor(gl: WebGL2RenderingContext, width: number, height: number, opts: FramebufferOptions = {}) {
    this.gl = gl;
    this.samples = opts.samples ?? 0;
    this.useDepth = opts.depth ?? true;
    this.internalFormat = opts.internalFormat ?? gl.RGBA8;
    this.filter = opts.filter ?? gl.LINEAR;

    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error('Framebuffer: allocation failed');
    this.texture = tex;
    this.resolveFbo = fbo;

    if (this.samples > 0) {
      const msaa = gl.createFramebuffer();
      if (!msaa) throw new Error('Framebuffer: MSAA allocation failed');
      this.msaaFbo = msaa;
    }

    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;

    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, this.internalFormat, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);

    if (this.msaaFbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);

      this.colorRb ??= gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorRb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, this.internalFormat, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colorRb);

      if (this.useDepth) {
        this.depthRb ??= gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
      }
    } else if (this.useDepth) {
      this.depthRb ??= gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
    }

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer: incomplete (0x${status.toString(16)})`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Bind for rendering (the multisampled target when MSAA is on). */
  bind(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo ?? this.resolveFbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  /** Blit MSAA → resolve so `texture` is readable. No-op when MSAA is off. */
  resolve(): void {
    if (!this.msaaFbo) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
    gl.blitFramebuffer(
      0, 0, this.width, this.height,
      0, 0, this.width, this.height,
      gl.COLOR_BUFFER_BIT, gl.NEAREST,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteFramebuffer(this.resolveFbo);
    if (this.msaaFbo) gl.deleteFramebuffer(this.msaaFbo);
    if (this.colorRb) gl.deleteRenderbuffer(this.colorRb);
    if (this.depthRb) gl.deleteRenderbuffer(this.depthRb);
  }
}
