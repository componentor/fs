/**
 * Tier 1 Benchmark Worker
 * Runs sync file operations using SharedArrayBuffer + Atomics in a Worker context
 */

let fs = null;

self.postMessage({ type: 'log', message: 'Worker script loaded' });

self.onmessage = async (event) => {
  const { type, iterations, fileSize, data } = event.data;
  self.postMessage({ type: 'log', message: 'Received: ' + type });

  if (type === 'init') {
    try {
      self.postMessage({ type: 'log', message: 'Importing module...' });
      const module = await import('/index.js');
      self.postMessage({ type: 'log', message: 'Module imported' });

      fs = module.fs;
      self.postMessage({ type: 'log', message: 'Got fs: ' + !!fs });

      // Verify OPFS access
      const root = await navigator.storage.getDirectory();
      self.postMessage({ type: 'log', message: 'Got OPFS root: ' + !!root });

      // Initialize sync kernel with URL to kernel.js
      self.postMessage({ type: 'log', message: 'Calling initSync(/kernel.js)...' });
      await fs.initSync('/kernel.js');
      self.postMessage({ type: 'log', message: 'initSync done - Tier 1 ready!' });

      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', error: e.message + '\n' + e.stack });
    }
    return;
  }

  if (type === 'benchmark-write') {
    try {
      self.postMessage({ type: 'log', message: 'Creating benchmark directory...' });
      fs.mkdirSync('/bench-t1', { recursive: true });
      self.postMessage({ type: 'log', message: 'Directory created, starting benchmark...' });

      // Use flush: false for fair comparison with LightningFS (which also doesn't flush per-write)
      // Flush once at the end to ensure data is persisted
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        fs.writeFileSync('/bench-t1/write-' + i + '.bin', data, { flush: false });
      }
      fs.flushSync(); // Flush all at once
      const elapsed = performance.now() - start;
      self.postMessage({ type: 'log', message: 'Benchmark done, cleaning up...' });

      fs.rmSync('/bench-t1', { recursive: true, force: true });
      self.postMessage({ type: 'result', elapsed });
    } catch (e) {
      const errMsg = e ? (e.message || e.toString()) : 'Unknown error';
      const errStack = e && e.stack ? e.stack : '';
      self.postMessage({ type: 'error', error: errMsg + '\n' + errStack });
    }
    return;
  }

  if (type === 'benchmark-read') {
    try {
      self.postMessage({ type: 'log', message: 'Creating benchmark directory for read...' });
      fs.mkdirSync('/bench-t1-read', { recursive: true });

      self.postMessage({ type: 'log', message: 'Writing test files...' });
      for (let i = 0; i < iterations; i++) {
        fs.writeFileSync('/bench-t1-read/read-' + i + '.bin', data, { flush: false });
      }
      fs.flushSync(); // Ensure files are written before reading

      self.postMessage({ type: 'log', message: 'Starting read benchmark...' });
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        fs.readFileSync('/bench-t1-read/read-' + i + '.bin');
      }
      const elapsed = performance.now() - start;
      self.postMessage({ type: 'log', message: 'Read benchmark done, cleaning up...' });

      fs.rmSync('/bench-t1-read', { recursive: true, force: true });
      self.postMessage({ type: 'result', elapsed });
    } catch (e) {
      const errMsg = e ? (e.message || e.toString()) : 'Unknown error';
      const errStack = e && e.stack ? e.stack : '';
      self.postMessage({ type: 'error', error: errMsg + '\n' + errStack });
    }
    return;
  }

  // Batch write - many small files with flush: false, then single flush at end
  if (type === 'benchmark-batch-write') {
    try {
      self.postMessage({ type: 'log', message: 'Creating batch benchmark directory...' });
      fs.mkdirSync('/bench-batch-t1', { recursive: true });
      self.postMessage({ type: 'log', message: 'Starting batch write benchmark...' });

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        fs.writeFileSync('/bench-batch-t1/batch-' + i + '.bin', data, { flush: false });
      }
      fs.flushSync(); // Single flush at end
      const elapsed = performance.now() - start;
      self.postMessage({ type: 'log', message: 'Batch write done, cleaning up...' });

      fs.rmSync('/bench-batch-t1', { recursive: true, force: true });
      self.postMessage({ type: 'result', elapsed });
    } catch (e) {
      const errMsg = e ? (e.message || e.toString()) : 'Unknown error';
      const errStack = e && e.stack ? e.stack : '';
      self.postMessage({ type: 'error', error: errMsg + '\n' + errStack });
    }
    return;
  }

  // Batch read - many small files
  if (type === 'benchmark-batch-read') {
    try {
      self.postMessage({ type: 'log', message: 'Creating batch read benchmark directory...' });
      fs.mkdirSync('/bench-batch-t1-read', { recursive: true });

      self.postMessage({ type: 'log', message: 'Writing batch test files...' });
      for (let i = 0; i < iterations; i++) {
        fs.writeFileSync('/bench-batch-t1-read/batch-' + i + '.bin', data, { flush: false });
      }
      fs.flushSync(); // Ensure files are written before reading

      self.postMessage({ type: 'log', message: 'Starting batch read benchmark...' });
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        fs.readFileSync('/bench-batch-t1-read/batch-' + i + '.bin');
      }
      const elapsed = performance.now() - start;
      self.postMessage({ type: 'log', message: 'Batch read done, cleaning up...' });

      fs.rmSync('/bench-batch-t1-read', { recursive: true, force: true });
      self.postMessage({ type: 'result', elapsed });
    } catch (e) {
      const errMsg = e ? (e.message || e.toString()) : 'Unknown error';
      const errStack = e && e.stack ? e.stack : '';
      self.postMessage({ type: 'error', error: errMsg + '\n' + errStack });
    }
    return;
  }
};
