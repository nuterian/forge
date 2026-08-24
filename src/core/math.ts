/**
 * Minimal column-major linear algebra for the whole project.
 * Hand-rolled on purpose: the fundamentals are the showcase.
 */

export type Vec3 = Float32Array;
export type Mat3 = Float32Array;
export type Mat4 = Float32Array;

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const TAU = Math.PI * 2;

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach: rate = fraction remaining after 1s. */
export const damp = (a: number, b: number, rate: number, dt: number) =>
  lerp(a, b, 1 - Math.pow(rate, dt));

// ---------------------------------------------------------------------------
// vec3
// ---------------------------------------------------------------------------

export const vec3 = {
  create(x = 0, y = 0, z = 0): Vec3 {
    const o = new Float32Array(3);
    o[0] = x;
    o[1] = y;
    o[2] = z;
    return o;
  },

  set(o: Vec3, x: number, y: number, z: number): Vec3 {
    o[0] = x;
    o[1] = y;
    o[2] = z;
    return o;
  },

  copy(o: Vec3, a: Vec3): Vec3 {
    o[0] = a[0];
    o[1] = a[1];
    o[2] = a[2];
    return o;
  },

  clone(a: Vec3): Vec3 {
    return vec3.create(a[0], a[1], a[2]);
  },

  add(o: Vec3, a: Vec3, b: Vec3): Vec3 {
    o[0] = a[0] + b[0];
    o[1] = a[1] + b[1];
    o[2] = a[2] + b[2];
    return o;
  },

  sub(o: Vec3, a: Vec3, b: Vec3): Vec3 {
    o[0] = a[0] - b[0];
    o[1] = a[1] - b[1];
    o[2] = a[2] - b[2];
    return o;
  },

  mul(o: Vec3, a: Vec3, b: Vec3): Vec3 {
    o[0] = a[0] * b[0];
    o[1] = a[1] * b[1];
    o[2] = a[2] * b[2];
    return o;
  },

  scale(o: Vec3, a: Vec3, s: number): Vec3 {
    o[0] = a[0] * s;
    o[1] = a[1] * s;
    o[2] = a[2] * s;
    return o;
  },

  /** o = a + b * s */
  scaleAndAdd(o: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
    o[0] = a[0] + b[0] * s;
    o[1] = a[1] + b[1] * s;
    o[2] = a[2] + b[2] * s;
    return o;
  },

  dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  },

  cross(o: Vec3, a: Vec3, b: Vec3): Vec3 {
    const ax = a[0],
      ay = a[1],
      az = a[2];
    const bx = b[0],
      by = b[1],
      bz = b[2];
    o[0] = ay * bz - az * by;
    o[1] = az * bx - ax * bz;
    o[2] = ax * by - ay * bx;
    return o;
  },

  len(a: Vec3): number {
    return Math.hypot(a[0], a[1], a[2]);
  },

  sqrLen(a: Vec3): number {
    return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
  },

  dist(a: Vec3, b: Vec3): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  },

  normalize(o: Vec3, a: Vec3): Vec3 {
    const l = Math.hypot(a[0], a[1], a[2]);
    if (l > 0) {
      const inv = 1 / l;
      o[0] = a[0] * inv;
      o[1] = a[1] * inv;
      o[2] = a[2] * inv;
    } else {
      o[0] = o[1] = o[2] = 0;
    }
    return o;
  },

  lerp(o: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
    o[0] = a[0] + (b[0] - a[0]) * t;
    o[1] = a[1] + (b[1] - a[1]) * t;
    o[2] = a[2] + (b[2] - a[2]) * t;
    return o;
  },


  /** Rotation only — ignores translation, no w divide. */
  transformDirMat4(o: Vec3, a: Vec3, m: Mat4): Vec3 {
    const x = a[0],
      y = a[1],
      z = a[2];
    o[0] = m[0] * x + m[4] * y + m[8] * z;
    o[1] = m[1] * x + m[5] * y + m[9] * z;
    o[2] = m[2] * x + m[6] * y + m[10] * z;
    return o;
  },

};

// ---------------------------------------------------------------------------
// mat3
// ---------------------------------------------------------------------------

export const mat3 = {
  create(): Mat3 {
    const o = new Float32Array(9);
    o[0] = o[4] = o[8] = 1;
    return o;
  },

  /**
   * Inverse-transpose of the upper-left 3x3 — the correct normal matrix.
   * The transpose is not optional: with the plain inverse, normals rotate
   * *backwards* relative to the mesh, so a spinning planet drags its own
   * terminator around with it.
   */
  normalFromMat4(o: Mat3, m: Mat4): Mat3 {
    const a00 = m[0],
      a01 = m[1],
      a02 = m[2];
    const a10 = m[4],
      a11 = m[5],
      a12 = m[6];
    const a20 = m[8],
      a21 = m[9],
      a22 = m[10];

    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;

    let det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) {
      o[0] = o[4] = o[8] = 1;
      o[1] = o[2] = o[3] = o[5] = o[6] = o[7] = 0;
      return o;
    }
    det = 1.0 / det;

    o[0] = b01 * det;
    o[1] = b11 * det;
    o[2] = b21 * det;
    o[3] = (-a22 * a01 + a02 * a21) * det;
    o[4] = (a22 * a00 - a02 * a20) * det;
    o[5] = (-a21 * a00 + a01 * a20) * det;
    o[6] = (a12 * a01 - a02 * a11) * det;
    o[7] = (-a12 * a00 + a02 * a10) * det;
    o[8] = (a11 * a00 - a01 * a10) * det;
    return o;
  },
};

// ---------------------------------------------------------------------------
// mat4 (column-major, OpenGL convention)
// ---------------------------------------------------------------------------

export const mat4 = {
  create(): Mat4 {
    const o = new Float32Array(16);
    o[0] = o[5] = o[10] = o[15] = 1;
    return o;
  },

  identity(o: Mat4): Mat4 {
    o.fill(0);
    o[0] = o[5] = o[10] = o[15] = 1;
    return o;
  },

  copy(o: Mat4, a: Mat4): Mat4 {
    o.set(a);
    return o;
  },

  clone(a: Mat4): Mat4 {
    const o = new Float32Array(16);
    o.set(a);
    return o;
  },

  /** o = a * b (apply b first, then a) */
  multiply(o: Mat4, a: Mat4, b: Mat4): Mat4 {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },

  fromTranslation(o: Mat4, x: number, y: number, z: number): Mat4 {
    mat4.identity(o);
    o[12] = x;
    o[13] = y;
    o[14] = z;
    return o;
  },

  fromScale(o: Mat4, x: number, y: number, z: number): Mat4 {
    o.fill(0);
    o[0] = x;
    o[5] = y;
    o[10] = z;
    o[15] = 1;
    return o;
  },

  fromXRotation(o: Mat4, rad: number): Mat4 {
    const s = Math.sin(rad),
      c = Math.cos(rad);
    mat4.identity(o);
    o[5] = c;
    o[6] = s;
    o[9] = -s;
    o[10] = c;
    return o;
  },

  fromYRotation(o: Mat4, rad: number): Mat4 {
    const s = Math.sin(rad),
      c = Math.cos(rad);
    mat4.identity(o);
    o[0] = c;
    o[2] = -s;
    o[8] = s;
    o[10] = c;
    return o;
  },

  fromZRotation(o: Mat4, rad: number): Mat4 {
    const s = Math.sin(rad),
      c = Math.cos(rad);
    mat4.identity(o);
    o[0] = c;
    o[1] = s;
    o[4] = -s;
    o[5] = c;
    return o;
  },



  translate(o: Mat4, a: Mat4, x: number, y: number, z: number): Mat4 {
    if (o !== a) o.set(a);
    o[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
    o[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
    o[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
    o[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
    return o;
  },

  scale(o: Mat4, a: Mat4, x: number, y: number, z: number): Mat4 {
    o[0] = a[0] * x; o[1] = a[1] * x; o[2] = a[2] * x; o[3] = a[3] * x;
    o[4] = a[4] * y; o[5] = a[5] * y; o[6] = a[6] * y; o[7] = a[7] * y;
    o[8] = a[8] * z; o[9] = a[9] * z; o[10] = a[10] * z; o[11] = a[11] * z;
    o[12] = a[12]; o[13] = a[13]; o[14] = a[14]; o[15] = a[15];
    return o;
  },

  perspective(o: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovy / 2);
    o.fill(0);
    o[0] = f / aspect;
    o[5] = f;
    o[11] = -1;
    if (far !== Infinity) {
      const nf = 1 / (near - far);
      o[10] = (far + near) * nf;
      o[14] = 2 * far * near * nf;
    } else {
      o[10] = -1;
      o[14] = -2 * near;
    }
    return o;
  },

  ortho(o: Mat4, left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    o.fill(0);
    o[0] = -2 * lr;
    o[5] = -2 * bt;
    o[10] = 2 * nf;
    o[12] = (left + right) * lr;
    o[13] = (top + bottom) * bt;
    o[14] = (far + near) * nf;
    o[15] = 1;
    return o;
  },

  lookAt(o: Mat4, eye: Vec3, center: Vec3, up: Vec3): Mat4 {
    const ex = eye[0], ey = eye[1], ez = eye[2];
    let zx = ex - center[0], zy = ey - center[1], zz = ez - center[2];
    let l = Math.hypot(zx, zy, zz);
    if (l === 0) {
      zz = 1;
      l = 1;
    }
    zx /= l; zy /= l; zz /= l;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz);
    if (l === 0) {
      // up is parallel to the view direction — nudge it.
      xx = 1; xy = 0; xz = 0;
    } else {
      xx /= l; xy /= l; xz /= l;
    }

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
    o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * ex + xy * ey + xz * ez);
    o[13] = -(yx * ex + yy * ey + yz * ez);
    o[14] = -(zx * ex + zy * ey + zz * ez);
    o[15] = 1;
    return o;
  },

  /** Orientation matrix placing +Z along (eye - target); the inverse of lookAt's rotation. */
  targetTo(o: Mat4, eye: Vec3, target: Vec3, up: Vec3): Mat4 {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let l = zx * zx + zy * zy + zz * zz;
    if (l === 0) {
      zz = 1;
    } else {
      l = 1 / Math.sqrt(l);
      zx *= l; zy *= l; zz *= l;
    }

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    l = xx * xx + xy * xy + xz * xz;
    if (l === 0) {
      xx = 1; xy = 0; xz = 0;
    } else {
      l = 1 / Math.sqrt(l);
      xx *= l; xy *= l; xz *= l;
    }

    o[0] = xx; o[1] = xy; o[2] = xz; o[3] = 0;
    o[4] = zy * xz - zz * xy;
    o[5] = zz * xx - zx * xz;
    o[6] = zx * xy - zy * xx;
    o[7] = 0;
    o[8] = zx; o[9] = zy; o[10] = zz; o[11] = 0;
    o[12] = eye[0]; o[13] = eye[1]; o[14] = eye[2]; o[15] = 1;
    return o;
  },

  invert(o: Mat4, a: Mat4): Mat4 | null {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;

    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },

  getTranslation(o: Vec3, m: Mat4): Vec3 {
    o[0] = m[12];
    o[1] = m[13];
    o[2] = m[14];
    return o;
  },
};
