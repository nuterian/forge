/**
 * What the site is tuned to.
 *
 * Six roots rather than twelve, and not a chromatic scale with a shuffle on it:
 * A, B, C, D, E, G — a low minor pentatonic with its second. Any two of them
 * sound deliberate against each other, which matters because several sounds can
 * be in the air at once and a semitone landing between two of them would read
 * as a mistake rather than as two things happening. A chromatic pick would
 * produce one about a third of the time.
 */

import { Rng } from '../core/rng.ts';

export const ROOTS = [55.0, 61.74, 65.41, 73.42, 82.41, 98.0];

/**
 * The note a seed is tuned to.
 *
 * Its own stream, `audio:<seed>` — never a chapter's main rng, so a sound can
 * never move a layout. Same seed, same note, every time; reroll moves it.
 */
export function rootFor(seed: string): number {
  return new Rng(`audio:${seed}`).pick(ROOTS);
}
