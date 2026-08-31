/**
 * The contract every chapter implements.
 *
 * The shell owns the canvas, the render target, the camera rig, the press and
 * the chrome. A chapter only has to build its scene and draw it — which is why
 * chapter 6 can reuse chapters 2–5 as components later.
 */

import type { OrbitCamera } from '../core/camera.ts';
import type { Rng } from '../core/rng.ts';
import type { PrintPass } from '../gl/post.ts';
import type { InkSet } from '../ui/palette.ts';
import type { LabelLayer } from '../ui/labels.ts';
import type { ControlPanel } from '../ui/controls.ts';
import type { AudioEngine } from '../audio/engine.ts';

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
  /**
   * The site's voice. May have no context at all — sound is opt-in, and a
   * chapter must open in silence and start humming later if the reader turns
   * it on, rather than treating "off" as a case to skip. Whatever a chapter
   * starts here it stops in dispose(), exactly like a GL resource.
   */
  audio: AudioEngine;
  /** Drawing-buffer size in physical pixels. */
  size: { width: number; height: number };
  /** The seed this chapter was opened with. */
  seed: string;
  /** Already seeded from `seed` — the chapter's one source of randomness. */
  rng: Rng;
  /**
   * True when this load is a reroll of the same chapter rather than a fresh
   * arrival. The shell already keeps the camera's yaw/pitch/fov/distance
   * across a reseed (see Shell.loadChapter); a chapter whose subject moves
   * with the seed (a planet on its own orbit, say) should check this before
   * re-centering the camera on that subject, or every reroll will yank the
   * view to the new position instead of leaving it where the user left it —
   * the same "reroll changes the content, not the view" contract Star Chart
   * gets for free because its subject never moves.
   */
  isReseed: boolean;
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
  /** Seeded generators get the shell's seed chip (shown seed + reroll). */
  seeded?: boolean;
  /** Chapters not yet built render as disabled nav entries. */
  available: boolean;
  /** Utility plates (the benchmark suite) — routable, but never listed. */
  hidden?: boolean;
  /** Code-split entry point. */
  load?: () => Promise<ChapterModule>;
}
