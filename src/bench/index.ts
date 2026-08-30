/**
 * The benchmark plate — #/bench, deliberately absent from the nav and the
 * proof sheet. Runs the whole suite against the committed thresholds and
 * prints a report: green means the budget holds, red means the code got
 * slower than we promised it would stay.
 */

import type { ChapterContext, ChapterInstance } from '../app/chapter.ts';
import { runAllBenches } from './benches.ts';
import { THRESHOLDS } from './thresholds.ts';
import type { BenchResult } from './harness.ts';

export function create(ctx: ChapterContext): ChapterInstance {
  const { gl } = ctx;

  const root = document.createElement('div');
  root.className = 'bench-report';
  const hiddenWarning = document.visibilityState !== 'visible'
    ? '<p class="bench-note">⚠ This tab is hidden or occluded — the browser throttles it onto slow cores, and every number will read high. Best-of-rounds resists this, but calibration wants a visible tab.</p>'
    : '';
  root.innerHTML = `<h2 class="bench-title">Running the suite…</h2><div class="bench-progress"></div>${hiddenWarning}`;
  document.body.append(root);

  let disposed = false;

  const render = (results: BenchResult[]): void => {
    if (disposed) return;
    let pass = 0;
    let fail = 0;
    let skipped = 0;

    const rows = results
      .map((r) => {
        if (r.skipped) {
          skipped++;
          return `<tr class="is-skipped"><td>${r.id}</td><td>${r.name}</td><td>—</td><td>—</td><td>SKIP</td></tr>`;
        }
        const threshold = THRESHOLDS[r.id];
        const ok = threshold === undefined || r.best <= threshold;
        ok ? pass++ : fail++;
        const spread = r.samples.length
          ? ` <span class="bench-spread">(worst ${Math.max(...r.samples).toFixed(3)})</span>`
          : '';
        return `<tr class="${ok ? 'is-pass' : 'is-fail'}">
          <td>${r.id}</td><td>${r.name}</td>
          <td>${r.best.toFixed(3)}ms${spread}</td>
          <td>${threshold === undefined ? '—' : `${threshold.toFixed(3)}ms`}</td>
          <td>${ok ? 'PASS' : 'FAIL'}</td></tr>`;
      })
      .join('');

    const verdict = fail === 0 ? `ALL ${pass} WITHIN BUDGET` : `${fail} OVER BUDGET, ${pass} within`;
    const json = JSON.stringify(
      Object.fromEntries(results.filter((r) => !r.skipped).map((r) => [r.id, +r.best.toFixed(4)])),
      null, 2,
    );

    root.innerHTML = `
      <h2 class="bench-title ${fail ? 'is-fail' : 'is-pass'}">${verdict}${skipped ? ` · ${skipped} skipped` : ''}</h2>
      <table class="bench-table">
        <thead><tr><th>id</th><th>bench</th><th>best</th><th>budget</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <details class="bench-json"><summary>results as JSON</summary><pre>${json}</pre></details>
      <p class="bench-note">Budgets live in src/bench/thresholds.ts, calibrated on the development
      machine. The reported figure is the best of several rounds — noise only ever adds
      time, so the minimum is the number the code is responsible for. Keep this
      tab visible while it runs.</p>`;
  };

  const progress = (done: number, total: number, id: string): void => {
    if (disposed) return;
    const el = root.querySelector('.bench-progress');
    if (el) el.textContent = `${done}/${total} · ${id}`;
  };

  runAllBenches(gl, progress)
    .then(render)
    .catch((err) => {
      if (disposed) return;
      root.innerHTML = `<h2 class="bench-title is-fail">Suite failed</h2><pre>${String(err)}</pre>`;
    });

  return {
    update() { /* the report is DOM; nothing simulates */ },
    render() {
      // Paper only — the report reads better on a still page.
      gl.clearColor(0.04, 0.05, 0.07, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    dispose() {
      disposed = true;
      root.remove();
    },
  };
}
