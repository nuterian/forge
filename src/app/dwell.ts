/**
 * How long somebody actually stayed.
 *
 * A page view says a chapter was opened, which is the least interesting thing
 * about it. These are generators — you are meant to sit with one, drag it
 * around, reroll it — so the number worth having is how long people stay, and a
 * count of opens cannot tell a fly-past from ten minutes of exploring.
 *
 * Three things make a naive timer lie, and all three are handled here.
 *
 * Hidden time is not dwell. A tab left open overnight would otherwise report
 * eight hours in the Orrery, and a handful of those would drag every average
 * this metric exists to produce.
 *
 * The last chapter of a session is the one most likely to be lost. If a visit
 * were only reported when the route changes, then everybody who opened a
 * chapter, stayed, and closed the tab would contribute nothing — and the
 * survivors would all be people who left early. That is a bias pointing exactly
 * the wrong way, so a visit is also reported the moment the page is hidden,
 * which is the last moment anything can reliably be sent.
 *
 * The consequence, stated plainly because it decides what the number means: a
 * visit interrupted by a tab-away arrives as two events rather than one. This
 * measures time in a single uninterrupted sitting, not total time on a chapter.
 * That is the honest reading of it, and it is the one that averages.
 */

import { event, type Where } from './count.ts';
import { routeId, titleFor } from './title.ts';

/**
 * Below this, it was a navigation and not a visit — the shell rewrites the hash
 * on its own account, and a reader passing through the index on the way
 * somewhere else did not read it.
 */
const MIN_SECONDS = 1;

/**
 * Above this, something is wrong rather than interesting. A laptop that sleeps
 * with the tab in front does not fire visibilitychange, and performance.now()
 * keeps counting through it.
 */
const MAX_SECONDS = 1800;

/** The visit in progress, or null between visits. */
let where: Where | null = null;
let chapter = '';
/** performance.now() when the current run of *visible* time began. */
let since = 0;
/** Visible milliseconds banked so far in this visit. */
let banked = 0;

/** The index is a page people spend time on too; it is not a chapter, so say so. */
function label(id: string): string {
  return id || 'index';
}

/**
 * Start timing the route now in the address bar.
 *
 * Captures the page it belongs to at the same moment, because by the time this
 * visit is reported the address bar will be describing the next one.
 */
function beginDwell(): void {
  const id = routeId();
  chapter = label(id);
  where = { url: `${location.pathname}#/${id}`, title: titleFor(id) };
  since = performance.now();
  banked = 0;
}

/** Bank the visible time since the last resume, without ending the visit. */
function bank(): void {
  if (since > 0) banked += performance.now() - since;
  since = 0;
}

/**
 * Report the visit and forget it. Safe to call twice — the second call has
 * nothing to report, which is what makes the hidden and pagehide handlers able
 * to race each other harmlessly.
 */
export function endDwell(): void {
  if (!where) return;
  bank();
  const seconds = Math.round(banked / 1000);
  const target = where;
  where = null;
  banked = 0;
  if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) return;
  event('dwell', { chapter, seconds }, target);
}

/**
 * Follow the address bar: end the visit that was running and start a new one,
 * unless it is the same chapter.
 *
 * That exception is the whole reason this is not two lines in main.ts. Pressing
 * reroll rewrites the hash with a new seed, which fires hashchange — and a
 * reader who rerolls the Star Chart nine times has not paid it ten separate
 * visits of a few seconds each. They sat with it. The seed-stripped route is
 * the identity of a visit, exactly as it is the identity of a page view.
 */
export function syncDwell(): void {
  if (where && label(routeId()) === chapter) return;
  endDwell();
  beginDwell();
}

/**
 * Watch for the reader looking away.
 *
 * pagehide as well as visibilitychange: Safari can put a page into the back/
 * forward cache without ever firing a visibility change, and that page is gone
 * as far as this is concerned. Both land in endDwell, which is idempotent.
 */
export function watchDwell(): void {
  document.addEventListener('visibilitychange', () => {
    // syncDwell rather than beginDwell on the way back: it starts a visit only
    // when there is not one already running, so a stray visible event cannot
    // silently reset a timer that was mid-count.
    if (document.hidden) endDwell();
    else syncDwell();
  });
  window.addEventListener('pagehide', endDwell);
}
