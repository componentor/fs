/**
 * One benchmark routine, run from either host.
 *
 * The page and the worker both measure the same synchronous API, and the only interesting
 * difference between them is *where the wait happens* — a real `Atomics.wait` in a worker, a
 * busy-spin on a page's main thread. That comparison is only worth anything if both sides run
 * byte-for-byte the same operations, so the routine lives here rather than being written twice.
 */

/** Timed operations, in the order they run. Mutations first, so reads measure a populated volume. */
export function runBench(fs) {
  fs.mkdirSync('/.bench', { recursive: true });
  const body = 'x'.repeat(1024);
  const time = (label, n, fn) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) fn(i);
    const per = (performance.now() - t0) / n;
    return { label, per, ops: Math.round(1000 / per) };
  };

  const rows = [];
  rows.push(time('writeFileSync 1KB (create)', 150, (n) => fs.writeFileSync(`/.bench/c${n}.txt`, body)));
  fs.writeFileSync('/.bench/fixed.txt', body);
  rows.push(time('writeFileSync 1KB (overwrite)', 200, () => fs.writeFileSync('/.bench/fixed.txt', body)));
  rows.push(time('readFileSync 1KB', 400, () => fs.readFileSync('/.bench/fixed.txt')));
  rows.push(time('statSync', 800, () => fs.statSync('/.bench/fixed.txt')));
  rows.push(time('existsSync', 800, () => fs.existsSync('/.bench/fixed.txt')));
  rows.push(time('readdirSync (150 entries)', 60, () => fs.readdirSync('/.bench')));
  let i = 0;
  rows.push(time('unlinkSync', 140, () => fs.unlinkSync(`/.bench/c${i++}.txt`)));

  fs.rmSync('/.bench', { recursive: true, force: true });
  return rows;
}
