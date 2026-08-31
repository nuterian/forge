/**
 * count.ts — one POST per page view, and nothing else.
 *
 * The same instrument jugalm.com uses, which is deliberate: self-hosted Umami
 * at stats.jugalm.com, and no third-party script anywhere near it. This file is
 * the whole client. A production whose entire premise is that nothing is stored
 * and nothing is fetched does not get to make an exception for its own metrics.
 *
 * No cookies, no localStorage, no device fingerprint, no client-side identifier
 * of any kind: the server derives a visit from the request itself against a
 * salt that rotates daily, so yesterday's visitor cannot be joined to today's.
 * Nothing here can identify a person, and nothing here is shared with anyone.
 *
 * It costs the page nothing. sendBeacon hands the browser a request and returns
 * immediately — the browser sends it on its own schedule, off the critical
 * path, and it cannot block paint, interaction or unload. This site holds a
 * frame budget; counting does not get to spend any of it.
 */

import { routeId } from './title.ts';

const ENDPOINT = 'https://stats.jugalm.com/api/send';

/**
 * The Forge's own website id, from the Umami dashboard.
 *
 * Empty until that entry exists. Paste the uuid here and that is the whole
 * change — nothing else in this file or anywhere else needs touching.
 *
 * While it is empty the bundler folds the guard below, finds the rest of
 * count() unreachable and deletes it: `stats.jugalm.com` does not appear in the
 * built bundle at all. That is the right failure mode rather than an accident.
 * A build with nowhere to report ships no reporting code, so a deploy made
 * before the dashboard entry exists cannot quietly file this site's pageviews
 * under jugalm.com's, and cannot be mistaken for tracking that is switched off.
 */
const WEBSITE = '';

/** Asked not to be counted, in either of the two ways a browser can ask. */
const optedOut = (): boolean =>
  navigator.doNotTrack === '1' ||
  (window as { doNotTrack?: string }).doNotTrack === '1' ||
  (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

/**
 * The route, without the seed.
 *
 * Every chapter here is a generator with a reroll button, so the seed is in the
 * URL and changes every time someone presses it. Reported verbatim, one
 * afternoon of rerolling would file several hundred distinct "pages" and the
 * report would be unreadable — the one number worth having, how many people
 * opened the Orrery, would be scattered across every seed they opened it with.
 * A seed is a state of a page, not a page.
 */
function route(): string {
  return `${location.pathname}#/${routeId()}`;
}

/**
 * The last route counted, so a reroll is not a second view of the same page.
 *
 * The chapters are hash routes, so there is no navigation for a tracker to
 * notice on its own — Umami's own script watches pushState and would record
 * exactly one view per session here however much of the site somebody read.
 * main.ts calls count() on every hashchange instead.
 */
let last = '';

/** One beacon. Everything reported goes through here, gated once. */
function send(payload: Record<string, unknown>): void {
  // Only the real site, and only real people: a local build, a preview server
  // or an automated run is not a visit.
  if (!WEBSITE) return;
  if (location.hostname !== 'jugalm.com' || navigator.webdriver || optedOut()) return;
  if (!navigator.sendBeacon) return;

  try {
    const body = JSON.stringify({
      type: 'event',
      payload: {
        website: WEBSITE,
        hostname: location.hostname,
        url: route(),
        title: document.title,
        referrer: document.referrer,
        screen: `${screen.width}x${screen.height}`,
        language: navigator.language,
        ...payload,
      },
    });
    // text/plain, and that is load-bearing. sendBeacon always sends with
    // credentials mode "include"; application/json is not CORS-safelisted, so
    // it forces a preflight, and a credentialed preflight REFUSES the wildcard
    // Access-Control-Allow-Origin that Umami answers with — the beacon is
    // rejected before it leaves the browser. A safelisted content type makes it
    // a no-cors request instead: no preflight, nothing to reject, and the body
    // is still parsed as JSON at the other end because Request.json() does not
    // consult the header. The response is opaque, which is fine — there is
    // nothing to read.
    navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
  } catch {
    /* counting is never worth an error in the console */
  }
}

/** One page view, unless this route was the last one counted. */
export function count(): void {
  const url = route();
  if (url === last) return;
  last = url;
  send({});
}

/**
 * One named thing that happened.
 *
 * `data` is for low-cardinality facts only — which chapter, which ink. Never a
 * seed: a seed is unique per press, and a property with unbounded values fills
 * the report with rows of one and answers nothing. The question worth asking is
 * "do people press reroll at all", not "which of nine thousand skies did they
 * see".
 */
export function event(name: string, data?: Record<string, string>): void {
  send(data ? { name, data } : { name });
}
