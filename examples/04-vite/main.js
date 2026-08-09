// A real bare import — no import map, because Vite resolves it from node_modules.
import { VFSFileSystem } from '@componentor/fs';

const out = document.getElementById('out');
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); out.textContent = lines.join('\n'); };

log('crossOriginIsolated:', crossOriginIsolated);
if (!crossOriginIsolated) {
  log('\nThe headers in vite.config.js are missing or not applied — sync API unavailable.');
  log('The promises API below still works.');
}

const fs = new VFSFileSystem({ root: '/vite-example' });
await fs.init();
await fs.promises.rm('/', { recursive: true, force: true });

// The async API works with or without cross-origin isolation.
await fs.promises.mkdir('/data', { recursive: true });
await fs.promises.writeFile('/data/config.json', JSON.stringify({ hello: 'world' }, null, 2));
log('\npromises.readFile:', await fs.promises.readFile('/data/config.json', 'utf8'));

// The sync API needs the isolation headers.
if (crossOriginIsolated) {
  fs.writeFileSync('/data/notes.txt', 'written synchronously');
  log('readFileSync:     ', fs.readFileSync('/data/notes.txt', 'utf8'));
  log('readdirSync:      ', JSON.stringify(fs.readdirSync('/data')));
}

log('\nReload the page — the rm() at the top is what clears it, not the browser.');
