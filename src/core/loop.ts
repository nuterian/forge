/** requestAnimationFrame loop with a clamped delta and a simple FPS meter. */

export type FrameFn = (dt: number, elapsed: number) => void;

export class Loop {
  private frameId = 0;
  private last = 0;
  private running = false;
  private readonly fn: FrameFn;

  elapsed = 0;
  fps = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(fn: FrameFn) {
    this.fn = fn;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      // Clamp: a backgrounded tab shouldn't fast-forward the simulation.
      const dt = Math.min((now - this.last) / 1000, 1 / 15);
      this.last = now;
      this.elapsed += dt;

      this.fpsAccum += dt;
      this.fpsFrames++;
      if (this.fpsAccum >= 0.5) {
        this.fps = this.fpsFrames / this.fpsAccum;
        this.fpsAccum = 0;
        this.fpsFrames = 0;
      }

      this.fn(dt, this.elapsed);
      this.frameId = requestAnimationFrame(tick);
    };
    this.frameId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }
}
