import './ui/style.css';
import { Shell } from './app/shell.ts';
import { count } from './app/count.ts';
import { applyTitle } from './app/title.ts';
import { syncDwell, watchDwell } from './app/dwell.ts';

const root = document.getElementById('app');
if (!root) throw new Error('main: #app not found');

// No hash → the gallery index.
if (!location.hash) location.hash = '#/';

// One listener for both, in this order and for a reason: the counter reports
// document.title alongside the URL, so the tab has to say where we are before
// the beacon goes out. Registered after the hash is normalised, so the first
// view is counted as the route it actually is rather than as an empty one that
// immediately redirects.
const onRoute = (): void => {
  applyTitle();
  count();
  // Last, and safe there: a visit captures the page it belongs to when it
  // starts, so ending one after the address bar has moved on still files it
  // against the chapter it was actually spent in.
  syncDwell();
};
onRoute();
watchDwell();
window.addEventListener('hashchange', onRoute);

const shell = new Shell(root);
void shell.start();
