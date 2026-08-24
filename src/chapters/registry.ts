/**
 * The six chapters, in order. Each is a seeded generator, and each re-imagines
 * a specific project from the 2015 coursework.
 */

import type { ChapterDef } from '../app/chapter.ts';

export const CHAPTERS: ChapterDef[] = [
  {
    id: 'star-chart',
    index: 1,
    title: 'Star Chart',
    subtitle: 'A night sky inked by a rasterizer written from scratch — no GPU triangles, just edge functions and barycentric weights.',
    concepts: [
      'Software rasterization: DDA lines, barycentric triangle fills',
      'Perspective projection computed by hand on the CPU',
      'Catmull-Rom and Bézier strokes',
      'Aliasing, and what fixes it',
    ],
    api: 'webgl2',
    palette: 'cyanotype',
    available: false,
  },
  {
    id: 'orrery',
    index: 2,
    title: 'Orrery',
    subtitle: 'The solar system as a working instrument: real Kepler orbits, hierarchical moons, an instanced asteroid belt, and a probe riding a spline.',
    concepts: [
      'Scene graph: hierarchical sun → planet → moon transforms',
      'Kepler orbital elements solved per frame',
      'Model-view-projection and a quaternion camera',
      'Instanced rendering: one draw call for the whole belt',
      'Parametric surfaces: UV spheres and ring annuli',
      'Catmull-Rom spline camera tours',
      'A procedural star in a single fragment shader',
      'OBJ mesh loading',
    ],
    api: 'webgl2',
    palette: 'observatory',
    available: true,
    load: () => import('./02-orrery/index.ts'),
  },
  {
    id: 'worldsmith',
    index: 3,
    title: 'Worldsmith',
    subtitle: 'Seed a planet: warped noise carves continents, ice and biomes, with the shading model itself as a control you can turn.',
    concepts: [
      'Procedural noise: FBM and domain warping',
      'Lambert → Blinn-Phong → banded ink, side by side',
      'Normal mapping in tangent space',
      'Colour ramps and texture filtering',
    ],
    api: 'webgl2',
    palette: 'ferrous',
    available: false,
  },
  {
    id: 'groundside',
    index: 4,
    title: 'Groundside',
    subtitle: 'Stand on the world you generated, under a seeded sky — shadow maps, bloom and the tone curve laid bare.',
    concepts: [
      'Framebuffers and the post-process pipeline',
      'Shadow mapping with PCF',
      'Bloom on bright inks',
      'Tone mapping, compared directly',
    ],
    api: 'webgl2',
    palette: 'ferrous',
    available: false,
  },
  {
    id: 'galaxy-loom',
    index: 5,
    title: 'Galaxy Loom',
    subtitle: 'Two hundred thousand stars settle into spiral arms on the GPU. Stir them, reseed them, watch a galaxy condense.',
    concepts: [
      'WebGPU compute shaders and storage buffers',
      'GPGPU particle simulation',
      'Curl noise and density waves',
      'Additive blending at scale',
    ],
    api: 'webgpu',
    palette: 'cyanotype',
    available: false,
  },
  {
    id: 'forge',
    index: 6,
    title: 'The Forge',
    subtitle: 'Seed an entire star system — then frame a shot and print it: an analytic ray tracer turns your flight into a travel poster.',
    concepts: [
      'Analytic ray–sphere and ray–plane intersection',
      'Hard shadows and reflection rays',
      'Composition of every previous chapter',
      'Procedural poster layout and typography',
    ],
    api: 'webgpu',
    palette: 'observatory',
    available: false,
  },
];

export const DEFAULT_CHAPTER = 'orrery';

export function findChapter(id: string): ChapterDef | undefined {
  return CHAPTERS.find((c) => c.id === id);
}
