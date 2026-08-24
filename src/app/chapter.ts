/**
 * The contract every chapter implements.
 *
 * The shell owns the canvas, the render target, the camera rig, the press and
 * the chrome. A chapter only has to build its scene and draw it — which is why
 * chapter 6 can reuse chapters 2–5 as components later.
 */

import type { OrbitCamera } from '../core/camera.ts';
import type { PrintPass } from '../gl/post.ts';
import type { InkSet } from '../ui/palette.ts';
import type { LabelLayer } from '../ui/labels.ts';
import type { ControlPanel } from '../ui/controls.ts';

export interface ChapterContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  camera: OrbitCamera;
  inks: InkSet;
  /** The shared print pass; chapters may tune it to taste on load. */
  print: PrintPass;
  labels: LabelLayer;
  /** Chapter-specific controls appear here. */
  controls: ControlPanel;
  /** Drawing-buffer size in physical pixels. */
  size: { width: number; height: number };
  /** The seed this chapter was opened with. */
  seed: string;
  /** Replace the seed and reload the chapter. */
  reseed: (seed: string) => void;
}

export interface ChapterInstance {
  /** Advance simulation. `dt` is clamped seconds. */
  update(dt: number, elapsed: number): void;
  /** Draw into the currently bound render target. */
  render(): void;
  resize?(width: number, height: number): void;
  dispose(): void;
}

export interface ChapterModule {
  create(ctx: ChapterContext): ChapterInstance | Promise<ChapterInstance>;
}

export interface ChapterDef {
  /** URL slug, e.g. "orrery". */
  id: string;
  /** 1-based chapter number. */
  index: number;
  title: string;
  subtitle: string;
  /** Named for the "How it works" panel. */
  concepts: string[];
  api: 'webgl2' | 'webgpu';
  /** Palette id from PALETTES. */
  palette?: string;
  /** Chapters not yet built render as disabled nav entries. */
  available: boolean;
  /** Code-split entry point. */
  load?: () => Promise<ChapterModule>;
}
