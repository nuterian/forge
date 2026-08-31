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

import { DEG, TAU, vec3 } from '../core/math.ts';
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
import {
  applyPlanetUniforms, bakePlanetFields, createRampTexture, generatePlanet,
} from '../chapters/03-worldsmith/planet.ts';
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
        const sky = new SkyPass(gl, 'bench.sky');
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
      id: 'gpu.planet',
      name: 'Worldsmith planet, planet-filling',
      reps: 60,
      setup: () => {
        const params = generatePlanet(new Rng('bench-planet'));
        const program = new Program(gl, planetVert, planetFrag, 'bench.planet');
        const mesh = toMesh(gl, uvSphere(1, 96, 64));
        const ramp = createRampTexture(gl, params, inks);
        const fields = bakePlanetFields(gl, params);
        disposables.push(program, mesh, fields, {
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
        const program = new Program(gl, bodyVert, bodyFrag, 'bench.body');
        const mesh = toMesh(gl, uvSphere(1, 56, 36));
        disposables.push(program, mesh);
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
        const count = 2600;
        const beltRng = new Rng('main-belt');
        const orbitAttr = new Float32Array(count * 4);
        const phaseAttr = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
          const t = beltRng.next();
          const a = 2.1 + 1.2 * (0.25 + 0.75 * t) * (0.9 + beltRng.next() * 0.2);
          orbitAttr[i * 4] = a;
          orbitAttr[i * 4 + 1] = beltRng.next() * 0.2;
          orbitAttr[i * 4 + 2] = beltRng.gaussian() * 0.1;
          orbitAttr[i * 4 + 3] = beltRng.next() * TAU;
          phaseAttr[i * 4] = TAU / (365 * Math.pow(a, 1.5));
          phaseAttr[i * 4 + 1] = beltRng.power(0.5, 2.4, 2.2);
          phaseAttr[i * 4 + 2] = beltRng.range(-0.9, 0.9);
          phaseAttr[i * 4 + 3] = beltRng.next();
        }
        const geo = icosphere(1, 1);
        const mesh = new Mesh(gl, {
          attributes: [
            { name: 'aPosition', data: geo.positions, size: 3 },
            { name: 'aNormal', data: geo.normals, size: 3 },
            { name: 'aOrbit', data: orbitAttr, size: 4, divisor: 1 },
            { name: 'aPhase', data: phaseAttr, size: 4, divisor: 1 },
          ],
          indices: geo.indices,
        });
        const program = new Program(gl, asteroidVert, asteroidFrag, 'bench.belt');
        disposables.push(program, mesh);
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
        const glow = new GlowBillboard(gl, 'bench.glow');
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

  const sky = generateSky('VELA-2015');

  // A fixed chart projection: the identity basis, 110° fov, like ch1 at rest.
  const chartProject = (dir: Float32Array | number[], out: { x: number; y: number; visible: boolean }): void => {
    const f = Math.min(1, Math.max(-1, -dir[2]!));
    const theta = Math.acos(f);
    const s = (theta / (55 * DEG)) * 0.46;
    const sinT = Math.hypot(dir[0]!, dir[1]!);
    const ux = sinT > 1e-6 ? dir[0]! / sinT : 0;
    const uy = sinT > 1e-6 ? dir[1]! / sinT : 0;
    out.x = (0.5 + ux * s * (rasterH / rasterW)) * rasterW;
    out.y = (0.5 - uy * s) * rasterH;
    out.visible = theta < Math.PI * 0.999;
  };
  const pa = { x: 0, y: 0, visible: false };
  const pb = { x: 0, y: 0, visible: false };

  const deepSky = generateDeepSky('bench');
  const deepDir = vec3.create();

  /**
   * The chart's instrument furniture, drawn the way ch1 draws it: the deep-sky
   * stipple, the lettered cartouche, the compass rose's triangle points, and
   * the degree ticks around the planisphere's rim. The rim ticks only appear
   * on the real plate when the whole sphere is in frame; they are always drawn
   * here because this bench is a bound on the worst frame, not the usual one.
   */
  const chartFurniture = (): void => {
    for (const object of deepSky) {
      for (let i = 0; i < object.radii.length; i++) {
        vec3.set(deepDir, object.points[i * 3]!, object.points[i * 3 + 1]!, object.points[i * 3 + 2]!);
        chartProject(deepDir, pa);
        if (!pa.visible) continue;
        raster.dot(pa.x, pa.y, object.radii[i]!, line, object.alphas[i]!, true);
      }
    }

    // The cartouche: paper fill, double rule, three lines of the stroke font.
    const title = 'TABULA ASTRORUM';
    const seedLine = 'SEED BENCH-0000';
    const epochLine = 'EPOCH 2026.0 \u00b7 THE FORGE PRESS';
    const boxW = Math.max(
      raster.measureText(title, 9.5),
      raster.measureText(seedLine, 6.4),
      raster.measureText(epochLine, 6.4),
    ) + 20;
    const boxH = 54;
    const x0 = (rasterW - boxW) / 2;
    const y0 = rasterH - boxH - 30;
    const x1 = x0 + boxW;
    const y1 = y0 + boxH;
    raster.triangle(x0, y0, x1, y0, x1, y1, paper, 0.93, false);
    raster.triangle(x0, y0, x1, y1, x0, y1, paper, 0.93, false);
    for (const inset of [0, 3]) {
      const a = x0 + inset, b = y0 + inset, c = x1 - inset, d = y1 - inset;
      raster.line(a, b, c, b, line, { alpha: 0.5, aa: true });
      raster.line(c, b, c, d, line, { alpha: 0.5, aa: true });
      raster.line(c, d, a, d, line, { alpha: 0.5, aa: true });
      raster.line(a, d, a, b, line, { alpha: 0.5, aa: true });
    }
    const boxCx = (x0 + x1) / 2;
    raster.textCentered(boxCx, y0 + 10, title, 9.5, line, { alpha: 0.92, aa: true });
    raster.textCentered(boxCx, y0 + 27, seedLine, 6.4, line, { alpha: 0.85, aa: true });
    raster.textCentered(boxCx, y0 + 38, epochLine, 6.4, line, { alpha: 0.45, aa: true });

    // The compass rose.
    const R = 50;
    const rx = rasterW - R - 26;
    const ry = 200 + R;
    raster.dot(rx, ry, R * 1.06, paper, 0.9, true);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      const inner = R * (i % 6 === 0 ? 0.82 : 0.9);
      raster.line(
        rx + Math.cos(a) * inner, ry + Math.sin(a) * inner,
        rx + Math.cos(a) * R, ry + Math.sin(a) * R,
        line, { alpha: 0.4, aa: true },
      );
    }
    raster.ring(rx, ry, R * 0.78, line, 0.35, true);
    raster.ring(rx, ry, R * 0.2, line, 0.45, true);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const long = k % 2 === 0;
      const reach = R * (long ? 0.76 : 0.46);
      const halfWidth = R * (long ? 0.11 : 0.08);
      const tipX = rx + Math.cos(a) * reach;
      const tipY = ry + Math.sin(a) * reach;
      const ox = -Math.sin(a) * halfWidth;
      const oy = Math.cos(a) * halfWidth;
      raster.triangle(rx, ry, tipX, tipY, rx + ox, ry + oy, line, 0.75, true);
      raster.triangle(rx, ry, tipX, tipY, rx - ox, ry - oy, line, 0.34, true);
    }
    raster.textCentered(rx, ry - R * 1.3, 'N', 7, line, { alpha: 0.9, aa: true });

    // Degree ticks around the rim, lettered every 45 degrees.
    const shortSide = Math.min(rasterW, rasterH);
    const limbR = shortSide * 0.38;
    const lx = rasterW / 2;
    const ly = rasterH / 2;
    raster.ring(lx, ly, limbR, line, 0.3, true);
    for (let deg = 0; deg < 360; deg += 5) {
      const a = (deg * Math.PI) / 180;
      const long = deg % 45 === 0;
      const mid = deg % 15 === 0;
      const len = limbR * (long ? 0.055 : mid ? 0.032 : 0.018);
      raster.line(
        lx + Math.cos(a) * limbR, ly + Math.sin(a) * limbR,
        lx + Math.cos(a) * (limbR - len), ly + Math.sin(a) * (limbR - len),
        line, { alpha: 0.34, aa: true },
      );
      if (long) {
        const rr = limbR - len - 9;
        raster.textCentered(
          lx + Math.cos(a) * rr, ly + Math.sin(a) * rr - 3,
          `${String(deg).padStart(3, '0')}\u00b0`, 6, line, { alpha: 0.4, aa: true },
        );
      }
    }
  };

  /**
   * The full chart workload: clear + graticule + deep sky + instrument plate +
   * stars + figures, ch1's mix on a dirty frame — the one where the plate has
   * to be re-baked because the view moved.
   */
  const chartFrame = (): void => {
    raster.clear(paper);
    // Graticule: 5 declination rings + 12 meridians at 72 steps.
    const point = vec3.create();
    for (let ring = 1; ring < 6; ring++) {
      const phi = (ring / 6) * Math.PI;
      const y = Math.cos(phi);
      const r = Math.sin(phi);
      let started = false;
      for (let s = 0; s <= 72; s++) {
        const theta = (s / 72) * TAU;
        vec3.set(point, r * Math.cos(theta), y, r * Math.sin(theta));
        chartProject(point, pb);
        if (started && pa.visible && pb.visible) {
          raster.line(pa.x, pa.y, pb.x, pb.y, line, { alpha: 0.16, aa: true });
        }
        pa.x = pb.x; pa.y = pb.y; pa.visible = pb.visible;
        started = true;
      }
    }
    for (let m = 0; m < 12; m++) {
      const theta = (m / 12) * TAU;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      let started = false;
      for (let s = 0; s <= 36; s++) {
        const phi = (s / 36) * Math.PI;
        const r = Math.sin(phi);
        vec3.set(point, r * ct, Math.cos(phi), r * st);
        chartProject(point, pb);
        if (started && pa.visible && pb.visible) {
          raster.line(pa.x, pa.y, pb.x, pb.y, line, { alpha: 0.16, aa: true });
        }
        pa.x = pb.x; pa.y = pb.y; pa.visible = pb.visible;
        started = true;
      }
    }
    chartFurniture();
    // Stars, with ch1's radius/alpha formulas and diamond spikes.
    for (let i = 0; i < sky.stars.length; i++) {
      const star = sky.stars[i]!;
      chartProject(star.dir, pa);
      if (!pa.visible) continue;
      const radius = 0.4 + star.mag * star.mag * 2.6;
      const alpha = 0.5 + star.mag * 0.5;
      raster.dot(pa.x, pa.y, radius, line, alpha, true);
      if (star.mag > 0.88) {
        const s = radius * 3.2;
        raster.triangle(pa.x - s, pa.y, pa.x, pa.y - radius * 0.55, pa.x, pa.y + radius * 0.55, line, alpha * 0.6, true);
        raster.triangle(pa.x + s, pa.y, pa.x, pa.y - radius * 0.55, pa.x, pa.y + radius * 0.55, line, alpha * 0.6, true);
        raster.triangle(pa.x, pa.y - s, pa.x - radius * 0.55, pa.y, pa.x + radius * 0.55, pa.y, line, alpha * 0.6, true);
        raster.triangle(pa.x, pa.y + s, pa.x - radius * 0.55, pa.y, pa.x + radius * 0.55, pa.y, line, alpha * 0.6, true);
      }
    }
    // Figures.
    const chainPoints: number[] = [];
    for (const con of sky.constellations) {
      chainPoints.length = 0;
      for (const idx of con.chain) {
        chartProject(sky.stars[idx]!.dir, pa);
        if (pa.visible) chainPoints.push(pa.x, pa.y);
      }
      if (chainPoints.length >= 4) {
        raster.splineStroke(chainPoints, line, { alpha: 0.5, aa: true });
      }
    }
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
