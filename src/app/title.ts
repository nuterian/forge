/**
 * What the browser tab says.
 *
 * The whole site lives at one URL with a hash after it, so without this every
 * chapter, every back-button entry and every bookmark reads "The Forge — a
 * generated cosmos" and there is no telling them apart. It is also what the
 * page-view counter reports alongside the URL, which is the difference between
 * a dashboard listing six routes and one listing six chapters by name.
 */

import { findChapter } from '../chapters/registry.ts';

/** The index's title, and the tail every chapter's title carries. */
const SITE = 'The Forge';
const INDEX_TITLE = 'The Forge — a generated cosmos';

/** The title for a route, without touching the document. */
export function titleFor(chapterId: string): string {
  if (!chapterId) return INDEX_TITLE;
  const def = findChapter(chapterId);
  return def ? `${def.title} · ${SITE}` : INDEX_TITLE;
}

/** The chapter id in the address bar, with any seed stripped off. */
export function routeId(): string {
  return location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
}

/**
 * Set the tab from the current route.
 *
 * Called before the counter on every route change, and deliberately not from
 * the shell: the shell loads chapters asynchronously, so a title set there
 * lands after the beacon has already gone out carrying the previous chapter's
 * name. This reads the route directly and is synchronous, so the two always
 * agree.
 */
export function applyTitle(): void {
  document.title = titleFor(routeId());
}
