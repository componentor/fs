import type { GlobOptions, Dirent } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { readdirSync, readdir } from './readdir.js';
import { statSync, stat } from './stat.js';

// ============================================================================
// Glob pattern matching
//
// Supports the full Node.js `fs.glob` pattern grammar:
//   *          — any run of non-separator characters (including empty)
//   ?          — exactly one non-separator character
//   **         — any number of path segments
//   [abc]      — character class
//   [a-z]      — character range
//   [!abc]     — negated character class
//   \x         — literal x (escape)
//   {foo,bar}  — brace alternation (expanded to multiple patterns up-front)
//
// Brace expansion is handled by producing multiple flat patterns before any
// directory walking; the walker then matches each expanded pattern in turn.
// ============================================================================

/** Expand `{a,b}` alternations into a flat list of patterns. */
function expandBraces(pattern: string): string[] {
  const out: string[] = [];
  function recurse(prefix: string, rest: string): void {
    const open = findBrace(rest);
    if (open === -1) {
      out.push(prefix + rest);
      return;
    }
    const close = matchCloseBrace(rest, open);
    if (close === -1) {
      // Unbalanced brace — treat literally, continue past it
      out.push(prefix + rest);
      return;
    }
    const head = rest.slice(0, open);
    const body = rest.slice(open + 1, close);
    const tail = rest.slice(close + 1);
    for (const alt of splitAlternations(body)) {
      recurse(prefix + head + alt, tail);
    }
  }
  recurse('', pattern);
  return out;
}

/** Find the first unescaped `{`, skipping over character classes. */
function findBrace(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue }
    if (c === '[') {
      const end = s.indexOf(']', i + 1);
      if (end !== -1) { i = end; continue }
    }
    if (c === '{') return i;
  }
  return -1;
}

/** Find the matching `}` for an opening brace, respecting nesting. */
function matchCloseBrace(s: string, open: number): number {
  let depth = 1;
  for (let i = open + 1; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue }
    if (c === '[') {
      const end = s.indexOf(']', i + 1);
      if (end !== -1) { i = end; continue }
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split a brace body on top-level commas, honoring nested braces and escapes. */
function splitAlternations(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') { i++; continue }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * Compile a single glob path-segment into a RegExp. `pattern` is one segment
 * (no `/`) after brace expansion, so it only needs to handle `*`, `?`, `[...]`
 * and `\x` escapes.
 */
function segmentToRegex(pattern: string): RegExp {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      // Literal next char
      const next = pattern[++i];
      re += /[.+^${}()|[\]\\*?]/.test(next) ? '\\' + next : next;
    } else if (ch === '*') {
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '[') {
      // Character class: copy verbatim, translating `!` → `^` and passing
      // ranges through as-is. Escape only `]` which we need to find the end.
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) {
        // Unclosed class — treat as literal `[`
        re += '\\[';
      } else {
        let body = pattern.slice(i + 1, end);
        if (body.startsWith('!')) body = '^' + body.slice(1);
        re += '[' + body + ']';
        i = end;
      }
    } else if ('.+^${}()|\\'.includes(ch)) {
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

function normalizeCwd(cwd: string | URL | undefined): string {
  if (!cwd) return '/';
  if (typeof cwd === 'string') return cwd || '/';
  // URL — only file: supported
  return cwd.pathname || '/';
}

/** Build a Dirent from a file path + parent dir + stat. */
function makeDirent(parentPath: string, name: string, isDir: boolean, isSymlink: boolean): Dirent {
  return {
    name,
    parentPath,
    isFile: () => !isDir && !isSymlink,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => isSymlink,
    isFIFO: () => false,
    isSocket: () => false,
  } as Dirent;
}

// ============================================================================
// Sync
// ============================================================================

export function globSync(
  syncRequest: SyncRequestFn,
  pattern: string | string[],
  options?: GlobOptions,
): string[] | Dirent[] {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const cwd = normalizeCwd(options?.cwd);
  const exclude = options?.exclude as ((arg: string | Dirent) => boolean) | undefined;
  const withFileTypes = options?.withFileTypes === true;

  const resultsSet = new Set<string>(); // dedupe across expanded patterns
  const resultsDirents: Dirent[] = [];

  const pushResult = (fullPath: string): void => {
    if (withFileTypes) {
      if (!resultsSet.has(fullPath)) {
        resultsSet.add(fullPath);
        // Stat to determine type. This matches Node, which exposes Dirents for matches.
        let isDir = false, isSymlink = false;
        try {
          const s = statSync(syncRequest, fullPath);
          isDir = s.isDirectory();
          // statSync follows symlinks — our VFS lstat would distinguish, but we
          // keep it simple here.
        } catch { /* treat as file */ }
        const slash = fullPath.lastIndexOf('/');
        const parent = slash <= 0 ? '/' : fullPath.slice(0, slash);
        const name = fullPath.slice(slash + 1);
        const dirent = makeDirent(parent, name, isDir, isSymlink);
        if (exclude && exclude(dirent)) { resultsSet.delete(fullPath); return }
        resultsDirents.push(dirent);
      }
    } else {
      if (exclude && exclude(fullPath)) return;
      resultsSet.add(fullPath);
    }
  };

  function walk(dir: string, segments: string[], segIdx: number): void {
    if (segIdx >= segments.length) return;

    const seg = segments[segIdx];
    const isLast = segIdx === segments.length - 1;

    if (seg === '**') {
      // Match zero or more path segments.
      // Zero segments: try the next pattern segment in the same directory.
      if (segIdx + 1 < segments.length) {
        walk(dir, segments, segIdx + 1);
      } else {
        // Trailing `**` matches the directory itself too (Node behavior).
        pushResult(dir);
      }

      let entries: string[];
      try {
        entries = readdirSync(syncRequest, dir) as string[];
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = joinPath(dir, entry);
        let isDir: boolean;
        try {
          isDir = statSync(syncRequest, full).isDirectory();
        } catch { continue }

        if (isDir) {
          // Keep ** active at same segIdx
          walk(full, segments, segIdx);
        }

        // If ** is the last segment, everything underneath matches.
        if (isLast) pushResult(full);
      }
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(syncRequest, dir) as string[];
    } catch { return }

    const re = segmentToRegex(seg);
    for (const entry of entries) {
      if (!re.test(entry)) continue;
      const full = joinPath(dir, entry);

      if (isLast) {
        pushResult(full);
      } else {
        let isDir: boolean;
        try { isDir = statSync(syncRequest, full).isDirectory() }
        catch { continue }
        if (isDir) walk(full, segments, segIdx + 1);
      }
    }
  }

  for (const pat of patterns) {
    for (const expanded of expandBraces(pat)) {
      const segments = expanded.split('/').filter(s => s !== '');
      walk(cwd, segments, 0);
    }
  }

  return withFileTypes ? resultsDirents : Array.from(resultsSet);
}

// ============================================================================
// Async (also usable via `for await` as an async generator)
// ============================================================================

export async function glob(
  asyncRequest: AsyncRequestFn,
  pattern: string | string[],
  options?: GlobOptions,
): Promise<string[] | Dirent[]> {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const cwd = normalizeCwd(options?.cwd);
  const exclude = options?.exclude as ((arg: string | Dirent) => boolean) | undefined;
  const withFileTypes = options?.withFileTypes === true;

  const resultsSet = new Set<string>();
  const resultsDirents: Dirent[] = [];

  const pushResult = async (fullPath: string): Promise<void> => {
    if (withFileTypes) {
      if (resultsSet.has(fullPath)) return;
      resultsSet.add(fullPath);
      let isDir = false, isSymlink = false;
      try {
        const s = await stat(asyncRequest, fullPath);
        isDir = s.isDirectory();
      } catch { /* treat as file */ }
      const slash = fullPath.lastIndexOf('/');
      const parent = slash <= 0 ? '/' : fullPath.slice(0, slash);
      const name = fullPath.slice(slash + 1);
      const dirent = makeDirent(parent, name, isDir, isSymlink);
      if (exclude && exclude(dirent)) { resultsSet.delete(fullPath); return }
      resultsDirents.push(dirent);
    } else {
      if (exclude && exclude(fullPath)) return;
      resultsSet.add(fullPath);
    }
  };

  async function walk(dir: string, segments: string[], segIdx: number): Promise<void> {
    if (segIdx >= segments.length) return;

    const seg = segments[segIdx];
    const isLast = segIdx === segments.length - 1;

    if (seg === '**') {
      if (segIdx + 1 < segments.length) {
        await walk(dir, segments, segIdx + 1);
      } else {
        await pushResult(dir);
      }

      let entries: string[];
      try { entries = (await readdir(asyncRequest, dir)) as string[] }
      catch { return }

      for (const entry of entries) {
        const full = joinPath(dir, entry);
        let isDir: boolean;
        try { isDir = (await stat(asyncRequest, full)).isDirectory() }
        catch { continue }

        if (isDir) await walk(full, segments, segIdx);
        if (isLast) await pushResult(full);
      }
      return;
    }

    let entries: string[];
    try { entries = (await readdir(asyncRequest, dir)) as string[] }
    catch { return }

    const re = segmentToRegex(seg);
    for (const entry of entries) {
      if (!re.test(entry)) continue;
      const full = joinPath(dir, entry);
      if (isLast) {
        await pushResult(full);
      } else {
        let isDir: boolean;
        try { isDir = (await stat(asyncRequest, full)).isDirectory() }
        catch { continue }
        if (isDir) await walk(full, segments, segIdx + 1);
      }
    }
  }

  for (const pat of patterns) {
    for (const expanded of expandBraces(pat)) {
      const segments = expanded.split('/').filter(s => s !== '');
      await walk(cwd, segments, 0);
    }
  }

  return withFileTypes ? resultsDirents : Array.from(resultsSet);
}
