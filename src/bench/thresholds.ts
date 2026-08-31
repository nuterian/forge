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
 *
 * One later run, on a genuinely quiet machine, came in at or under every one
 * of those (raster.lines 0.717 · dots 0.350 · triangles 0.550 · kepler 0.550 ·
 * labels 0.006 · chart.frame 1.00 WITH the instrument plate). Only
 * cpu.chart.frame is re-budgeted from it below; the rest are left alone rather
 * than ratcheted on the strength of a single run.
 *
 * Re-budgeted once since: cpu.chart.frame, when the Star Chart gained its
 * instrument plate. See the note on that entry below.
 */

export const THRESHOLDS: Record<string, number> = {
  // GPU, ms per draw at 1920×1080, depth test off, sustained submission.
  'gpu.sky': 0.22,
  'gpu.post': 0.1,
  // Eight impressions instead of one — twenty-four texture samples against the
  // resting path's three. It measures 0.062ms against the resting pass's
  // 0.047, which is far less than eight times: the taps walk outward from the
  // same point and hit the same cache lines, so the pass stays bandwidth-bound
  // rather than sample-bound. Budgeted at roughly twice the measured figure,
  // like everything else here, rather than at what eight times three suggested.
  'gpu.post.warp': 0.15,
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
  // The stroke font, added with the Star Chart's instrument plate. Cheap: 600
  // glyphs is about 5000 very short Wu lines, and the glyph table is indexed
  // by character code so nothing allocates. Measured at 0.163ms outside the
  // browser, which scales to ~0.12ms against the one clean in-browser run
  // (that run put raster.lines at 0.717ms where the same loop takes 0.954ms in
  // node, a ratio of 1.33). Budgeted well above that because the figure is
  // derived; tighten once a clean run measures it directly.
  'cpu.raster.text': 0.3,
  // Re-budgeted from 2.5 when the Star Chart gained its instrument furniture:
  // the deep-sky stipple, the lettered cartouche, the compass rose and the
  // rim's degree ticks all landed inside this bench's workload.
  //
  // It went to 3.9 first, on an estimate, and that was too loose. The estimate
  // scaled the recorded 1.23ms best by the 1.57x the furniture costs when the
  // rasterizer is timed outside the browser. What it could not account for is
  // that the 1.23ms baseline was itself measured on a busy machine: one clean
  // in-browser run — every other row at or below its recorded best, raster
  // lines at 0.72ms against a recorded 1.83 — put the furniture-inclusive
  // frame at 1.00ms. Faster WITH the furniture than the number the old budget
  // was set from. So this follows the file's own rule against the figure that
  // was actually measured: twice 1.00, plus a little for a less quiet machine.
  'cpu.chart.frame': 2.2,
  'cpu.kepler': 1.3,
  'cpu.labels': 0.025,
};
