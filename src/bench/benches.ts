/**
 * The benchmark suite: every hot pass and primitive in the project, measured
 * under a fixed, deterministic workload so a number from last month and a
 * number from today disagree only when the code changed.
 *
 * GPU passes render into an offscreen 1920×1080 target with depth testing off,
 * so every fragment actually shades — early-Z would otherwise let draw order
 * decide the measurement. CPU benches run the real modules (Raster, Kepler,
 * the label layer) on seeded data.
 */

import { DEG, vec3 } from '../core/math.ts';
import { OrbitCamera } from '../core/camera.ts';
import { Rng } from '../core/rng.ts';
import { Raster } from '../core/raster.ts';
import { positionAt, type OrbitalElements } from '../core/kepler.ts';
import { Framebuffer } from '../gl/framebuffer.ts';
import { Mesh } from '../gl/mesh.ts';
import { Program } from '../gl/program.ts';
import { icosphere, toMesh, uvSphere } from '../gl/geometry.ts';
import { PrintPass } from '../gl/post.ts';
import { GlowBillboard } from '../scene/glow.ts';
import { SkyPass } from '../scene/sky.ts';
import { InkSet, PALETTES } from '../ui/palette.ts';
import { LabelLayer, type LabelSpec } from '../ui/labels.ts';
import { generateSky } from '../chapters/01-star-chart/sky.ts';
import { generateDeepSky } from '../chapters/01-star-chart/deepsky.ts';
import { ChartPlate, projectPlanisphere, type Basis, type PlateView } from '../chapters/01-star-chart/plate.ts';
import { beltAttributes } from '../chapters/02-orrery/bodies.ts';
import { applyPlanetUniforms, bakePlanetFields, createRampTexture } from '../chapters/03-worldsmith/planet.ts';
import { generatePlanet } from '../chapters/03-worldsmith/params.ts';
import { GpuTimer, best, cpuBench, yieldTask, type BenchResult } from './harness.ts';

import planetVert from '../chapters/03-worldsmith/shaders/planet.vert?raw';
import planetFrag from '../chapters/03-worldsmith/shaders/planet.frag?raw';
import bodyVert from '../scene/shaders/body.vert?raw';
import bodyFrag from '../scene/shaders/body.frag?raw';
import asteroidVert from '../chapters/02-orrery/shaders/asteroid.vert?raw';
import asteroidFrag from '../chapters/02-orrery/shaders/asteroid.frag?raw';

export const BENCH_WIDTH = 1920;
export const BENCH_HEIGHT = 1080;

/** The unit sphere mapped straight onto NDC: fills the target exactly. */
const NDC_VP = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -0.01, 0, 0, 0, 0.5, 1]);
const IDENTITY4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

export async function runAllBenches(
  gl: WebGL2RenderingContext,
  onProgress: (done: number, total: number, id: string) => void,
): Promise<BenchResult[]> {
  const results: BenchResult[] = [];
  const timer = new GpuTimer(gl);
  const inks = new InkSet(PALETTES.find((p) => p.id === 'observatory') ?? PALETTES[0]!);

  const camera = new OrbitCamera({ distance: 27 });
  camera.update(0, BENCH_WIDTH / BENCH_HEIGHT);

  const target = new Framebuffer(gl, BENCH_WIDTH, BENCH_HEIGHT, { samples: 0, depth: false });
  const bindTarget = (): void => {
    target.bind();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
  };

  interface GpuBench {
    id: string;
    name: string;
    reps: number;
    /**
     * Returns the timed draw and, optionally, a prepare step that runs once
     * per round *outside* the timer. Raw-program benches put their uniform
     * uploads in prepare so the number is the shader, not driver state churn —
     * uniforms between every draw inflated the planet's measurement 5×.
     */
    setup: () => { prepare?: () => void; draw: () => void };
  }
  const disposables: Array<{ dispose: () => void }> = [];

  // --- GPU benches ----------------------------------------------------------

  const benchEye = vec3.create(0, 0, 5);
  const benchLight = vec3.create(6, 0, 6);

  const gpuBenches: GpuBench[] = [
    {
      id: 'gpu.sky',
      name: 'Sky pass, fullscreen 1080p',
      reps: 60,
      setup: () => {
        const sky = new SkyPass(gl);
        disposables.push(sky);
        return { draw: () => sky.draw(camera, inks, { density: 1, galaxy: 0.6 }) };
      },
    },
    {
      id: 'gpu.post',
      name: 'Print post pass, 1080p',
      reps: 60,
      setup: () => {
        const print = new PrintPass(gl);
        const source = new Framebuffer(gl, BENCH_WIDTH, BENCH_HEIGHT, { samples: 0, depth: false });
        source.bind();
        gl.clearColor(0.4, 0.35, 0.3, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        disposables.push(print, source);
        return { draw: () => print.render(source, BENCH_WIDTH, BENCH_HEIGHT, 1.25) };
      },
    },
    {
      // The same pass mid-warp. It takes the expensive branch — eight
      // impressions with the colour plates pulled apart, twenty-four samples
      // against the resting path's three — so it is measured separately rather
      // than left to hide behind a number taken at rest. It only runs for
      // about a second across a route change, but a second at 60fps is sixty
      // frames that still have to land.
      id: 'gpu.post.warp',
      name: 'Print post pass mid-warp, 1080p',
      reps: 60,
      setup: () => {
        const print = new PrintPass(gl);
        print.warp = 0.5;
        const source = new Framebuffer(gl, BENCH_WIDTH, BENCH_HEIGHT, { samples: 0, depth: false });
        source.bind();
        gl.clearColor(0.4, 0.35, 0.3, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        disposables.push(print, source);
        return { draw: () => print.render(source, BENCH_WIDTH, BENCH_HEIGHT, 1.25) };
      },
    },
    {
      id: 'gpu.planet',
      name: 'Worldsmith planet, planet-filling',
      reps: 60,
      setup: () => {
        const params = generatePlanet(new Rng('bench-planet'));
        const program = Program.cached(gl, planetVert, planetFrag, 'worldsmith.planet');
        const mesh = toMesh(gl, uvSphere(1, 96, 64));
        const ramp = createRampTexture(gl, params, inks);
        const fields = bakePlanetFields(gl, params);
        disposables.push(mesh, fields, {
          dispose: () => gl.deleteTexture(ramp),
        });
        return {
          prepare: () => {
            program
              .use()
              .set('uModel', IDENTITY4)
              .set('uViewProjection', NDC_VP)
              .set('uNormalMatrix', IDENTITY3)
              .set('uLightPos', benchLight)
              .set('uCameraPos', benchEye)
              .set('uCloudDrift', 0.4)
              .set('uRelief', 1)
              .set('uShadeMode', 0)
              .set('uBands', 5)
              .set('uSoftness', 0.05)
              .set('uFilterMode', 0)
              .setTexture('uRamp', ramp, 0)
              .setTexture('uFields', fields.texture, 1);
            applyPlanetUniforms(program, params, inks);
          },
          draw: () => mesh.draw(),
        };
      },
    },
    {
      id: 'gpu.bake',
      name: 'Worldsmith field bake (per load)',
      reps: 4,
      setup: () => {
        const params = generatePlanet(new Rng('bench-planet'));
        return {
          draw: () => {
            const fb = bakePlanetFields(gl, params);
            disposables.push(fb);
            bindTarget(); // bake binds its own target; restore ours
          },
        };
      },
    },
    {
      id: 'gpu.body',
      name: 'Banded-ink body shader, fullscreen',
      reps: 80,
      setup: () => {
        const program = Program.cached(gl, bodyVert, bodyFrag, 'scene.body');
        const mesh = toMesh(gl, uvSphere(1, 56, 36));
        disposables.push(mesh);
        return {
          prepare: () => {
            program
              .use()
              .set('uModel', IDENTITY4)
              .set('uViewProjection', NDC_VP)
              .set('uNormalMatrix', IDENTITY3)
              .set('uLightPos', benchLight)
              .set('uCameraPos', benchEye)
              .set('uInkShadow', inks.shadow)
              .set('uBands', 4)
              .set('uSoftness', 0.06)
              .set('uShadeMode', 0)
              .set('uPattern', 0.55)
              .set('uAtmosphere', 0.5)
              .set('uStyle', 1)
              .set('uInkBase', inks.ink(3))
              .set('uInkHighlight', inks.ink(0));
          },
          draw: () => mesh.draw(),
        };
      },
    },
    {
      id: 'gpu.belt',
      name: 'Asteroid belt, 2600 instances',
      reps: 60,
      setup: () => {
        // The Orrery's own belt, from the same seed.
        const belt = beltAttributes(new Rng('main-belt'));
        const count = belt.orbit.length / 4;
        const geo = icosphere(1, 1);
        const mesh = new Mesh(gl, {
          attributes: [
            { name: 'aPosition', data: geo.positions, size: 3 },
            { name: 'aNormal', data: geo.normals, size: 3 },
            { name: 'aOrbit', data: belt.orbit, size: 4, divisor: 1 },
            { name: 'aPhase', data: belt.phase, size: 4, divisor: 1 },
          ],
          indices: geo.indices,
        });
        const program = Program.cached(gl, asteroidVert, asteroidFrag, 'orrery.asteroid');
        disposables.push(mesh);
        return {
          prepare: () => {
            program
              .use()
              .set('uViewProjection', camera.viewProjection)
              .set('uTime', 9500)
              .set('uOrbitScale', 8)
              .set('uCompression', 0.5)
              .set('uSizeScale', 0.03)
              .set('uInkShadow', inks.shadow)
              .set('uInkBase', inks.ink(0))
              .set('uInkHighlight', inks.ink(2));
          },
          draw: () => mesh.draw(count),
        };
      },
    },
    {
      id: 'gpu.glow',
      name: 'Glow billboard, screen-filling',
      reps: 80,
      setup: () => {
        const glow = new GlowBillboard(gl);
        disposables.push(glow);
        const center = vec3.create(0, 0, 0);
        const eyeCam = new OrbitCamera({ distance: 4 });
        eyeCam.update(0, BENCH_WIDTH / BENCH_HEIGHT);
        return {
          draw: () =>
            glow.draw(eyeCam, {
              center, scale: 3, inner: 1 / 3, ink: inks.ink(1),
              opacity: 0.55, time: 2.5,
            }),
        };
      },
    },
  ];

  // --- CPU benches ----------------------------------------------------------

  const rasterW = 1500;
  const rasterH = 844;
  const raster = new Raster(rasterW, rasterH);
  const paper: [number, number, number] = [10, 12, 19];
  const line: [number, number, number] = [244, 233, 212];

  // The Star Chart's real plate — the same class the chapter draws with — at
  // the view a visitor arrives to (110° across, looking down -Z), on a dirty
  // frame: the one where the baked plate has to be redrawn because the view
  // moved. Stars, figures, deep sky and the instrument furniture, exactly as
  // the chapter lays them down.
  const plate = new ChartPlate(generateSky('VELA-2015'), generateDeepSky('bench'), inks, {
    title: 'TABULA ASTRORUM', seed: 'SEED BENCH-0000', epoch: 'EPOCH 2026.0 \u00b7 THE FORGE PRESS',
  });
  const basis: Basis = {
    right: vec3.create(1, 0, 0), up: vec3.create(0, 1, 0), forward: vec3.create(0, 0, -1),
  };
  const view: PlateView = {
    project: (dir, out) => {
      projectPlanisphere(dir, basis, view.fov, rasterW, rasterH, out);
      out.x *= rasterW;
      out.y *= rasterH;
    },
    fov: 110 * DEG,
    pxPerCss: 1,
    narrow: false,
    antialias: true,
  };
  const chartFrame = (): void => {
    raster.clear(paper);
    plate.drawGraticule(raster, view);
    plate.drawDeepSky(raster, view);
    plate.drawFurniture(raster, view);
    plate.drawStars(raster, view, 0);
    plate.drawFigures(raster, view);
  };

  const orbit: OrbitalElements = {
    a: 5.2, e: 0.049, i: 1.3, node: 100.5, peri: 14.7, L0: 34.4, period: 4332.6,
  };
  const keplerOut = vec3.create();

  const labelLayer = new LabelLayer();
  const labelCamera = new OrbitCamera({ distance: 30 });
  labelCamera.update(0, 16 / 9);
  const labelRng = new Rng('bench-labels');
  const specs: LabelSpec[] = [];
  for (let i = 0; i < 40; i++) {
    specs.push({
      id: `b${i}`,
      text: `Body ${i}`,
      detail: i % 3 === 0 ? '0.00 AU' : undefined,
      color: '#ffb03a',
      position: vec3.create(labelRng.range(-20, 20), labelRng.range(-4, 4), labelRng.range(-20, 20)),
      priority: i % 7,
      occluder: i % 2
        ? { center: vec3.create(labelRng.range(-20, 20), 0, labelRng.range(-20, 20)), radius: 1.2 }
        : undefined,
    });
  }
  labelLayer.set(specs);

  interface CpuBench {
    id: string;
    name: string;
    reps: number;
    fn: () => void;
  }

  const cpuBenches: CpuBench[] = [
    { id: 'cpu.raster.clear', name: 'Raster clear, 1500×844', reps: 40, fn: () => raster.clear(paper) },
    {
      id: 'cpu.raster.lines',
      name: '1000 AA lines, ~120px',
      reps: 12,
      fn: () => {
        const rng = new Rng(7);
        for (let i = 0; i < 1000; i++) {
          const x = rng.range(60, rasterW - 60);
          const y = rng.range(60, rasterH - 60);
          raster.line(x, y, x + rng.range(-120, 120), y + rng.range(-120, 120), line, { alpha: 0.3, aa: true });
        }
      },
    },
    {
      id: 'cpu.raster.dots',
      name: '2000 AA dots, r 0.5–3.5',
      reps: 12,
      fn: () => {
        const rng = new Rng(11);
        for (let i = 0; i < 2000; i++) {
          raster.dot(rng.range(4, rasterW - 4), rng.range(4, rasterH - 4), rng.range(0.5, 3.5), line, 0.8, true);
        }
      },
    },
    {
      // The stroke font is a new primitive in a hot path — the cartouche, the
      // compass points and every degree label go through it — so it gets its
      // own row rather than hiding inside the chart frame.
      id: 'cpu.raster.text',
      name: '600 glyphs, stroke font',
      reps: 12,
      fn: () => {
        for (let row = 0; row < 20; row++) {
          raster.text(40, 30 + row * 34, 'URANOGRAPHIA 0123 \u00b7 PLATE', 11, line, { alpha: 0.8, aa: true });
        }
      },
    },
    {
      id: 'cpu.raster.triangles',
      name: '600 AA triangles, ~14px',
      reps: 12,
      fn: () => {
        const rng = new Rng(13);
        for (let i = 0; i < 600; i++) {
          const x = rng.range(20, rasterW - 20);
          const y = rng.range(20, rasterH - 20);
          raster.triangle(
            x, y, x + rng.range(-14, 14), y + rng.range(-14, 14),
            x + rng.range(-14, 14), y + rng.range(-14, 14), line, 0.6, true,
          );
        }
      },
    },
    { id: 'cpu.chart.frame', name: 'Star chart frame, 1500×844', reps: 6, fn: chartFrame },
    {
      id: 'cpu.kepler',
      name: '10k Kepler solves',
      reps: 20,
      fn: () => {
        for (let i = 0; i < 10000; i++) positionAt(keplerOut, orbit, i * 0.37);
      },
    },
    {
      id: 'cpu.labels',
      name: 'Label layer update, 40 labels',
      reps: 200,
      fn: () => labelLayer.update(labelCamera, 1920, 1080),
    },
  ];

  // --- run ------------------------------------------------------------------
  // Several full sweeps, interleaved, taking the minimum per bench at the end.
  // A backgrounded page can spend whole seconds on efficiency cores or behind
  // other GPU work; sweeps make sure one favourable scheduling window reaches
  // every bench instead of whichever happened to run during it.

  // An occluded page rides efficiency cores in long stretches; more sweeps
  // buy more chances of a performance-core window, and minima only improve.
  const SWEEPS = document.visibilityState === 'visible' ? 3 : 7;
  const total = (gpuBenches.length + cpuBenches.length) * SWEEPS;
  let done = 0;

  const gpuReady = gpuBenches.map((bench) => ({ bench, run: timer.ext ? bench.setup() : null }));
  const samplesById = new Map<string, number[]>();
  const push = (id: string, samples: number[]): void => {
    const list = samplesById.get(id) ?? [];
    list.push(...samples);
    samplesById.set(id, list);
  };

  // Warm every GPU bench once: compile, upload, allocate.
  for (const { run } of gpuReady) {
    if (!run) continue;
    bindTarget();
    run.prepare?.();
    run.draw();
  }

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (const { bench, run } of gpuReady) {
      onProgress(done, total, bench.id);
      if (!run) { done++; continue; }
      push(bench.id, await timer.run(run.draw, bench.reps, () => {
        bindTarget();
        run.prepare?.();
      }, 2));
      done++;
    }
    for (const bench of cpuBenches) {
      onProgress(done, total, bench.id);
      await yieldTask();
      push(bench.id, cpuBench(bench.fn, { reps: bench.reps, rounds: 4 }));
      done++;
    }
  }

  for (const bench of gpuBenches) {
    const samples = samplesById.get(bench.id);
    results.push(
      samples
        ? { id: bench.id, name: bench.name, kind: 'gpu', best: best(samples), samples }
        : {
            id: bench.id, name: bench.name, kind: 'gpu', best: 0, samples: [],
            skipped: 'EXT_disjoint_timer_query_webgl2 unavailable',
          },
    );
  }
  for (const bench of cpuBenches) {
    const samples = samplesById.get(bench.id)!;
    results.push({ id: bench.id, name: bench.name, kind: 'cpu', best: best(samples), samples });
  }

  onProgress(total, total, 'done');

  for (const d of disposables) d.dispose();
  target.dispose();
  labelLayer.clear();
  labelLayer.element.remove();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return results;
}
