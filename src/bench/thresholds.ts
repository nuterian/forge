/**
 * The performance budget, in milliseconds per iteration, enforced by #/bench.
 *
 * Calibration: Apple-silicon MacBook (the project's development machine),
 * Chrome, 1080p offscreen targets. Each threshold is set roughly 1.5× the
 * post-optimization median on that machine — tight enough that a real
 * regression (a shader gaining octaves, a raster primitive re-allocating,
 * a pass losing its bake) fails immediately, loose enough that run-to-run
 * noise and thermal state do not.
 *
 * These are machine-relative: a slower GPU fails honestly. The point is not
 * a universal constant but a ratchet — on the calibration machine the suite
 * must stay green, and any change that turns a row red either gets fixed or
 * consciously re-budgets HERE, in a reviewed diff, with a reason.
 */

export const THRESHOLDS: Record<string, number> = {
  // GPU, ms per draw at 1920×1080.
  'gpu.sky': 1.2,
  'gpu.post': 0.9,
  'gpu.planet': 0.75,
  'gpu.bake': 30,
  'gpu.body': 0.55,
  'gpu.belt': 0.5,
  'gpu.glow': 1.1,

  // CPU, ms per iteration (one frame, one batch — see the bench name).
  'cpu.raster.clear': 0.6,
  'cpu.raster.lines': 3.0,
  'cpu.raster.dots': 2.0,
  'cpu.raster.triangles': 2.0,
  'cpu.chart.frame': 8.0,
  'cpu.kepler': 1.5,
  'cpu.labels': 0.35,
};
