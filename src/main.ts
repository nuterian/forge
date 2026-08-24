import './ui/style.css';
import { Shell } from './app/shell.ts';

const root = document.getElementById('app');
if (!root) throw new Error('main: #app not found');

// No hash → the gallery index.
if (!location.hash) location.hash = '#/';

const shell = new Shell(root);
void shell.start();
