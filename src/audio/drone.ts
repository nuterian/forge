/**
 * The bed: the room a chapter is heard in.
 *
 * Two detuned oscillators roughly an octave apart, through a lowpass, under a
 * slow wobble in pitch and amplitude, with a thread of bandpassed noise
 * underneath. That is the anatomy of the famous saber hum, which was never a
 * synthesizer at all — it was a projector motor and an idling television
 * picked up on a microphone, which is to say two detuned tones and a filter.
 * Dropped an octave and taken down to a whisper, the same three parts are a
 * starship's room tone, an observatory at night, or a world turning.
 *
 * Seeded, from its own stream. A given world always hums at its own pitch, and
 * rerolling changes it — but `audio:<seed>` never touches the chapter's main
 * rng, so no layout on screen moves because a sound was drawn.
 *
 * The three parts are not stacked in one place. Each sits at its own distance
 * and drifts on its own slow orbit around the listener, so what you are in is a
 * space rather than a chord: the tones close and nearly centred, the air at
 * middle distance sweeping one way, the partial far off and dull, sweeping the
 * other. Three layers a listener can pull apart is the difference between depth
 * and a loud bed — see spatial.ts for why the dulling with distance is doing
 * more of that work than the level is.
 */

import { Rng } from '../core/rng.ts';
import type { AudioEngine, Voice } from './engine.ts';
import { Place } from './spatial.ts';
import { noiseBuffer, stopAndFree } from './util.ts';

/**
 * The pitches a world can hum at.
 *
 * Six roots rather than twelve, and not a chromatic scale with a shuffle on
 * it: A, B, C, D, E, G — a low minor pentatonic with its second. Any two of
 * them sound deliberate against each other, which matters because navigating
 * crossfades one chapter's room into the next, and a semitone landing there
 * would read as a mistake rather than as a different place. A chromatic pick
 * would produce one about a third of the time.
 */
export const ROOTS = [55.0, 61.74, 65.41, 73.42, 82.41, 98.0];

function pickRoot(rng: Rng): number {
  return rng.pick(ROOTS);
}

/**
 * The note a seed will hum at, before the room's octave is applied.
 *
 * Exported so the warp can land its arrival on the pitch the chapter it is
 * delivering you to is about to start humming — which is what turns a whoosh
 * into an arrival somewhere. It draws from the same stream in the same order
 * as the constructor below, so the two cannot disagree.
 */
export function rootFor(seed: string): number {
  return pickRoot(new Rng(`audio:${seed}`));
}

/**
 * A chapter's character. The seed picks the note; this picks the instrument,
 * because a reader arriving at two chapters on the same seed must still hear
 * two different rooms.
 */
export interface Room {
  /** Multiplies the root: 1 is the written octave, 2 is one above. */
  octave: number;
  /** Lowpass cutoff as a multiple of the root, with its resonance. */
  cutoff: number;
  resonance: number;
  /** The octave partner's level against the root's. */
  upper: number;
  /**
   * The thread of air: centre frequency, bandwidth, and level.
   *
   * `air` is not comparable between rooms by eye. A bandpass passes noise power
   * in proportion to its effective bandwidth — about 1.57 x fc/Q — so the same
   * number is twenty-odd decibels louder at Q 0.8 than at Q 3, and these gains
   * were each solved backwards from the ratio the room wanted against its
   * tones rather than picked to look consistent in the source.
   *
   * That ratio wants to be around thirty decibels, not fifteen. Noise and a
   * tone at the same measured level are nothing like as loud as each other:
   * the tone sits in one critical band and the noise smears across twenty, so
   * the ear finds it first and tires of it fastest. A bed set by the numbers
   * to sit "under" the tones was reported as plainly noisy, and it was right.
   * Keep the bands narrow (Q at or above 1.5) and out of 2-4 kHz, where the
   * ear is most sensitive and where hiss is least forgivable.
   */
  airHz: number;
  airQ: number;
  air: number;
  /**
   * The room's third layer: one sine at this ratio to the root, swelling in
   * and out on its own slow cycle, past the lowpass so it stays audible above
   * the tones. Pitch and air alone give a room a size; this is what gives it a
   * subject — the cold pinprick over the star chart, the gear ratio under the
   * orrery, the heat inside a world. Kept far enough down that a listener
   * finds it rather than hears it.
   */
  partial: number;
  partialLevel: number;
  /** The slow wobble: rate in Hz, pitch swing in cents, amplitude swing. */
  wobbleHz: number;
  cents: number;
  depth: number;
  /** Level into the ambient bus. */
  level: number;
  /**
   * How wide the room is: how far the air and the partial swing to either side
   * as they drift, and how far off the partial sits. 0 collapses the room to
   * the middle of your head, which is where a bed with no depth lives.
   */
  width: number;
}

/** How long the room takes to arrive, and to leave. */
const FADE_IN = 1.5;
const FADE_OUT = 0.55;

export class Drone implements Voice {
  private readonly engine: AudioEngine;
  private readonly room: Room;

  // Everything the seed decides, drawn once at construction so the pitch is
  // fixed before a single node exists — and so it is the same whether sound
  // was on when the chapter opened or switched on a minute later.
  private readonly root: number;
  private readonly detune: number;
  private readonly wobbleHz: number;
  private readonly airHz: number;
  private readonly swellHz: number;
  private readonly phase: number;

  private oscLow: OscillatorNode | null = null;
  private oscHigh: OscillatorNode | null = null;
  private oscPartial: OscillatorNode | null = null;
  private partialGain: GainNode | null = null;
  private placeTone: Place | null = null;
  private placeAir: Place | null = null;
  private placePartial: Place | null = null;
  /** Each layer's own drift rate and starting angle, drawn from the seed. */
  private readonly driftAir: number;
  private readonly driftPartial: number;
  private readonly driftTone: number;
  private air: AudioBufferSourceNode | null = null;
  private wobbleGain: GainNode | null = null;
  private fade: GainNode | null = null;
  private chain: AudioNode[] = [];

  /**
   * The cosmetic clock. Accumulated from the frame's dt and nothing else: the
   * bed is scenery, like the corona's simmer and the clouds' drift, so a
   * reader who pauses the orrery or winds the pace to a tenth must still be
   * standing in a room that is alive. The same rule the visuals follow.
   */
  private clock = 0;
  private leaving = false;

  /**
   * Which way the listener is facing, in radians — the chapter's camera yaw.
   *
   * The room is fixed and you turn inside it, so dragging the view swings the
   * layers around your head. It is the cheapest honest link there is between
   * what a reader is doing and what they hear, and it is the thing that stops
   * three drifting layers from sounding like an effect on a bed: they belong
   * to the place rather than to the sound.
   */
  private bearing = 0;

  /** Point the listener. Safe to call every frame with the same value. */
  setBearing(radians: number): void {
    this.bearing = radians;
  }

  constructor(engine: AudioEngine, seed: string, room: Room) {
    this.engine = engine;
    this.room = room;

    const rng = new Rng(`audio:${seed}`);
    // The first draw, and rootFor() above depends on it staying first.
    this.root = pickRoot(rng) * room.octave;
    // Cents, not Hz: the beat between the octave partner and the root's second
    // harmonic has to stay the same *musical* width at every pitch, or the low
    // tunings shimmer and the high ones sound merely out of tune.
    this.detune = rng.range(5, 12) * (rng.bool() ? 1 : -1);
    this.wobbleHz = room.wobbleHz * rng.range(0.8, 1.3);
    this.airHz = room.airHz * rng.range(0.85, 1.2);
    // Slower than the wobble by an order of magnitude, and never a whole
    // multiple of it: the two must not line up into one obvious pulse.
    this.swellHz = room.wobbleHz * rng.range(0.11, 0.19);
    // Three drift rates, all slower than anything else in the voice and none a
    // simple ratio of another: the layers must never line up into one wide
    // sound that swings as a block.
    this.driftAir = rng.range(0.021, 0.037);
    this.driftPartial = rng.range(0.013, 0.024);
    this.driftTone = rng.range(0.008, 0.015);
    this.phase = rng.range(0, Math.PI * 2);
  }

  /**
   * Build the graph, the first time there is a context to build it in.
   *
   * Deferred rather than done in the constructor because sound is opt-in: a
   * chapter opened in silence must be able to start humming the moment the
   * reader turns the switch, without reloading anything.
   */
  private build(now: number): void {
    const ctx = this.engine.context;
    const bus = this.engine.bus('ambient');
    if (!ctx || !bus) return;

    const room = this.room;

    // The fade stage is separate from the wobble stage on purpose: arrival and
    // departure must not fight the amplitude modulation for the same param.
    const fade = ctx.createGain();
    fade.gain.value = 0;
    fade.connect(bus);
    fade.gain.linearRampToValueAtTime(room.level, now + FADE_IN);

    const wobble = ctx.createGain();
    wobble.gain.value = 1;
    wobble.connect(fade);

    // Three places, at three depths. The tones are here in the room with you
    // and barely move; the air is at middle distance and sweeps; the partial is
    // furthest, dullest and slowest. Nothing but the drift rates and the width
    // separates them, and that is enough — see spatial.ts.
    const placeTone = new Place(ctx, wobble, { farHz: 2600, farGain: 0.55 });
    const placeAir = new Place(ctx, wobble, { nearHz: 9000, farHz: 900, farGain: 0.3 });
    const placePartial = new Place(ctx, wobble, { nearHz: 6000, farHz: 700, farGain: 0.2 });

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = this.root * room.cutoff;
    lowpass.Q.value = room.resonance;
    lowpass.connect(placeTone.input);

    // The root, as a sawtooth: it needs a second harmonic for the octave
    // partner to beat against, and a triangle has none. The lowpass takes the
    // rest of the harmonics back off again.
    const low = ctx.createOscillator();
    low.type = 'sawtooth';
    low.frequency.value = this.root;
    const lowGain = ctx.createGain();
    lowGain.gain.value = 0.5;
    low.connect(lowGain).connect(lowpass);

    // The octave, detuned by a few cents. This pair is the whole hum: the beat
    // between them is what keeps a sustained tone from sounding like a test.
    const high = ctx.createOscillator();
    high.type = 'triangle';
    high.frequency.value = this.root * 2;
    high.detune.value = this.detune;
    const highGain = ctx.createGain();
    highGain.gain.value = room.upper;
    high.connect(highGain).connect(lowpass);

    // The third layer, past the lowpass rather than through it: at four or
    // five times the root it would be cut away by the filter that shapes the
    // tones, and the point of it is to sit above them.
    const partial = ctx.createOscillator();
    partial.type = 'sine';
    partial.frequency.value = this.root * room.partial;
    partial.detune.value = -this.detune;
    const partialGain = ctx.createGain();
    partialGain.gain.value = 0;
    partial.connect(partialGain).connect(placePartial.input);

    // The air underneath, which is what makes it a room and not a chord.
    const air = ctx.createBufferSource();
    air.buffer = noiseBuffer(ctx);
    air.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = this.airHz;
    band.Q.value = room.airQ;
    const airGain = ctx.createGain();
    airGain.gain.value = room.air;
    air.connect(band).connect(airGain).connect(placeAir.input);

    low.start(now);
    high.start(now);
    partial.start(now);
    // Start the noise somewhere arbitrary in the buffer so two chapters open
    // in the same session are not looping the same two seconds in lockstep.
    air.start(now, (this.phase / (Math.PI * 2)) * air.buffer.duration);

    this.oscLow = low;
    this.oscHigh = high;
    this.oscPartial = partial;
    this.partialGain = partialGain;
    this.placeTone = placeTone;
    this.placeAir = placeAir;
    this.placePartial = placePartial;
    this.air = air;
    this.wobbleGain = wobble;
    this.fade = fade;
    this.chain = [
      lowGain, highGain, partialGain, band, airGain, lowpass, wobble, fade,
      ...placeTone.nodes(), ...placeAir.nodes(), ...placePartial.nodes(),
    ];
    this.engine.hold();
  }

  update(dt: number, now: number): void {
    if (this.leaving) return;
    this.clock += dt;
    if (!this.oscLow) {
      this.build(now);
      return;
    }

    // Two rates, deliberately incommensurate, so the wobble never settles into
    // an audible loop. Written with setTargetAtTime rather than a ramp: the
    // target moves again next frame, and a linear ramp to a moving target
    // spends every frame fighting the last one.
    const t = this.clock + this.phase;
    const slow = Math.sin(t * this.wobbleHz * Math.PI * 2);
    const slower = Math.sin(t * this.wobbleHz * 1.618 * Math.PI * 2 + 1.1);

    const cents = slow * this.room.cents;
    this.oscLow!.detune.setTargetAtTime(cents, now, 0.05);
    this.oscHigh!.detune.setTargetAtTime(this.detune + cents * 0.6, now, 0.05);
    this.wobbleGain!.gain.setTargetAtTime(1 - this.room.depth * (0.5 - slower * 0.5), now, 0.08);

    // The third layer, breathing on its own much slower cycle. Never quite off
    // and never quite full, so it reads as a thing that is always there and
    // only sometimes noticed.
    const swell = 0.5 - 0.5 * Math.cos(t * this.swellHz * Math.PI * 2);
    this.partialGain!.gain.setTargetAtTime(this.room.partialLevel * (0.2 + 0.8 * swell), now, 0.15);

    // And move all three. Each rides its own slow circle around the listener:
    // sin gives the side it is on, cos gives how near, so a layer is closest as
    // it crosses the middle and furthest and dullest as it swings out wide.
    // The partial runs backwards, so the room breathes open rather than
    // rotating as a block.
    // Subtracted, not added: turning your head to the right sends the room to
    // the left, which is the only sign of this that is not disorienting.
    const w = this.room.width;
    const b = this.bearing;
    const aAir = t * this.driftAir * Math.PI * 2 - b;
    const aPar = -t * this.driftPartial * Math.PI * 2 + 2.4 - b;
    const aTon = t * this.driftTone * Math.PI * 2 + 0.9 - b;
    this.placeTone!.set(Math.sin(aTon) * w * 0.22, 0.86 + 0.14 * Math.cos(aTon), now, 0.3);
    this.placeAir!.set(Math.sin(aAir) * w, 0.42 + 0.3 * Math.cos(aAir), now, 0.3);
    this.placePartial!.set(Math.sin(aPar) * w * 0.85, 0.2 + 0.22 * Math.cos(aPar), now, 0.3);
  }

  stop(now: number): void {
    if (this.leaving) return;
    this.leaving = true;
    const fade = this.fade;
    if (!fade) return;

    // Read the level BEFORE cancelling, not after. cancelScheduledValues drops
    // a ramp that has not finished, and the param then reverts to the value it
    // held before that ramp began — which for a room still fading in is zero.
    // Reading second therefore fades from silence to silence and cuts the
    // room dead, which is exactly the click this codebase forbids.
    const gain = fade.gain;
    const from = gain.value;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(from, now);
    gain.linearRampToValueAtTime(0, now + FADE_OUT);

    // Free at the end of the fade, not at the start of it. The shared tail of
    // the graph rides on the last source's teardown; the engine's own count is
    // decremented once, by that one.
    const end = now + FADE_OUT + 0.02;
    if (this.oscLow) stopAndFree(this.oscLow, end, []);
    if (this.oscHigh) stopAndFree(this.oscHigh, end, []);
    if (this.oscPartial) stopAndFree(this.oscPartial, end, []);
    if (this.air) stopAndFree(this.air, end, this.chain, this.engine.release);
    this.oscLow = null;
    this.oscHigh = null;
    this.oscPartial = null;
    this.partialGain = null;
    this.placeTone = null;
    this.placeAir = null;
    this.placePartial = null;
    this.air = null;
    this.wobbleGain = null;
    this.fade = null;
  }
}
