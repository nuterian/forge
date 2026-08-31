/**
 * The sky's own sounds: things that go past you.
 *
 * Travel is not a texture, it is things arriving and leaving. There is no bed
 * under any of this — the index is silent except for the stars that actually
 * come close enough to matter, heard doing it. The star field reports them;
 * nothing here invents an event.
 *
 * Every pass is pitched from the same six roots the beds are tuned to, three
 * or four octaves up, so a handful of them drifting past at once is a chord
 * that keeps rearranging itself rather than a pile of unrelated tones.
 */

import { Rng } from '../core/rng.ts';
import type { AudioEngine, Voice } from './engine.ts';
import { ROOTS } from './tuning.ts';
import { Place } from './spatial.ts';
import { noiseBuffer, stopAndFree, strike } from './util.ts';

/** How loud one pass gets at its closest. Subtle: a suggestion, not an event. */
const PASS_LEVEL = 0.13;
/** The fade when a pass is cut short — a star respawning, or a page leaving. */
const PASS_OUT = 0.35;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * One star going by.
 *
 * Three layers, because a single sine going past is a test tone: the note, a
 * fifth above it at a fifth of the level, and a narrow band of noise at the
 * same pitch for breath. The Place underneath carries all three, so they move
 * as one object rather than as three sounds that happen to agree.
 */
export class StarPass implements Voice {
  private readonly engine: AudioEngine;
  private readonly pitch: number;
  private readonly breathQ: number;

  private place: Place | null = null;
  private env: GainNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private breath: AudioBufferSourceNode | null = null;
  private chain: AudioNode[] = [];

  private pan = 0;
  private near = 0;
  private lastNear = -1;
  private ending = false;

  constructor(engine: AudioEngine, rng: Rng) {
    this.engine = engine;
    // Three or four octaves over the beds: high enough to sit clear of the
    // room without ever being the brightest thing in it.
    this.pitch = rng.pick(ROOTS) * (rng.bool(0.55) ? 8 : 16);
    this.breathQ = rng.range(9, 18);
  }

  /** Where the star field says it is now. */
  at(pan: number, near: number): void {
    this.pan = pan;
    this.near = near;
  }

  private build(now: number): void {
    const ctx = this.engine.context;
    const bus = this.engine.bus('ambient');
    if (!ctx || !bus) return;

    // A pass starts far off and dull and arrives bright, which is the whole
    // effect; the Place does that from `near` alone.
    const place = new Place(ctx, bus, { nearHz: 11000, farHz: 380, farGain: 0.02 });
    const env = ctx.createGain();
    env.gain.value = 0;
    env.connect(place.input);

    const a = ctx.createOscillator();
    a.type = 'sine';
    a.frequency.value = this.pitch;
    const aGain = ctx.createGain();
    aGain.gain.value = PASS_LEVEL;
    a.connect(aGain).connect(env);

    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = this.pitch * 1.5;
    const bGain = ctx.createGain();
    bGain.gain.value = PASS_LEVEL * 0.22;
    b.connect(bGain).connect(env);

    const breath = ctx.createBufferSource();
    breath.buffer = noiseBuffer(ctx);
    breath.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = this.pitch;
    band.Q.value = this.breathQ;
    const breathGain = ctx.createGain();
    // Well under the tones. Noise is the first thing an ear finds and the
    // first thing it tires of; this is here for breath, not for texture.
    breathGain.gain.value = PASS_LEVEL * 0.22;
    breath.connect(band).connect(breathGain).connect(env);

    a.start(now);
    b.start(now);
    breath.start(now, Math.random() * 1.5);

    this.place = place;
    this.env = env;
    this.oscA = a;
    this.oscB = b;
    this.breath = breath;
    this.chain = [aGain, bGain, band, breathGain, env, ...place.nodes()];
    this.engine.hold();
  }

  update(dt: number, now: number): void {
    if (this.ending) return;
    if (!this.place) {
      this.build(now);
      return;
    }

    this.place.set(this.pan, this.near, now, 0.25);

    // A narrow window around the closest part of the approach, not the whole
    // of it. The star is in view for five seconds or so; it is audible for
    // about one and a half of them, and gone well before it leaves. A sound
    // that lasts as long as the thing that caused it stops being an event and
    // starts being a drone, which is the one thing this site does not do.
    //
    // `near` only ever rises, so the shape is read off it directly rather than
    // off a clock: the sound is a function of where the star is, not of how
    // long it has been sounding.
    const shape = smoothstep(0.42, 0.68, this.near) * (1 - smoothstep(0.74, 0.92, this.near));
    this.env!.gain.setTargetAtTime(shape, now, 0.12);

    // Doppler, and then a stylisation. The rise is real: the star is closing,
    // so its pitch climbs. Nothing in this field ever recedes — a star that
    // runs out of z is replaced rather than passing behind you — so the fall
    // on the tail is put there by hand, because a pass with no fall in it does
    // not read as having gone by.
    if (this.lastNear >= 0 && dt > 0) {
      const rate = (this.near - this.lastNear) / dt;
      const cents = rate * 210 - smoothstep(0.62, 1, this.near) * 34;
      this.oscA!.detune.setTargetAtTime(cents, now, 0.12);
      this.oscB!.detune.setTargetAtTime(cents, now, 0.12);
    }
    this.lastNear = this.near;
  }

  stop(now: number): void {
    if (this.ending) return;
    this.ending = true;
    if (!this.env) return;

    const gain = this.env.gain;
    const from = gain.value;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(from, now);
    gain.linearRampToValueAtTime(0, now + PASS_OUT);

    const end = now + PASS_OUT + 0.02;
    if (this.oscA) stopAndFree(this.oscA, end, []);
    if (this.oscB) stopAndFree(this.oscB, end, []);
    if (this.breath) stopAndFree(this.breath, end, this.chain, this.engine.release);
    this.place = null;
    this.env = null;
    this.oscA = null;
    this.oscB = null;
    this.breath = null;
  }
}

/**
 * A shooting star: a short airy zip, gone with the streak that drew it.
 *
 * Noise through a bandpass that sweeps down as the streak falls, panned to the
 * side it crosses. No tone in it at all — a meteor is friction, not a note, and
 * giving it a pitch would make it a chime.
 */
export function streakCue(engine: AudioEngine, pan: number): void {
  const ctx = engine.context;
  const bus = engine.bus('events');
  if (!ctx || !bus) return;

  const at = ctx.currentTime + 0.01;
  const life = 0.62;

  const place = new Place(ctx, bus, { nearHz: 14000, farHz: 900, farGain: 0.1 });
  place.set(pan, 0.72, at, 0.01);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(5200, at);
  band.frequency.exponentialRampToValueAtTime(900, at + life);
  band.Q.value = 1.6;

  const env = ctx.createGain();
  strike(env.gain, at, 0.36, 0.05, life - 0.05);

  src.connect(band).connect(env).connect(place.input);
  src.start(at);
  engine.hold();
  stopAndFree(src, at + life + 0.05, [band, env, ...place.nodes()], engine.release);
}
