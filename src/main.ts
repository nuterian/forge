import './ui/style.css';
import { Shell } from './app/shell.ts';
import { DEFAULT_CHAPTER } from './chapters/registry.ts';

const root = document.getElementById('app');
if (!root) throw new Error('main: #app not found');

if (!location.hash) {
  location.hash = `#/${DEFAULT_CHAPTER}`;
}

const shell = new Shell(root);
void shell.start();
