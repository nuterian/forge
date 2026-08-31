/**
 * The application shell: owns the canvas, the render target, the camera rig,
 * the press, and all the chrome. Chapters plug into it.
 */

import { Loop } from '../core/loop.ts';
import { OrbitCamera } from '../core/camera.ts';
import { vec3 } from '../core/math.ts';
import { Rng, randomSeedString } from '../core/rng.ts';
import { createContext, maxSamples, resizeToDisplay, WebGLNotSupportedError, type GLContext } from '../gl/context.ts';
import { registerChunks } from '../gl/chunks.ts';
import { Framebuffer } from '../gl/framebuffer.ts';
import { PrintPass, DEFAULT_PRINT } from '../gl/post.ts';
import { Gallery } from './gallery.ts';
import { ControlPanel } from '../ui/controls.ts';
import { LabelLayer } from '../ui/labels.ts';
import {
  applyPaletteToCss, DEFAULT_PALETTE, InkSet, PALETTES,
  type Palette,
} from '../ui/palette.ts';
import { CHAPTERS, findChapter } from '../chapters/registry.ts';
import type { ChapterDef, ChapterInstance } from './chapter.ts';

interface Route {
  /** Empty string routes to the gallery index. */
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
  /**
   * True once the reader has picked inks from the Inks control. Chapters name
   * a default palette, but that is a *default* — an opening opinion for a first
   * arrival, not a preference the shell gets to overrule every time the route
   * changes. Once someone has chosen, their choice outranks every chapter's
   * suggestion for the rest of the session; reroll and navigation both keep it.
   */
  private paletteChosen = false;

  private chapter: ChapterInstance | null = null;
  private chapterDef: ChapterDef | null = null;
  private chapterPanel: ControlPanel | null = null;
  private currentSeed = '';
  private loadToken = 0;
  private gallery: Gallery | null = null;

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
    resizeToDisplay(this.ctx, this.ctx.canvas.getBoundingClientRect());

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

    const home = document.createElement('a');
    home.className = 'chapter-nav-link chapter-nav-home';
    home.href = '#/';
    home.innerHTML = `<span class="chapter-nav-rule"></span><span>Index</span>`;
    this.navEl.append(home);

    for (const def of CHAPTERS) {
      if (def.hidden) continue;
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

  private updateChrome(def: ChapterDef, seed?: string): void {
    this.mastheadEl.innerHTML = `
      <span class="masthead-index">${String(def.index).padStart(2, '0')}</span>
      <div>
        <h1 class="masthead-title">${def.title}</h1>
        <p class="masthead-subtitle">${def.subtitle}</p>
      </div>`;

    // Seeded generators wear their seed; the reroll button prints a new one.
    if (def.seeded && seed !== undefined) {
      const chip = document.createElement('div');
      chip.className = 'seed-chip';
      chip.innerHTML = `<span class="seed-chip-label">Seed</span><span class="seed-chip-value">${seed}</span>`;
      const reroll = document.createElement('button');
      reroll.type = 'button';
      reroll.className = 'seed-chip-reroll';
      reroll.title = 'New seed';
      reroll.textContent = '↻';
      reroll.addEventListener('click', () => {
        location.hash = `#/${def.id}?seed=${encodeURIComponent(randomSeedString())}`;
      });
      chip.append(reroll);
      this.mastheadEl.querySelector('div')!.append(chip);
    }

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
          this.paletteChosen = true;
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
      chapterId: path ?? '',
      seed: params.get('seed') ?? 'VELA-2015',
    };
  }

  private async syncToRoute(): Promise<void> {
    const route = this.currentRoute();

    if (!route.chapterId) {
      this.showGallery();
      return;
    }

    const def = findChapter(route.chapterId);
    if (!def) {
      location.hash = '#/';
      return;
    }

    this.hideGallery();

    if (!def.available) {
      this.updateChrome(def);
      this.disposeChapter();
      this.showComingSoon(def);
      return;
    }
    // Same chapter, same seed → nothing to do. A seed change reloads.
    if (this.chapterDef?.id === def.id && this.chapter && this.currentSeed === route.seed) return;

    await this.loadChapter(def, route.seed);
  }

  private showGallery(): void {
    this.disposeChapter();
    this.clearNotice();
    this.chapterDef = null;
    this.hud.style.display = 'none';
    this.labels.element.style.display = 'none';
    if (!this.gallery) {
      this.gallery = new Gallery();
      this.root.append(this.gallery.element);
    }
    this.gallery.show(this.palette);
  }

  private hideGallery(): void {
    this.gallery?.hide();
    this.hud.style.display = '';
    this.labels.element.style.display = '';
  }

  private async loadChapter(def: ChapterDef, seed: string): Promise<void> {
    const token = ++this.loadToken;

    // A reseed of the same chapter keeps the view: rerolling the sky should
    // not yank the camera back to its defaults.
    const isReseed = this.chapterDef?.id === def.id && this.chapter !== null;
    const view = isReseed
      ? {
          yaw: this.camera.yaw,
          pitch: this.camera.pitch,
          fov: this.camera.fov,
          distance: this.camera.distance,
        }
      : null;

    this.disposeChapter();
    this.clearNotice();
    this.chapterDef = def;
    this.currentSeed = seed;

    // A genuinely new chapter starts from a clean pivot. Chapters only ever
    // *move toward* their own subject (Worldsmith's planet can sit forty-odd
    // units from the origin); nothing moves it back on the way out, so
    // without this a chapter that assumes it starts near the origin — which
    // is every one of them but Worldsmith — inherits a stray, far-off target
    // and points at empty space until its own damping (~1s) drags it home.
    if (!isReseed) {
      vec3.set(this.camera.target, 0, 0, 0);
      vec3.set(this.camera.position, 0, 0, 10);
    }

    // Measure before the chapter is built, not after. Chapters frame their
    // opening shot in create(), and framing needs the aspect ratio — which is
    // wrong (or literally 1×1, before the stylesheet has landed) if the only
    // measurement happens in the first frame, after create() has already run.
    const rect = this.ctx.canvas.getBoundingClientRect();
    if (resizeToDisplay(this.ctx, rect)) {
      this.framebuffer.resize(this.ctx.width, this.ctx.height);
    }
    this.camera.aspect = this.ctx.width / Math.max(1, this.ctx.height);

    // Chapters only declare deviations from the house print settings, so
    // every load starts from the same plate.
    Object.assign(this.print.settings, DEFAULT_PRINT);

    // The chapter's own inks, but only until the reader has an opinion.
    if (def.palette && !this.paletteChosen) {
      const p = PALETTES.find((x) => x.id === def.palette);
      if (p && p.id !== this.palette.id) {
        this.palette = p;
        this.applyPalette(p);
      }
    }

    this.updateChrome(def, seed);

    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'Inking…';
    this.root.append(loading);

    try {
      if (!def.load) throw new Error(`Chapter "${def.id}" has no loader`);
      const mod = await def.load();
      // A newer navigation may have started while this one was importing.
      if (token !== this.loadToken) return;

      // On a phone the panel would cover a third of the scene before you have
      // even looked at it, so it arrives collapsed to its header and opens on
      // a tap. On anything roomier it stays open, where it belongs.
      //
      // Measured from the canvas, not window.innerWidth: that reads 0 when the
      // page is laid out while hidden, and 0 is narrower than any phone, so
      // every desktop load would have arrived collapsed too.
      const chapterPanel = new ControlPanel(def.title, rect.width > 0 && rect.width <= 620);
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
        rng: new Rng(seed),
        isReseed,
        reseed: (next: string) => {
          location.hash = `#/${def.id}?seed=${encodeURIComponent(next)}`;
        },
      });

      if (token !== this.loadToken) {
        instance.dispose();
        return;
      }

      this.chapter = instance;
      // A chapter loaded, so whatever the browser is holding is current. Spend
      // the stale-build reload again if a *later* deploy strands this session.
      try { sessionStorage.removeItem('forge:reloaded-for-stale-build'); } catch { /* no-op */ }
      chapterPanel.add(this.inkSelector());

      // Restore the pre-reseed view, within whatever limits the chapter set.
      if (view) {
        this.camera.yaw = view.yaw;
        this.camera.pitch = view.pitch;
        this.camera.fov = Math.min(Math.max(view.fov, this.camera.minFov), this.camera.maxFov);
        this.camera.distance = Math.min(
          Math.max(view.distance, this.camera.minDistance),
          this.camera.maxDistance,
        );
      }

      instance.resize?.(this.ctx.width, this.ctx.height);
    } catch (err) {
      if (token !== this.loadToken) return;
      console.error(err);
      if (this.recoverFromStaleBuild(err)) return;
      this.showNotice(
        `${def.title} failed to load`,
        err instanceof Error ? err.message : String(err),
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      loading.remove();
    }
  }

  /**
   * Reload once when a chapter's code cannot be fetched at all.
   *
   * Chapters are dynamic imports of content-hashed files, and the page that
   * names those hashes is HTML the browser is allowed to cache (GitHub Pages
   * serves it with max-age=600). So for ten minutes after a deploy, anyone
   * holding the previous index.html asks for chunks the deploy has already
   * deleted, and every chapter 404s — the site looks broken to exactly the
   * people who visit most often.
   *
   * The page itself is the stale part, so reloading it is the fix. Guarded by
   * a session flag: if the reload fails the same way it is not a cache at all,
   * and a loop would be worse than the error.
   */
  private recoverFromStaleBuild(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    if (!/dynamically imported module|Importing a module script failed/i.test(message)) {
      return false;
    }
    const KEY = 'forge:reloaded-for-stale-build';
    try {
      if (sessionStorage.getItem(KEY)) return false;
      sessionStorage.setItem(KEY, '1');
    } catch {
      return false; // no session storage (private mode): show the error instead
    }
    location.reload();
    return true;
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

    // One layout read for the whole frame — resize and label placement both
    // need it, and getBoundingClientRect() is not free at 60fps.
    const rect = this.ctx.canvas.getBoundingClientRect();

    if (resizeToDisplay(this.ctx, rect)) {
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
