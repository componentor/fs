import type { WatchOptions, WatchEventType, FSWatcher, WatchListener, WatchFileListener, WatchFileOptions } from '../types.js';
import type { AsyncRequestFn } from './context.js';
import { stat } from './stat.js';
import * as path from '../path.js';

export function watch(
  _filePath: string,
  _options?: WatchOptions | string,
  _listener?: WatchListener
): FSWatcher {
  const interval = setInterval(() => {
    // Polling-based watch placeholder
  }, 1000);

  const watcher: FSWatcher = {
    close: () => clearInterval(interval),
    ref: () => watcher,
    unref: () => watcher,
  };

  return watcher;
}

export function watchFile(
  _filePath: string,
  _optionsOrListener?: WatchFileOptions | WatchFileListener,
  _listener?: WatchFileListener
): void {
  // Stat polling placeholder
}

export function unwatchFile(
  _filePath: string,
  _listener?: WatchFileListener
): void {
  // Clear stat polling placeholder
}

export async function* watchAsync(
  asyncRequest: AsyncRequestFn,
  filePath: string,
  options?: WatchOptions
): AsyncIterable<WatchEventType> {
  let lastMtime = 0;
  const signal = options?.signal;

  while (!signal?.aborted) {
    try {
      const s = await stat(asyncRequest, filePath);
      if (s.mtimeMs !== lastMtime) {
        if (lastMtime !== 0) {
          yield { eventType: 'change', filename: path.basename(filePath) };
        }
        lastMtime = s.mtimeMs;
      }
    } catch {
      yield { eventType: 'rename', filename: path.basename(filePath) };
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }
}
