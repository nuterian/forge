/**
 * Small primitives every voice on the site is built from.
 *
 * Two rules live here, and both are the audio version of a rule the visuals
 * already keep:
 *
 *  - Never assign `.value` on a live AudioParam. A step in a gain is a click,
 *    and a click is the hard cut this production does not make anywhere else.
 *    Everything ramps.
 *  - Every one-shot is stopped AND disconnected. A stopped oscillator that is
 *    still connected keeps its whole chain alive; it costs nothing you can
 *    measure until a few minutes of navigating have left four hundred of them
 *    hanging off a bus.
 */

import { Rng } from '../core/rng.ts';

/**
 * Ramp to a value and actually arrive there, by `seconds` from `now`.
 *
 * The cancel-then-anchor pair is what makes this safe to call over a ramp
 * already in flight: cancelling alone would leave the param at whatever the
 * last *scheduled* value was and jump, so the current computed value is pinned
 * down first and the new ramp starts from there.
 */
export function rampTo(param: AudioParam, value: number, now: number, seconds: number): void {
  const from = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  param.linearRampToValueAtTime(value, now + Math.max(seconds, 1 / 1000));
}

/**
 * Chase a value exponentially — for parameters written every frame, where a
 * linear ramp to a target that moves again next frame would fight itself.
 * `tau` is the time constant: about 63% of the way there per tau.
 */
export function glideTo(param: AudioParam, value: number, now: number, tau: number): void {
  param.setTargetAtTime(value, now, Math.max(tau, 1 / 1000));
}

/**
 * A short envelope struck at `at`: silence, up over `attack`, down over
 * `release`. Written as ramps rather than an oscillator's own gain so the same
 * shape can drive a filter cutoff or a detune just as easily.
 */
export function strike(
  param: AudioParam, at: number, peak: number, attack: number, release: number,
): void {
  param.setValueAtTime(0, at);
  param.linearRampToValueAtTime(peak, at + attack);
  // Exponential on the way down is what makes a tick read as a tick; it cannot
  // reach zero, so the ramp lands just above it and a final step cleans up
  // under cover of silence.
  param.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-4), at + attack + release);
  param.setValueAtTime(0, at + attack + release + 0.001);
}

/**
 * Stop a source and tear its chain down when it ends.
 *
 * `onended` fires on the main thread after the audio thread has finished with
 * the node, which is the only moment it is safe to disconnect. `free` runs
 * exactly once and reports back so a leak counter can be kept honest.
 *
 * There is a wall-clock backstop behind it, and it is not belt and braces: if
 * the context is suspended before `when` — the reader turned sound off, or the
 * tab went away — the audio clock stops, `stop(when)` never arrives, `onended`
 * never fires, and the node stays connected for the life of the page. The
 * backstop tears it down anyway. Cutting a sound that is already inaudible
 * costs nothing; keeping it alive costs the leak this whole file exists to
 * prevent.
 */
export function stopAndFree(
  source: AudioScheduledSourceNode,
  when: number,
  chain: AudioNode[],
  onFree?: () => void,
): void {
  let freed = false;
  const free = (): void => {
    if (freed) return;
    freed = true;
    source.onended = null;
    try {
      source.disconnect();
    } catch { /* already gone */ }
    for (const node of chain) {
      try {
        node.disconnect();
      } catch { /* already gone */ }
    }
    onFree?.();
  };
  source.onended = free;
  setSoon(free, Math.max(0, when - source.context.currentTime) + 0.5);
  try {
    source.stop(when);
  } catch {
    // Already stopped: onended will not fire again, so free now.
    free();
  }
}

/**
 * Run `fn` after `seconds`, on the wall clock.
 *
 * Deliberately not scheduled against the audio clock: this is for teardown
 * bookkeeping on the main thread, which has to happen even if the context is
 * suspended halfway through — an audio-clock callback on a parked context
 * would never arrive, and the node it was going to free would live forever.
 */
export function setSoon(fn: () => void, seconds: number): void {
  setTimeout(fn, Math.max(0, seconds * 1000));
}

/**
 * Two seconds of white noise, made once per context and shared.
 *
 * Every noisy voice on the site loops or windows this one buffer: the drone's
 * air, the warp's rush, the dry ticks in the chrome. Building it from the
 * project's own seeded generator rather than Math.random is not superstition —
 * it means the "recording" underneath every sound is itself reproducible, the
 * same promise the star field makes.
 */
const NOISE_SECONDS = 2;
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const length = Math.ceil(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = new Rng('audio:noise');
  for (let i = 0; i < length; i++) data[i] = rng.range(-1, 1);
  noiseCache.set(ctx, buffer);
  return buffer;
}
