/**
 * Seeded, reproducible randomness. Every chapter is a generator, so the same
 * seed string must always produce the same cosmos — on any machine, any day.
 */

/** FNV-1a-ish string hash → 32-bit unsigned. */
export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * mulberry32 — small, fast, and good enough for visuals.
 * Deterministic for a given 32-bit seed.
 */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  bool(chance = 0.5): boolean {
    return this.next() < chance;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Approximately normal, mean 0, stddev 1 (sum of uniforms). */
  gaussian(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508;
  }

  /** Biased toward `power > 1` = toward min, `power < 1` = toward max. */
  power(min: number, max: number, power: number): number {
    return min + Math.pow(this.next(), power) * (max - min);
  }

  /** A uniformly distributed point on the unit sphere. */
  onSphere(out: Float32Array): Float32Array {
    const z = this.range(-1, 1);
    const a = this.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    out[0] = r * Math.cos(a);
    out[1] = r * Math.sin(a);
    out[2] = z;
    return out;
  }
}

const SEED_WORDS = [
  'ARC', 'VELA', 'KEPLER', 'ORION', 'LYRA', 'CETUS', 'DRACO', 'PYXIS',
  'CARINA', 'AURIGA', 'HYDRA', 'CORVUS', 'MENSA', 'NORMA', 'OCTANS', 'TUCANA',
];

/** A readable, shareable seed like "VELA-8F3A". */
export function randomSeedString(): string {
  const word = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)]!;
  const hex = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');
  return `${word}-${hex}`;
}
