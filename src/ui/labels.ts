/**
 * World-space labels drawn as DOM over the canvas.
 *
 * Text stays crisp at any DPI and costs nothing in the shader, which is why
 * the labels aren't rendered into the scene. Overlapping labels are culled by
 * priority so a crowded inner system doesn't turn into a pile of type.
 */

import type { OrbitCamera } from '../core/camera.ts';
import type { Vec3 } from '../core/math.ts';

export interface LabelSpec {
  id: string;
  text: string;
  /** Optional second line, e.g. a distance readout. */
  detail?: string;
  color: string;
  /** Live world position — read every frame, so callers can mutate in place. */
  position: Vec3;
  /** Higher wins when two labels collide. */
  priority?: number;
  /** Hidden beyond this distance from the camera. */
  maxDistance?: number;
  /**
   * A body this label can hide behind — a moon's parent planet, say. Held live
   * and read every frame, exactly like `position`, so callers mutate it in
   * place rather than rebuilding the label set as the world moves.
   */
  occluder?: { center: Vec3; radius: number };
}

interface LabelEntry {
  spec: LabelSpec;
  el: HTMLElement;
  detailEl: HTMLElement | null;
  /** Last written styles — a 60Hz loop must not touch the CSSOM redundantly. */
  lastOpacity: string;
  lastTransform: string;
}

const projected = { x: 0, y: 0, visible: false };

/**
 * Does `sphere` stand between the eye and `target`? A ray-sphere intersection
 * written out in scalars — this runs for every label every frame, and a label
 * layer has no business allocating vectors at 60fps.
 *
 * The near hit has to land *in front of* the target, not merely on the ray:
 * a moon crossing in front of its planet is not hidden by it.
 */
function occludes(eye: Vec3, target: Vec3, center: Vec3, radius: number): boolean {
  const dx = target[0]! - eye[0]!;
  const dy = target[1]! - eye[1]!;
  const dz = target[2]! - eye[2]!;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 1e-6) return false;

  const ux = dx / distance, uy = dy / distance, uz = dz / distance;
  const ox = center[0]! - eye[0]!;
  const oy = center[1]! - eye[1]!;
  const oz = center[2]! - eye[2]!;

  // Distance along the ray to the point closest to the sphere's centre.
  const along = ox * ux + oy * uy + oz * uz;
  if (along <= 0) return false; // the body is behind the eye

  const closest2 = ox * ox + oy * oy + oz * oz - along * along;
  const radius2 = radius * radius;
  if (closest2 >= radius2) return false; // the ray misses

  const near = along - Math.sqrt(radius2 - closest2);
  return near > 0 && near < distance;
}

/** World position → normalized screen coords, same contract as camera.project. */
export type LabelProjector = (
  position: Vec3,
  out: { x: number; y: number; visible: boolean },
) => void;

export class LabelLayer {
  readonly element: HTMLElement;
  private entries = new Map<string, LabelEntry>();
  private lastDetail = new Map<string, string>();

  visible = true;

  /** Chapters with a non-matrix projection (the star chart) install their own. */
  projector: LabelProjector | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'label-layer';
  }

  /** Replace the label set, reusing DOM nodes for ids that persist. */
  set(specs: LabelSpec[]): void {
    const next = new Map<string, LabelEntry>();

    for (const spec of specs) {
      const existing = this.entries.get(spec.id);
      if (existing) {
        existing.spec = spec;
        existing.el.querySelector('.label-text')!.textContent = spec.text;
        existing.el.style.setProperty('--label-color', spec.color);
        next.set(spec.id, existing);
        this.entries.delete(spec.id);
        continue;
      }

      const el = document.createElement('div');
      el.className = 'label';
      el.style.setProperty('--label-color', spec.color);

      const tick = document.createElement('span');
      tick.className = 'label-tick';

      const text = document.createElement('span');
      text.className = 'label-text';
      text.textContent = spec.text;

      el.append(tick, text);

      let detailEl: HTMLElement | null = null;
      if (spec.detail !== undefined) {
        detailEl = document.createElement('span');
        detailEl.className = 'label-detail';
        detailEl.textContent = spec.detail;
        el.append(detailEl);
      }

      this.element.append(el);
      next.set(spec.id, { spec, el, detailEl, lastOpacity: '', lastTransform: '' });
    }

    // Anything left in the old map is gone from the scene.
    for (const stale of this.entries.values()) stale.el.remove();
    this.entries = next;
  }

  /** Update one label's detail line without rebuilding the set. */
  setDetail(id: string, detail: string): void {
    const entry = this.entries.get(id);
    if (!entry?.detailEl) return;
    if (this.lastDetail.get(id) === detail) return;
    this.lastDetail.set(id, detail);
    entry.detailEl.textContent = detail;
  }

  update(camera: OrbitCamera, width: number, height: number): void {
    if (!this.visible) {
      this.element.style.display = 'none';
      return;
    }
    this.element.style.display = '';

    // Project everything first, then resolve collisions by priority.
    const placed: Array<{ x: number; y: number; priority: number; entry: LabelEntry }> = [];

    for (const entry of this.entries.values()) {
      const { spec } = entry;
      if (this.projector) this.projector(spec.position, projected);
      else camera.project(spec.position, projected);

      if (!projected.visible) {
        this.hide(entry);
        continue;
      }
      if (spec.maxDistance !== undefined && camera.distanceTo(spec.position) > spec.maxDistance) {
        this.hide(entry);
        continue;
      }
      if (
        spec.occluder &&
        occludes(camera.position, spec.position, spec.occluder.center, spec.occluder.radius)
      ) {
        this.hide(entry);
        continue;
      }

      placed.push({
        x: projected.x * width,
        y: projected.y * height,
        priority: spec.priority ?? 0,
        entry,
      });
    }

    placed.sort((a, b) => b.priority - a.priority);

    const taken: Array<{ x: number; y: number }> = [];
    const minGapX = 74;
    const minGapY = 17;

    for (const item of placed) {
      const collides = taken.some(
        (t) => Math.abs(t.x - item.x) < minGapX && Math.abs(t.y - item.y) < minGapY,
      );
      if (collides) {
        this.hide(item.entry);
        continue;
      }
      taken.push({ x: item.x, y: item.y });
      if (item.entry.lastOpacity !== '1') {
        item.entry.el.style.opacity = '1';
        item.entry.lastOpacity = '1';
      }
      const transform = `translate(${item.x.toFixed(1)}px, ${item.y.toFixed(1)}px)`;
      if (item.entry.lastTransform !== transform) {
        item.entry.el.style.transform = transform;
        item.entry.lastTransform = transform;
      }
    }
  }

  private hide(entry: LabelEntry): void {
    if (entry.lastOpacity !== '0') {
      entry.el.style.opacity = '0';
      entry.lastOpacity = '0';
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.el.remove();
    this.entries.clear();
    this.lastDetail.clear();
    this.projector = null;
  }
}
