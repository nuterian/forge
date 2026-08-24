/**
 * The four render states every chapter draws through, named once.
 *
 * Every chapter walks the same order — solid bodies, then translucent sheets
 * (rings, ink lines), then additive glows — and each was spelling the state
 * out by hand, which is how one chapter ends up with a stale depthMask the
 * next one has to guess at. Each helper here sets its *whole* state, never a
 * delta, so calling them in any order leaves nothing behind.
 */

/** Solid geometry: depth tested and written, no blending, backfaces culled. */
export function beginOpaque(gl: WebGL2RenderingContext): void {
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
}

/**
 * Sheets you can see through — ring annuli, orbit ribbons. Depth is still
 * tested but not written, so two translucent things never occlude each other
 * by draw order, and culling is off because these are two-sided surfaces.
 */
export function beginTranslucent(gl: WebGL2RenderingContext): void {
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
}

/** Light that adds: coronas, atmospheres. Same as translucent, but it sums. */
export function beginAdditive(gl: WebGL2RenderingContext): void {
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.disable(gl.CULL_FACE);
}

/** Hand the context back the way the shell expects to find it. */
export function endPasses(gl: WebGL2RenderingContext): void {
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}
