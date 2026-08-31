import './ui/style.css';
import { Shell } from './app/shell.ts';
import { count } from './app/count.ts';
import { applyTitle } from './app/title.ts';

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
};
onRoute();
window.addEventListener('hashchange', onRoute);

const shell = new Shell(root);
void shell.start();
