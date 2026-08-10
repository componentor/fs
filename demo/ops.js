/**
 * Every operation the browser UI can ask for, against whichever host owns the filesystem.
 *
 * The page and the worker run the same code — the only difference is where the synchronous wait
 * happens. Keeping one implementation is what makes "same demo, different host" an honest claim
 * rather than two things that merely look alike.
 */

import { runBench } from './bench.js';

const join = (dir, name) => (dir === '/' ? '' : dir) + '/' + name;

export function createOps(fs, emit = () => {}) {
  const ops = {
    /**
     * Clone a real repository with isomorphic-git, straight onto this filesystem.
     *
     * This is the claim the library exists to make, run end to end: isomorphic-git is written
     * against node's `fs` and knows nothing about OPFS. It is handed this instance unmodified —
     * same `promises` surface, same errors — and writes a working tree and a `.git` directory
     * that the file browser above then lists with `readdirSync` and `statSync`.
     *
     * `corsProxy` is not a workaround for this filesystem: a browser cannot fetch github.com's
     * git endpoints directly at all, whatever it stores the result in. isomorphic-git runs a
     * public proxy for exactly this, and that is what its own documentation uses.
     */
    async clone({ url, dir, depth, ref }) {
      const { git, http } = await import('./vendor-git.js');
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });

      const started = performance.now();
      await git.clone({
        fs,
        http,
        dir,
        url,
        ref: ref || undefined,
        corsProxy: 'https://cors.isomorphic-git.org',
        singleBranch: true,
        depth: depth ?? 1,
        onProgress: (p) => emit({ type: 'clone-progress', phase: p.phase, loaded: p.loaded, total: p.total }),
        onMessage: (message) => emit({ type: 'clone-message', message: String(message).trim() }),
      });
      const ms = performance.now() - started;

      // Read it back through the synchronous API — the point being that what git wrote is
      // immediately there, with no await between writing and seeing it.
      const entries = fs.readdirSync(dir);
      const log = await git.log({ fs, dir, depth: 1 });
      const head = log[0];
      return {
        ms,
        entries: entries.length,
        branch: await git.currentBranch({ fs, dir }) ?? 'HEAD',
        commit: head ? head.oid.slice(0, 8) : null,
        message: head ? head.commit.message.split('\n')[0].slice(0, 100) : null,
        author: head ? head.commit.author.name : null,
      };
    },

    list(path) {
      // `statSync` with no await, on the fast path — the thing the demo exists to show.
      return fs.readdirSync(path, { withFileTypes: true })
        .map((entry) => {
          const isDirectory = entry.isDirectory();
          return {
            name: entry.name,
            isDirectory,
            size: isDirectory ? null : fs.statSync(join(path, entry.name)).size,
          };
        })
        .sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name));
    },

    read(path) {
      const bytes = fs.readFileSync(path);
      return { size: bytes.length, head: new TextDecoder().decode(bytes.subarray(0, 2000)) };
    },

    remove(path) { fs.rmSync(path, { recursive: true, force: true }); },
    mkdir(path) { fs.mkdirSync(path, { recursive: true }); },

    write({ path, data, text }) {
      const parent = path.replace(/\/[^/]+$/, '') || '/';
      if (parent !== '/') fs.mkdirSync(parent, { recursive: true });
      fs.writeFileSync(path, data ? new Uint8Array(data) : text);
    },

    /** A batch import — one message for a whole dropped folder, rather than one per file. */
    importFiles(files) {
      for (const file of files) ops.write(file);
      return files.length;
    },

    seed(cwd) {
      fs.mkdirSync(join(cwd, 'src/components'), { recursive: true });
      fs.writeFileSync(join(cwd, 'src/index.js'), 'export * from "./components/button.js";\n');
      fs.writeFileSync(join(cwd, 'src/components/button.js'), 'export const Button = () => "click";\n');
      fs.writeFileSync(join(cwd, 'readme.md'), '# Sample tree\n\nCreated with mkdirSync + writeFileSync.\n');
    },

    wipe() { fs.rmSync('/', { recursive: true, force: true }); },

    ping() {
      const stamp = new Date().toLocaleTimeString();
      fs.writeFileSync('/tab-ping.txt', `written at ${stamp}\n`);
      return stamp;
    },

    /**
     * Timed in here on purpose: these are real `Atomics.wait` round trips, not a main-thread spin,
     * so the numbers are the sync path's actual cost on this machine and engine. The page can run
     * the same routine on its own main thread for comparison — see `runBench`.
     */
    bench() {
      return { rows: runBench(fs), isLeader: fs.isLeader };
    },
  };
  return ops;
}
