/**
 * A small Wavefront OBJ loader — the direct descendant of the 2015 "matrices"
 * assignment, which loaded shuttle.obj and pushed it around with matrix stacks.
 *
 * Supports v / vn / vt / f with triangle-fan polygon splitting and negative
 * (relative) indices. No materials: our inks come from the palette, not .mtl.
 */

import type { GeometryData } from './geometry.ts';

export function parseObj(source: string): GeometryData {
  const inPositions: number[][] = [];
  const inNormals: number[][] = [];
  const inUvs: number[][] = [];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Deduplicate by the raw "v/vt/vn" triple so shared vertices stay shared.
  const cache = new Map<string, number>();

  const resolve = (raw: number, list: number[][]): number =>
    raw < 0 ? list.length + raw : raw - 1;

  const vertexFor = (token: string): number => {
    const cached = cache.get(token);
    if (cached !== undefined) return cached;

    const parts = token.split('/');
    const pi = resolve(parseInt(parts[0]!, 10), inPositions);
    const p = inPositions[pi] ?? [0, 0, 0];
    positions.push(p[0]!, p[1]!, p[2]!);

    if (parts[1]) {
      const t = inUvs[resolve(parseInt(parts[1], 10), inUvs)] ?? [0, 0];
      uvs.push(t[0]!, t[1]!);
    } else {
      uvs.push(0, 0);
    }

    if (parts[2]) {
      const n = inNormals[resolve(parseInt(parts[2], 10), inNormals)] ?? [0, 1, 0];
      normals.push(n[0]!, n[1]!, n[2]!);
    } else {
      normals.push(0, 0, 0); // filled in by computeNormals() below
    }

    const index = positions.length / 3 - 1;
    cache.set(token, index);
    return index;
  };

  let sawNormals = false;

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const kind = parts[0];

    switch (kind) {
      case 'v':
        inPositions.push([+parts[1]!, +parts[2]!, +parts[3]!]);
        break;
      case 'vn':
        sawNormals = true;
        inNormals.push([+parts[1]!, +parts[2]!, +parts[3]!]);
        break;
      case 'vt':
        inUvs.push([+parts[1]!, +parts[2]!]);
        break;
      case 'f': {
        const verts = parts.slice(1).map(vertexFor);
        // Fan-triangulate: works for the convex faces OBJ exporters emit.
        for (let i = 1; i < verts.length - 1; i++) {
          indices.push(verts[0]!, verts[i]!, verts[i + 1]!);
        }
        break;
      }
      default:
        break; // o, g, s, usemtl, mtllib — irrelevant here
    }
  }

  const geo: GeometryData = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices:
      positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
  };

  if (!sawNormals) computeNormals(geo);
  return geo;
}

/** Area-weighted vertex normals, for files that ship without vn lines. */
export function computeNormals(geo: GeometryData): void {
  const { positions, normals, indices } = geo;
  normals.fill(0);

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;

    const abx = positions[b]! - positions[a]!;
    const aby = positions[b + 1]! - positions[a + 1]!;
    const abz = positions[b + 2]! - positions[a + 2]!;
    const acx = positions[c]! - positions[a]!;
    const acy = positions[c + 1]! - positions[a + 1]!;
    const acz = positions[c + 2]! - positions[a + 2]!;

    // Cross product magnitude is twice the triangle area, which weights
    // each face's contribution by its size for free.
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }

  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    if (l > 0) {
      normals[i] /= l;
      normals[i + 1] /= l;
      normals[i + 2] /= l;
    } else {
      normals[i + 1] = 1;
    }
  }
}

export async function loadObj(url: string): Promise<GeometryData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`loadObj: ${url} → HTTP ${res.status}`);
  return parseObj(await res.text());
}

/** Scale/centre a mesh so its longest axis spans `size` — OBJ units vary wildly. */
export function normalizeGeometry(geo: GeometryData, size = 1): GeometryData {
  const p = geo.positions;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]!); maxX = Math.max(maxX, p[i]!);
    minY = Math.min(minY, p[i + 1]!); maxY = Math.max(maxY, p[i + 1]!);
    minZ = Math.min(minZ, p[i + 2]!); maxZ = Math.max(maxZ, p[i + 2]!);
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const s = size / extent;

  for (let i = 0; i < p.length; i += 3) {
    p[i] = (p[i]! - cx) * s;
    p[i + 1] = (p[i + 1]! - cy) * s;
    p[i + 2] = (p[i + 2]! - cz) * s;
  }
  return geo;
}
