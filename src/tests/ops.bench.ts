/**
 * Full-stack op micro-benchmarks — method layer → wire encode → dispatch → VFSEngine.
 *
 * Run with: npx vitest bench ops.bench
 * (bench files are NOT picked up by `vitest run`, so the normal suite is unaffected)
 *
 * [engine.bench.ts](./engine.bench.ts) measures the engine in isolation. This one measures what
 * a caller actually pays per `fs.*` call minus the SharedArrayBuffer hop: argument parsing, mode
 * parsing, request encoding, dispatch decoding, and the engine itself. That makes it the right
 * place to catch a regression in the layers *around* the engine — the ones a browser benchmark
 * is too noisy to resolve.
 *
 * Backed by an in-memory handle, so these are not I/O numbers. Compare runs against each other,
 * never against the Playwright OPFS benchmark.
 */
import { bench, describe } from 'vitest';
import { createHarness, type Harness } from './helpers/engine-transport.js';
import { writeFileSync } from '../src/methods/writeFile.js';
import { readFileSync } from '../src/methods/readFile.js';
import { appendFileSync } from '../src/methods/appendFile.js';
import { statSync } from '../src/methods/stat.js';
import { mkdirSync } from '../src/methods/mkdir.js';
import { readdirSync } from '../src/methods/readdir.js';
import { truncateSync } from '../src/methods/truncate.js';
import { existsSync } from '../src/methods/exists.js';
import { openSync, closeSync, writeSyncFd, readSync } from '../src/methods/open.js';

const KB4 = 'x'.repeat(4096);
const BYTES4K = new TextEncoder().encode(KB4);

/** A harness pre-populated with one 4 KB file and a directory of 200 entries. */
function seeded(): Harness {
  const h = createHarness();
  writeFileSync(h.request, '/file.bin', KB4);
  mkdirSync(h.request, '/dir');
  for (let i = 0; i < 200; i++) writeFileSync(h.request, `/dir/f${i}`, '');
  return h;
}

describe('metadata', () => {
  const h = seeded();
  bench('stat', () => { statSync(h.request, '/file.bin'); });
  bench('exists', () => { existsSync(h.request, '/file.bin'); });
  bench('readdir (200 entries)', () => { readdirSync(h.request, '/dir'); });
});

describe('whole-file IO', () => {
  const h = seeded();
  let n = 0;
  bench('read 4KB', () => { readFileSync(h.request, '/file.bin'); });
  bench('read 4KB as utf8', () => { readFileSync(h.request, '/file.bin', 'utf8'); });
  bench('overwrite 4KB', () => { writeFileSync(h.request, '/file.bin', BYTES4K); });
  bench('create 4KB', () => { writeFileSync(h.request, `/new${n++}`, BYTES4K); });
  bench('append 64B', () => { appendFileSync(h.request, '/log', 'y'.repeat(64)); });
});

describe('descriptor IO', () => {
  const h = seeded();
  const buf = new Uint8Array(4096);
  bench('open+close', () => { closeSync(h.request, openSync(h.request, '/file.bin', 'r')); });
  bench('open+read+close', () => {
    const fd = openSync(h.request, '/file.bin', 'r');
    readSync(h.request, fd, buf, 0, 4096, 0);
    closeSync(h.request, fd);
  });
  bench('open+write+close', () => {
    const fd = openSync(h.request, '/fd.bin', 'w');
    writeSyncFd(h.request, fd, BYTES4K, 0, BYTES4K.byteLength, 0);
    closeSync(h.request, fd);
  });
});

describe('tree mutation', () => {
  const h = createHarness();
  let n = 0;
  bench('mkdir', () => { mkdirSync(h.request, `/d${n++}`); });
  bench('truncate', () => { writeFileSync(h.request, '/t', BYTES4K); truncateSync(h.request, '/t', 128); });
});
