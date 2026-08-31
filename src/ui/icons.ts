/**
 * The chrome's icons.
 *
 * Geometry from Feather (MIT — github.com/feathericons/feather), inlined as
 * SVG rather than installed: package.json has vite and typescript and nothing
 * else, and that is a feature of this project rather than an oversight. Feather
 * suits the house style better than a custom mark would — a 24-unit grid, one
 * stroke weight, round caps, no fills anywhere — which is the same drawing this
 * production already does in its orbit lines and constellation strokes.
 *
 * Every icon inherits `currentColor`, so an icon reprints itself whenever the
 * inks change, exactly like the rest of the interface.
 */

/**
 * Lighter than Feather's own 2px default. At the 14–15px these are set in, a
 * 2-unit stroke prints at about 1.2 device pixels and sits visibly heavier than
 * the hairlines around it; 1.5 lands on the same weight as the panel rules.
 */
const FRAME =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

/** The speaker body, shared by both volume states. */
const SPEAKER = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>';

const PATHS: Record<string, string> = {
  /** volume-2 — the speaker, sounding. */
  volume: `${SPEAKER}<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`,
  /** volume-x — the speaker, struck out. */
  'volume-off': `${SPEAKER}<line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`,
  /** arrow-left — the way back to the index. */
  'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  /** refresh-cw — a new seed. */
  refresh:
    '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>' +
    '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
};

export type IconName = keyof typeof PATHS;

/** One icon as markup, sized in CSS. Safe to drop into innerHTML — it is ours. */
export function icon(name: IconName): string {
  return `<svg class="icon" ${FRAME}>${PATHS[name]!}</svg>`;
}
