/**
 * The performance budget, in milliseconds per iteration, enforced by #/bench.
 *
 * Calibrated on the project's development machine (Apple-silicon MacBook,
 * Chrome) at roughly 2× the best figure ever measured there after the
 * optimization pass — strict enough that any real regression fails at once
 * (the pass that regressed to "only" half its speed is already over budget),
 * with the factor of two absorbing thermal state and run-to-run scheduling.
 *
 * Two rules keep these honest:
 *  - Validate with the tab VISIBLE. An occluded page is parked on efficiency
 *    cores and its GPU work is deprioritized; the suite's best-of-sweeps
 *    resists that, but a fully throttled run can still read 3–5× high, and a
 *    red row from a hidden tab means nothing. The page warns when occluded.
 *  - These are machine-relative, and they are a ratchet, not a constant: on
 *    the calibration machine the suite stays green, and any change that turns
 *    a row red either gets fixed or consciously re-budgets HERE, in a
 *    reviewed diff, with a reason.
 *
 * Best figures observed at calibration (ms):
 *   gpu.sky 0.089 · gpu.post 0.045 · gpu.planet 0.248 · gpu.bake 0.819
 *   gpu.body 0.054 · gpu.belt 0.118 · gpu.glow 0.762
 *   cpu.raster.clear 0.325 · lines 1.83 · dots 0.80 · triangles 1.03
 *   cpu.chart.frame 1.23 · cpu.kepler 0.64 · cpu.labels 0.009
 */

export const THRESHOLDS: Record<string, number> = {
  // GPU, ms per draw at 1920×1080, depth test off, sustained submission.
  'gpu.sky': 0.22,
  'gpu.post': 0.1,
  'gpu.planet': 0.55,
  'gpu.bake': 2.0,
  'gpu.body': 0.13,
  'gpu.belt': 0.28,
  'gpu.glow': 1.6,

  // CPU, ms per iteration (one frame, one batch — see the bench name).
  'cpu.raster.clear': 0.65,
  'cpu.raster.lines': 3.7,
  'cpu.raster.dots': 1.6,
  'cpu.raster.triangles': 2.1,
  'cpu.chart.frame': 2.5,
  'cpu.kepler': 1.3,
  'cpu.labels': 0.025,
};
