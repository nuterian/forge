/**
 * The chrome's own sounds: dry, short, mechanical.
 *
 * The house style forbids a beep. Every one of these is a *press* — a switch
 * closing, a plate seating, a stamp landing — which in synthesis terms means a
 * band of noise with a very fast attack and a short release, sometimes with a
 * low body under it, and never a sustained tone.
 */

import type { AudioEngine } from './engine.ts';
import { noiseBuffer, stopAndFree, strike } from './util.ts';

/**
 * A switch closing: a click of filtered air over a short low body.
 *
 * This is what confirms the sound toggle, and it is deliberately the first
 * thing anyone hears on this site — it says "that worked" without saying
 * anything else. Everything is scheduled against the audio clock in one go and
 * torn down by `stopAndFree`, so a hundred of them leave nothing behind.
 */
export function switchCue(engine: AudioEngine, up: boolean): void {
  const ctx = engine.context;
  const bus = engine.bus('ui');
  if (!ctx || !bus) return;

  const at = ctx.currentTime + 0.005;
  engine.hold();
  engine.hold();

  // The click: a narrow band of air, higher going on than coming off, which is
  // the whole difference between a switch making and breaking.
  const click = ctx.createBufferSource();
  click.buffer = noiseBuffer(ctx);
  click.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = up ? 2400 : 1500;
  band.Q.value = 1.4;
  const clickGain = ctx.createGain();
  strike(clickGain.gain, at, 0.4, 0.002, 0.05);
  click.connect(band).connect(clickGain).connect(bus);
  click.start(at);
  stopAndFree(click, at + 0.09, [band, clickGain], engine.release);

  // The body: one short pitched thud so the click has a weight, not a fizz.
  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(up ? 196 : 147, at);
  body.frequency.exponentialRampToValueAtTime(up ? 262 : 110, at + 0.06);
  const bodyGain = ctx.createGain();
  strike(bodyGain.gain, at, 0.16, 0.004, 0.1);
  body.connect(bodyGain).connect(bus);
  body.start(at);
  stopAndFree(body, at + 0.14, [bodyGain], engine.release);
}
