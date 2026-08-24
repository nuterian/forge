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
}

interface LabelEntry {
  spec: LabelSpec;
  el: HTMLElement;
  detailEl: HTMLElement | null;
}

const projected = { x: 0, y: 0, visible: false };

export class LabelLayer {
  readonly element: HTMLElement;
  private entries = new Map<string, LabelEntry>();
  private lastDetail = new Map<string, string>();

  visible = true;

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
      next.set(spec.id, { spec, el, detailEl });
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
      camera.project(spec.position, projected);

      if (!projected.visible) {
        entry.el.style.opacity = '0';
        continue;
      }
      if (spec.maxDistance !== undefined && camera.distanceTo(spec.position) > spec.maxDistance) {
        entry.el.style.opacity = '0';
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
        item.entry.el.style.opacity = '0';
        continue;
      }
      taken.push({ x: item.x, y: item.y });
      item.entry.el.style.opacity = '1';
      item.entry.el.style.transform = `translate(${item.x.toFixed(1)}px, ${item.y.toFixed(1)}px)`;
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.el.remove();
    this.entries.clear();
    this.lastDetail.clear();
  }
}
