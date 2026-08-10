/**
 * Every operation the browser UI can ask for, against whichever host owns the filesystem.
 *
 * The page and the worker run the same code — the only difference is where the synchronous wait
 * happens. Keeping one implementation is what makes "same demo, different host" an honest claim
 * rather than two things that merely look alike.
 */

import { runBench } from './bench.js';

const join = (dir, name) => (dir === '/' ? '' : dir) + '/' + name;

export function createOps(fs) {
  const ops = {
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
