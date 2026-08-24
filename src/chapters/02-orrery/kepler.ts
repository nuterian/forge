/**
 * Kepler's problem, solved once per body per frame.
 *
 * Given classical orbital elements and a time, produce a position. The only
 * hard part is inverting Kepler's equation M = E − e·sin E, which has no closed
 * form — so we run Newton-Raphson, which converges in a handful of iterations
 * for the near-circular orbits of the planets.
 */

import { DEG, TAU, type Vec3 } from '../../core/math.ts';

export interface OrbitalElements {
  /** Semi-major axis, AU. */
  a: number;
  /** Eccentricity, dimensionless. */
  e: number;
  /** Inclination to the ecliptic, degrees. */
  i: number;
  /** Longitude of the ascending node, degrees. */
  node: number;
  /** Longitude of perihelion (ϖ = Ω + ω), degrees. */
  peri: number;
  /** Mean longitude at J2000, degrees. */
  L0: number;
  /** Orbital period, days. */
  period: number;
}

/** Solve M = E − e·sin E for E. M in radians. */
export function eccentricAnomaly(meanAnomaly: number, e: number): number {
  // Wrap to [-π, π]; Newton converges fastest starting near the answer.
  let m = meanAnomaly % TAU;
  if (m > Math.PI) m -= TAU;
  if (m < -Math.PI) m += TAU;

  let E = e < 0.8 ? m : Math.PI * Math.sign(m || 1);

  for (let iter = 0; iter < 12; iter++) {
    const f = E - e * Math.sin(E) - m;
    const df = 1 - e * Math.cos(E);
    const delta = f / df;
    E -= delta;
    if (Math.abs(delta) < 1e-10) break;
  }
  return E;
}

/** Mean anomaly in radians at `days` since J2000. */
export function meanAnomalyAt(el: OrbitalElements, days: number): number {
  const meanLongitude = el.L0 + (360 / el.period) * days;
  return (meanLongitude - el.peri) * DEG;
}

/**
 * Position in heliocentric ecliptic coordinates (AU), written into `out` as
 * world-space Y-up: X and Z span the ecliptic plane, Y is the orbital normal.
 */
export function positionAt(out: Vec3, el: OrbitalElements, days: number): Vec3 {
  return positionAtAnomaly(out, el, meanAnomalyAt(el, days));
}

/** Position at an explicit mean anomaly — used to trace whole orbits. */
export function positionAtAnomaly(out: Vec3, el: OrbitalElements, meanAnomaly: number): Vec3 {
  const E = eccentricAnomaly(meanAnomaly, el.e);

  // Position in the orbital plane, with the focus at the origin.
  const xOrbital = el.a * (Math.cos(E) - el.e);
  const yOrbital = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);

  const omega = (el.peri - el.node) * DEG; // argument of perihelion
  const node = el.node * DEG;
  const inc = el.i * DEG;

  const cosW = Math.cos(omega), sinW = Math.sin(omega);
  const cosN = Math.cos(node), sinN = Math.sin(node);
  const cosI = Math.cos(inc), sinI = Math.sin(inc);

  // Rotate: orbital plane → ecliptic (argument of perihelion, inclination, node).
  const xEcl = (cosW * cosN - sinW * sinN * cosI) * xOrbital + (-sinW * cosN - cosW * sinN * cosI) * yOrbital;
  const yEcl = (cosW * sinN + sinW * cosN * cosI) * xOrbital + (-sinW * sinN + cosW * cosN * cosI) * yOrbital;
  const zEcl = sinW * sinI * xOrbital + cosW * sinI * yOrbital;

  // Ecliptic (x, y, z_normal) → world (x, y_up, z).
  out[0] = xEcl;
  out[1] = zEcl;
  out[2] = yEcl;
  return out;
}

/**
 * A moon's position on a simple circular, inclined orbit — the shared shape
 * behind every satellite in the project (the Orrery's moons, Worldsmith's).
 * `angle` is the position around the circle; `inclination` tilts it off the
 * parent's equatorial plane, in radians. Written in the parent's local frame:
 * callers add the parent's own position (and rotate by its axial tilt, if it
 * has one) to place the result in world space.
 */
export function satelliteOffset(out: Vec3, angle: number, distance: number, inclination: number): Vec3 {
  const x = Math.cos(angle) * distance;
  const zFlat = Math.sin(angle) * distance;
  out[0] = x;
  out[1] = -zFlat * Math.sin(inclination);
  out[2] = zFlat * Math.cos(inclination);
  return out;
}

/** Days since the J2000.0 epoch (2000-01-01 12:00 TT). */
export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

export function dateFromDays(days: number): Date {
  return new Date(J2000_MS + days * 86400000);
}

export function daysFromDate(date: Date): number {
  return (date.getTime() - J2000_MS) / 86400000;
}
