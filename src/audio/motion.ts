/**
 * The sound of moving.
 *
 * This site has no bed. Nothing hums, nothing sustains, and at rest it is
 * silent — which is the audio version of what the plates already do: hard
 * marks on empty paper, never a wash. What is left is the two things worth
 * hearing, motion and events, and this is the first of them.
 *
 * It is played by the reader. Drag to orbit and there is air moving; stop and
 * it is gone inside a third of a second. Nothing here runs on a clock: the
 * whole voice is a function of how fast the camera is actually travelling this
 * frame, so it cannot drone, and it cannot get out of step with what is on
 * screen because it is not keeping its own time.
 */

import type { AudioEngine, Voice } from './engine.ts';
import { Place } from './spatial.ts';
import { noiseBuffer, stopAndFree } from './util.ts';

/**
 * The two speeds, and what counts as fast.
 *
 * Angular for the chapters that turn on the spot (the Star Chart's sky is at
 * infinity, so its camera never moves a millimetre while you pan it) and
 * linear for the ones you fly through. Both are normalised to roughly 1 at a
 * brisk drag, and the louder of the two wins — they are the same gesture from
 * two different chapters, not two things happening at once.
 */
const FAST_ANGULAR = 2.6;
const FAST_LINEAR = 26;

/** Rise fast enough to feel like the drag; fall fast enough to be over. */
const ATTACK = 0.045;
const RELEASE = 0.11;

/** How loud a full-speed drag is. Under everything; noticed, not heard. */
const LEVEL = 0.38;

export class CameraMotion implements Voice {
  private readonly engine: AudioEngine;

  private place: Place | null = null;
  private env: GainNode | null = null;
  private band: BiquadFilterNode | null = null;
  private body: OscillatorNode | null = null;
  private air: AudioBufferSourceNode | null = null;
  private chain: AudioNode[] = [];

  /** Written every frame by the shell, read every frame here. */
  private speed = 0;
  private pan = 0;
  private smoothed = 0;
  private ending = false;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  /**
   * How fast the camera is going, and which way the drag is pushing.
   * `angular` is radians/second, `linear` is world units/second.
   */
  drive(angular: number, linear: number, pan: number): void {
    const a = Math.abs(angular) / FAST_ANGULAR;
    const l = Math.abs(linear) / FAST_LINEAR;
    const raw = a > l ? a : l;
    this.speed = raw > 1 ? 1 : raw;
    this.pan = pan;
  }

  private build(now: number): void {
    const ctx = this.engine.context;
    const bus = this.engine.bus('ambient');
    if (!ctx || !bus) return;

    const place = new Place(ctx, bus, { nearHz: 13000, farHz: 700, farGain: 0.25 });
    const env = ctx.createGain();
    env.gain.value = 0;
    env.connect(place.input);

    // The air: a band of noise that opens upward as you go faster. This is the
    // whole of the gesture — the body under it only stops it sounding like a
    // hiss gate.
    const air = ctx.createBufferSource();
    air.buffer = noiseBuffer(ctx);
    air.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 300;
    band.Q.value = 1.1;
    air.connect(band).connect(env);

    // A low tone that bends with speed, at a fifth of the level. Two layers,
    // because one band of noise sliding about is a sound effect and not a
    // movement.
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = 70;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.2;
    body.connect(bodyGain).connect(env);

    air.start(now, 0.37);
    body.start(now);

    this.place = place;
    this.env = env;
    this.band = band;
    this.body = body;
    this.air = air;
    this.chain = [band, bodyGain, env, ...place.nodes()];
    this.engine.hold();
  }

  update(dt: number, now: number): void {
    if (this.ending) return;
    if (!this.env) {
      this.build(now);
      return;
    }

    // Asymmetric smoothing, done here rather than left to the AudioParam:
    // setTargetAtTime has one time constant, and a movement needs to arrive
    // faster than it leaves or it lags the hand that made it.
    const target = this.speed;
    const tau = target > this.smoothed ? ATTACK : RELEASE;
    this.smoothed += (target - this.smoothed) * Math.min(1, dt / Math.max(tau, 1e-3));
    const s = this.smoothed;

    // Below a whisper, snap the whole envelope to a true zero rather than
    // trailing a very small number. Some chapters never quite stop — Worldsmith
    // tracks a planet that is itself on an orbit, so its camera creeps forever —
    // and without this the site has a floor instead of silence. Inaudible is
    // not the same as off, and off is what was asked for.
    if (s < 0.05) this.smoothed = 0;
    const level = this.smoothed < 0.05 ? 0 : LEVEL * this.smoothed * this.smoothed;
    this.env.gain.setTargetAtTime(level, now, 0.04);
    this.band!.frequency.setTargetAtTime(300 + s * 1900, now, 0.05);
    this.body!.frequency.setTargetAtTime(70 + s * 40, now, 0.06);
    this.place!.set(this.pan, 0.45 + s * 0.5, now, 0.08);
  }

  stop(now: number): void {
    if (this.ending) return;
    this.ending = true;
    if (!this.env) return;

    const gain = this.env.gain;
    const from = gain.value;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(from, now);
    gain.linearRampToValueAtTime(0, now + 0.12);

    const end = now + 0.15;
    if (this.body) stopAndFree(this.body, end, []);
    if (this.air) stopAndFree(this.air, end, this.chain, this.engine.release);
    this.place = null;
    this.env = null;
    this.band = null;
    this.body = null;
    this.air = null;
  }
}
