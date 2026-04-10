import type { GlobOptions } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { readdirSync, readdir } from './readdir.js';
import { statSync, stat } from './stat.js';

/**
 * Convert a glob segment pattern to a RegExp.
 * Supports: * (any non-/ chars), ? (single char), literal chars.
 */
function segmentToRegex(pattern: string): RegExp {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re);
}

function matchSegment(name: string, pattern: string): boolean {
  return segmentToRegex(pattern).test(name);
}

function joinPath(base: string, name: string): string {
  if (base === '/') return '/' + name;
  return base + '/' + name;
}

export function globSync(
  syncRequest: SyncRequestFn,
  pattern: string,
  options?: GlobOptions,
): string[] {
  const cwd = options?.cwd ?? '/';
  const exclude = options?.exclude;

  const segments = pattern.split('/').filter((s) => s !== '');
  const results: string[] = [];

  function walk(dir: string, segIdx: number): void {
    if (segIdx >= segments.length) return;

    const seg = segments[segIdx];
    const isLast = segIdx === segments.length - 1;

    if (seg === '**') {
      // Match zero or more path segments.
      // Try skipping ** (match zero segments) — continue with next segment in same dir
      if (segIdx + 1 < segments.length) {
        walk(dir, segIdx + 1);
      }

      // Recurse into all subdirectories with ** still active
      let entries: string[];
      try {
        entries = readdirSync(syncRequest, dir) as string[];
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = joinPath(dir, entry);
        if (exclude && exclude(full)) continue;

        let isDir: boolean;
        try {
          const s = statSync(syncRequest, full);
          isDir = s.isDirectory();
        } catch {
          continue;
        }

        if (isDir) {
          // Recurse with ** still at same segIdx
          walk(full, segIdx);
        }

        // If this is the last segment after **, match the entry against nothing (** matches it)
        if (isLast) {
          results.push(full);
        }
      }
      return;
    }

    // Normal segment (may contain * or ? wildcards)
    let entries: string[];
    try {
      entries = readdirSync(syncRequest, dir) as string[];
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!matchSegment(entry, seg)) continue;
      const full = joinPath(dir, entry);
      if (exclude && exclude(full)) continue;

      if (isLast) {
        results.push(full);
      } else {
        // Must be a directory to continue matching deeper segments
        let isDir: boolean;
        try {
          const s = statSync(syncRequest, full);
          isDir = s.isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          walk(full, segIdx + 1);
        }
      }
    }
  }

  walk(cwd, 0);
  return results;
}

export async function glob(
  asyncRequest: AsyncRequestFn,
  pattern: string,
  options?: GlobOptions,
): Promise<string[]> {
  const cwd = options?.cwd ?? '/';
  const exclude = options?.exclude;

  const segments = pattern.split('/').filter((s) => s !== '');
  const results: string[] = [];

  async function walk(dir: string, segIdx: number): Promise<void> {
    if (segIdx >= segments.length) return;

    const seg = segments[segIdx];
    const isLast = segIdx === segments.length - 1;

    if (seg === '**') {
      // Try skipping ** (match zero segments)
      if (segIdx + 1 < segments.length) {
        await walk(dir, segIdx + 1);
      }

      let entries: string[];
      try {
        entries = (await readdir(asyncRequest, dir)) as string[];
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = joinPath(dir, entry);
        if (exclude && exclude(full)) continue;

        let isDir: boolean;
        try {
          const s = await stat(asyncRequest, full);
          isDir = s.isDirectory();
        } catch {
          continue;
        }

        if (isDir) {
          await walk(full, segIdx);
        }

        if (isLast) {
          results.push(full);
        }
      }
      return;
    }

    let entries: string[];
    try {
      entries = (await readdir(asyncRequest, dir)) as string[];
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!matchSegment(entry, seg)) continue;
      const full = joinPath(dir, entry);
      if (exclude && exclude(full)) continue;

      if (isLast) {
        results.push(full);
      } else {
        let isDir: boolean;
        try {
          const s = await stat(asyncRequest, full);
          isDir = s.isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          await walk(full, segIdx + 1);
        }
      }
    }
  }

  await walk(cwd, 0);
  return results;
}
