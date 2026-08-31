/**
 * Deep-sky objects: the things on a chart that are not stars.
 *
 * One to three nebulae and open clusters per sky, and for about three seeds in
 * ten, a comet. They are drawn from their OWN Rng stream rather than the sky's,
 * which is the whole reason this is a separate module: the star catalogue in
 * sky.ts draws from `rng` in an order that is now fixed for good, and a single
 * extra call in there would move every star that follows it. Keyed on the same
 * seed, so a given sky always grows the same nebulae.
 *
 * Each object is baked into a flat list of sample directions at generation
 * time. Nothing here is re-derived per frame: the chapter projects the points
 * it is given and stipples them, once per view, into the plate.
 */

import { TAU, vec3, type Vec3 } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { starName } from '../../core/names.ts';

export type DeepSkyKind = 'nebula' | 'cluster' | 'comet';

export interface DeepSkyObject {
  kind: DeepSkyKind;
  name: string;
  /** Centre on the celestial sphere — where the label hangs. */
  dir: Vec3;
  inkIndex: number;
  /** Sample directions as xyz triples: what actually gets drawn. */
  points: Float32Array;
  /** Per-point dot radius, in raster pixels at the reference zoom. */
  radii: Float32Array;
  alphas: Float32Array;
}

/**
 * The 8×8 ordered screen, again — the nebulae are stippled against it rather
 * than against white noise, so their edges break up in the same regular way
 * the print pass's shadows do instead of dissolving into static.
 */
const BAYER8 = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

/** A tangent frame at `dir`, for laying an object out on the sphere. */
function tangentFrame(dir: Vec3, t1: Vec3, t2: Vec3): void {
  const helper = Math.abs(dir[1]!) < 0.9 ? UP : RIGHT;
  vec3.normalize(t1, vec3.cross(t1, dir, helper));
  vec3.cross(t2, dir, t1);
}

const UP = vec3.create(0, 1, 0);
const RIGHT = vec3.create(1, 0, 0);

/** Offset `dir` by (u, v) radians in its tangent frame, onto the sphere. */
function offsetDir(out: Vec3, dir: Vec3, t1: Vec3, t2: Vec3, u: number, v: number): Vec3 {
  vec3.copy(out, dir);
  vec3.scaleAndAdd(out, out, t1, u);
  vec3.scaleAndAdd(out, out, t2, v);
  return vec3.normalize(out, out);
}

/**
 * A stippled nebula: a lobed boundary, filled with dots whose survival is
 * decided by the ordered screen against a density that falls off from the
 * core. Dense and solid in the middle, breaking into separated dots at the
 * rim — a halftone, not a fade.
 */
function buildNebula(rng: Rng, dir: Vec3): DeepSkyObject {
  const radius = rng.range(0.055, 0.115);
  // Two lobes at different frequencies keep the outline from reading as a
  // circle with a wobble.
  const lobeA = rng.range(0, TAU);
  const lobeB = rng.range(0, TAU);
  const lobeAmp = rng.range(0.18, 0.34);

  const t1 = vec3.create();
  const t2 = vec3.create();
  tangentFrame(dir, t1, t2);
  const point = vec3.create();

  const CELLS = 13; // half-width of the sampling grid, in cells
  const cell = radius / CELLS;

  const px: number[] = [];
  const rr: number[] = [];
  const aa: number[] = [];

  for (let gy = -CELLS; gy <= CELLS; gy++) {
    for (let gx = -CELLS; gx <= CELLS; gx++) {
      // Jitter inside the cell so the stipple is not a visible lattice.
      const u = (gx + rng.range(-0.38, 0.38)) * cell;
      const v = (gy + rng.range(-0.38, 0.38)) * cell;
      const d = Math.hypot(u, v);
      if (d < 1e-6) continue;

      const theta = Math.atan2(v, u);
      const bound =
        radius * (1 - lobeAmp + lobeAmp * (Math.sin(theta * 3 + lobeA) * 0.5 + 0.5)) *
        (0.86 + 0.28 * (Math.sin(theta * 2 + lobeB) * 0.5 + 0.5));
      if (d > bound) continue;

      const density = 1 - Math.pow(d / bound, 1.35);
      const threshold = BAYER8[(((gy % 8) + 8) % 8) * 8 + (((gx % 8) + 8) % 8)]! / 64;
      if (density < threshold) continue;

      offsetDir(point, dir, t1, t2, u, v);
      px.push(point[0]!, point[1]!, point[2]!);
      rr.push(0.55 + density * 0.75);
      aa.push(0.3 + density * 0.45);
    }
  }

  return {
    kind: 'nebula',
    name: `${starName(rng).toUpperCase()} NEBULA`,
    dir: vec3.clone(dir),
    inkIndex: rng.pick(NEBULA_INKS),
    points: new Float32Array(px),
    radii: new Float32Array(rr),
    alphas: new Float32Array(aa),
  };
}

/** An open cluster: a loose ring of stars with a few strays inside it. */
function buildCluster(rng: Rng, dir: Vec3): DeepSkyObject {
  const radius = rng.range(0.018, 0.034);
  const count = rng.int(9, 16);

  const t1 = vec3.create();
  const t2 = vec3.create();
  tangentFrame(dir, t1, t2);
  const point = vec3.create();

  const px: number[] = [];
  const rr: number[] = [];
  const aa: number[] = [];

  const push = (u: number, v: number, r: number, a: number): void => {
    offsetDir(point, dir, t1, t2, u, v);
    px.push(point[0]!, point[1]!, point[2]!);
    rr.push(r);
    aa.push(a);
  };

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * TAU + rng.gaussian() * 0.16;
    const rad = radius * (0.74 + rng.range(-0.2, 0.26));
    push(Math.cos(angle) * rad, Math.sin(angle) * rad, rng.range(0.9, 1.7), rng.range(0.6, 0.95));
  }
  for (let i = 0; i < 3; i++) {
    push(
      rng.gaussian() * radius * 0.22, rng.gaussian() * radius * 0.22,
      rng.range(0.8, 1.3), rng.range(0.5, 0.8),
    );
  }

  return {
    kind: 'cluster',
    // Clusters get a catalogue number; on a real plate most of them never
    // earned a name.
    name: `F ${rng.int(101, 989)}`,
    dir: vec3.clone(dir),
    inkIndex: rng.pick(CLUSTER_INKS),
    points: new Float32Array(px),
    radii: new Float32Array(rr),
    alphas: new Float32Array(aa),
  };
}

/**
 * A comet: a bright coma and a tail that curves away from it, stippled so it
 * thins by losing dots rather than by fading.
 */
function buildComet(rng: Rng, dir: Vec3): DeepSkyObject {
  const length = rng.range(0.10, 0.21);
  // The curve: a quadratic sweep sideways, which is what a dust tail does.
  const curve = rng.range(-0.075, 0.075);
  const flip = rng.bool() ? 1 : -1;

  const t1 = vec3.create();
  const t2 = vec3.create();
  tangentFrame(dir, t1, t2);
  const point = vec3.create();

  const px: number[] = [];
  const rr: number[] = [];
  const aa: number[] = [];

  const push = (u: number, v: number, r: number, a: number): void => {
    offsetDir(point, dir, t1, t2, u, v);
    px.push(point[0]!, point[1]!, point[2]!);
    rr.push(r);
    aa.push(a);
  };

  // The coma: a tight knot at the head.
  push(0, 0, 2.1, 0.95);
  for (let i = 0; i < 7; i++) {
    push(rng.gaussian() * 0.006, rng.gaussian() * 0.006, rng.range(0.7, 1.2), rng.range(0.4, 0.7));
  }

  // The tail: dots spreading and thinning along the sweep.
  const TAIL = 74;
  for (let i = 0; i < TAIL; i++) {
    const s = (i + 1) / TAIL;
    const spread = 0.004 + s * 0.026;
    const u = s * length * flip + rng.gaussian() * spread;
    const v = s * s * curve + rng.gaussian() * spread;
    // Losing dots as it goes: the far end is sparse because samples are
    // rejected there, not because they are drawn faint.
    if (rng.next() > 1 - s * 0.55) continue;
    push(u, v, 0.5 + (1 - s) * 0.9, 0.18 + (1 - s) * 0.5);
  }

  return {
    kind: 'comet',
    name: `COMET ${starName(rng).toUpperCase()}`,
    dir: vec3.clone(dir),
    inkIndex: 0,
    points: new Float32Array(px),
    radii: new Float32Array(rr),
    alphas: new Float32Array(aa),
  };
}

/** Nebulae take the cooler inks; clusters the brighter ones. */
const NEBULA_INKS = [2, 3, 4];
const CLUSTER_INKS = [0, 1, 3];

export function generateDeepSky(seed: string): DeepSkyObject[] {
  const rng = new Rng(`deepsky:${seed}`);
  const objects: DeepSkyObject[] = [];
  const dir = vec3.create();

  const count = rng.int(1, 3);
  for (let i = 0; i < count; i++) {
    // Off the poles, where the chart's projection stretches everything.
    for (let attempt = 0; attempt < 24; attempt++) {
      rng.onSphere(dir);
      if (Math.abs(dir[1]!) < 0.8) break;
    }
    objects.push(rng.bool(0.55) ? buildNebula(rng, dir) : buildCluster(rng, dir));
  }

  // A comet is a rarity, and should stay one.
  if (rng.bool(0.3)) {
    for (let attempt = 0; attempt < 24; attempt++) {
      rng.onSphere(dir);
      if (Math.abs(dir[1]!) < 0.75) break;
    }
    objects.push(buildComet(rng, dir));
  }

  return objects;
}
