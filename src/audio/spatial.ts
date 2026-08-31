/**
 * Where a sound is.
 *
 * Web Audio ships a PannerNode that will do distance and HRTF for you, and this
 * does not use it — for the same reason the chapters do not use three.js. The
 * whole of it is four numbers you can name:
 *
 *   pan       which side of you it is on
 *   gain      how far away it is
 *   cutoff    air absorption: distance eats the top end long before it eats
 *             the level, which is the cue that actually reads as depth
 *   detune    Doppler, written by the caller from its own geometry
 *
 * The third one is the one that matters. A quiet copy of a bright sound reads
 * as a quiet sound; a dull one reads as a distant one. HRTF would cost far more
 * and would be the wrong instrument anyway — this production is a flat print
 * with hard bands, not a room simulation.
 */

/** A source placed somewhere around the listener. */
export class Place {
  /** Connect the source here. */
  readonly input: BiquadFilterNode;
  private readonly panner: StereoPannerNode;
  private readonly gain: GainNode;

  /** How dull the farthest distance is, and how bright the nearest. */
  private readonly nearHz: number;
  private readonly farHz: number;
  /** Level at the farthest distance; 1 at the nearest. */
  private readonly farGain: number;

  constructor(
    ctx: BaseAudioContext,
    dest: AudioNode,
    opts: { nearHz?: number; farHz?: number; farGain?: number } = {},
  ) {
    this.nearHz = opts.nearHz ?? 12000;
    this.farHz = opts.farHz ?? 520;
    this.farGain = opts.farGain ?? 0.06;

    this.input = ctx.createBiquadFilter();
    this.input.type = 'lowpass';
    this.input.frequency.value = this.nearHz;
    this.input.Q.value = 0.5;

    this.panner = ctx.createStereoPanner();
    this.gain = ctx.createGain();
    this.gain.gain.value = 1;

    this.input.connect(this.panner).connect(this.gain).connect(dest);
  }

  /**
   * Put it somewhere. `near` runs 0 (as far off as this voice ever gets) to 1
   * (right here); `pan` runs -1 to +1.
   *
   * Both curves are exponential rather than linear, because both of the things
   * they model are: loudness falls with the square of distance, and brightness
   * falls faster still. Written with setTargetAtTime — these move every frame,
   * and a ramp toward a target that moves again next frame spends its whole
   * life being cancelled.
   */
  set(pan: number, near: number, now: number, tau = 0.1): void {
    const n = near < 0 ? 0 : near > 1 ? 1 : near;
    const level = this.farGain + (1 - this.farGain) * n * n;
    const hz = this.farHz * Math.pow(this.nearHz / this.farHz, n);
    this.gain.gain.setTargetAtTime(level, now, tau);
    this.input.frequency.setTargetAtTime(hz, now, tau);
    this.panner.pan.setTargetAtTime(pan < -1 ? -1 : pan > 1 ? 1 : pan, now, tau);
  }

  /** Set the level directly, past the distance curve — for fades. */
  get level(): AudioParam {
    return this.gain.gain;
  }

  /** Every node this owns, for a caller's teardown chain. */
  nodes(): AudioNode[] {
    return [this.input, this.panner, this.gain];
  }

  disconnect(): void {
    this.input.disconnect();
    this.panner.disconnect();
    this.gain.disconnect();
  }
}
