/**
 * Screen-space expanded polylines — "ink strokes".
 *
 * gl.LINES is stuck at 1px on every desktop driver, which is far too thin for
 * the poster look. Instead each polyline point is emitted twice and pushed
 * sideways in the vertex shader along the screen-space normal, giving crisp
 * constant-width strokes that never vary with depth.
 */

import { Mesh } from './mesh.ts';

export interface PolylineOptions {
  closed?: boolean;
  dynamic?: boolean;
}

export interface PolylineArrays {
  position: Float32Array;
  prev: Float32Array;
  next: Float32Array;
  side: Float32Array;
  param: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
}

/**
 * Expand a flat [x,y,z, ...] point array into ribbon attributes. Each point
 * becomes two vertices carrying their own neighbours, which is what lets the
 * vertex shader compute a screen-space direction without any adjacency lookup.
 */
export function polylineArrays(points: Float32Array, closed: boolean): PolylineArrays {
  const n = points.length / 3;
  if (n < 2) throw new Error('polylineArrays: need at least 2 points');

  // A closed loop repeats its first point so the seam joins cleanly.
  const count = closed ? n + 1 : n;
  const verts = count * 2;

  const position = new Float32Array(verts * 3);
  const prev = new Float32Array(verts * 3);
  const next = new Float32Array(verts * 3);
  const side = new Float32Array(verts);
  const param = new Float32Array(verts);

  const at = (i: number, out: Float32Array, offset: number) => {
    const idx = closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    out[offset] = points[idx * 3]!;
    out[offset + 1] = points[idx * 3 + 1]!;
    out[offset + 2] = points[idx * 3 + 2]!;
  };

  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    for (let s = 0; s < 2; s++) {
      const v = i * 2 + s;
      at(i, position, v * 3);
      at(i - 1, prev, v * 3);
      at(i + 1, next, v * 3);
      side[v] = s === 0 ? -1 : 1;
      param[v] = t;
    }
  }

  // Triangle strip written as indexed triangles: (0,1,2) (2,1,3) ...
  const indices = new Uint32Array((count - 1) * 6);
  for (let i = 0; i < count - 1; i++) {
    const a = i * 2;
    indices.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
  }

  return { position, prev, next, side, param, indices, vertexCount: verts };
}

/** Build ribbon geometry from a flat [x,y,z, x,y,z, ...] point array. */
export function buildPolyline(
  gl: WebGL2RenderingContext,
  points: Float32Array,
  opts: PolylineOptions = {},
): Mesh {
  const closed = opts.closed ?? false;
  const arrays = polylineArrays(points, closed);

  return new Mesh(gl, {
    attributes: [
      { name: 'aPosition', data: arrays.position, size: 3, dynamic: opts.dynamic },
      { name: 'aPrev', data: arrays.prev, size: 3, dynamic: opts.dynamic },
      { name: 'aNext', data: arrays.next, size: 3, dynamic: opts.dynamic },
      { name: 'aSide', data: arrays.side, size: 1 },
      { name: 'aParam', data: arrays.param, size: 1 },
    ],
    indices: arrays.indices,
  });
}

/**
 * Re-upload the positions of a polyline built with `dynamic: true`. The vertex
 * count must match — this is for moving an existing stroke, not reshaping it.
 */
export function updatePolyline(mesh: Mesh, points: Float32Array, closed: boolean): void {
  const arrays = polylineArrays(points, closed);
  mesh.update('aPosition', arrays.position);
  mesh.update('aPrev', arrays.prev);
  mesh.update('aNext', arrays.next);
}
