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
  // Events used to be the loudest bus, on the theory that a rare moment should
  // carry over the bed. There is no bed to carry over any more — an event lands
  // in silence, where the same level is startling rather than audible.
  events: 0.55,
  ui: 0.36,
};

/**
 * Master level with sound on.
 *
 * Raised once, on the theory that a site of short sounds with silence between
 * them could afford headroom a bed could not, and put back down again when the
 * reader said the result was loud and disruptive. Both halves of that were
 * true: the headroom exists, and using it is still the wrong call. A sound
 * arriving into silence is far more present than the same sound arriving over
 * a bed, so removing the bed should have taken the master DOWN, not up.
 *
 * The limiter on the output covers the case where several land in one second.
 */
const MASTER_GAIN = 0.3;

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

/**
 * How long the master takes to duck when the page stops being attended to.
 *
 * Long enough to be a fade rather than a cut. The old behaviour suspended the
 * context outright the moment the tab was hidden, which is the hard cut this
 * production makes nowhere else — it was only forgivable because nobody is
 * listening to a tab they have just left. They are listening to the one they
 * just came back to, though, and that arrives on the same ramp.
 */
const AWAY_FADE = 0.3;

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
  private readonly onAttention = (): void => this.syncAttention();

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
    // Hidden and unfocused are different states and both mean silence. A tab
    // on a second monitor with the reader working in another app is visible by
    // every measure the visibility API has, and nobody wants it humming.
    document.addEventListener('visibilitychange', this.onAttention);
    window.addEventListener('blur', this.onAttention);
    window.addEventListener('focus', this.onAttention);
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
  /**
   * Is anyone there? Hidden or unfocused both mean no.
   *
   * Deliberately not consulted by kick(): a pointerdown or a keystroke IS
   * attention, whatever hasFocus() happens to report at that instant, and in
   * some embedded contexts it reports false throughout. Trusting it there
   * would mean the toggle silently does nothing.
   */
  private get attended(): boolean {
    return !document.hidden && document.hasFocus();
  }

  private kick(): void {
    if (this.disposed || !this.wanted || document.hidden) return;
    if (!this.ctx) this.build();
    this.openMaster(MASTER_RAMP);
  }

  /**
   * Bring the master up, resuming the clock first if it is parked.
   *
   * The order is the whole of it. AudioContext.resume() is asynchronous and
   * currentTime does not advance while a context is suspended, so a ramp
   * scheduled before the resume lands is scheduled entirely into the past: by
   * the time audio is running again the ramp has already "finished", and the
   * gain arrives at full in a single step. That is a click, and it is the one
   * click a reader is guaranteed to hear, because it is exactly the moment they
   * turn sound on or come back to the tab. Wait for the clock, then write to it.
   */
  private openMaster(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (ctx.state === 'running') {
      rampTo(this.master.gain, MASTER_GAIN, ctx.currentTime, seconds);
      return;
    }
    void ctx.resume().then(
      () => {
        // Re-check: a reader can switch away, or turn sound off, inside the
        // handful of milliseconds a resume takes. Tested against `hidden`
        // rather than `attended` for the same reason kick() is — this runs on
        // the gesture path too, and hasFocus() lies in embedded contexts.
        if (this.ctx !== ctx || !this.master || !this.wanted || document.hidden) return;
        rampTo(this.master.gain, MASTER_GAIN, ctx.currentTime, seconds);
      },
      () => { /* no activation yet: the next gesture tries again */ },
    );
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
   * Follow the reader's attention: fade out when they leave, fade back when
   * they return, and park the context once the fade has actually landed.
   *
   * The order matters in both directions. Suspending mid-fade freezes the gain
   * wherever it got to, and it is still sitting there, audible, the instant
   * anything resumes — so the suspend waits out the ramp, and checks on the way
   * through that the reader has not come back in the meantime. Coming back,
   * the resume happens first and the ramp second, because a ramp scheduled on a
   * parked clock never runs.
   *
   * Derived from state rather than remembered, so any number of blur, focus and
   * visibility events in any order settle to the same place.
   */
  private syncAttention(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    if (this.wanted && this.attended) {
      this.openMaster(AWAY_FADE);
      return;
    }

    if (ctx.state === 'running') rampTo(master.gain, 0, ctx.currentTime, AWAY_FADE);
    setSoon(() => {
      if (this.wanted && this.attended) return;
      const parked = this.ctx;
      if (!parked || !this.master) return;
      // Land at silence before parking, whatever the fade actually did. A
      // context suspended at a non-zero gain resumes at that gain — the step
      // here is inaudible because it happens at the end of a fade to zero, and
      // it is the one thing standing between a lost race and a bang on return.
      this.master.gain.cancelScheduledValues(parked.currentTime);
      this.master.gain.setValueAtTime(0, parked.currentTime);
      void parked.suspend();
    }, AWAY_FADE * 1.6);
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
    document.removeEventListener('visibilitychange', this.onAttention);
    window.removeEventListener('blur', this.onAttention);
    window.removeEventListener('focus', this.onAttention);
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
