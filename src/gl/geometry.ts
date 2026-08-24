/**
 * Parametric surface builders — the descendant of the 2015 "perspective &
 * parametric shapes" assignment, where sphere/cylinder meshes were generated
 * by hand rather than loaded.
 */

import { Mesh, type MeshSpec } from './mesh.ts';

export interface GeometryData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
}

export function toMesh(gl: WebGL2RenderingContext, geo: GeometryData, extra?: Partial<MeshSpec>): Mesh {
  return new Mesh(gl, {
    attributes: [
      { name: 'aPosition', data: geo.positions, size: 3 },
      { name: 'aNormal', data: geo.normals, size: 3 },
      { name: 'aUv', data: geo.uvs, size: 2 },
      ...(extra?.attributes ?? []),
    ],
    indices: geo.indices,
    mode: extra?.mode,
  });
}

/**
 * A UV sphere: the classic parametric surface, x = r sinφ cosθ etc.
 * Poles are degenerate in UV space, which is fine for our flat inks.
 */
export function uvSphere(radius = 1, segments = 48, rings = 32): GeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const theta = u * Math.PI * 2;
      const nx = sinPhi * Math.cos(theta);
      const ny = cosPhi;
      const nz = sinPhi * Math.sin(theta);

      positions.push(nx * radius, ny * radius, nz * radius);
      normals.push(nx, ny, nz);
      uvs.push(u, 1 - v);
    }
  }

  // Winding matters: with gl.cullFace(BACK), inward-wound triangles leave the
  // *far* hemisphere's interior visible — every lit planet then displays the
  // shading of the side facing away from the camera, which reads as inverted
  // lighting from most angles.
  const stride = segments + 1;
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * stride + x;
      const b = a + stride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  return pack(positions, normals, uvs, indices);
}

/** A flat annulus in the XZ plane — planetary rings. uv.x = radial position. */
export function ringAnnulus(inner = 1.3, outer = 2.2, segments = 128): GeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = t * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);

    positions.push(c * inner, 0, s * inner);
    normals.push(0, 1, 0);
    uvs.push(0, t);

    positions.push(c * outer, 0, s * outer);
    normals.push(0, 1, 0);
    uvs.push(1, t);
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  return pack(positions, normals, uvs, indices);
}

/**
 * An icosphere — near-uniform triangles, so a lit asteroid reads as a rock
 * rather than a gridded ball. Subdivision 0 gives a 20-face icosahedron.
 */
export function icosphere(radius = 1, subdivisions = 1): GeometryData {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalizeArr);

  let faces: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  for (let s = 0; s < subdivisions; s++) {
    const midpoints = new Map<string, number>();
    const next: number[][] = [];

    const midpoint = (i: number, j: number): number => {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      const existing = midpoints.get(key);
      if (existing !== undefined) return existing;
      const a = verts[i]!;
      const b = verts[j]!;
      verts.push(normalizeArr([a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!]));
      const index = verts.length - 1;
      midpoints.set(key, index);
      return index;
    };

    for (const [a, b, c] of faces) {
      const ab = midpoint(a!, b!);
      const bc = midpoint(b!, c!);
      const ca = midpoint(c!, a!);
      next.push([a!, ab, ca], [b!, bc, ab], [c!, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const v of verts) {
    positions.push(v[0]! * radius, v[1]! * radius, v[2]! * radius);
    normals.push(v[0]!, v[1]!, v[2]!);
    uvs.push(0.5 + Math.atan2(v[2]!, v[0]!) / (Math.PI * 2), 0.5 - Math.asin(v[1]!) / Math.PI);
  }
  for (const f of faces) indices.push(f[0]!, f[1]!, f[2]!);

  return pack(positions, normals, uvs, indices);
}

/** A screen-filling triangle — cheaper and seam-free versus two quad triangles. */
export function fullscreenTriangle(gl: WebGL2RenderingContext): Mesh {
  return new Mesh(gl, {
    attributes: [
      { name: 'aPosition', data: new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), size: 3 },
      { name: 'aUv', data: new Float32Array([0, 0, 2, 0, 0, 2]), size: 2 },
    ],
    count: 3,
  });
}

/** A camera-facing quad, expanded in the vertex shader. Used for sprites/labels. */
export function billboardQuad(gl: WebGL2RenderingContext): Mesh {
  return new Mesh(gl, {
    attributes: [
      {
        name: 'aPosition',
        data: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
        size: 3,
      },
      { name: 'aUv', data: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), size: 2 },
    ],
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
}

function normalizeArr(v: number[]): number[] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}

function pack(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
): GeometryData {
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices:
      positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
  };
}
