/**
 * A stable fingerprint of any generated value, for the determinism tests.
 *
 * The project's promise is "same seed, same sky, forever", and the code keeps
 * it by never changing the order in which a generator draws from its Rng. That
 * is easy to break by accident and impossible to see in a diff, so every
 * generator's output for a few fixed seeds is reduced to a short hash here and
 * the hashes are committed. A hash that moves is the alarm: either the change
 * was meant to alter every sky ever shared, or a draw slipped in somewhere.
 *
 * Numbers are written out exactly (String(n) is the shortest round-trip form,
 * so two doubles fingerprint alike only if they are bit-identical), typed
 * arrays element by element, objects in their own-key order. Bytes hash
 * directly, so a Raster's whole buffer costs one pass with no serialisation.
 *
 * Non-integer numbers are taken to eight significant digits first. The first
 * run of this suite on GitHub's x86 runner failed one sky that passed on an
 * arm64 Mac: V8's Math.pow and Math.sin are compiled per architecture, and
 * the last bit of a transcendental can differ between the two. A star's
 * magnitude off by one part in 10^16 is not a different sky, and eight digits
 * is coarse enough that no ulp-level difference can straddle a boundary in
 * practice while any real change — a draw slipping in, a formula edited —
 * moves the leading digits and is caught. The same drift exists between
 * visitors' machines, and is invisible for the same reason.
 */

const FNV_PRIME = 16777619;

/** Two independent 32-bit FNV-1a streams, so a collision needs to fool both. */
class Hasher {
  private a = 2166136261 >>> 0;
  private b = 0x84222325 >>> 0;

  byte(v: number): void {
    this.a = Math.imul(this.a ^ (v & 0xff), FNV_PRIME) >>> 0;
    this.b = Math.imul(this.b ^ (v & 0xff), 0x9e3779b1) >>> 0;
  }

  string(s: string): void {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c);
      this.byte(c >>> 8);
    }
  }

  hex(): string {
    return this.a.toString(16).padStart(8, '0') + this.b.toString(16).padStart(8, '0');
  }
}

function isTypedArray(v: unknown): v is ArrayLike<number> {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function walk(h: Hasher, value: unknown): void {
  if (value === null || value === undefined) {
    h.string(String(value));
  } else if (typeof value === 'number') {
    h.string(Number.isInteger(value) || !Number.isFinite(value) ? String(value) : value.toPrecision(8));
  } else if (typeof value === 'boolean') {
    h.string(String(value));
  } else if (typeof value === 'string') {
    h.string(JSON.stringify(value));
  } else if (isTypedArray(value) || Array.isArray(value)) {
    h.string('[');
    for (let i = 0; i < value.length; i++) {
      if (i) h.string(',');
      walk(h, value[i]);
    }
    h.string(']');
  } else if (typeof value === 'object') {
    h.string('{');
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      h.string(JSON.stringify(k));
      h.string(':');
      walk(h, v);
      h.string(',');
    }
    h.string('}');
  } else {
    throw new Error(`fingerprint: cannot hash a ${typeof value}`);
  }
}

/** Sixteen hex characters that change if anything in `value` does. */
export function fingerprint(value: unknown): string {
  const h = new Hasher();
  walk(h, value);
  return h.hex();
}

/** The same, straight over a byte buffer — a Raster's pixels, say. */
export function fingerprintBytes(bytes: Uint8Array | Uint8ClampedArray): string {
  const h = new Hasher();
  for (let i = 0; i < bytes.length; i++) h.byte(bytes[i]!);
  return h.hex();
}
