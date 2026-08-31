import './ui/style.css';
import { Shell } from './app/shell.ts';
import { startCounting } from './app/count.ts';

const root = document.getElementById('app');
if (!root) throw new Error('main: #app not found');

// No hash → the gallery index.
if (!location.hash) location.hash = '#/';

// After the hash has been normalised, so the first view is counted as the
// route it actually is rather than as an empty one that immediately redirects.
startCounting();

const shell = new Shell(root);
void shell.start();
