/**
 * The promise API's per-call overhead.
 *
 * Two changes land on this path and both need measuring rather than assuming:
 *
 *   • every `VFSPromises` method became `async`, so node's reject-don't-throw contract holds for
 *     bad arguments. That adds a microtask per call, which has to be noise next to the work;
 *   • `FileHandle.appendFile` stopped issuing an `fstat` to locate end-of-file, halving its
 *     round trips. In this harness a round trip is cheap, so the gain here is a *floor* — in a
 *     browser, where each one crosses a worker boundary, it is worth far more.
 */

import { bench, describe } from 'vitest';
import { createFsHarness } from './helpers/engine-transport.js';

const { fs } = createFsHarness();
fs.mkdirSync('/b');
fs.writeFileSync('/b/f', 'x'.repeat(4096));
fs.writeFileSync('/b/a', '');

describe('promise API overhead', () => {
  bench('promises.stat', async () => { await fs.promises.stat('/b/f'); });
  bench('promises.readFile 4KB', async () => { await fs.promises.readFile('/b/f'); });
  bench('promises.access', async () => { await fs.promises.access('/b/f'); });
});

describe('FileHandle append path', () => {
  bench('handle.appendFile 64B', async () => {
    const h = await fs.promises.open('/b/a', 'a');
    try { await h.appendFile('y'.repeat(64)); } finally { await h.close(); }
  });

  bench('handle.write 64B (reference)', async () => {
    const h = await fs.promises.open('/b/a', 'a');
    try { await h.write(new Uint8Array(64), 0, 64, null); } finally { await h.close(); }
  });

  bench('handle.stat + write — what appendFile used to do', async () => {
    // An exact reproduction of the removed implementation, so the saving is measured against
    // the real thing rather than estimated.
    const h = await fs.promises.open('/b/a', 'a');
    try {
      const st = await h.stat();
      await h.write(new Uint8Array(64), 0, 64, st.size);
    } finally { await h.close(); }
  });
});

describe('cost of the async wrapper itself', () => {
  // Marking the promise methods `async` is what makes a bad argument reject instead of throw.
  // It costs one extra microtask per call. Measured in isolation rather than against the real
  // methods, because the two forms cannot both exist on the class at once — the pair below is
  // exactly the transformation that was applied, with the body held constant.
  const work = () => Promise.resolve(1);
  const plain = (): Promise<number> => work();
  const wrapped = async (): Promise<number> => work();

  bench('plain: return work()', async () => { await plain(); });
  bench('async: return work()  ← what the promise methods now do', async () => { await wrapped(); });

  // For scale: a single real filesystem call in this harness, which is the cheapest possible
  // transport (no worker, no postMessage). Anything in a browser is far slower than this.
  bench('one real promises.stat, for scale', async () => { await fs.promises.stat('/b/f'); });
});
