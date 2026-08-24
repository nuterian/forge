/**
 * The seeded sky: a catalog of stars on the celestial sphere, grouped into
 * invented constellations. Same seed → same sky, forever.
 */

import { vec3, type Vec3 } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { constellationName, starName } from '../../core/names.ts';

export interface CatalogStar {
  dir: Vec3;
  /** 0 faint → 1 bright. */
  mag: number;
  /** Ink index, or -1 for the default line ink. */
  tint: number;
  /** Only a handful of the brightest stars are named. */
  name?: string;
}

export interface Constellation {
  name: string;
  /** Catalog indices, in figure order — the spline runs through these. */
  chain: number[];
  /** Extra edges branching off the chain: [fromIndex, toIndex]. */
  branches: Array<[number, number]>;
  inkIndex: number;
  centroid: Vec3;
}

export interface SkyModel {
  stars: CatalogStar[];
  constellations: Constellation[];
}

/** Same tilt as the Orrery's background sky — it is the same galaxy. */
const BAND_NORMAL = vec3.normalize(vec3.create(), vec3.create(0.42, 0.78, -0.46));

/** A random direction within `spread` radians of `center`. */
function scatterAround(rng: Rng, center: Vec3, spread: number, out: Vec3): Vec3 {
  // Build a tangent basis and offset by a 2D gaussian.
  const helper = Math.abs(center[1]!) < 0.9 ? vec3.create(0, 1, 0) : vec3.create(1, 0, 0);
  const t1 = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), center, helper));
  const t2 = vec3.cross(vec3.create(), center, t1);
  vec3.copy(out, center);
  vec3.scaleAndAdd(out, out, t1, rng.gaussian() * spread);
  vec3.scaleAndAdd(out, out, t2, rng.gaussian() * spread);
  return vec3.normalize(out, out);
}

export function generateSky(seed: string): SkyModel {
  const rng = new Rng(seed);
  const stars: CatalogStar[] = [];

  // --- Field stars ---------------------------------------------------------
  const fieldCount = 2400;
  for (let i = 0; i < fieldCount; i++) {
    stars.push({
      dir: rng.onSphere(vec3.create()) as Vec3,
      mag: rng.power(0.02, 0.75, 2.4),
      tint: rng.bool(0.16) ? rng.int(1, 4) : -1,
    });
  }

  // --- The galactic band: extra faint stars along a great circle ----------
  const e1 = vec3.normalize(
    vec3.create(),
    vec3.cross(vec3.create(), BAND_NORMAL, vec3.create(0, 1, 0)),
  );
  const e2 = vec3.cross(vec3.create(), BAND_NORMAL, e1);
  for (let i = 0; i < 1400; i++) {
    const t = rng.range(0, Math.PI * 2);
    const dir = vec3.create();
    vec3.scaleAndAdd(dir, dir, e1, Math.cos(t));
    vec3.scaleAndAdd(dir, dir, e2, Math.sin(t));
    vec3.scaleAndAdd(dir, dir, BAND_NORMAL, rng.gaussian() * 0.16);
    stars.push({
      dir: vec3.normalize(dir, dir),
      mag: rng.power(0.02, 0.4, 2.0),
      tint: rng.bool(0.1) ? 4 : -1,
    });
  }

  // --- Constellations ------------------------------------------------------
  const constellations: Constellation[] = [];
  const centers: Vec3[] = [];
  const count = rng.int(9, 13);

  for (let c = 0; c < count; c++) {
    // Rejection-sample a centre that keeps its distance from the others and
    // stays off the poles, where the chart projection gets awkward.
    let center = vec3.create();
    for (let attempt = 0; attempt < 40; attempt++) {
      rng.onSphere(center);
      if (Math.abs(center[1]!) > 0.85) continue;
      if (centers.every((o) => vec3.dot(o, center) < Math.cos(0.55))) break;
    }
    centers.push(vec3.clone(center));

    const memberCount = rng.int(4, 8);
    const spread = rng.range(0.09, 0.16);
    const members: number[] = [];
    for (let m = 0; m < memberCount; m++) {
      const dir = scatterAround(rng, center, spread, vec3.create());
      members.push(stars.length);
      stars.push({
        dir,
        mag: rng.range(0.72, 1),
        tint: -1,
      });
    }

    // Figure: a greedy nearest-neighbour chain through the members, so the
    // stroke wanders naturally instead of zig-zagging.
    const remaining = [...members];
    const chain = [remaining.splice(rng.int(0, remaining.length - 1), 1)[0]!];
    while (remaining.length > 0) {
      const last = stars[chain[chain.length - 1]!]!.dir;
      let best = 0;
      let bestDot = -2;
      for (let i = 0; i < remaining.length; i++) {
        const d = vec3.dot(last, stars[remaining[i]!]!.dir);
        if (d > bestDot) {
          bestDot = d;
          best = i;
        }
      }
      chain.push(remaining.splice(best, 1)[0]!);
    }

    // Occasionally one branch, from a mid-chain star to its nearest non-neighbour.
    const branches: Array<[number, number]> = [];
    if (chain.length >= 5 && rng.bool(0.4)) {
      const from = chain[rng.int(1, chain.length - 3)]!;
      const fromDir = stars[from]!.dir;
      let best = -1;
      let bestDot = -2;
      for (const idx of chain) {
        if (idx === from) continue;
        const pos = chain.indexOf(idx);
        if (Math.abs(pos - chain.indexOf(from)) <= 1) continue;
        const d = vec3.dot(fromDir, stars[idx]!.dir);
        if (d > bestDot) {
          bestDot = d;
          best = idx;
        }
      }
      if (best >= 0) branches.push([from, best]);
    }

    // Centroid for the label.
    const centroid = vec3.create();
    for (const idx of members) vec3.add(centroid, centroid, stars[idx]!.dir);
    vec3.normalize(centroid, centroid);

    constellations.push({
      name: constellationName(rng),
      chain,
      branches,
      inkIndex: rng.int(1, 4),
      centroid,
    });
  }

  // Name the brightest star of a few constellations.
  for (const constellation of constellations) {
    if (!rng.bool(0.35)) continue;
    let brightest = constellation.chain[0]!;
    for (const idx of constellation.chain) {
      if (stars[idx]!.mag > stars[brightest]!.mag) brightest = idx;
    }
    stars[brightest]!.name = starName(rng);
  }

  return { stars, constellations };
}
