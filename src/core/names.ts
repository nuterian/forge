/**
 * Seeded invented names, in the register of star atlases: constellations now,
 * planets (ch.3) and whole systems (ch.6) later. Same seed, same names.
 */

import type { Rng } from './rng.ts';

const ONSETS = [
  'A', 'BE', 'CA', 'DRA', 'E', 'FE', 'GA', 'HY', 'I', 'KOR', 'LY', 'MA',
  'NE', 'O', 'PY', 'QUA', 'RI', 'SA', 'TAU', 'U', 'VE', 'XA', 'ZE', 'THE',
];

const MIDDLES = [
  'LA', 'RE', 'NI', 'DO', 'SA', 'LU', 'MI', 'TE', 'RA', 'VO', 'PHE', 'CU',
  'ME', 'RIO', 'DA', 'NO',
];

const ENDINGS = [
  'RIS', 'MA', 'NUS', 'RA', 'LIS', 'DES', 'PHUS', 'NIX', 'THA', 'CO',
  'RION', 'BIS', 'GON', 'TES', 'VIA',
];

const EPITHETS = [
  'MINOR', 'MAJOR', 'AUSTRALIS', 'BOREALIS', 'OBSCURA', 'VETUS', 'NOVA',
];

/** e.g. "DRALUNIX", "SAMERA MINOR". */
export function constellationName(rng: Rng): string {
  let name = rng.pick(ONSETS);
  if (rng.bool(0.7)) name += rng.pick(MIDDLES);
  name += rng.pick(ENDINGS);
  if (rng.bool(0.28)) name += ` ${rng.pick(EPITHETS)}`;
  return name;
}

/** Bright-star names are shorter and rounder: "VELA", "KORA". */
export function starName(rng: Rng): string {
  return rng.pick(ONSETS) + rng.pick(MIDDLES).toLowerCase();
}

/** Planet names for ch.3 and system designations for ch.6. */
export function bodyName(rng: Rng): string {
  let name = rng.pick(ONSETS) + rng.pick(MIDDLES).toLowerCase();
  if (rng.bool(0.5)) name += rng.pick(ENDINGS).toLowerCase();
  return name;
}
