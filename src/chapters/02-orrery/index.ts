/**
 * Chapter 02 — Orrery
 *
 * The solar system as a working instrument. Everything here is a fundamental:
 * a scene graph of hierarchical transforms, Kepler's equation solved per body
 * per frame, one instanced draw call for the whole asteroid belt, parametric
 * spheres and ring annuli, a Catmull-Rom camera tour, a star drawn entirely in
 * a fragment shader, and an OBJ mesh loaded by our own parser.
 *
 * Re-imagines two 2015 assignments: "Introduction to shaders" (the procedural
 * sun) and "Introduction to matrices" (the loaded spacecraft).
 */

import type { ChapterContext, ChapterInstance } from '../../app/chapter.ts';
import {
  DEG, TAU, mat3, mat4, vec3,
  type Mat4, type Vec3,
} from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { Spline } from '../../core/spline.ts';
import { Program } from '../../gl/program.ts';
import { beginAdditive, beginOpaque, beginTranslucent, endPasses } from '../../gl/passes.ts';
import { Mesh } from '../../gl/mesh.ts';
import { icosphere, ringAnnulus, uvSphere, toMesh } from '../../gl/geometry.ts';
import { buildPolyline, updatePolyline } from '../../gl/polyline.ts';
import { loadObj, normalizeGeometry } from '../../gl/obj.ts';
import type { LabelSpec } from '../../ui/labels.ts';
import { SURFACE_STYLE_ID } from '../../scene/body.ts';
import { GlowBillboard } from '../../scene/glow.ts';
import { SkyPass } from '../../scene/sky.ts';
import { BELT, PLANETS, TOUR_ORDER, type BodyDef, type MoonDef } from './bodies.ts';
import { dateFromDays, daysFromDate, meanAnomalyAt, positionAt, positionAtAnomaly, satelliteOffset } from '../../core/kepler.ts';

// Scene furniture shared with the other space chapters.
import bodyVert from '../../scene/shaders/body.vert?raw';
import bodyFrag from '../../scene/shaders/body.frag?raw';
import sunFrag from '../../scene/shaders/sun.frag?raw';
import ringsFrag from '../../scene/shaders/rings.frag?raw';
import orbitVert from '../../scene/shaders/orbit.vert?raw';
import orbitFrag from '../../scene/shaders/orbit.frag?raw';
// The belt is the Orrery's own: nothing else instances rocks by orbit.
import asteroidVert from './shaders/asteroid.vert?raw';
import asteroidFrag from './shaders/asteroid.frag?raw';

/** Earth radii, the reference for perceptual body sizing. */
const EARTH_RADIUS_KM = 6371;
/** Luna's orbit, the reference for perceptual moon spacing. */
const LUNA_DISTANCE_KM = 384400;
/** Points sampled per orbit trace. */
const ORBIT_SAMPLES = 384;

interface RuntimeMoon {
  def: MoonDef;
  position: Vec3;
  radius: number;
  model: Mat4;
  normalMatrix: Float32Array;
  /** Visual orbit rate, revolutions per clock second. */
  visRate: number;
  /** Starting angle, so sibling moons spread around their planet. */
  phase0: number;
}

interface RuntimeBody {
  def: BodyDef;
  /** World position, mutated in place so labels can hold the reference. */
  position: Vec3;
  /** Position in AU, before scale compression. */
  positionAu: Vec3;
  radius: number;
  model: Mat4;
  normalMatrix: Float32Array;
  /** Where the body sits along its own orbit trace, 0–1. */
  phase: number;
  /** Visual spin rate, revolutions per clock second. Negative = retrograde. */
  spinRate: number;
  moons: RuntimeMoon[];
  /** Orbit trace sampled in AU; rebuilt into world space when scales change. */
  orbitAu: Float32Array;
  orbitMesh: Mesh;
  ringMesh: Mesh | null;
  tilt: Mat4;
}

interface Settings {
  timeWarp: number;
  compression: number;
  orbitScale: number;
  bodyScale: number;
  moonScale: number;
  showOrbits: boolean;
  showBelt: boolean;
  showMoons: boolean;
  showRings: boolean;
  showLabels: boolean;
  showProbe: boolean;
  showSky: boolean;
  dashedOrbits: boolean;
  shadeMode: number;
  bands: number;
  softness: number;
  pattern: number;
  focus: string;
  tourSpeed: number;
  lineWidth: number;
  corona: number;
  galaxy: number;
}

export async function create(ctx: ChapterContext): Promise<ChapterInstance> {
  const { gl, camera, inks, labels, controls, print } = ctx;

  // The press wants a slightly finer plate here: the orbit traces are thin and
  // heavy dithering eats them.
  print.settings.ditherLevels = 16;
  print.settings.halftone = 0.22;

  const settings: Settings = {
    timeWarp: 6,
    compression: 0.5,
    orbitScale: 8,
    bodyScale: 0.5,
    moonScale: 1,
    showOrbits: true,
    showBelt: true,
    showMoons: true,
    showRings: true,
    showLabels: true,
    showProbe: true,
    showSky: true,
    dashedOrbits: false,
    shadeMode: 0,
    bands: 4,
    softness: 0.06,
    pattern: 0.55,
    focus: 'none',
    tourSpeed: 1,
    lineWidth: 1.6,
    corona: 0.55,
    galaxy: 0.6,
  };

  let simDays = daysFromDate(new Date());
  let tourU = 0;

  /**
   * The visual clock, used for spins, moon orbits, and the sun's simmer.
   *
   * Orbital positions follow simDays and stay date-accurate; rotations do not.
   * At 6 days/second Earth would physically spin six times a second and Io
   * would lap Jupiter three times — pure strobe. So rotation runs on its own
   * clock, sped up gently (a cube root of the warp) and rate-compressed so
   * fast and slow rotators keep their ordering but both stay watchable.
   */
  let visClock = 0;

  /** Always runs, even paused — a frozen orrery under a still-simmering sun. */
  let sunClock = 0;

  // -- programs ------------------------------------------------------------

  const bodyProgram = new Program(gl, bodyVert, bodyFrag, 'orrery.body');
  const sunProgram = new Program(gl, bodyVert, sunFrag, 'orrery.sun');
  const ringProgram = new Program(gl, bodyVert, ringsFrag, 'orrery.rings');
  const orbitProgram = new Program(gl, orbitVert, orbitFrag, 'orrery.orbit');
  const asteroidProgram = new Program(gl, asteroidVert, asteroidFrag, 'orrery.asteroid');
  const sky = new SkyPass(gl, 'orrery.sky');
  const corona = new GlowBillboard(gl, 'orrery.corona');

  // -- geometry ------------------------------------------------------------

  const planetMesh = toMesh(gl, uvSphere(1, 56, 36));
  const moonMesh = toMesh(gl, uvSphere(1, 24, 16));

  const probeGeometry = normalizeGeometry(await loadObj(`${import.meta.env.BASE_URL}probe.obj`), 1);
  const probeMesh = toMesh(gl, probeGeometry);

  // -- scale helpers -------------------------------------------------------

  /**
   * True distances are unviewable — Neptune is thirty times Earth's orbit, and
   * the planets themselves are specks at that scale. Compressing the radius by
   * a power keeps the *ordering* and the ellipses honest while making the
   * system fit on one page. Slide compression to 1.0 to see the real thing.
   */
  const scaleAu = (au: number): number => Math.pow(au, settings.compression) * settings.orbitScale;

  const worldFromAu = (out: Vec3, au: Vec3): Vec3 => {
    const r = vec3.len(au);
    if (r < 1e-9) return vec3.set(out, 0, 0, 0);
    return vec3.scale(out, au, scaleAu(r) / r);
  };

  /**
   * Perceptual body radius. Jupiter is 11 Earths across and Mercury is a third
   * of one; at true proportions one of them is always invisible. Raising the
   * ratio to a fractional power keeps every planet legible while preserving
   * the ordering — Jupiter still plainly dwarfs Mercury.
   */
  const bodyRadius = (radiusKm: number): number =>
    Math.pow(radiusKm / EARTH_RADIUS_KM, 0.45) * settings.bodyScale;

  /**
   * The sun is 109 Earth radii and breaks any curve that flatters the planets,
   * so it gets its own scale — sized to stay the largest object in frame
   * without swallowing Mercury's orbit.
   */
  const sunRadius = (): number => settings.bodyScale * 3.6;

  const moonDistance = (km: number, planetRadius: number): number =>
    planetRadius * 1.75 + Math.pow(km / LUNA_DISTANCE_KM, 0.5) * 0.85 * settings.moonScale;

  // -- bodies --------------------------------------------------------------

  const sun = {
    position: vec3.create(0, 0, 0),
    radius: sunRadius(),
    model: mat4.create(),
    normalMatrix: mat3.create(),
  };

  const bodies: RuntimeBody[] = PLANETS.map((def) => {
    // Sample the orbit by mean anomaly, so the parameter along the trace is
    // linear in *time* — which is what lets the fragment shader fade the trail
    // behind the planet correctly.
    const orbitAu = new Float32Array(ORBIT_SAMPLES * 3);
    const p = vec3.create();
    for (let i = 0; i < ORBIT_SAMPLES; i++) {
      positionAtAnomaly(p, def.elements, (i / ORBIT_SAMPLES) * TAU);
      orbitAu[i * 3] = p[0]!;
      orbitAu[i * 3 + 1] = p[1]!;
      orbitAu[i * 3 + 2] = p[2]!;
    }

    const orbitMesh = buildPolyline(gl, orbitAu, { closed: true, dynamic: true });

    const ringMesh = def.rings
      ? toMesh(gl, ringAnnulus(def.rings.inner, def.rings.outer, 192))
      : null;

    return {
      def,
      position: vec3.create(),
      positionAu: vec3.create(),
      radius: bodyRadius(def.radiusKm),
      model: mat4.create(),
      normalMatrix: mat3.create(),
      phase: 0,
      orbitAu,
      orbitMesh,
      ringMesh,
      tilt: mat4.fromXRotation(mat4.create(), def.axialTilt * DEG),
      // Compress the range of real rotation rates (Venus: 243 days, Jupiter:
      // 10 hours) into rates that are all visibly, calmly different.
      spinRate:
        Math.sign(def.dayHours || 1) *
        (0.008 + 0.035 * Math.pow(24 / Math.abs(def.dayHours || 24), 0.4)),
      moons: (def.moons ?? []).map((moon, moonIndex) => ({
        def: moon,
        position: vec3.create(),
        radius: bodyRadius(moon.radiusKm),
        model: mat4.create(),
        normalMatrix: mat3.create(),
        visRate:
          Math.sign(moon.periodDays || 1) *
          (0.006 + 0.028 * Math.pow(1 / Math.abs(moon.periodDays || 1), 0.5)),
        phase0: moonIndex * 2.39996, // golden angle: siblings never bunch up
      })),
    };
  });

  /** Rebuild every orbit trace in world space. Called when a scale changes. */
  const scratchOrbit = new Float32Array(ORBIT_SAMPLES * 3);
  const rebuildOrbits = (): void => {
    const au = vec3.create();
    const world = vec3.create();
    for (const body of bodies) {
      for (let i = 0; i < ORBIT_SAMPLES; i++) {
        vec3.set(au, body.orbitAu[i * 3]!, body.orbitAu[i * 3 + 1]!, body.orbitAu[i * 3 + 2]!);
        worldFromAu(world, au);
        scratchOrbit[i * 3] = world[0]!;
        scratchOrbit[i * 3 + 1] = world[1]!;
        scratchOrbit[i * 3 + 2] = world[2]!;
      }
      updatePolyline(body.orbitMesh, scratchOrbit, true);
    }
  };

  rebuildOrbits();

  // -- asteroid belt -------------------------------------------------------
  // One draw call. Every rock's orbit lives in these two instance attributes
  // and is integrated on the GPU; nothing here is touched again after upload.

  const beltRng = new Rng('main-belt');
  const orbitAttr = new Float32Array(BELT.count * 4);
  const phaseAttr = new Float32Array(BELT.count * 4);

  for (let i = 0; i < BELT.count; i++) {
    // Bias toward the middle of the belt, and carve the inner edge back.
    const t = beltRng.next();
    const a = BELT.innerAu + (BELT.outerAu - BELT.innerAu) * (0.25 + 0.75 * t) * (0.9 + beltRng.next() * 0.2);
    const e = beltRng.next() * BELT.maxEccentricity;
    const inclination = beltRng.gaussian() * BELT.maxInclination * 0.3 * DEG;
    const phase = beltRng.next() * TAU;

    orbitAttr[i * 4] = a;
    orbitAttr[i * 4 + 1] = e;
    orbitAttr[i * 4 + 2] = inclination;
    orbitAttr[i * 4 + 3] = phase;

    // Mean motion from Kepler's third law: period ∝ a^{3/2}.
    const periodDays = 365.256 * Math.pow(a, 1.5);
    phaseAttr[i * 4] = TAU / periodDays;
    phaseAttr[i * 4 + 1] = beltRng.power(0.5, 2.4, 2.2);
    phaseAttr[i * 4 + 2] = beltRng.range(-0.9, 0.9);
    phaseAttr[i * 4 + 3] = beltRng.next();
  }

  const asteroidGeo = icosphere(1, 1);
  const beltMesh = new Mesh(gl, {
    attributes: [
      { name: 'aPosition', data: asteroidGeo.positions, size: 3 },
      { name: 'aNormal', data: asteroidGeo.normals, size: 3 },
      { name: 'aOrbit', data: orbitAttr, size: 4, divisor: 1 },
      { name: 'aPhase', data: phaseAttr, size: 4, divisor: 1 },
    ],
    indices: asteroidGeo.indices,
  });

  // -- the tour spline -----------------------------------------------------
  // Waypoints are the planets' actual positions, so the route is a real
  // grand tour of wherever everything happens to be right now.

  let tourSpline = new Spline([vec3.create(0, 0, 0), vec3.create(1, 0, 0)], true);
  let tourMesh: Mesh | null = null;

  const replotTour = (): void => {
    const waypoints: Vec3[] = [];
    const au = vec3.create();

    for (const id of TOUR_ORDER) {
      const body = bodies.find((b) => b.def.id === id);
      if (!body) continue;
      positionAt(au, body.def.elements, simDays);
      const world = worldFromAu(vec3.create(), au);
      // Lift the route off the ecliptic so it doesn't graze the planets it visits.
      world[1] = world[1]! + body.radius * 2.6 + 0.6;
      waypoints.push(world);
    }

    // A sweep back past the inner system closes the loop gracefully.
    waypoints.push(vec3.create(-scaleAu(1.6), 1.4, scaleAu(1.1)));

    tourSpline = new Spline(waypoints, true, 32);

    const points = tourSpline.sample(360);
    if (tourMesh) {
      updatePolyline(tourMesh, points, true);
    } else {
      tourMesh = buildPolyline(gl, points, { closed: true, dynamic: true });
    }
  };

  replotTour();

  // -- probe ---------------------------------------------------------------

  const probe = {
    position: vec3.create(),
    tangent: vec3.create(0, 0, 1),
    model: mat4.create(),
    normalMatrix: mat3.create(),
    scale: 0.42,
  };

  // -- controls ------------------------------------------------------------

  const dateFormat = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit',
  });

  const focusOptions = [
    { label: 'Free orbit', value: 'none' },
    { label: 'Sun', value: 'sun' },
    ...PLANETS.map((p) => ({ label: p.name, value: p.id })),
    { label: 'Ride the probe', value: 'probe' },
  ];

  // A deliberately small panel: time, where to look, how it's shaded, and two
  // visibility switches. Everything else runs on tuned defaults.
  controls.addAll([
    { kind: 'readout', label: 'Epoch', get: () => dateFormat.format(dateFromDays(simDays)) },
    {
      kind: 'slider', label: 'Days / second', min: 0, max: 120, value: settings.timeWarp,
      format: (v) => (v < 0.05 ? 'paused' : v.toFixed(0)),
      onChange: (v) => (settings.timeWarp = v),
    },
    {
      kind: 'button', label: 'Return to today',
      onClick: () => { simDays = daysFromDate(new Date()); replotTour(); },
    },
    {
      kind: 'select', label: 'Follow', value: 'none', options: focusOptions,
      onChange: (v) => {
        settings.focus = v;
        if (v === 'none') camera.releaseToOrbit();
        else if (v === 'sun') camera.focus(sun.position, sun.radius * 7);
        else {
          const body = bodies.find((b) => b.def.id === v);
          if (body) camera.focus(body.position, Math.max(body.radius * 9, 2.4));
        }
      },
    },
    {
      kind: 'select', label: 'Shading', value: 'ink',
      options: [
        { label: 'Banded ink', value: 'ink' },
        { label: 'Lambert', value: 'lambert' },
        { label: 'Blinn-Phong', value: 'phong' },
      ],
      onChange: (v) => (settings.shadeMode = v === 'ink' ? 0 : v === 'lambert' ? 1 : 2),
    },
    { kind: 'toggle', label: 'Orbit traces', value: settings.showOrbits, onChange: (v) => (settings.showOrbits = v) },
    { kind: 'toggle', label: 'Labels', value: settings.showLabels, onChange: (v) => (settings.showLabels = v) },
  ]);

  // -- labels --------------------------------------------------------------

  const buildLabels = (): void => {
    const specs: LabelSpec[] = [
      { id: 'sun', text: 'Sol', color: inks.hex(1), position: sun.position, priority: 10 },
    ];
    for (const body of bodies) {
      specs.push({
        id: body.def.id,
        text: body.def.name,
        detail: '',
        color: inks.hex(body.def.inkIndex),
        position: body.position,
        priority: 5,
      });
      if (settings.showMoons) {
        for (const moon of body.moons) {
          specs.push({
            id: moon.def.id,
            text: moon.def.name,
            color: inks.hex(moon.def.inkIndex),
            position: moon.position,
            priority: 1,
            // Moons only earn a label when you are close enough to see them.
            maxDistance: 14,
            // ...and not while the planet itself is in the way. body.position
            // is the same live vector the scene graph writes each frame.
            occluder: { center: body.position, radius: body.radius },
          });
        }
      }
    }
    if (settings.showProbe) {
      specs.push({ id: 'probe', text: 'Probe', color: inks.hex(0), position: probe.position, priority: 8 });
    }
    labels.set(specs);
  };

  buildLabels();
  let lastMoonVisibility = settings.showMoons;
  let lastProbeVisibility = settings.showProbe;

  // -- scratch -------------------------------------------------------------

  const tmpAu = vec3.create();
  const tmpVec = vec3.create();
  const tmpLocal = vec3.create();
  const tmpMat = mat4.create();
  const tmpMat2 = mat4.create();
  const resolution = new Float32Array(2);
  const lightPosition = vec3.create(0, 0, 0);

  let viewportWidth = ctx.size.width;
  let viewportHeight = ctx.size.height;

  camera.minDistance = 0.25;
  camera.maxDistance = 600;
  // The previous chapter may have pivoted the camera anywhere — Worldsmith's
  // planet orbits tens of units from its own origin — so every chapter must
  // claim its own pivot on load rather than trust leftover state.
  camera.focus(sun.position);
  // Frame the inner system out to about Mars, with the belt at the edge: the
  // most legible view of the system, and the one that makes the orbit traces
  // read as a diagram.
  //
  // Asking for a *radius* rather than a distance is what keeps that framing on
  // a portrait phone. fov is vertical, so the same distance that frames the
  // inner system on a laptop shows nothing but the sun on a 375px-wide screen;
  // fitDistance solves for whichever axis is tighter.
  //
  // This runs on every fresh arrival rather than behind a "is the distance
  // wildly wrong" guard. The old guard tested `distance > 80 || distance < 4`,
  // which the camera's own default of 30 sails straight through — so the
  // opening shot was never actually framed, and arriving from Worldsmith
  // (which leaves the camera a few units from a planet) parked the view
  // inside the sun.
  camera.distance = camera.fitDistance(scaleAu(1.5));
  camera.pitch = 0.5;

  // -- update --------------------------------------------------------------

  const update = (dt: number, elapsed: number): void => {
    simDays += dt * settings.timeWarp;
    // Cube root: the warp slider nudges rotation speed without strobing it —
    // and at zero warp a whisper of rotation keeps the paused scene alive.
    visClock += dt * Math.pow(Math.max(settings.timeWarp, 0.05) / 6, 1 / 3);
    sunClock += dt;

    // --- planets: a scene graph, one level at a time ---------------------
    for (const body of bodies) {
      positionAt(tmpAu, body.def.elements, simDays);
      vec3.copy(body.positionAu, tmpAu);
      worldFromAu(body.position, tmpAu);

      // Where the body sits along its own trace, in the same mean-anomaly
      // parameterisation the trace was sampled with.
      const meanAnomaly = meanAnomalyAt(body.def.elements, simDays);
      body.phase = ((meanAnomaly / TAU) % 1 + 1) % 1;

      // model = T(position) · R(axial tilt) · R(spin) · S(radius)
      const spin = visClock * body.spinRate * TAU;
      mat4.fromTranslation(tmpMat, body.position[0]!, body.position[1]!, body.position[2]!);
      mat4.multiply(body.model, tmpMat, body.tilt);
      mat4.fromYRotation(tmpMat2, spin);
      mat4.multiply(body.model, body.model, tmpMat2);
      mat4.scale(body.model, body.model, body.radius, body.radius, body.radius);
      mat3.normalFromMat4(body.normalMatrix, body.model);

      // --- moons: children of the planet's frame -------------------------
      for (const moon of body.moons) {
        const distance = moonDistance(moon.def.distanceKm, body.radius);
        const angle = moon.phase0 + visClock * moon.visRate * TAU;

        // Position in the moon's own orbital plane, inclined off the equator...
        satelliteOffset(tmpLocal, angle, distance, moon.def.inclination * DEG);
        // ...then carried into the planet's tilted frame. This is the whole
        // point of a scene graph: the moon never knows where the planet is.
        vec3.transformDirMat4(tmpVec, tmpLocal, body.tilt);
        vec3.add(moon.position, body.position, tmpVec);

        mat4.fromTranslation(tmpMat, moon.position[0]!, moon.position[1]!, moon.position[2]!);
        mat4.scale(moon.model, tmpMat, moon.radius, moon.radius, moon.radius);
        mat3.normalFromMat4(moon.normalMatrix, moon.model);
      }
    }

    // --- the probe on its spline -----------------------------------------
    if (settings.tourSpeed > 0) {
      // Arc-length parameterised, so speed is constant regardless of how far
      // apart the waypoints happen to be.
      tourU = (tourU + (dt * settings.tourSpeed) / 90) % 1;
    }
    tourSpline.atDistance(probe.position, tourU);
    tourSpline.tangentAt(probe.tangent, tourU);

    // targetTo puts +Z from target toward eye, so aiming at (position −
    // tangent) points the probe's nose along its direction of travel.
    vec3.sub(tmpVec, probe.position, probe.tangent);
    mat4.targetTo(tmpMat, probe.position, tmpVec, VEC_UP);
    mat4.scale(probe.model, tmpMat, probe.scale, probe.scale, probe.scale);
    mat3.normalFromMat4(probe.normalMatrix, probe.model);

    // --- camera -----------------------------------------------------------
    if (settings.focus === 'probe') {
      // Ride behind and slightly above, looking ahead of the probe.
      vec3.scaleAndAdd(tmpVec, probe.position, probe.tangent, -2.4);
      tmpVec[1] = tmpVec[1]! + 0.85;
      vec3.scaleAndAdd(tmpLocal, probe.position, probe.tangent, 3.5);
      camera.script(tmpVec, tmpLocal);
      camera.inputEnabled = false;
    } else {
      camera.inputEnabled = true;
      if (settings.focus === 'sun') {
        camera.focus(sun.position);
      } else {
        const body = bodies.find((b) => b.def.id === settings.focus);
        if (body) camera.focus(body.position);
      }
    }

    // --- labels -----------------------------------------------------------
    labels.visible = settings.showLabels;
    if (lastMoonVisibility !== settings.showMoons || lastProbeVisibility !== settings.showProbe) {
      lastMoonVisibility = settings.showMoons;
      lastProbeVisibility = settings.showProbe;
      buildLabels();
    }
    if (settings.showLabels) {
      for (const body of bodies) {
        labels.setDetail(body.def.id, `${vec3.len(body.positionAu).toFixed(2)} AU`);
      }
    }

    void elapsed;
  };

  // -- render --------------------------------------------------------------

  const render = (): void => {
    resolution[0] = viewportWidth;
    resolution[1] = viewportHeight;

    // --- sky: a fullscreen pass behind everything -------------------------
    if (settings.showSky) {
      sky.draw(camera, inks, { density: 1, galaxy: settings.galaxy });
    }

    beginOpaque(gl);

    // --- the sun: one fragment shader, no textures ------------------------
    mat4.fromScale(tmpMat, sun.radius, sun.radius, sun.radius);
    mat4.copy(sun.model, tmpMat);
    mat3.normalFromMat4(sun.normalMatrix, sun.model);

    sunProgram
      .use()
      .set('uModel', sun.model)
      .set('uViewProjection', camera.viewProjection)
      .set('uNormalMatrix', sun.normalMatrix)
      .set('uTime', sunClock)
      .set('uCameraPos', camera.position)
      .set('uInkCore', inks.ink(2))
      .set('uInkHot', inks.ink(1))
      .set('uInkFlare', inks.ink(0))
      .set('uBands', 6);
    planetMesh.draw();

    // --- planets and moons ------------------------------------------------
    bodyProgram
      .use()
      .set('uViewProjection', camera.viewProjection)
      .set('uLightPos', lightPosition)
      .set('uCameraPos', camera.position)
      .set('uInkShadow', inks.shadow)
      .set('uBands', settings.bands)
      .set('uSoftness', settings.softness)
      .set('uShadeMode', settings.shadeMode)
      .set('uPattern', settings.pattern);

    for (const body of bodies) {
      bodyProgram
        .set('uModel', body.model)
        .set('uNormalMatrix', body.normalMatrix)
        .set('uInkBase', inks.ink(body.def.inkIndex))
        .set('uInkHighlight', inks.ink(0))
        .set('uAtmosphere', body.def.atmosphere)
        .set('uStyle', SURFACE_STYLE_ID[body.def.style]);
      planetMesh.draw();
    }

    if (settings.showMoons) {
      bodyProgram.set('uAtmosphere', 0).set('uStyle', SURFACE_STYLE_ID.rocky);
      for (const body of bodies) {
        for (const moon of body.moons) {
          bodyProgram
            .set('uModel', moon.model)
            .set('uNormalMatrix', moon.normalMatrix)
            .set('uInkBase', inks.ink(moon.def.inkIndex))
            .set('uInkHighlight', inks.ink(0));
          moonMesh.draw();
        }
      }
    }

    // --- the belt: 2600 rocks, one draw call ------------------------------
    if (settings.showBelt) {
      asteroidProgram
        .use()
        .set('uViewProjection', camera.viewProjection)
        .set('uTime', simDays)
        .set('uOrbitScale', settings.orbitScale)
        .set('uCompression', settings.compression)
        .set('uSizeScale', settings.bodyScale * 0.06)
        .set('uInkShadow', inks.shadow)
        .set('uInkBase', inks.ink(0))
        .set('uInkHighlight', inks.ink(2));
      beltMesh.draw(BELT.count);
    }

    // --- the probe, loaded from OBJ ---------------------------------------
    if (settings.showProbe) {
      bodyProgram
        .use()
        .set('uViewProjection', camera.viewProjection)
        .set('uLightPos', lightPosition)
        .set('uCameraPos', camera.position)
        .set('uInkShadow', inks.shadow)
        .set('uBands', Math.max(settings.bands, 3))
        .set('uSoftness', settings.softness)
        .set('uShadeMode', settings.shadeMode)
        .set('uPattern', 0)
        .set('uAtmosphere', 0)
        .set('uStyle', SURFACE_STYLE_ID.rocky)
        .set('uModel', probe.model)
        .set('uNormalMatrix', probe.normalMatrix)
        .set('uInkBase', inks.ink(0))
        .set('uInkHighlight', inks.ink(1));
      gl.disable(gl.CULL_FACE); // the probe is an open shell in places
      probeMesh.draw();
      gl.enable(gl.CULL_FACE);
    }

    // --- translucent passes ------------------------------------------------
    beginTranslucent(gl);

    if (settings.showRings) {
      ringProgram
        .use()
        .set('uViewProjection', camera.viewProjection)
        .set('uLightPos', lightPosition)
        .set('uCameraPos', camera.position);

      for (const body of bodies) {
        if (!body.ringMesh || !body.def.rings) continue;
        // The annulus was built in planet-radius units, so the planet's own
        // model matrix (tilt included) places the rings for free.
        ringProgram
          .set('uModel', body.model)
          .set('uNormalMatrix', body.normalMatrix)
          .set('uInk', inks.ink(body.def.inkIndex))
          .set('uInkDark', inks.shadow)
          .set('uOpacity', body.def.rings.opacity)
          .set('uSeed', body.def.radiusKm * 0.001)
          .set('uPlanetCenter', body.position)
          .set('uPlanetRadius', body.radius);
        body.ringMesh.draw();
      }
    }

    // --- orbit traces ------------------------------------------------------
    if (settings.showOrbits) {
      orbitProgram
        .use()
        .set('uViewProjection', camera.viewProjection)
        .set('uResolution', resolution)
        .set('uLineWidth', settings.lineWidth * (viewportWidth / Math.max(1, ctx.canvas.clientWidth)))
        .set('uTrail', 0.28)
        .set('uDashes', settings.dashedOrbits ? 48 : 0);

      for (const body of bodies) {
        orbitProgram
          .set('uInk', inks.ink(body.def.inkIndex))
          .set('uOpacity', 0.85)
          .set('uPhase', body.phase);
        body.orbitMesh.draw();
      }

      // The tour route, dashed, so it reads as a plan rather than an orbit.
      if (settings.showProbe && tourMesh) {
        orbitProgram
          .set('uInk', inks.ink(0))
          .set('uOpacity', 0.5)
          .set('uPhase', tourU)
          .set('uTrail', 0.12)
          .set('uDashes', 90);
        tourMesh.draw();
      }
    }

    // --- corona, additive over everything ---------------------------------
    if (settings.corona > 0.001) {
      beginAdditive(gl);
      corona.draw(camera, {
        center: sun.position,
        scale: sun.radius * 3.0,
        inner: 1 / 3.0,
        ink: inks.ink(1),
        opacity: settings.corona,
        time: sunClock,
      });
    }

    endPasses(gl);
  };

  // -- lifecycle -----------------------------------------------------------

  return {
    update,
    render,
    resize(width, height) {
      viewportWidth = width;
      viewportHeight = height;
    },
    dispose() {
      camera.inputEnabled = true;
      for (const program of [bodyProgram, sunProgram, ringProgram, orbitProgram, asteroidProgram]) {
        program.dispose();
      }
      sky.dispose();
      corona.dispose();
      for (const mesh of [planetMesh, moonMesh, probeMesh, beltMesh]) {
        mesh.dispose();
      }
      for (const body of bodies) {
        body.orbitMesh.dispose();
        body.ringMesh?.dispose();
      }
      tourMesh?.dispose();
    },
  };
}

const VEC_UP = vec3.create(0, 1, 0);
