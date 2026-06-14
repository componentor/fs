/**
 * Shared benchmark logic — runs identically on the main thread OR inside a
 * worker. The page (index.html) uses it directly for main-thread mode; a
 * worker (benchmark-worker.js) uses it for worker-hosted mode, which is what
 * makes the benchmark work in multi-tab Safari (follower tabs).
 *
 * Parameterized via `ctx`:
 *   ctx.log(msg, level)  — log sink (DOM logger on main, postMessage in worker)
 *   ctx.flush            — flush-mode checkbox value
 *   ctx.debug            — debug-mode checkbox value
 *   ctx.opfsSync         — opfs-sync-mode checkbox value
 *   ctx.swBridge         — MessagePort to a main-thread SW bridge (worker mode
 *                          only; undefined on the main thread)
 *
 * The body below is the byte-identical benchmark code lifted from the page,
 * with only DOM config reads replaced by `ctx.*` and `swBridge: ctx.swBridge`
 * added to the VFS constructor.
 */
export function createBenchmark(ctx) {
  const log = ctx.log;

    let LightningFS, git, http;
    let memfsModule = null; // { memfs } factory function
    let vfs = null;
    let vfsReady = false;

    // Small test repo URL - using GitHub's official example repository
    // This is tiny (just a README) and guaranteed to be public
    const TEST_REPO_URL = 'https://github.com/octocat/Hello-World';
    const CORS_PROXY = 'https://cors.isomorphic-git.org';
    // Note: CORS proxy is required for browser-based git operations

    async function init() {
      log('Loading LightningFS...', 'info');
      const lfsModule = await import('https://esm.sh/@isomorphic-git/lightning-fs@4.6.0');
      LightningFS = lfsModule.default;
      log('LightningFS loaded', 'success');

      log('Loading isomorphic-git...', 'info');
      const gitModule = await import('https://esm.sh/isomorphic-git@1.27.1');
      git = gitModule.default;
      http = (await import('https://esm.sh/isomorphic-git@1.27.1/http/web')).default;
      log('isomorphic-git loaded', 'success');

      log('Loading memfs...', 'info');
      try {
        const mod = await import('https://esm.sh/memfs@4');
        console.log('[memfs] exports:', Object.keys(mod));
        // memfs v4 export structure varies — detect the right factory
        if (typeof mod.memfs === 'function') {
          memfsModule = { create: () => mod.memfs().fs };
        } else if (typeof mod.Volume === 'function') {
          memfsModule = { create: () => mod.createFsFromVolume(new mod.Volume()) };
        } else if (typeof mod.default?.memfs === 'function') {
          memfsModule = { create: () => mod.default.memfs().fs };
        } else if (typeof mod.default?.Volume === 'function') {
          memfsModule = { create: () => mod.default.createFsFromVolume(new mod.default.Volume()) };
        } else {
          throw new Error('Could not find memfs factory — exports: ' + Object.keys(mod).join(', '));
        }
        log('memfs loaded', 'success');
      } catch (e) {
        log('memfs failed to load: ' + e.message, 'error');
      }

      // Clean corrupted VFS binaries from OPFS before init
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        // Clean root-level VFS files
        for await (const [name] of opfsRoot.entries()) {
          if (name.startsWith('.vfs')) {
            await opfsRoot.removeEntry(name);
            log(`Removed stale OPFS file: ${name}`, 'info');
          }
        }
        // Clean VFS binary inside vfs-bench subdir
        try {
          const vfsBenchDir = await opfsRoot.getDirectoryHandle('vfs-bench');
          await vfsBenchDir.removeEntry('.vfs.bin');
          log('Removed stale OPFS file: vfs-bench/.vfs.bin', 'info');
        } catch (e) {} // dir or file doesn't exist — fine
      } catch (e) {}

      // Initialize VFS — works with or without crossOriginIsolated
      // Sync API requires crossOriginIsolated (SAB); Promises API works in both modes via MessagePort fallback
      {
        const debugMode = ctx.debug;
        const opfsSyncMode = ctx.opfsSync;
        log(`Initializing VFS${debugMode ? ' (debug mode)' : ''}${opfsSyncMode ? ' (OPFS sync)' : ''}${!crossOriginIsolated ? ' (promises only — no COEP)' : ''}...`, 'info');
        try {
          const vfsModule = await import('/index.js');
          vfs = new vfsModule.VFSFileSystem({ root: '/vfs-bench', debug: debugMode, opfsSync: opfsSyncMode, swBridge: ctx.swBridge });
          await Promise.race([
            vfs.init(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('VFS init timeout (10s) - check browser console for [VFS] Sync-relay init failed')), 10000))
          ]);
          // Clean up stale state from previous benchmark runs
          const vfsDirs = ['/bench-vfs', '/bench-vfs-p', '/bench-vfs-read', '/bench-vfs-read-p',
            '/bench-vfs-large', '/bench-vfs-large-p', '/bench-vfs-batch', '/bench-vfs-batch-p',
            '/bench-vfs-batch-read', '/bench-vfs-batch-read-p', '/git-bench-vfs', '/git-status-vfs'];
          for (const d of vfsDirs) {
            try { await vfs.promises.rm(d, { recursive: true, force: true }); } catch {}
          }
          vfsReady = true;
          log('VFS ready' + (!crossOriginIsolated ? ' (promises only)' : ''), 'success');
        } catch (e) {
          log('VFS init failed: ' + e.message, 'error');
        }
      }
    }

    // Create fs wrapper for isomorphic-git (expects specific format)
    // Converts errors to Node.js-style errors that isomorphic-git expects
    function createGitFs(fsInstance) {
      // Helper to convert errors to Node.js format
      const wrapError = (err, method, args) => {
        if (err.code !== 'ENOENT' && err.name !== 'NotFoundError' &&
            err.code !== 'ENOTDIR' && err.name !== 'TypeMismatchError') {
          console.log(`[git-fs] ${method} error:`, err, 'args:', args);
        }
        if (err.name === 'NotFoundError' || err.code === 'ENOENT') {
          const e = new Error(err.message || 'ENOENT: no such file or directory');
          e.code = 'ENOENT';
          return e;
        }
        if (err.name === 'NotAllowedError' || err.code === 'EACCES') {
          const e = new Error(err.message || 'EACCES: permission denied');
          e.code = 'EACCES';
          return e;
        }
        if (err.name === 'TypeMismatchError' || err.code === 'ENOTDIR') {
          const e = new Error(err.message || 'ENOTDIR: not a directory');
          e.code = 'ENOTDIR';
          return e;
        }
        if (err.code) {
          const e = new Error(err.message);
          e.code = err.code;
          return e;
        }
        return err;
      };

      const wrap = (fn, name) => async (...args) => {
        try {
          return await fn(...args);
        } catch (err) {
          throw wrapError(err, name, args);
        }
      };

      return {
        promises: {
          readFile: wrap(async (filepath, options) => {
            return await fsInstance.promises.readFile(filepath, options);
          }, 'readFile'),
          writeFile: wrap((filepath, data, options) => fsInstance.promises.writeFile(filepath, data, options), 'writeFile'),
          unlink: wrap((filepath) => fsInstance.promises.unlink(filepath), 'unlink'),
          readdir: wrap((filepath, options) => fsInstance.promises.readdir(filepath, options), 'readdir'),
          mkdir: wrap((filepath, options) => fsInstance.promises.mkdir(filepath, options), 'mkdir'),
          rmdir: wrap((filepath, options) => fsInstance.promises.rmdir(filepath, options), 'rmdir'),
          stat: wrap(async (filepath) => {
            const stat = await fsInstance.promises.stat(filepath);
            return {
              ...stat,
              isFile: () => stat.isFile ? stat.isFile() : stat.type === 'file',
              isDirectory: () => stat.isDirectory ? stat.isDirectory() : stat.type === 'directory',
              isSymbolicLink: () => false,
              mode: stat.mode || 0o100644,
              size: stat.size || 0,
              mtimeMs: stat.mtimeMs || Date.now(),
            };
          }, 'stat'),
          lstat: wrap(async (filepath) => {
            const stat = await fsInstance.promises.stat(filepath);
            return {
              ...stat,
              isFile: () => stat.isFile ? stat.isFile() : stat.type === 'file',
              isDirectory: () => stat.isDirectory ? stat.isDirectory() : stat.type === 'directory',
              isSymbolicLink: () => false,
              mode: stat.mode || 0o100644,
              size: stat.size || 0,
              mtimeMs: stat.mtimeMs || Date.now(),
            };
          }, 'lstat'),
          readlink: async () => {
            const e = new Error('ENOENT: readlink not supported');
            e.code = 'ENOENT';
            throw e;
          },
          symlink: async () => {
            const e = new Error('ENOENT: symlink not supported');
            e.code = 'ENOENT';
            throw e;
          },
          chmod: async () => { /* no-op */ },
        },
      };
    }

    // Per-operation stats helper
    function computeStats(times) {
      if (!times || times.length === 0) return null;
      const sorted = [...times].sort((a, b) => a - b);
      const n = sorted.length;
      return {
        avg: sorted.reduce((a, b) => a + b, 0) / n,
        min: sorted[0],
        max: sorted[n - 1],
        p50: sorted[Math.floor(n * 0.5)],
        p95: sorted[Math.floor(n * 0.95)],
      };
    }

    // Benchmark functions
    async function benchmarkWrite(iterations = 100, fileSize = 1024) {
      const data = new Uint8Array(fileSize).fill(65);
      const results = { perOp: {} };
      const flushMode = ctx.flush;
      const flushOpt = flushMode ? { flush: true } : undefined;

      // LightningFS
      const lfs = new LightningFS(`bench-write-${Date.now()}`);
      log(`Testing LightningFS write (${iterations} x ${fileSize} bytes)...`, 'info');
      const lTimes = [];
      for (let i = 0; i < iterations; i++) {
        const t = performance.now();
        await lfs.promises.writeFile(`/write-${i}.bin`, data);
        lTimes.push(performance.now() - t);
      }
      results.lightning = lTimes.reduce((a, b) => a + b, 0);
      results.perOp.lightning = computeStats(lTimes);
      log(`LightningFS: ${results.lightning.toFixed(2)}ms (avg ${results.perOp.lightning.avg.toFixed(3)}ms/op)`, 'success');

      // memfs (in-memory)
      if (memfsModule) {
        log(`Testing memfs write (${iterations} x ${fileSize} bytes)...`, 'info');
        const mfs = memfsModule.create();
        const mTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          mfs.writeFileSync(`/write-${i}.bin`, data);
          mTimes.push(performance.now() - t);
        }
        results.memfs = mTimes.reduce((a, b) => a + b, 0);
        results.perOp.memfs = computeStats(mTimes);
        log(`memfs: ${results.memfs.toFixed(2)}ms (avg ${results.perOp.memfs.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.memfs = null;
      }

      // VFS Sync (SAB + Atomics.wait) — requires crossOriginIsolated
      if (vfsReady && crossOriginIsolated) {
        log(`Testing VFS Sync write (${iterations} x ${fileSize} bytes)${flushMode ? ' [flush]' : ''}...`, 'info');
        vfs.mkdirSync('/bench-vfs', { recursive: true });
        const vsTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          vfs.writeFileSync(`/bench-vfs/write-${i}.bin`, data, flushOpt);
          vsTimes.push(performance.now() - t);
        }
        results.vfsSync = vsTimes.reduce((a, b) => a + b, 0);
        results.perOp.vfsSync = computeStats(vsTimes);
        vfs.rmSync('/bench-vfs', { recursive: true, force: true });
        log(`VFS Sync: ${results.vfsSync.toFixed(2)}ms (avg ${results.perOp.vfsSync.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.vfsSync = null;
      }

      // VFS Promises (async relay)
      if (vfsReady) {
        log(`Testing VFS Promises write (${iterations} x ${fileSize} bytes)${flushMode ? ' [flush]' : ''}...`, 'info');
        await vfs.promises.mkdir('/bench-vfs-p', { recursive: true });
        const vpTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          await vfs.promises.writeFile(`/bench-vfs-p/write-${i}.bin`, data, flushOpt);
          vpTimes.push(performance.now() - t);
        }
        results.vfsPromises = vpTimes.reduce((a, b) => a + b, 0);
        results.perOp.vfsPromises = computeStats(vpTimes);
        await vfs.promises.rm('/bench-vfs-p', { recursive: true, force: true });
        log(`VFS Promises: ${results.vfsPromises.toFixed(2)}ms (avg ${results.perOp.vfsPromises.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.vfsPromises = null;
      }

      return { ...results, iterations, fileSize, operation: 'write' };
    }

    async function benchmarkRead(iterations = 100, fileSize = 1024) {
      const data = new Uint8Array(fileSize).fill(65);
      const results = { perOp: {} };

      // Setup files for LightningFS
      const lfs = new LightningFS(`bench-read-${Date.now()}`);
      for (let i = 0; i < iterations; i++) {
        await lfs.promises.writeFile(`/read-${i}.bin`, data);
      }

      // LightningFS
      log(`Testing LightningFS read (${iterations} x ${fileSize} bytes)...`, 'info');
      const lTimes = [];
      for (let i = 0; i < iterations; i++) {
        const t = performance.now();
        await lfs.promises.readFile(`/read-${i}.bin`);
        lTimes.push(performance.now() - t);
      }
      results.lightning = lTimes.reduce((a, b) => a + b, 0);
      results.perOp.lightning = computeStats(lTimes);
      log(`LightningFS: ${results.lightning.toFixed(2)}ms (avg ${results.perOp.lightning.avg.toFixed(3)}ms/op)`, 'success');

      // memfs (in-memory)
      if (memfsModule) {
        log(`Testing memfs read (${iterations} x ${fileSize} bytes)...`, 'info');
        const mfs = memfsModule.create();
        for (let i = 0; i < iterations; i++) {
          mfs.writeFileSync(`/read-${i}.bin`, data);
        }
        const mTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          mfs.readFileSync(`/read-${i}.bin`);
          mTimes.push(performance.now() - t);
        }
        results.memfs = mTimes.reduce((a, b) => a + b, 0);
        results.perOp.memfs = computeStats(mTimes);
        log(`memfs: ${results.memfs.toFixed(2)}ms (avg ${results.perOp.memfs.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.memfs = null;
      }

      // VFS Sync (SAB + Atomics.wait) — requires crossOriginIsolated
      if (vfsReady && crossOriginIsolated) {
        log(`Testing VFS Sync read (${iterations} x ${fileSize} bytes)...`, 'info');
        vfs.mkdirSync('/bench-vfs-read', { recursive: true });
        for (let i = 0; i < iterations; i++) {
          vfs.writeFileSync(`/bench-vfs-read/read-${i}.bin`, data);
        }
        const vsTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          vfs.readFileSync(`/bench-vfs-read/read-${i}.bin`);
          vsTimes.push(performance.now() - t);
        }
        results.vfsSync = vsTimes.reduce((a, b) => a + b, 0);
        results.perOp.vfsSync = computeStats(vsTimes);
        vfs.rmSync('/bench-vfs-read', { recursive: true, force: true });
        log(`VFS Sync: ${results.vfsSync.toFixed(2)}ms (avg ${results.perOp.vfsSync.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.vfsSync = null;
      }

      // VFS Promises (async relay)
      if (vfsReady) {
        log(`Testing VFS Promises read (${iterations} x ${fileSize} bytes)...`, 'info');
        await vfs.promises.mkdir('/bench-vfs-read-p', { recursive: true });
        for (let i = 0; i < iterations; i++) {
          await vfs.promises.writeFile(`/bench-vfs-read-p/read-${i}.bin`, data);
        }
        const vpTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          await vfs.promises.readFile(`/bench-vfs-read-p/read-${i}.bin`);
          vpTimes.push(performance.now() - t);
        }
        results.vfsPromises = vpTimes.reduce((a, b) => a + b, 0);
        results.perOp.vfsPromises = computeStats(vpTimes);
        await vfs.promises.rm('/bench-vfs-read-p', { recursive: true, force: true });
        log(`VFS Promises: ${results.vfsPromises.toFixed(2)}ms (avg ${results.perOp.vfsPromises.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.vfsPromises = null;
      }

      return { ...results, iterations, fileSize, operation: 'read' };
    }

    async function benchmarkLargeFile(iterations = 10, fileSizeMB = 1) {
      const fileSize = fileSizeMB * 1024 * 1024;
      const data = new Uint8Array(fileSize).fill(65);
      const results = { perOp: {} };
      const flushMode = ctx.flush;
      const flushOpt = flushMode ? { flush: true } : undefined;

      // LightningFS
      const lfs = new LightningFS(`bench-large-${Date.now()}`);
      log(`Testing LightningFS large write (${iterations} x ${fileSizeMB}MB)...`, 'info');
      const lTimes = [];
      for (let i = 0; i < iterations; i++) {
        const t = performance.now();
        await lfs.promises.writeFile(`/large-${i}.bin`, data);
        lTimes.push(performance.now() - t);
      }
      results.lightning = lTimes.reduce((a, b) => a + b, 0);
      results.perOp.lightning = computeStats(lTimes);
      log(`LightningFS: ${results.lightning.toFixed(2)}ms (avg ${results.perOp.lightning.avg.toFixed(3)}ms/op)`, 'success');

      // memfs (in-memory)
      if (memfsModule) {
        log(`Testing memfs large write (${iterations} x ${fileSizeMB}MB)...`, 'info');
        const mfs = memfsModule.create();
        const mTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          mfs.writeFileSync(`/large-${i}.bin`, data);
          mTimes.push(performance.now() - t);
        }
        results.memfs = mTimes.reduce((a, b) => a + b, 0);
        results.perOp.memfs = computeStats(mTimes);
        log(`memfs: ${results.memfs.toFixed(2)}ms (avg ${results.perOp.memfs.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.memfs = null;
      }

      // VFS Sync (SAB + Atomics.wait) for large files — requires crossOriginIsolated
      if (vfsReady && crossOriginIsolated) {
        log(`Testing VFS Sync large write (${iterations} x ${fileSizeMB}MB)${flushMode ? ' [flush]' : ''}...`, 'info');
        vfs.mkdirSync('/bench-vfs-large', { recursive: true });
        const vsTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          vfs.writeFileSync(`/bench-vfs-large/large-${i}.bin`, data, flushOpt);
          vsTimes.push(performance.now() - t);
        }
        results.vfsSync = vsTimes.reduce((a, b) => a + b, 0);
        results.perOp.vfsSync = computeStats(vsTimes);
        vfs.rmSync('/bench-vfs-large', { recursive: true, force: true });
        log(`VFS Sync: ${results.vfsSync.toFixed(2)}ms (avg ${results.perOp.vfsSync.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.vfsSync = null;
      }

      // VFS Promises for large files
      if (vfsReady) {
        log(`Testing VFS Promises large write (${iterations} x ${fileSizeMB}MB)${flushMode ? ' [flush]' : ''}...`, 'info');
        await vfs.promises.mkdir('/bench-vfs-large-p', { recursive: true });
        const vpTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          await vfs.promises.writeFile(`/bench-vfs-large-p/large-${i}.bin`, data, flushOpt);
          vpTimes.push(performance.now() - t);
        }
        results.vfsPromises = vpTimes.reduce((a, b) => a + b, 0);
        results.perOp.vfsPromises = computeStats(vpTimes);
        await vfs.promises.rm('/bench-vfs-large-p', { recursive: true, force: true });
        log(`VFS Promises: ${results.vfsPromises.toFixed(2)}ms (avg ${results.perOp.vfsPromises.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.vfsPromises = null;
      }

      return { ...results, iterations, fileSize, fileSizeMB, operation: 'large-write' };
    }

    // Batch write - many small files, measuring batch throughput
    async function benchmarkBatchWrite(iterations = 500, fileSize = 256) {
      const data = new Uint8Array(fileSize).fill(65);
      const results = { perOp: {} };
      const flushMode = ctx.flush;
      const flushOpt = flushMode ? { flush: true } : undefined;

      // LightningFS
      const lfs = new LightningFS(`bench-batch-write-${Date.now()}`);
      log(`Testing LightningFS batch write (${iterations} x ${fileSize} bytes)...`, 'info');
      const lTimes = [];
      for (let i = 0; i < iterations; i++) {
        const t = performance.now();
        await lfs.promises.writeFile(`/batch-${i}.bin`, data);
        lTimes.push(performance.now() - t);
      }
      results.lightning = lTimes.reduce((a, b) => a + b, 0);
      results.perOp.lightning = computeStats(lTimes);
      log(`LightningFS: ${results.lightning.toFixed(2)}ms (avg ${results.perOp.lightning.avg.toFixed(3)}ms/op)`, 'success');

      // memfs (in-memory)
      if (memfsModule) {
        log(`Testing memfs batch write (${iterations} x ${fileSize} bytes)...`, 'info');
        const mfs = memfsModule.create();
        const mTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          mfs.writeFileSync(`/batch-${i}.bin`, data);
          mTimes.push(performance.now() - t);
        }
        results.memfs = mTimes.reduce((a, b) => a + b, 0);
        results.perOp.memfs = computeStats(mTimes);
        log(`memfs: ${results.memfs.toFixed(2)}ms (avg ${results.perOp.memfs.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.memfs = null;
      }

      // VFS Sync batch write — requires crossOriginIsolated
      if (vfsReady && crossOriginIsolated) {
        log(`Testing VFS Sync batch write (${iterations} x ${fileSize} bytes)${flushMode ? ' [flush]' : ''}...`, 'info');
        vfs.mkdirSync('/bench-vfs-batch', { recursive: true });
        const vsTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          vfs.writeFileSync(`/bench-vfs-batch/batch-${i}.bin`, data, flushOpt);
          vsTimes.push(performance.now() - t);
        }
        results.vfsSync = vsTimes.reduce((a, b) => a + b, 0);
        results.perOp.vfsSync = computeStats(vsTimes);
        vfs.rmSync('/bench-vfs-batch', { recursive: true, force: true });
        log(`VFS Sync: ${results.vfsSync.toFixed(2)}ms (avg ${results.perOp.vfsSync.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.vfsSync = null;
      }

      // VFS Promises batch write
      if (vfsReady) {
        log(`Testing VFS Promises batch write (${iterations} x ${fileSize} bytes)${flushMode ? ' [flush]' : ''}...`, 'info');
        await vfs.promises.mkdir('/bench-vfs-batch-p', { recursive: true });
        const vpTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          await vfs.promises.writeFile(`/bench-vfs-batch-p/batch-${i}.bin`, data, flushOpt);
          vpTimes.push(performance.now() - t);
        }
        results.vfsPromises = vpTimes.reduce((a, b) => a + b, 0);
        results.perOp.vfsPromises = computeStats(vpTimes);
        await vfs.promises.rm('/bench-vfs-batch-p', { recursive: true, force: true });
        log(`VFS Promises: ${results.vfsPromises.toFixed(2)}ms (avg ${results.perOp.vfsPromises.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.vfsPromises = null;
      }

      return { ...results, iterations, fileSize, operation: 'batch-write' };
    }

    // Batch read - many small files, measuring batch throughput
    async function benchmarkBatchRead(iterations = 500, fileSize = 256) {
      const data = new Uint8Array(fileSize).fill(65);
      const results = { perOp: {} };

      // Setup files for LightningFS
      const lfs = new LightningFS(`bench-batch-read-${Date.now()}`);
      for (let i = 0; i < iterations; i++) {
        await lfs.promises.writeFile(`/batch-${i}.bin`, data);
      }

      // LightningFS
      log(`Testing LightningFS batch read (${iterations} x ${fileSize} bytes)...`, 'info');
      const lTimes = [];
      for (let i = 0; i < iterations; i++) {
        const t = performance.now();
        await lfs.promises.readFile(`/batch-${i}.bin`);
        lTimes.push(performance.now() - t);
      }
      results.lightning = lTimes.reduce((a, b) => a + b, 0);
      results.perOp.lightning = computeStats(lTimes);
      log(`LightningFS: ${results.lightning.toFixed(2)}ms (avg ${results.perOp.lightning.avg.toFixed(3)}ms/op)`, 'success');

      // memfs (in-memory)
      if (memfsModule) {
        log(`Testing memfs batch read (${iterations} x ${fileSize} bytes)...`, 'info');
        const mfs = memfsModule.create();
        for (let i = 0; i < iterations; i++) {
          mfs.writeFileSync(`/batch-${i}.bin`, data);
        }
        const mTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          mfs.readFileSync(`/batch-${i}.bin`);
          mTimes.push(performance.now() - t);
        }
        results.memfs = mTimes.reduce((a, b) => a + b, 0);
        results.perOp.memfs = computeStats(mTimes);
        log(`memfs: ${results.memfs.toFixed(2)}ms (avg ${results.perOp.memfs.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.memfs = null;
      }

      // VFS Sync batch read — requires crossOriginIsolated
      if (vfsReady && crossOriginIsolated) {
        log(`Testing VFS Sync batch read (${iterations} x ${fileSize} bytes)...`, 'info');
        vfs.mkdirSync('/bench-vfs-batch-read', { recursive: true });
        for (let i = 0; i < iterations; i++) {
          vfs.writeFileSync(`/bench-vfs-batch-read/batch-${i}.bin`, data);
        }
        const vsTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          vfs.readFileSync(`/bench-vfs-batch-read/batch-${i}.bin`);
          vsTimes.push(performance.now() - t);
        }
        results.vfsSync = vsTimes.reduce((a, b) => a + b, 0);
        results.perOp.vfsSync = computeStats(vsTimes);
        vfs.rmSync('/bench-vfs-batch-read', { recursive: true, force: true });
        log(`VFS Sync: ${results.vfsSync.toFixed(2)}ms (avg ${results.perOp.vfsSync.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.vfsSync = null;
      }

      // VFS Promises batch read
      if (vfsReady) {
        log(`Testing VFS Promises batch read (${iterations} x ${fileSize} bytes)...`, 'info');
        await vfs.promises.mkdir('/bench-vfs-batch-read-p', { recursive: true });
        for (let i = 0; i < iterations; i++) {
          await vfs.promises.writeFile(`/bench-vfs-batch-read-p/batch-${i}.bin`, data);
        }
        const vpTimes = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          await vfs.promises.readFile(`/bench-vfs-batch-read-p/batch-${i}.bin`);
          vpTimes.push(performance.now() - t);
        }
        results.vfsPromises = vpTimes.reduce((a, b) => a + b, 0);
        results.perOp.vfsPromises = computeStats(vpTimes);
        await vfs.promises.rm('/bench-vfs-batch-read-p', { recursive: true, force: true });
        log(`VFS Promises: ${results.vfsPromises.toFixed(2)}ms (avg ${results.perOp.vfsPromises.avg.toFixed(3)}ms/op)`, 'success');
      } else {
        results.vfsPromises = null;
      }

      return { ...results, iterations, fileSize, operation: 'batch-read' };
    }

    // Git Clone benchmark - clones a small repo
    async function benchmarkGitClone() {
      const results = {};
      const repoUrl = TEST_REPO_URL;
      const corsProxy = CORS_PROXY;

      // LightningFS
      log(`Testing LightningFS git clone (${repoUrl})...`, 'info');
      const lfs = new LightningFS(`git-clone-${Date.now()}`);
      const startL = performance.now();
      try {
        await git.clone({
          fs: lfs,
          http,
          dir: '/repo',
          url: repoUrl,
          corsProxy,
          singleBranch: true,
          depth: 1,
        });
        results.lightning = performance.now() - startL;
        log(`LightningFS: ${results.lightning.toFixed(2)}ms`, 'success');
      } catch (e) {
        log(`LightningFS git clone failed: ${e.message} (code: ${e.code})`, 'error');
        console.error('LightningFS clone error:', e);
        results.lightning = null;
      }

      // memfs git clone
      if (memfsModule) {
        log(`Testing memfs git clone...`, 'info');
        const mfs = memfsModule.create();
        const memGitFs = createGitFs({ promises: mfs.promises });
        const startM = performance.now();
        try {
          await git.clone({
            fs: memGitFs,
            http,
            dir: '/repo',
            url: repoUrl,
            corsProxy,
            singleBranch: true,
            depth: 1,
          });
          results.memfs = performance.now() - startM;
          log(`memfs: ${results.memfs.toFixed(2)}ms`, 'success');
        } catch (e) {
          log(`memfs git clone failed: ${e.message}`, 'error');
          results.memfs = null;
        }
      } else {
        results.memfs = null;
      }

      // VFS Sync not applicable (git requires async)
      results.vfsSync = null;

      // VFS Promises git clone
      if (vfsReady) {
        log(`Testing VFS Promises git clone...`, 'info');
        const vfsGitFs = createGitFs(vfs);
        try { await vfs.promises.rm('/git-bench-vfs', { recursive: true, force: true }); } catch {}
        await vfs.promises.mkdir('/git-bench-vfs', { recursive: true });
        const startVP = performance.now();
        try {
          await git.clone({
            fs: vfsGitFs,
            http,
            dir: '/git-bench-vfs',
            url: repoUrl,
            corsProxy,
            singleBranch: true,
            depth: 1,
            onMessage: (msg) => log(`[git VFS] ${msg}`, 'info'),
          });
          results.vfsPromises = performance.now() - startVP;
          log(`VFS Promises: ${results.vfsPromises.toFixed(2)}ms`, 'success');
        } catch (e) {
          log(`VFS Promises git clone failed: ${e.message}`, 'error');
          results.vfsPromises = null;
        }
        try { await vfs.promises.rm('/git-bench-vfs', { recursive: true, force: true }); } catch {}
      } else {
        results.vfsPromises = null;
      }

      return { ...results, iterations: 1, fileSize: 0, operation: 'git-clone' };
    }

    // Git Status benchmark - runs git status on a cloned repo multiple times
    async function benchmarkGitStatus(iterations = 10) {
      const results = {};
      const repoUrl = TEST_REPO_URL;
      const corsProxy = CORS_PROXY;

      // Setup: Clone repo for each fs
      log('Setting up repos for git status benchmark...', 'info');

      // LightningFS setup
      const lfs = new LightningFS(`git-status-${Date.now()}`);
      try {
        await git.clone({
          fs: lfs,
          http,
          dir: '/repo',
          url: repoUrl,
          corsProxy,
          singleBranch: true,
          depth: 1,
        });
      } catch (e) {
        log(`LightningFS clone for status failed: ${e.message}`, 'error');
        return { lightning: null, vfsSync: null, vfsPromises: null, iterations, fileSize: 0, operation: 'git-status' };
      }

      // LightningFS status benchmark
      log(`Testing LightningFS git status (${iterations}x)...`, 'info');
      const startL = performance.now();
      for (let i = 0; i < iterations; i++) {
        await git.statusMatrix({ fs: lfs, dir: '/repo' });
      }
      results.lightning = performance.now() - startL;
      log(`LightningFS: ${results.lightning.toFixed(2)}ms`, 'success');

      // memfs git status
      if (memfsModule) {
        const mfs = memfsModule.create();
        const memGitFs = createGitFs({ promises: mfs.promises });
        try {
          await git.clone({
            fs: memGitFs,
            http,
            dir: '/repo-status',
            url: repoUrl,
            corsProxy,
            singleBranch: true,
            depth: 1,
          });
          log(`Testing memfs git status (${iterations}x)...`, 'info');
          const startM = performance.now();
          for (let i = 0; i < iterations; i++) {
            await git.statusMatrix({ fs: memGitFs, dir: '/repo-status' });
          }
          results.memfs = performance.now() - startM;
          log(`memfs: ${results.memfs.toFixed(2)}ms`, 'success');
        } catch (e) {
          log(`memfs git status failed: ${e.message}`, 'error');
          results.memfs = null;
        }
      } else {
        results.memfs = null;
      }

      // VFS Sync not applicable (git requires async)
      results.vfsSync = null;

      // VFS Promises git status
      if (vfsReady) {
        const vfsGitFs = createGitFs(vfs);
        try { await vfs.promises.rm('/git-status-vfs', { recursive: true, force: true }); } catch {}
        await vfs.promises.mkdir('/git-status-vfs', { recursive: true });
        try {
          await git.clone({
            fs: vfsGitFs,
            http,
            dir: '/git-status-vfs',
            url: repoUrl,
            corsProxy,
            singleBranch: true,
            depth: 1,
          });
          log(`Testing VFS Promises git status (${iterations}x)...`, 'info');
          const startVP = performance.now();
          for (let i = 0; i < iterations; i++) {
            await git.statusMatrix({ fs: vfsGitFs, dir: '/git-status-vfs' });
          }
          results.vfsPromises = performance.now() - startVP;
          log(`VFS Promises: ${results.vfsPromises.toFixed(2)}ms`, 'success');
        } catch (e) {
          log(`VFS Promises git status failed: ${e.message}`, 'error');
          results.vfsPromises = null;
        }
        try { await vfs.promises.rm('/git-status-vfs', { recursive: true, force: true }); } catch {}
      } else {
        results.vfsPromises = null;
      }

      return { ...results, iterations, fileSize: 0, operation: 'git-status' };
    }


  // Dispatch a single benchmark by type (params match the page's buttons/runAll).
  async function run(type, a, b) {
    if (!LightningFS) await init();
    switch (type) {
      case 'write': return benchmarkWrite(a ?? 100, b ?? 1024);
      case 'read': return benchmarkRead(a ?? 100, b ?? 1024);
      case 'large': return benchmarkLargeFile(a ?? 10, b ?? 1);
      case 'batch-write': return benchmarkBatchWrite(a ?? 500, b ?? 256);
      case 'batch-read': return benchmarkBatchRead(a ?? 500, b ?? 256);
      case 'git-clone': return benchmarkGitClone();
      case 'git-status': return benchmarkGitStatus(a ?? 10);
      default: throw new Error('unknown benchmark type: ' + type);
    }
  }

  return { init, run };
}
