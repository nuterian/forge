/**
 * A tiny declarative control panel. Chapters describe the knobs they want and
 * this renders them — no dependency, and styled to match the print aesthetic.
 */

export interface SliderControl {
  kind: 'slider';
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  /** Formats the readout; defaults to 2 significant decimals. */
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

export interface ToggleControl {
  kind: 'toggle';
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

export interface SelectControl {
  kind: 'select';
  label: string;
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (v: string) => void;
}

export interface ButtonControl {
  kind: 'button';
  label: string;
  onClick: () => void;
}

export interface ReadoutControl {
  kind: 'readout';
  label: string;
  /** Polled once per frame. */
  get: () => string;
}

export interface GroupControl {
  kind: 'group';
  label: string;
}

export type Control =
  | SliderControl
  | ToggleControl
  | SelectControl
  | ButtonControl
  | ReadoutControl
  | GroupControl;

/** Renders controls into a container and keeps readouts fresh. */
export class ControlPanel {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly readouts: Array<{ control: ReadoutControl; el: HTMLElement; last: string }> = [];

  constructor(title: string, collapsed = false) {
    this.element = document.createElement('section');
    this.element.className = 'panel';

    const header = document.createElement('button');
    header.className = 'panel-header';
    header.type = 'button';
    header.innerHTML = `<span class="panel-title">${title}</span><span class="panel-chevron">−</span>`;

    this.body = document.createElement('div');
    this.body.className = 'panel-body';

    header.addEventListener('click', () => {
      const isCollapsed = this.element.classList.toggle('is-collapsed');
      header.querySelector('.panel-chevron')!.textContent = isCollapsed ? '+' : '−';
    });

    if (collapsed) {
      this.element.classList.add('is-collapsed');
      header.querySelector('.panel-chevron')!.textContent = '+';
    }

    this.element.append(header, this.body);
  }

  add(control: Control): void {
    this.body.append(this.build(control));
  }

  addAll(controls: Control[]): void {
    for (const c of controls) this.add(c);
  }

  /** Called once per frame; only touches the DOM when a value actually changed. */
  refresh(): void {
    for (const entry of this.readouts) {
      const next = entry.control.get();
      if (next !== entry.last) {
        entry.last = next;
        entry.el.textContent = next;
      }
    }
  }

  clear(): void {
    this.body.replaceChildren();
    this.readouts.length = 0;
  }

  private build(control: Control): HTMLElement {
    switch (control.kind) {
      case 'group': {
        const el = document.createElement('div');
        el.className = 'control-group';
        el.textContent = control.label;
        return el;
      }

      case 'slider': {
        const row = document.createElement('label');
        row.className = 'control control-slider';

        const fmt = control.format ?? ((v: number) => trimNumber(v));
        const label = document.createElement('span');
        label.className = 'control-label';
        label.textContent = control.label;

        const value = document.createElement('span');
        value.className = 'control-value';
        value.textContent = fmt(control.value);

        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(control.min);
        input.max = String(control.max);
        input.step = String(control.step ?? (control.max - control.min) / 200);
        input.value = String(control.value);
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          value.textContent = fmt(v);
          control.onChange(v);
        });

        const head = document.createElement('span');
        head.className = 'control-head';
        head.append(label, value);
        row.append(head, input);
        return row;
      }

      case 'toggle': {
        const row = document.createElement('label');
        row.className = 'control control-toggle';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = control.value;
        input.addEventListener('change', () => control.onChange(input.checked));

        const box = document.createElement('span');
        box.className = 'toggle-box';

        const label = document.createElement('span');
        label.className = 'control-label';
        label.textContent = control.label;

        row.append(input, box, label);
        return row;
      }

      case 'select': {
        const row = document.createElement('label');
        row.className = 'control control-select';

        const label = document.createElement('span');
        label.className = 'control-label';
        label.textContent = control.label;

        const select = document.createElement('select');
        for (const opt of control.options) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          select.append(o);
        }
        select.value = control.value;
        select.addEventListener('change', () => control.onChange(select.value));

        row.append(label, select);
        return row;
      }

      case 'button': {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'control control-button';
        button.textContent = control.label;
        button.addEventListener('click', control.onClick);
        return button;
      }

      case 'readout': {
        const row = document.createElement('div');
        row.className = 'control control-readout';

        const label = document.createElement('span');
        label.className = 'control-label';
        label.textContent = control.label;

        const value = document.createElement('span');
        value.className = 'control-value';
        value.textContent = control.get();

        row.append(label, value);
        this.readouts.push({ control, el: value, last: value.textContent });
        return row;
      }
    }
  }
}

function trimNumber(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
