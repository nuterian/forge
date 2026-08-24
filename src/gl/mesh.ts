/**
 * VAO-backed meshes. Because attribute locations are fixed in ATTRIB_SLOTS,
 * one VAO is valid for every program that uses the same attribute names.
 */

import { ATTRIB_SLOTS } from './program.ts';

export interface AttributeSpec {
  /** Must be a key of ATTRIB_SLOTS. */
  name: keyof typeof ATTRIB_SLOTS | string;
  data: Float32Array;
  /** Components per vertex (1–4). */
  size: number;
  /** 0 = per vertex (default), 1 = per instance. */
  divisor?: number;
  /** Defaults to gl.STATIC_DRAW. */
  dynamic?: boolean;
}

export interface MeshSpec {
  attributes: AttributeSpec[];
  indices?: Uint16Array | Uint32Array;
  /** gl.TRIANGLES by default. */
  mode?: number;
  /** Vertex/index count override. */
  count?: number;
}

export class Mesh {
  readonly gl: WebGL2RenderingContext;
  readonly vao: WebGLVertexArrayObject;
  readonly mode: number;
  readonly count: number;
  readonly indexType: number | null;

  private readonly buffers = new Map<string, WebGLBuffer>();
  private readonly indexBuffer: WebGLBuffer | null = null;

  constructor(gl: WebGL2RenderingContext, spec: MeshSpec) {
    this.gl = gl;
    this.mode = spec.mode ?? gl.TRIANGLES;

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Mesh: gl.createVertexArray() failed');
    this.vao = vao;
    gl.bindVertexArray(vao);

    let vertexCount = 0;
    for (const attr of spec.attributes) {
      const slot = ATTRIB_SLOTS[attr.name];
      if (slot === undefined) {
        throw new Error(`Mesh: attribute "${attr.name}" has no slot in ATTRIB_SLOTS`);
      }

      const buffer = gl.createBuffer();
      if (!buffer) throw new Error(`Mesh: gl.createBuffer() failed for "${attr.name}"`);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, attr.data, attr.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      gl.enableVertexAttribArray(slot);
      gl.vertexAttribPointer(slot, attr.size, gl.FLOAT, false, 0, 0);
      if (attr.divisor) gl.vertexAttribDivisor(slot, attr.divisor);

      this.buffers.set(attr.name, buffer);
      if (!attr.divisor) {
        vertexCount = Math.max(vertexCount, attr.data.length / attr.size);
      }
    }

    if (spec.indices) {
      const ib = gl.createBuffer();
      if (!ib) throw new Error('Mesh: gl.createBuffer() failed for indices');
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, spec.indices, gl.STATIC_DRAW);
      this.indexBuffer = ib;
      this.indexType = spec.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      this.count = spec.count ?? spec.indices.length;
    } else {
      this.indexType = null;
      this.count = spec.count ?? vertexCount;
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** Re-upload an attribute declared with `dynamic: true`. */
  update(name: string, data: Float32Array): void {
    const buffer = this.buffers.get(name);
    if (!buffer) throw new Error(`Mesh: no buffer for attribute "${name}"`);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  draw(instances = 0): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (this.indexType !== null) {
      if (instances > 0) gl.drawElementsInstanced(this.mode, this.count, this.indexType, 0, instances);
      else gl.drawElements(this.mode, this.count, this.indexType, 0);
    } else {
      if (instances > 0) gl.drawArraysInstanced(this.mode, 0, this.count, instances);
      else gl.drawArrays(this.mode, 0, this.count);
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteVertexArray(this.vao);
    for (const b of this.buffers.values()) gl.deleteBuffer(b);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    this.buffers.clear();
  }
}
