/**
 * An orbit camera driven by quaternions, with framerate-independent damping.
 *
 * Orientation is stored as yaw/pitch (which is what a mouse actually produces)
 * but every transition — refocusing on a planet, handing control to a spline
 * tour and taking it back — is a quaternion slerp, so the camera never gimbals
 * or takes the long way round.
 */

import {
  DEG, clamp, damp, mat4, quat, vec3,
  type Mat4, type Quat, type Vec3,
} from './math.ts';

export type CameraMode = 'orbit' | 'scripted';

export interface OrbitCameraOptions {
  fov?: number;
  near?: number;
  far?: number;
  distance?: number;
  minDistance?: number;
  maxDistance?: number;
  yaw?: number;
  pitch?: number;
}

const UP = vec3.create(0, 1, 0);

export class OrbitCamera {
  fov: number;
  near: number;
  far: number;
  aspect = 1;

  /** Where the camera is looking. In orbit mode, the pivot. */
  readonly target: Vec3 = vec3.create();
  /** Resolved eye position, damped toward the desired one. */
  readonly position: Vec3 = vec3.create(0, 0, 10);

  readonly view: Mat4 = mat4.create();
  readonly projection: Mat4 = mat4.create();
  readonly viewProjection: Mat4 = mat4.create();
  readonly orientation: Quat = quat.create();

  mode: CameraMode = 'orbit';

  /** Orbit parameters (desired; the rendered camera damps toward these). */
  distance: number;
  yaw: number;
  pitch: number;
  minDistance: number;
  maxDistance: number;

  /** How much of the error remains after one second. Lower = snappier. */
  damping = 0.0008;
  rotateSpeed = 0.0055;
  zoomSpeed = 0.0014;

  private readonly desiredTarget: Vec3 = vec3.create();
  private readonly desiredPosition: Vec3 = vec3.create();
  private readonly scriptedEye: Vec3 = vec3.create();
  private readonly scriptedTarget: Vec3 = vec3.create();

  private element: HTMLElement | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly listeners: Array<[string, EventListener]> = [];

  /** Set false while a tour is flying, so a stray drag doesn't fight it. */
  inputEnabled = true;

  constructor(opts: OrbitCameraOptions = {}) {
    this.fov = opts.fov ?? 42 * DEG;
    this.near = opts.near ?? 0.05;
    this.far = opts.far ?? 4000;
    this.distance = opts.distance ?? 30;
    this.minDistance = opts.minDistance ?? 0.4;
    this.maxDistance = opts.maxDistance ?? 900;
    this.yaw = opts.yaw ?? 0.6;
    this.pitch = opts.pitch ?? 0.42;

    this.computeDesired();
    vec3.copy(this.position, this.desiredPosition);
    vec3.copy(this.target, this.desiredTarget);
  }

  // -- input ---------------------------------------------------------------

  attach(element: HTMLElement): void {
    this.detach();
    this.element = element;

    const onPointerDown = (e: Event) => {
      const pe = e as PointerEvent;
      if (!this.inputEnabled || pe.button !== 0) return;
      this.dragging = true;
      this.lastX = pe.clientX;
      this.lastY = pe.clientY;
      element.setPointerCapture(pe.pointerId);
      element.style.cursor = 'grabbing';
    };

    const onPointerMove = (e: Event) => {
      const pe = e as PointerEvent;
      if (!this.dragging || !this.inputEnabled) return;
      const dx = pe.clientX - this.lastX;
      const dy = pe.clientY - this.lastY;
      this.lastX = pe.clientX;
      this.lastY = pe.clientY;

      this.yaw -= dx * this.rotateSpeed;
      // Stop just shy of the poles: at exactly ±90° the up vector degenerates.
      this.pitch = clamp(this.pitch + dy * this.rotateSpeed, -1.5, 1.5);
      this.mode = 'orbit';
    };

    const onPointerUp = (e: Event) => {
      const pe = e as PointerEvent;
      this.dragging = false;
      if (element.hasPointerCapture?.(pe.pointerId)) element.releasePointerCapture(pe.pointerId);
      element.style.cursor = 'grab';
    };

    const onWheel = (e: Event) => {
      const we = e as WheelEvent;
      if (!this.inputEnabled) return;
      we.preventDefault();
      // Exponential zoom: constant *proportional* change per notch, so zooming
      // feels the same whether you are at 1 unit or 500.
      const scale = Math.exp(we.deltaY * this.zoomSpeed);
      this.distance = clamp(this.distance * scale, this.minDistance, this.maxDistance);
      this.mode = 'orbit';
    };

    const add = (type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      element.addEventListener(type, fn, opts);
      this.listeners.push([type, fn]);
    };

    add('pointerdown', onPointerDown);
    add('pointermove', onPointerMove);
    add('pointerup', onPointerUp);
    add('pointercancel', onPointerUp);
    add('wheel', onWheel, { passive: false });
    element.style.cursor = 'grab';
    element.style.touchAction = 'none';
  }

  detach(): void {
    if (!this.element) return;
    for (const [type, fn] of this.listeners) this.element.removeEventListener(type, fn);
    this.listeners.length = 0;
    this.element = null;
  }

  // -- control -------------------------------------------------------------

  /** Point the orbit pivot at a world position; the camera eases over. */
  focus(point: Vec3, distance?: number): void {
    vec3.copy(this.desiredTarget, point);
    if (distance !== undefined) {
      this.distance = clamp(distance, this.minDistance, this.maxDistance);
    }
    this.mode = 'orbit';
  }

  /** Hand the camera to an external driver (the spline tour) for this frame. */
  script(eye: Vec3, lookAt: Vec3): void {
    vec3.copy(this.scriptedEye, eye);
    vec3.copy(this.scriptedTarget, lookAt);
    this.mode = 'scripted';
  }

  /**
   * Return control to the orbit rig without a jump: adopt the current eye's
   * yaw/pitch/distance relative to the target as the new orbit parameters.
   */
  releaseToOrbit(): void {
    const offset = vec3.sub(vec3.create(), this.position, this.target);
    const dist = vec3.len(offset);
    if (dist > 1e-5) {
      this.distance = clamp(dist, this.minDistance, this.maxDistance);
      this.pitch = Math.asin(clamp(offset[1]! / dist, -1, 1));
      this.yaw = Math.atan2(offset[0]!, offset[2]!);
    }
    vec3.copy(this.desiredTarget, this.target);
    this.mode = 'orbit';
  }

  private computeDesired(): void {
    if (this.mode === 'scripted') {
      vec3.copy(this.desiredPosition, this.scriptedEye);
      vec3.copy(this.desiredTarget, this.scriptedTarget);
      return;
    }
    const cosPitch = Math.cos(this.pitch);
    this.desiredPosition[0] = this.desiredTarget[0]! + this.distance * cosPitch * Math.sin(this.yaw);
    this.desiredPosition[1] = this.desiredTarget[1]! + this.distance * Math.sin(this.pitch);
    this.desiredPosition[2] = this.desiredTarget[2]! + this.distance * cosPitch * Math.cos(this.yaw);
  }

  update(dt: number, aspect: number): void {
    this.aspect = aspect;
    this.computeDesired();

    // Scripted motion is already smooth, so only damp when orbiting.
    const rate = this.mode === 'scripted' ? 0.00002 : this.damping;
    for (let i = 0; i < 3; i++) {
      this.position[i] = damp(this.position[i]!, this.desiredPosition[i]!, rate, dt);
      this.target[i] = damp(this.target[i]!, this.desiredTarget[i]!, rate, dt);
    }

    mat4.lookAt(this.view, this.position, this.target, UP);
    mat4.perspective(this.projection, this.fov, aspect, this.near, this.far);
    mat4.multiply(this.viewProjection, this.projection, this.view);
    quat.fromTargetTo(this.orientation, this.position, this.target, UP);
  }

  /** Distance from the eye — for depth-sorting transparent things. */
  distanceTo(point: Vec3): number {
    return vec3.dist(this.position, point);
  }

  /**
   * World → normalized screen coordinates, with a flag for points behind the
   * camera (which project to plausible-looking but wrong positions).
   */
  project(point: Vec3, out: { x: number; y: number; visible: boolean }): void {
    const m = this.viewProjection;
    const x = point[0]!, y = point[1]!, z = point[2]!;
    const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    if (cw <= 1e-6) {
      out.visible = false;
      out.x = out.y = 0;
      return;
    }
    const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    out.x = (cx / cw) * 0.5 + 0.5;
    out.y = 1 - ((cy / cw) * 0.5 + 0.5);
    out.visible = out.x >= -0.1 && out.x <= 1.1 && out.y >= -0.1 && out.y <= 1.1;
  }

  dispose(): void {
    this.detach();
  }
}
