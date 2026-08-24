/**
 * Registers the shared GLSL library, available to any shader as
 * `#include <math>`, `#include <ink>`, `#include <polyline>`.
 */

import { registerChunk } from './program.ts';

import mathChunk from '../shaders/lib/math.glsl?raw';
import inkChunk from '../shaders/lib/ink.glsl?raw';
import polylineChunk from '../shaders/lib/polyline.glsl?raw';

let registered = false;

export function registerChunks(): void {
  if (registered) return;
  registered = true;
  registerChunk('math', mathChunk);
  registerChunk('ink', inkChunk);
  registerChunk('polyline', polylineChunk);
}
