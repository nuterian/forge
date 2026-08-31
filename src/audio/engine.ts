/**
 * The site's voice.
 *
 * Everything you hear on this site is synthesized here, from oscillators,
 * filtered noise and envelopes — the same contract the visuals keep. Nothing
 * is stored: no sample, no buffer of somebody else's recording, not one audio
 * file in the build. A folder of .mp3s would be the only asset in a project
 * that has none.
 *
 * The engine owns three things and nothing else: the AudioContext, an output
 * stage (master gain into a limiter), and a small set of named buses so the
 * later voices mix against something fixed rather than against each other's
 * guesses.
 *
 * It is strictly opt-in, and "not started" is a normal state it handles at
 * every entry point rather than an error it guards against. Browsers will not
 * let a page make noise before a gesture — which is the right policy — so the
 * context is not even constructed until someone asks for sound.
 */

import { rampTo, setSoon } from './util.ts';

/**
 * Where a sound goes.
 *
 * ambient — the bed. Always running while a chapter is open, always quietest.
 * events  — the rare moments. Loud enough to be noticed over the bed.
 * ui      — chrome. Dry, short, and never allowed to become a beep.
 */
export type BusName = 'ambient' | 'events' | 'ui';

/**
 * The mix, fixed in code. There is one control on this site and it is on/off;
 * these are the numbers a mixer would otherwise ask the reader to discover.
 */
const BUS_TRIM: Record<BusName, number> = {
  ambient: 0.62,
  events: 0.85,
  ui: 0.5,
};

/**
 * Master level with sound on. Deliberately low: the whole thing should sit
 * under a listener's attention until they think about it.
 */
const MASTER_GAIN = 0.34;

/** How long the master takes to open and close. Long enough never to click. */
const MASTER_RAMP = 0.14;

/**
 * How long the master stays open after sound is switched off.
 *
 * Just long enough for the cue that confirms the switch to be heard. Without
 * it the confirmation fades out underneath itself and turning sound off is the
 * one action on the site with no feedback at all — which is exactly the moment
 * a reader most wants to know something happened.
 */
const OFF_HOLD = 0.17;

const STORAGE_KEY = 'forge:sound';

/** A running voice the engine ticks and can shut down on its behalf. */
export interface Voice {
  /** `now` is AudioContext.currentTime; `dt` is the frame's clamped seconds. */
  update(dt: number, now: number): void;
  /** Ramp down and free everything. Must leave nothing connected. */
  stop(now: number): void;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private busNodes: Record<BusName, GainNode> | null = null;

  /**
   * What the reader has asked for, which is not the same as what is running.
   * The preference survives a reload; the context cannot be built until the
   * next gesture, so between those two moments this is true and `ctx` is null.
   */
  private wanted = false;
  /** Set once the tab is hidden, so returning to it knows to resume. */
  private suspendedByVisibility = false;
  private disposed = false;

  private readonly voices = new Set<Voice>();

  /**
   * Nodes the engine is currently keeping alive on someone's behalf. Voices
   * and one-shots both report here, which is the only way to see the leak that
   * matters in Web Audio: a stopped oscillator that was never disconnected
   * keeps its whole chain alive and costs nothing measurable until there are
   * four hundred of them.
   */
  live = 0;

  /**
   * Report one tracked node freed. A single shared arrow rather than a closure
   * per one-shot: `stopAndFree` already guarantees it runs at most once, so
   * there is nothing per-sound to capture and nothing to allocate.
   */
  readonly release = (): void => {
    this.live--;
  };

  /** Count a one-shot in. Pair with `release` as `stopAndFree`'s callback. */
  hold(): void {
    this.live++;
  }

  private readonly onGesture = (): void => this.kick();
  private readonly onVisibility = (): void => this.syncVisibility();

  constructor() {
    try {
      this.wanted = localStorage.getItem(STORAGE_KEY) === 'on';
    } catch {
      this.wanted = false; // private mode: the default, which is off
    }

    // Capture, and passive: this must never interfere with a drag on the
    // canvas or with the click that is also a navigation.
    window.addEventListener('pointerdown', this.onGesture, { capture: true, passive: true });
    window.addEventListener('keydown', this.onGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** What the toggle should show. */
  get enabled(): boolean {
    return this.wanted;
  }

  /** True only when there is a context and it is actually rendering. */
  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** AudioContext.currentTime, or 0 when there is no context yet. */
  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /**
   * The node a voice should connect to, or null when there is no context —
   * which callers must treat as "no sound right now", not as a failure.
   */
  bus(name: BusName): GainNode | null {
    return this.busNodes?.[name] ?? null;
  }

  /** The context, for scheduling. Null until the first gesture with sound on. */
  get context(): AudioContext | null {
    return this.ctx;
  }

  // -- the one control -------------------------------------------------------

  setEnabled(on: boolean): void {
    if (this.disposed || on === this.wanted) return;
    this.wanted = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      /* no storage: the choice lasts the session, which is better than nothing */
    }

    if (on) {
      // Called from a click handler, so this IS the gesture.
      this.kick();
    } else if (this.ctx && this.master) {
      const gain = this.master.gain;
      const now = this.ctx.currentTime;
      const from = gain.value;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(from, now);
      gain.setValueAtTime(from, now + OFF_HOLD);
      gain.linearRampToValueAtTime(0, now + OFF_HOLD + MASTER_RAMP);
      // Park the context once the ramp has actually landed. Suspending mid-ramp
      // freezes the gain wherever it got to, and it would still be there,
      // audible, the moment anything resumed it.
      setSoon(() => {
        if (!this.wanted) void this.ctx?.suspend();
      }, (OFF_HOLD + MASTER_RAMP) * 2);
    }
  }

  toggle(): boolean {
    this.setEnabled(!this.wanted);
    return this.wanted;
  }

  /**
   * Called on every gesture. Builds the context the first time and resumes it
   * every time after — Safari re-suspends on its own whenever the tab loses
   * focus, so "already started" is never a state worth trusting.
   */
  private kick(): void {
    if (this.disposed || !this.wanted || document.hidden) return;
    if (!this.ctx) this.build();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') void ctx.resume();
    if (this.master) rampTo(this.master.gain, MASTER_GAIN, ctx.currentTime, MASTER_RAMP);
  }

  private build(): void {
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return; // no Web Audio at all: the site is simply silent
    }

    // A limiter on the output, not for loudness but for safety: several rare
    // moments can land inside the same second, and the sum of things that were
    // each mixed to sit under the bed must not become a spike.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;
    limiter.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(limiter);

    const buses = {} as Record<BusName, GainNode>;
    for (const name of Object.keys(BUS_TRIM) as BusName[]) {
      const gain = ctx.createGain();
      gain.gain.value = BUS_TRIM[name];
      gain.connect(master);
      buses[name] = gain;
    }

    this.ctx = ctx;
    this.limiter = limiter;
    this.master = master;
    this.busNodes = buses;
  }

  // -- lifecycle -------------------------------------------------------------

  /**
   * A tab that hums in the background is a bug. Suspending stops the audio
   * thread outright, which is stronger and cheaper than muting.
   */
  private syncVisibility(): void {
    if (!this.ctx) return;
    if (document.hidden) {
      if (this.ctx.state === 'running') {
        this.suspendedByVisibility = true;
        void this.ctx.suspend();
      }
    } else if (this.suspendedByVisibility) {
      this.suspendedByVisibility = false;
      if (this.wanted) void this.ctx.resume();
    }
  }

  addVoice(voice: Voice): void {
    this.voices.add(voice);
  }

  /** Ramp a voice down and forget it. Safe to call on one already removed. */
  stopVoice(voice: Voice): void {
    if (!this.voices.delete(voice)) return;
    voice.stop(this.now());
  }

  /** Every voice this engine is running, stopped. Chapters call this on the way out. */
  stopAll(): void {
    const now = this.now();
    for (const voice of this.voices) voice.stop(now);
    this.voices.clear();
  }

  /** One tick, from the shell's frame. Cheap and allocation-free when silent. */
  update(dt: number): void {
    if (!this.running) return;
    const now = this.ctx!.currentTime;
    for (const voice of this.voices) voice.update(dt, now);
  }

  dispose(): void {
    this.disposed = true;
    this.stopAll();
    window.removeEventListener('pointerdown', this.onGesture, { capture: true });
    window.removeEventListener('keydown', this.onGesture, { capture: true });
    document.removeEventListener('visibilitychange', this.onVisibility);
    // Tear the output stage down explicitly before closing. close() would
    // collect it anyway, but doing it by hand keeps this file honest about the
    // rule it asks every voice to keep.
    for (const node of Object.values(this.busNodes ?? {})) node.disconnect();
    this.master?.disconnect();
    this.limiter?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    this.busNodes = null;
  }
}
