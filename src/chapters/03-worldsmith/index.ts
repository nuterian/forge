/**
 * Chapter 03 — Worldsmith
 *
 * Seed → a world and the star it answers to: domain-warped FBM continents,
 * oceans, ice caps and biome ramps, printed in banded inks with a rim-lit
 * atmosphere — riding a real Kepler orbit around a seeded star. Zoom in and
 * it is a portrait of a planet; zoom out and the view eases into an orrery
 * of its whole year. The shading model itself is a control — Lambert,
 * Blinn-Phong and the house banded ink on the same world.
 *
 * Re-imagines the 2015 seeded Perlin terrain generator (demo 8), hand-rolled
 * and wrapped onto a sphere. The planet generator lives in planet.ts and is
 * lifted verbatim by chapter 6; the sky, sun, glow, moons, rings and orbit
 * lines all come from src/scene — chapters building on each other literally.
 */

import type { ChapterContext, ChapterInstance } from '../../app/chapter.ts';
import { TAU, clamp, mat3, mat4, vec3 } from '../../core/math.ts';
import { Program } from '../../gl/program.ts';
import { ringAnnulus, toMesh, uvSphere } from '../../gl/geometry.ts';
import { buildPolyline } from '../../gl/polyline.ts';
import type { LabelSpec } from '../../ui/labels.ts';
import { meanAnomalyAt, positionAt, positionAtAnomaly, satelliteOffset } from '../../core/kepler.ts';
import { SURFACE_STYLE_ID } from '../../scene/body.ts';
import { GlowBillboard } from '../../scene/glow.ts';
import { SkyPass } from '../../scene/sky.ts';
import { applyPlanetUniforms, bakePlanetFields, classifyPlanet, createRampTexture, generatePlanet, generateStar } from './planet.ts';

import planetVert from './shaders/planet.vert?raw';
import planetFrag from './shaders/planet.frag?raw';
// Shared scene furniture: the procedural sun, the banded-ink body shader (for
// moons), the ring annulus and the orbit-trace ribbon.
import bodyVert from '../../scene/shaders/body.vert?raw';
import bodyFrag from '../../scene/shaders/body.frag?raw';
import sunFrag from '../../scene/shaders/sun.frag?raw';
import ringsFrag from '../../scene/shaders/rings.frag?raw';
import orbitVert from '../../scene/shaders/orbit.vert?raw';
import orbitFrag from '../../scene/shaders/orbit.frag?raw';

/** Points sampled along the orbit trace. */
const ORBIT_SAMPLES = 256;

interface Settings {
  shadeMode: number;
  bands: number;
  softness: number;
  relief: number;
  filterMode: number;
  pace: number;
}

export function create(ctx: ChapterContext): ChapterInstance {
  const { gl, camera, inks, labels, controls, rng, isReseed } = ctx;

  // The system forms around its star.
  const star = generateStar(rng);
  const params = generatePlanet(rng);

  const settings: Settings = {
    shadeMode: 0,
    bands: 5,
    softness: 0.05,
    relief: 1,
    filterMode: 0,
    pace: 1,
  };

  // -- programs --------------------------------------------------------------

  const planetProgram = new Program(gl, planetVert, planetFrag, 'worldsmith.planet');
  const moonProgram = new Program(gl, bodyVert, bodyFrag, 'worldsmith.moon');
  const sunProgram = new Program(gl, bodyVert, sunFrag, 'worldsmith.sun');
  const orbitProgram = new Program(gl, orbitVert, orbitFrag, 'worldsmith.orbit');
  const ringProgram = params.rings ? new Program(gl, bodyVert, ringsFrag, 'worldsmith.rings') : null;
  const sky = new SkyPass(gl, 'worldsmith.sky');
  // One class, two scales: the star's corona reaches out evenly, the planet's
  // atmosphere leans into the light.
  const corona = new GlowBillboard(gl, 'worldsmith.corona');
  const halo = new GlowBillboard(gl, 'worldsmith.halo');

  // -- geometry & textures -----------------------------------------------------

  const planetMesh = toMesh(gl, uvSphere(1, 96, 64));
  const moonMesh = params.moons.length ? toMesh(gl, uvSphere(1, 28, 18)) : null;
  const ringMesh = params.rings
    ? toMesh(gl, ringAnnulus(params.rings.inner, params.rings.outer, 160))
    : null;
  const rampTexture = createRampTexture(gl, params, inks);
  // The seed's noise fields, evaluated once here instead of ~29 octaves per
  // fragment per frame. Sliders all work against the result, so none of them
  // costs a re-bake.
  const fields = bakePlanetFields(gl, params);

  // The orbit trace, sampled by mean anomaly so the ribbon's parameter is
  // linear in time — which is what lets the shader fade a trail behind the
  // planet correctly (the Orrery's trick, reused wholesale).
  const orbitPoints = new Float32Array(ORBIT_SAMPLES * 3);
  {
    const p = vec3.create();
    for (let i = 0; i < ORBIT_SAMPLES; i++) {
      positionAtAnomaly(p, params.orbit, (i / ORBIT_SAMPLES) * TAU);
      orbitPoints[i * 3] = p[0]!;
      orbitPoints[i * 3 + 1] = p[1]!;
      orbitPoints[i * 3 + 2] = p[2]!;
    }
  }
  const orbitMesh = buildPolyline(gl, orbitPoints, { closed: true });

  // -- the star ------------------------------------------------------------------
  // At the origin, and it IS the light: phases, terminators and the halo's
  // sun-side all follow from the planet's true position on its orbit.

  const starModel = mat4.fromScale(mat4.create(), star.radius, star.radius, star.radius);
  const starNormal = mat3.normalFromMat4(mat3.create(), starModel);

  // -- runtime state ----------------------------------------------------------------

  const planetPosition = vec3.create();
  const planetModel = mat4.create();
  const planetNormal = mat3.create();
  const tilt = mat4.fromXRotation(mat4.create(), params.axialTilt);

  let orbitClock = 0;
  let orbitPhase = 0;
  let spinAngle = rng.range(0, TAU);
  let moonClock = 0;
  let cloudDrift = 0;
  let visClock = 0; // corona simmer + halo breathing; never pauses

  positionAt(planetPosition, params.orbit, 0);

  const moonRuntime = params.moons.map((def) => ({
    def,
    position: vec3.create(),
    model: mat4.create(),
    normalMatrix: mat3.create(),
  }));

  // -- camera ---------------------------------------------------------------------
  // The pivot lives on the planet up close and eases onto the star as you zoom
  // out, so pulling back turns the portrait into an orrery of the whole year.

  camera.minDistance = 1.6;
  camera.maxDistance = 220;
  const focusTarget = vec3.copy(vec3.create(), planetPosition);
  // A reroll changes the world, not the view: the star and planet just land
  // wherever their new seed puts them, and the camera stays exactly where the
  // user left it — the same contract Star Chart gets for free because its sky
  // never moves. Only a genuine first arrival gets the "meet the world"
  // framing below.
  if (!isReseed) {
    // Land on the portrait: anything outside a close-up is reframed.
    if (camera.distance > 12 || camera.distance < 2.2) camera.distance = 4.2;
    // Meet the world gibbous: the star about 45° off the view, terminator in frame.
    camera.yaw = Math.atan2(-planetPosition[0]!, -planetPosition[2]!) - 0.8;
    camera.pitch = 0.2;
    camera.focus(focusTarget);
    vec3.copy(camera.target, focusTarget);
  }

  // -- controls ---------------------------------------------------------------------

  const percentOf = (max: number) => (v: number) => `${Math.round((v / max) * 100)}%`;

  controls.addAll([
    {
      kind: 'select', label: 'Shading', value: 'ink',
      options: [
        { label: 'Banded ink', value: 'ink' },
        { label: 'Lambert', value: 'lambert' },
        { label: 'Blinn-Phong', value: 'phong' },
      ],
      onChange: (v) => (settings.shadeMode = v === 'ink' ? 0 : v === 'lambert' ? 1 : 2),
    },
    {
      kind: 'slider', label: 'Sea level', min: 0.05, max: 0.92, value: params.seaLevel,
      format: percentOf(1),
      onChange: (v) => (params.seaLevel = v),
    },
    {
      kind: 'slider', label: 'Ice caps', min: 0, max: 0.45, value: params.iceCap,
      format: percentOf(0.45),
      onChange: (v) => (params.iceCap = v),
    },
    {
      kind: 'slider', label: 'Cloud cover', min: 0, max: 0.65, value: params.cloudCover,
      format: percentOf(0.65),
      onChange: (v) => (params.cloudCover = v),
    },
    {
      kind: 'slider', label: 'Relief', min: 0, max: 2, value: settings.relief,
      format: (v) => `${v.toFixed(2)}×`,
      onChange: (v) => (settings.relief = v),
    },
    {
      kind: 'select', label: 'Biome ramp', value: 'stepped',
      options: [
        { label: 'Stepped ink (nearest)', value: 'stepped' },
        { label: 'Blended (linear)', value: 'linear' },
      ],
      onChange: (v) => (settings.filterMode = v === 'stepped' ? 0 : 1),
    },
    {
      kind: 'slider', label: 'Pace', min: 0, max: 3, value: settings.pace,
      format: (v) => `${v.toFixed(1)}×`,
      onChange: (v) => (settings.pace = v),
    },
  ]);

  // -- labels ------------------------------------------------------------------------

  const planetAnchor = vec3.copy(vec3.create(), planetPosition);
  planetAnchor[1] = planetAnchor[1]! + 1.34;

  const specs: LabelSpec[] = [
    {
      id: 'star',
      text: star.name,
      color: inks.hex(1),
      position: ORIGIN,
      priority: 8,
    },
    {
      id: 'planet',
      text: params.name,
      detail: classifyPlanet(params),
      color: inks.hex(params.scheme.low),
      position: planetAnchor,
      priority: 10,
    },
  ];
  for (const moon of moonRuntime) {
    specs.push({
      id: moon.def.name,
      text: moon.def.name,
      color: inks.hex(moon.def.inkIndex),
      position: moon.position,
      priority: 2,
      maxDistance: 16,
    });
  }
  labels.set(specs);

  // -- scratch --------------------------------------------------------------------------

  const tmpMat = mat4.create();
  const tmpLocal = vec3.create();
  const tmpVec = vec3.create();
  const sunDir = vec3.create();
  const resolution = new Float32Array(2);

  let viewportWidth = ctx.size.width;
  let viewportHeight = ctx.size.height;

  // -- update -------------------------------------------------------------------------------
  // Everything cosmetic runs on accumulated clocks, so pace changes retune the
  // rates without ever snapping the world to a new angle.

  const update = (dt: number): void => {
    orbitClock += dt * settings.pace;
    spinAngle += dt * settings.pace * params.spinRate * TAU;
    moonClock += dt * settings.pace;
    // Clouds keep creeping even on a paused world — the print stays alive.
    cloudDrift += dt * params.cloudDriftRate * (0.3 + settings.pace);
    visClock += dt;

    // --- the year: Kepler, solved for real -------------------------------
    positionAt(planetPosition, params.orbit, orbitClock);
    orbitPhase = ((meanAnomalyAt(params.orbit, orbitClock) / TAU) % 1 + 1) % 1;

    // model = T(orbit position) · R(axial tilt) · R(spin)
    mat4.fromTranslation(tmpMat, planetPosition[0]!, planetPosition[1]!, planetPosition[2]!);
    mat4.multiply(planetModel, tmpMat, tilt);
    mat4.fromYRotation(tmpMat, spinAngle);
    mat4.multiply(planetModel, planetModel, tmpMat);
    mat3.normalFromMat4(planetNormal, planetModel);

    // Sunward direction, for the halo's long side.
    vec3.scale(sunDir, planetPosition, -1);
    vec3.normalize(sunDir, sunDir);

    for (const moon of moonRuntime) {
      const angle = moon.def.phase0 + moonClock * moon.def.rate * TAU;
      // Position in the moon's own orbital plane, inclined off the equator,
      // then carried into the planet's tilted frame — the same scene-graph
      // step the Orrery's moons take, so a tilted world's moons tilt with it.
      satelliteOffset(tmpLocal, angle, moon.def.distance, moon.def.inclination);
      vec3.transformDirMat4(tmpVec, tmpLocal, tilt);
      vec3.add(moon.position, planetPosition, tmpVec);

      mat4.fromTranslation(tmpMat, moon.position[0]!, moon.position[1]!, moon.position[2]!);
      mat4.scale(moon.model, tmpMat, moon.def.radius, moon.def.radius, moon.def.radius);
      mat3.normalFromMat4(moon.normalMatrix, moon.model);
    }

    vec3.copy(planetAnchor, planetPosition);
    planetAnchor[1] = planetAnchor[1]! + 1.34;

    // --- the pivot: planet up close, star from afar ------------------------
    const zoomOut = clamp((camera.distance - 16) / (70 - 16), 0, 1);
    const ease = zoomOut * zoomOut * (3 - 2 * zoomOut);
    vec3.scale(focusTarget, planetPosition, 1 - ease);
    camera.focus(focusTarget);

    // The class label follows the sliders: drain the sea and watch a temperate
    // world become a desert one. classifyPlanet returns literals, so this is
    // allocation-free and setDetail early-outs on no change.
    labels.setDetail('planet', classifyPlanet(params));
  };

  // -- render --------------------------------------------------------------------------------

  const render = (): void => {
    resolution[0] = viewportWidth;
    resolution[1] = viewportHeight;

    // --- sky ---------------------------------------------------------------
    sky.draw(camera, inks, { density: 0.9, galaxy: 0.5 });

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    // --- the star: the Orrery's sun, reseeded ------------------------------
    sunProgram
      .use()
      .set('uModel', starModel)
      .set('uViewProjection', camera.viewProjection)
      .set('uNormalMatrix', starNormal)
      .set('uTime', visClock)
      .set('uCameraPos', camera.position)
      .set('uInkCore', inks.ink(2))
      .set('uInkHot', inks.ink(1))
      .set('uInkFlare', inks.ink(0))
      .set('uBands', 6);
    planetMesh.draw();

    // --- the planet ----------------------------------------------------------
    planetProgram
      .use()
      .set('uModel', planetModel)
      .set('uViewProjection', camera.viewProjection)
      .set('uNormalMatrix', planetNormal)
      .set('uLightPos', ORIGIN)
      .set('uCameraPos', camera.position)
      .set('uCloudDrift', cloudDrift)
      .set('uRelief', settings.relief)
      .set('uShadeMode', settings.shadeMode)
      .set('uBands', settings.bands)
      .set('uSoftness', settings.softness)
      .set('uFilterMode', settings.filterMode)
      .setTexture('uRamp', rampTexture, 0)
      .setTexture('uFields', fields.texture, 1);
    applyPlanetUniforms(planetProgram, params, inks);
    planetMesh.draw();

    // --- moons ------------------------------------------------------------------
    if (moonMesh) {
      moonProgram
        .use()
        .set('uViewProjection', camera.viewProjection)
        .set('uLightPos', ORIGIN)
        .set('uCameraPos', camera.position)
        .set('uInkShadow', inks.shadow)
        .set('uBands', settings.bands)
        .set('uSoftness', settings.softness)
        .set('uShadeMode', settings.shadeMode)
        .set('uPattern', 0.6)
        .set('uAtmosphere', 0)
        .set('uStyle', SURFACE_STYLE_ID.rocky);
      for (const moon of moonRuntime) {
        moonProgram
          .set('uModel', moon.model)
          .set('uNormalMatrix', moon.normalMatrix)
          .set('uInkBase', inks.ink(moon.def.inkIndex))
          .set('uInkHighlight', inks.ink(0));
        moonMesh.draw();
      }
    }

    // --- translucent passes -------------------------------------------------------
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    if (ringProgram && ringMesh && params.rings) {
      gl.disable(gl.CULL_FACE);
      ringProgram
        .use()
        .set('uViewProjection', camera.viewProjection)
        .set('uLightPos', ORIGIN)
        .set('uCameraPos', camera.position)
        .set('uModel', planetModel)
        .set('uNormalMatrix', planetNormal)
        .set('uInk', inks.ink(0))
        .set('uInkDark', inks.shadow)
        .set('uOpacity', params.rings.opacity)
        .set('uSeed', params.rings.seed)
        .set('uPlanetCenter', planetPosition)
        .set('uPlanetRadius', 1);
      ringMesh.draw();
      gl.enable(gl.CULL_FACE);
    }

    // --- the orbit trace: the year, drawn as an instrument line -------------------
    gl.disable(gl.CULL_FACE);
    orbitProgram
      .use()
      .set('uViewProjection', camera.viewProjection)
      .set('uResolution', resolution)
      .set('uLineWidth', 1.6 * (viewportWidth / Math.max(1, ctx.canvas.clientWidth)))
      .set('uTrail', 0.3)
      .set('uDashes', 0)
      .set('uInk', inks.ink(params.scheme.low))
      .set('uOpacity', 0.85)
      .set('uPhase', orbitPhase);
    orbitMesh.draw();
    gl.enable(gl.CULL_FACE);

    // --- glows, additive over everything ---------------------------------------------
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.disable(gl.CULL_FACE);

    corona.draw(camera, {
      center: ORIGIN,
      scale: star.radius * 3,
      inner: 1 / 3,
      ink: inks.ink(1),
      opacity: star.corona,
      time: visClock,
    });

    if (params.atmosphere > 0.01) {
      halo.draw(camera, {
        center: planetPosition,
        scale: 1.5,
        inner: 1 / 1.5,
        ink: inks.ink(params.scheme.atmo),
        opacity: 0.4 * params.atmosphere,
        time: visClock,
        // A planet's air is a thin skin next to a star's corona, and it only
        // glows where the light actually reaches.
        reachMin: 0.16,
        reachMax: 0.66,
        sunDir,
        sunBias: 1,
      });
    }

    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  };

  // -- lifecycle ---------------------------------------------------------------------------------

  return {
    update,
    render,
    resize(width, height) {
      viewportWidth = width;
      viewportHeight = height;
    },
    dispose() {
      camera.minDistance = 0.4;
      camera.maxDistance = 900;
      for (const program of [planetProgram, moonProgram, sunProgram, orbitProgram]) {
        program.dispose();
      }
      ringProgram?.dispose();
      sky.dispose();
      corona.dispose();
      halo.dispose();
      for (const mesh of [planetMesh, orbitMesh]) mesh.dispose();
      moonMesh?.dispose();
      ringMesh?.dispose();
      gl.deleteTexture(rampTexture);
      fields.dispose();
    },
  };
}

const ORIGIN = vec3.create(0, 0, 0);
