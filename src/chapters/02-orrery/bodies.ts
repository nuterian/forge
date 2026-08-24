/**
 * The real solar system, to the precision a visualizer needs.
 *
 * Orbital elements are the JPL approximate elements at the J2000.0 epoch,
 * accurate enough to place every planet correctly for any date this century.
 * Moons use simplified circular orbits — their real elements precess in ways
 * that would cost a great deal of code and change nothing you can see.
 */

import type { OrbitalElements } from '../../core/kepler.ts';
import type { SurfaceStyle } from '../../scene/body.ts';

export interface RingDef {
  /** Inner and outer radius, in units of the planet's own radius. */
  inner: number;
  outer: number;
  opacity: number;
}

export interface MoonDef {
  id: string;
  name: string;
  /** Orbital radius, km. */
  distanceKm: number;
  /** Sidereal period, days. Negative is retrograde. */
  periodDays: number;
  radiusKm: number;
  inkIndex: number;
  /** Inclination to the planet's equator, degrees. */
  inclination: number;
}

export interface BodyDef {
  id: string;
  name: string;
  elements: OrbitalElements;
  radiusKm: number;
  inkIndex: number;
  style: SurfaceStyle;
  /** Rim-light strength, 0–1. */
  atmosphere: number;
  /** Degrees from the orbital plane normal. */
  axialTilt: number;
  /** Sidereal rotation, hours. Negative is retrograde. */
  dayHours: number;
  rings?: RingDef;
  moons?: MoonDef[];
}

export const SUN_RADIUS_KM = 695700;

export const PLANETS: BodyDef[] = [
  {
    id: 'mercury',
    name: 'Mercury',
    elements: { a: 0.38709927, e: 0.20563593, i: 7.00497902, node: 48.33076593, peri: 77.45779628, L0: 252.2503235, period: 87.9691 },
    radiusKm: 2439.7,
    inkIndex: 0,
    style: 'rocky',
    atmosphere: 0,
    axialTilt: 0.03,
    dayHours: 1407.6,
  },
  {
    id: 'venus',
    name: 'Venus',
    elements: { a: 0.72333566, e: 0.00677672, i: 3.39467605, node: 76.67984255, peri: 131.60246718, L0: 181.9790995, period: 224.701 },
    radiusKm: 6051.8,
    inkIndex: 1,
    style: 'rocky',
    atmosphere: 1,
    axialTilt: 177.36,
    dayHours: -5832.5,
  },
  {
    id: 'earth',
    name: 'Earth',
    elements: { a: 1.00000261, e: 0.01671123, i: -0.00001531, node: 0, peri: 102.93768193, L0: 100.46457166, period: 365.256 },
    radiusKm: 6371,
    inkIndex: 3,
    style: 'rocky',
    atmosphere: 0.9,
    axialTilt: 23.44,
    dayHours: 23.93,
    moons: [
      { id: 'luna', name: 'Luna', distanceKm: 384400, periodDays: 27.3217, radiusKm: 1737.4, inkIndex: 0, inclination: 5.15 },
    ],
  },
  {
    id: 'mars',
    name: 'Mars',
    elements: { a: 1.52371034, e: 0.0933941, i: 1.84969142, node: 49.55953891, peri: -23.94362959, L0: -4.55343205, period: 686.98 },
    radiusKm: 3389.5,
    inkIndex: 2,
    style: 'rocky',
    atmosphere: 0.35,
    axialTilt: 25.19,
    dayHours: 24.62,
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    elements: { a: 5.202887, e: 0.04838624, i: 1.30439695, node: 100.47390909, peri: 14.72847983, L0: 34.39644051, period: 4332.589 },
    radiusKm: 69911,
    inkIndex: 1,
    style: 'banded',
    atmosphere: 0.7,
    axialTilt: 3.13,
    dayHours: 9.93,
    rings: { inner: 1.4, outer: 1.8, opacity: 0.12 },
    moons: [
      { id: 'io', name: 'Io', distanceKm: 421700, periodDays: 1.769, radiusKm: 1821.6, inkIndex: 1, inclination: 0.04 },
      { id: 'europa', name: 'Europa', distanceKm: 671100, periodDays: 3.551, radiusKm: 1560.8, inkIndex: 0, inclination: 0.47 },
      { id: 'ganymede', name: 'Ganymede', distanceKm: 1070400, periodDays: 7.155, radiusKm: 2634.1, inkIndex: 0, inclination: 0.2 },
      { id: 'callisto', name: 'Callisto', distanceKm: 1882700, periodDays: 16.689, radiusKm: 2410.3, inkIndex: 4, inclination: 0.19 },
    ],
  },
  {
    id: 'saturn',
    name: 'Saturn',
    elements: { a: 9.53667594, e: 0.05386179, i: 2.48599187, node: 113.66242448, peri: 92.59887831, L0: 49.95424423, period: 10759.22 },
    radiusKm: 58232,
    inkIndex: 1,
    style: 'banded',
    atmosphere: 0.6,
    axialTilt: 26.73,
    dayHours: 10.66,
    rings: { inner: 1.28, outer: 2.41, opacity: 0.92 },
    moons: [
      { id: 'rhea', name: 'Rhea', distanceKm: 527108, periodDays: 4.518, radiusKm: 763.8, inkIndex: 0, inclination: 0.35 },
      { id: 'titan', name: 'Titan', distanceKm: 1221870, periodDays: 15.945, radiusKm: 2574.7, inkIndex: 1, inclination: 0.33 },
      { id: 'iapetus', name: 'Iapetus', distanceKm: 3560820, periodDays: 79.32, radiusKm: 734.5, inkIndex: 0, inclination: 15.47 },
    ],
  },
  {
    id: 'uranus',
    name: 'Uranus',
    elements: { a: 19.18916464, e: 0.04725744, i: 0.77263783, node: 74.01692503, peri: 170.9542763, L0: 313.23810451, period: 30685.4 },
    radiusKm: 25362,
    inkIndex: 3,
    style: 'icy',
    atmosphere: 0.65,
    // Uranus is tipped past 90°, which is why its rings look like a bullseye.
    axialTilt: 97.77,
    dayHours: -17.24,
    rings: { inner: 1.64, outer: 2.02, opacity: 0.4 },
    moons: [
      { id: 'titania', name: 'Titania', distanceKm: 435910, periodDays: 8.706, radiusKm: 788.4, inkIndex: 0, inclination: 0.34 },
      { id: 'oberon', name: 'Oberon', distanceKm: 583520, periodDays: 13.46, radiusKm: 761.4, inkIndex: 0, inclination: 0.06 },
    ],
  },
  {
    id: 'neptune',
    name: 'Neptune',
    elements: { a: 30.06992276, e: 0.00859048, i: 1.77004347, node: 131.78422574, peri: 44.96476227, L0: -55.12002969, period: 60189 },
    radiusKm: 24622,
    inkIndex: 4,
    style: 'icy',
    atmosphere: 0.7,
    axialTilt: 28.32,
    dayHours: 16.11,
    moons: [
      { id: 'triton', name: 'Triton', distanceKm: 354759, periodDays: -5.877, radiusKm: 1353.4, inkIndex: 3, inclination: 156.9 },
    ],
  },
];

/** The main belt, between Mars and Jupiter. */
export const BELT = {
  count: 2600,
  innerAu: 2.06,
  outerAu: 3.28,
  /** Vertical spread as a fraction of orbital radius. */
  thickness: 0.055,
  maxEccentricity: 0.18,
  maxInclination: 17,
};

/** Bodies the camera can be told to follow, in tour order. */
export const TOUR_ORDER = ['earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
