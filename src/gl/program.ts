/**
 * Shader programs: `#include <chunk>` resolution, introspected uniforms, and
 * fixed attribute slots so a Mesh's VAO works with any program.
 */

/** Attribute name → location, bound before linking so VAOs are program-agnostic. */
export const ATTRIB_SLOTS: Record<string, number> = {
  aPosition: 0,
  aNormal: 1,
  aUv: 2,
  aColor: 3,
  // Line ribbons
  aPrev: 4,
  aNext: 5,
  aSide: 6,
  aParam: 7,
  // Per-instance
  aOrbit: 8,
  aPhase: 9,
  aTint: 10,
};

const chunks = new Map<string, string>();

/** Register a reusable GLSL chunk available to `#include <name>`. */
export function registerChunk(name: string, source: string): void {
  chunks.set(name, source);
}

const INCLUDE_RE = /^[ \t]*#include[ \t]+<([\w.-]+)>[ \t]*$/gm;

export function resolveIncludes(source: string, depth = 0): string {
  if (depth > 8) throw new Error('resolveIncludes: include depth exceeded (circular include?)');
  return source.replace(INCLUDE_RE, (_match, name: string) => {
    const chunk = chunks.get(name);
    if (chunk === undefined) throw new Error(`resolveIncludes: unknown chunk <${name}>`);
    return resolveIncludes(chunk, depth + 1);
  });
}

interface UniformInfo {
  location: WebGLUniformLocation;
  type: number;
  size: number;
}

export type UniformValue = number | boolean | Float32Array | number[];

/**
 * Every program ever built, per context, keyed by its source.
 *
 * A chapter is torn down and rebuilt on every reroll and every ink change, and
 * it used to recompile all of its programs each time — eight or nine for
 * Worldsmith, two thirds of a reroll's wall time on the fastest hardware and
 * far more than that on drivers that compile slowly. The source never changes
 * between two builds of the same chapter, so the compiled program is kept for
 * the life of the context and handed back on the next request. A session
 * compiles about fifteen distinct programs in total; keeping them all costs
 * nothing worth measuring, which is why there is no eviction and no dispose.
 */
const cache = new WeakMap<WebGL2RenderingContext, Map<string, Program>>();

export class Program {
  readonly gl: WebGL2RenderingContext;
  readonly handle: WebGLProgram;
  readonly name: string;
  private readonly uniforms = new Map<string, UniformInfo>();
  /** Names already warned about, so a bad uniform doesn't spam every frame. */
  private readonly warned = new Set<string>();

  /**
   * The program for this vertex/fragment pair, compiled on first request and
   * shared by every later one. `name` labels compile errors and the dev-only
   * inactive-uniform warnings; the first caller's name sticks.
   *
   * Shared means shared state: uniforms persist between callers, so a draw
   * must set every uniform it relies on rather than trust what the previous
   * owner left behind. Every pass in the project already does.
   */
  static cached(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string, name = 'program'): Program {
    let programs = cache.get(gl);
    if (!programs) {
      programs = new Map();
      cache.set(gl, programs);
    }
    const key = `${vertexSource}\0${fragmentSource}`;
    let program = programs.get(key);
    if (!program) {
      program = new Program(gl, vertexSource, fragmentSource, name);
      programs.set(key, program);
    }
    return program;
  }

  private constructor(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string, name: string) {
    this.gl = gl;
    this.name = name;

    const vs = compileShader(gl, gl.VERTEX_SHADER, resolveIncludes(vertexSource), `${name}.vert`);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, resolveIncludes(fragmentSource), `${name}.frag`);

    const handle = gl.createProgram();
    if (!handle) throw new Error(`${name}: gl.createProgram() failed`);
    gl.attachShader(handle, vs);
    gl.attachShader(handle, fs);

    for (const [attrib, slot] of Object.entries(ATTRIB_SLOTS)) {
      gl.bindAttribLocation(handle, slot, attrib);
    }

    gl.linkProgram(handle);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(handle);
      gl.deleteProgram(handle);
      throw new Error(`${name}: link failed\n${log}`);
    }

    this.handle = handle;

    const count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(handle, i);
      if (!info) continue;
      // Array uniforms report as "name[0]" — store under the bare name too.
      const bare = info.name.replace(/\[0\]$/, '');
      const location = gl.getUniformLocation(handle, info.name);
      if (location) this.uniforms.set(bare, { location, type: info.type, size: info.size });
    }
  }

  use(): this {
    this.gl.useProgram(this.handle);
    return this;
  }

  has(name: string): boolean {
    return this.uniforms.has(name);
  }

  /** Set a uniform, dispatching on the type reported by the driver. */
  set(name: string, value: UniformValue): this {
    const info = this.uniforms.get(name);
    if (!info) {
      // Unused uniforms get optimized out — that's normal, so warn only once.
      if (!this.warned.has(name)) {
        this.warned.add(name);
        if (import.meta.env.DEV) {
          console.debug(`${this.name}: uniform "${name}" not active (optimized out?)`);
        }
      }
      return this;
    }

    const gl = this.gl;
    const loc = info.location;

    switch (info.type) {
      case gl.FLOAT:
        if (typeof value === 'number') gl.uniform1f(loc, value);
        else gl.uniform1fv(loc, value as Float32Array);
        break;
      case gl.FLOAT_VEC2:
        gl.uniform2fv(loc, value as Float32Array);
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(loc, value as Float32Array);
        break;
      case gl.FLOAT_VEC4:
        gl.uniform4fv(loc, value as Float32Array);
        break;
      case gl.FLOAT_MAT3:
        gl.uniformMatrix3fv(loc, false, value as Float32Array);
        break;
      case gl.FLOAT_MAT4:
        gl.uniformMatrix4fv(loc, false, value as Float32Array);
        break;
      case gl.INT:
      case gl.BOOL:
      case gl.SAMPLER_2D:
      case gl.SAMPLER_CUBE:
        if (typeof value === 'number') gl.uniform1i(loc, value);
        else if (typeof value === 'boolean') gl.uniform1i(loc, value ? 1 : 0);
        else gl.uniform1iv(loc, value as unknown as Int32Array);
        break;
      case gl.INT_VEC2:
        gl.uniform2iv(loc, value as unknown as Int32Array);
        break;
      case gl.INT_VEC3:
        gl.uniform3iv(loc, value as unknown as Int32Array);
        break;
      default:
        throw new Error(`${this.name}: unhandled uniform type 0x${info.type.toString(16)} for "${name}"`);
    }
    return this;
  }

  /** Bind a texture to a unit and point the sampler uniform at it. */
  setTexture(name: string, texture: WebGLTexture, unit: number, target?: number): this {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target ?? gl.TEXTURE_2D, texture);
    return this.set(name, unit);
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`${label}: gl.createShader() failed`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`${label}: compile failed\n${log}\n${withLineNumbers(source, log)}`);
  }
  return shader;
}

/** Print the source around the first reported error line — GLSL logs are terse. */
function withLineNumbers(source: string, log: string): string {
  const match = /ERROR:\s*\d+:(\d+)/.exec(log);
  const lines = source.split('\n');
  if (!match) return lines.map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n');

  const errLine = parseInt(match[1]!, 10);
  const from = Math.max(0, errLine - 6);
  const to = Math.min(lines.length, errLine + 5);
  return lines
    .slice(from, to)
    .map((l, i) => {
      const n = from + i + 1;
      return `${n === errLine ? '>>>' : '   '}${String(n).padStart(4)}| ${l}`;
    })
    .join('\n');
}
