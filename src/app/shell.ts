/**
 * The application shell: owns the canvas, the render target, the camera rig,
 * the press, and all the chrome. Chapters plug into it.
 */

import { Loop } from '../core/loop.ts';
import { OrbitCamera } from '../core/camera.ts';
import { createContext, maxSamples, resizeToDisplay, WebGLNotSupportedError, type GLContext } from '../gl/context.ts';
import { registerChunks } from '../gl/chunks.ts';
import { Framebuffer } from '../gl/framebuffer.ts';
import { PrintPass } from '../gl/post.ts';
import { ControlPanel } from '../ui/controls.ts';
import { LabelLayer } from '../ui/labels.ts';
import {
  applyPaletteToCss, DEFAULT_PALETTE, InkSet, PALETTES,
  type Palette,
} from '../ui/palette.ts';
import { CHAPTERS, DEFAULT_CHAPTER, findChapter } from '../chapters/registry.ts';
import type { ChapterDef, ChapterInstance } from './chapter.ts';

interface Route {
  chapterId: string;
  seed: string;
}

export class Shell {
  private readonly root: HTMLElement;
  private ctx!: GLContext;
  private framebuffer!: Framebuffer;
  private print!: PrintPass;
  private camera!: OrbitCamera;
  private labels!: LabelLayer;
  private loop!: Loop;

  private palette: Palette = DEFAULT_PALETTE;
  private inks: InkSet = new InkSet(DEFAULT_PALETTE);

  private chapter: ChapterInstance | null = null;
  private chapterDef: ChapterDef | null = null;
  private chapterPanel: ControlPanel | null = null;
  private loadToken = 0;

  // Chrome
  private hud!: HTMLElement;
  private mastheadEl!: HTMLElement;
  private navEl!: HTMLElement;
  private leftRail!: HTMLElement;
  private rightRail!: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start(): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.id = 'stage';
    this.root.append(canvas);

    try {
      this.ctx = createContext(canvas);
    } catch (err) {
      this.showNotice(
        'WebGL2 unavailable',
        err instanceof WebGLNotSupportedError
          ? err.message
          : 'This browser could not create a WebGL2 context.',
      );
      return;
    }

    registerChunks();
    resizeToDisplay(this.ctx);

    const gl = this.ctx.gl;
    this.framebuffer = new Framebuffer(gl, this.ctx.width, this.ctx.height, {
      samples: maxSamples(gl, 4),
      depth: true,
    });
    this.print = new PrintPass(gl);
    this.camera = new OrbitCamera();
    this.camera.attach(canvas);
    this.labels = new LabelLayer();

    this.buildChrome();
    this.applyPalette(this.palette);

    this.loop = new Loop((dt, elapsed) => this.frame(dt, elapsed));
    this.loop.start();

    window.addEventListener('hashchange', () => void this.syncToRoute());
    await this.syncToRoute();
  }

  // -- chrome --------------------------------------------------------------

  private buildChrome(): void {
    this.hud = document.createElement('div');
    this.hud.className = 'hud';

    const topLeft = document.createElement('div');
    topLeft.className = 'hud-topleft';
    this.mastheadEl = document.createElement('div');
    this.mastheadEl.className = 'masthead';
    topLeft.append(this.mastheadEl);

    const topRight = document.createElement('div');
    topRight.className = 'hud-topright';
    this.navEl = document.createElement('nav');
    this.navEl.className = 'chapter-nav';
    topRight.append(this.navEl);

    const bottomLeft = document.createElement('div');
    bottomLeft.className = 'hud-bottomleft';
    this.leftRail = document.createElement('div');
    this.leftRail.className = 'rail';
    bottomLeft.append(this.leftRail);

    const bottomRight = document.createElement('div');
    bottomRight.className = 'hud-bottomright';
    this.rightRail = document.createElement('div');
    this.rightRail.className = 'rail';
    bottomRight.append(this.rightRail);

    this.hud.append(topLeft, topRight, bottomLeft, bottomRight);
    this.root.append(this.labels.element, this.hud);

    this.buildNav();
  }

  private buildNav(): void {
    this.navEl.replaceChildren();
    for (const def of CHAPTERS) {
      const link = document.createElement('a');
      link.className = 'chapter-nav-link';
      if (!def.available) link.classList.add('is-disabled');
      link.href = `#/${def.id}`;
      link.innerHTML =
        `<span class="chapter-nav-rule"></span>` +
        `<span class="chapter-nav-num">${String(def.index).padStart(2, '0')}</span>` +
        `<span>${def.title}</span>`;
      link.dataset.chapter = def.id;
      this.navEl.append(link);
    }
  }

  private updateChrome(def: ChapterDef): void {
    this.mastheadEl.innerHTML = `
      <span class="masthead-index">${String(def.index).padStart(2, '0')}</span>
      <div>
        <h1 class="masthead-title">${def.title}</h1>
        <p class="masthead-subtitle">${def.subtitle}</p>
      </div>`;

    for (const link of this.navEl.querySelectorAll<HTMLElement>('.chapter-nav-link')) {
      link.classList.toggle('is-active', link.dataset.chapter === def.id);
    }

    // "How it works" — the concepts this chapter is actually demonstrating.
    this.rightRail.replaceChildren();
    const concepts = new ControlPanel('How it works');
    const list = document.createElement('ul');
    list.className = 'concept-list';
    for (const concept of def.concepts) {
      const li = document.createElement('li');
      li.textContent = concept;
      list.append(li);
    }
    const body = concepts.element.querySelector('.panel-body')!;
    body.append(list);

    const note = document.createElement('p');
    note.className = 'concept-note';
    note.textContent = 'Drag to orbit · scroll to zoom';
    body.append(note);

    this.rightRail.append(concepts.element);
  }

  /** The one shell-owned control: which ink set the whole page prints in. */
  private inkSelector(): Parameters<ControlPanel['add']>[0] {
    return {
      kind: 'select',
      label: 'Inks',
      value: this.palette.id,
      options: PALETTES.map((p) => ({ label: p.name, value: p.id })),
      onChange: (id) => {
        const next = PALETTES.find((p) => p.id === id);
        if (next) {
          this.palette = next;
          this.applyPalette(next);
          // The chapter captured the old inks, so reload it with the new ones.
          void this.loadChapter(this.chapterDef!, this.currentRoute().seed);
        }
      },
    };
  }

  private applyPalette(palette: Palette): void {
    this.inks = new InkSet(palette);
    applyPaletteToCss(palette);
    this.print.paper = this.inks.paper;
  }

  // -- routing -------------------------------------------------------------

  private currentRoute(): Route {
    const hash = location.hash.replace(/^#\/?/, '');
    const [path, query] = hash.split('?');
    const params = new URLSearchParams(query ?? '');
    return {
      chapterId: path || DEFAULT_CHAPTER,
      seed: params.get('seed') ?? 'SOL',
    };
  }

  private async syncToRoute(): Promise<void> {
    const route = this.currentRoute();
    const def = findChapter(route.chapterId);

    if (!def) {
      location.hash = `#/${DEFAULT_CHAPTER}`;
      return;
    }
    if (!def.available) {
      this.updateChrome(def);
      this.disposeChapter();
      this.showComingSoon(def);
      return;
    }
    if (this.chapterDef?.id === def.id && this.chapter) return;

    await this.loadChapter(def, route.seed);
  }

  private async loadChapter(def: ChapterDef, seed: string): Promise<void> {
    const token = ++this.loadToken;
    this.disposeChapter();
    this.clearNotice();
    this.chapterDef = def;

    if (def.palette) {
      const p = PALETTES.find((x) => x.id === def.palette);
      if (p && p.id !== this.palette.id) {
        this.palette = p;
        this.applyPalette(p);
      }
    }

    this.updateChrome(def);

    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'Inking…';
    this.root.append(loading);

    try {
      if (!def.load) throw new Error(`Chapter "${def.id}" has no loader`);
      const mod = await def.load();
      // A newer navigation may have started while this one was importing.
      if (token !== this.loadToken) return;

      const chapterPanel = new ControlPanel(def.title);
      this.chapterPanel = chapterPanel;
      this.leftRail.replaceChildren(chapterPanel.element);

      const instance = await mod.create({
        gl: this.ctx.gl,
        canvas: this.ctx.canvas,
        camera: this.camera,
        inks: this.inks,
        print: this.print,
        labels: this.labels,
        controls: chapterPanel,
        size: { width: this.ctx.width, height: this.ctx.height },
        seed,
        reseed: (next: string) => {
          location.hash = `#/${def.id}?seed=${encodeURIComponent(next)}`;
          void this.loadChapter(def, next);
        },
      });

      if (token !== this.loadToken) {
        instance.dispose();
        return;
      }

      this.chapter = instance;
      chapterPanel.add(this.inkSelector());
      instance.resize?.(this.ctx.width, this.ctx.height);
    } catch (err) {
      if (token !== this.loadToken) return;
      console.error(err);
      this.showNotice(
        `${def.title} failed to load`,
        err instanceof Error ? err.message : String(err),
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      loading.remove();
    }
  }

  private disposeChapter(): void {
    this.chapter?.dispose();
    this.chapter = null;
    this.labels.clear();
    this.chapterPanel = null;
    this.leftRail.replaceChildren();
  }

  // -- frame ---------------------------------------------------------------

  private frame(dt: number, elapsed: number): void {
    const gl = this.ctx.gl;

    if (resizeToDisplay(this.ctx)) {
      this.framebuffer.resize(this.ctx.width, this.ctx.height);
      this.chapter?.resize?.(this.ctx.width, this.ctx.height);
    }

    const aspect = this.ctx.width / Math.max(1, this.ctx.height);
    this.camera.update(dt, aspect);

    if (this.chapter) {
      this.chapter.update(dt, elapsed);

      this.framebuffer.bind();
      const paper = this.inks.paper;
      gl.clearColor(paper[0]!, paper[1]!, paper[2]!, 1);
      gl.clearDepth(1);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      this.chapter.render();
      this.framebuffer.resolve();

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.print.render(this.framebuffer, this.ctx.width, this.ctx.height, elapsed);
    }

    const rect = this.ctx.canvas.getBoundingClientRect();
    this.labels.update(this.camera, rect.width, rect.height);
    this.chapterPanel?.refresh();
  }

  // -- notices -------------------------------------------------------------

  private clearNotice(): void {
    this.root.querySelector('.notice')?.remove();
  }

  private showNotice(title: string, message: string, detail?: string): void {
    this.clearNotice();
    const notice = document.createElement('div');
    notice.className = 'notice';
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = message;
    notice.append(h, p);
    if (detail) {
      const pre = document.createElement('pre');
      pre.textContent = detail;
      notice.append(pre);
    }
    this.root.append(notice);
  }

  private showComingSoon(def: ChapterDef): void {
    this.showNotice(
      `${String(def.index).padStart(2, '0')} · ${def.title}`,
      `${def.subtitle}\n\nNot inked yet — this chapter is still on the press.`,
    );
  }
}
