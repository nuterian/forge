/**
 * Measurement instruments for the benchmark plate (#/bench).
 *
 * GPU passes are timed with EXT_disjoint_timer_query_webgl2: one query brackets
 * N repetitions of a draw, the result is polled asynchronously, and the whole
 * thing is repeated for a median — wall-clock timing of GL calls measures
 * command submission, not the GPU, and lies by an order of magnitude.
 *
 * CPU work is timed with performance.now() around batches sized to dwarf the
 * timer's resolution, again taking the median of several samples so a stray
 * GC pause or a background tab doesn't write the number.
 */

export interface BenchResult {
  id: string;
  name: string;
  kind: 'gpu' | 'cpu';
  /**
   * Milliseconds per iteration (one draw, one frame, one batch — see name),
   * the *minimum* across rounds. Noise — GC, tab throttling, another process
   * on the GPU — only ever adds time, so the minimum is the one statistic the
   * environment cannot inflate: it is what the code can do, and it moves only
   * when the code itself changes. Medians here swung 4× between runs of an
   * unchanged build; minima held.
   */
  best: number;
  samples: number[];
  /** Set when the environment cannot run this bench (no timer extension). */
  skipped?: string;
}

export function best(values: number[]): number {
  return Math.min(...values);
}

// -- GPU ---------------------------------------------------------------------

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class GpuTimer {
  private readonly gl: WebGL2RenderingContext;
  readonly ext: TimerExt | null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  }

  /**
   * Time `reps` calls of `draw` on the GPU; resolves to ms per call.
   * `prepare` runs once, before the query opens — bind targets, set uniforms
   * there, so state upload never pollutes the shading measurement.
   */
  async time(draw: () => void, reps: number, prepare?: () => void): Promise<number> {
    const gl = this.gl;
    const ext = this.ext;
    if (!ext) throw new Error('EXT_disjoint_timer_query_webgl2 unavailable');

    prepare?.();
    const query = gl.createQuery()!;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    for (let i = 0; i < reps; i++) draw();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    gl.flush();

    // Results land a few frames later; poll off the critical path.
    for (;;) {
      await new Promise((r) => setTimeout(r, 8));
      if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
    }
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
    gl.deleteQuery(query);
    if (disjoint) throw new Error('disjoint');
    return ns / 1e6 / reps;
  }

  /** Median of `rounds` timings, retrying rounds the driver marks disjoint. */
  async run(draw: () => void, reps: number, prepare?: () => void, rounds = 5): Promise<number[]> {
    const samples: number[] = [];
    let retries = 0;
    while (samples.length < rounds && retries < rounds * 3) {
      try {
        samples.push(await this.time(draw, reps, prepare));
      } catch {
        retries++;
      }
    }
    if (!samples.length) throw new Error('all GPU timing rounds were disjoint');
    return samples;
  }
}

// -- CPU ---------------------------------------------------------------------

/**
 * Median ms for one call of `fn`, measured as `reps` calls per sample over
 * `rounds` samples. A `setup` runs before each sample, outside the clock.
 */
export function cpuBench(
  fn: () => void,
  opts: { reps: number; rounds?: number; setup?: () => void },
): number[] {
  const rounds = opts.rounds ?? 7;
  // Warm the JIT so the first sample isn't measuring compilation.
  opts.setup?.();
  for (let i = 0; i < Math.max(1, opts.reps >> 2); i++) fn();

  const samples: number[] = [];
  for (let round = 0; round < rounds; round++) {
    opts.setup?.();
    const t0 = performance.now();
    for (let i = 0; i < opts.reps; i++) fn();
    samples.push((performance.now() - t0) / opts.reps);
  }
  return samples;
}
