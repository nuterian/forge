/** WebGL2 context creation + DPR-aware sizing. */

export interface GLContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  /** Drawing-buffer size in physical pixels. */
  width: number;
  height: number;
  dpr: number;
}

export class WebGLNotSupportedError extends Error {}

export function createContext(canvas: HTMLCanvasElement): GLContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false, // we resolve our own multisampled FBO instead
    depth: false, // the default framebuffer only ever receives a fullscreen post pass
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });

  if (!gl) {
    throw new WebGLNotSupportedError(
      'WebGL2 is unavailable in this browser. The Forge needs WebGL2 for chapters 1–4.',
    );
  }

  return { gl, canvas, width: 1, height: 1, dpr: 1 };
}

/**
 * Match the drawing buffer to the CSS size. Caps DPR because a 3x retina
 * display at full resolution costs more than the look gains.
 *
 * Accepts an already-measured rect so a caller doing its own layout read
 * this frame (e.g. for label placement) doesn't force a second one — two
 * getBoundingClientRect() calls a frame, 60 times a second, adds up for
 * nothing.
 */
export function resizeToDisplay(ctx: GLContext, rect: DOMRect, maxDpr = 2): boolean {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));

  if (ctx.canvas.width === w && ctx.canvas.height === h) return false;

  ctx.canvas.width = w;
  ctx.canvas.height = h;
  ctx.width = w;
  ctx.height = h;
  ctx.dpr = dpr;
  return true;
}

/** Largest MSAA sample count the driver supports, capped for sanity. */
export function maxSamples(gl: WebGL2RenderingContext, cap = 4): number {
  return Math.min(gl.getParameter(gl.MAX_SAMPLES) as number, cap);
}
