import type { GlobOptions, Dirent } from '../types.js';
import type { SyncRequestFn, AsyncRequestFn } from './context.js';
import { readdirSync, readdir } from './readdir.js';
import { Dirent as DirentClass } from '../stats-classes.js';
import { INODE_TYPE } from '../vfs/layout.js';
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


/**
 * Reduce a matched absolute path to what node would report.
 *
 * Node's results are **relative to `cwd`** unless the pattern was itself absolute — `glob('*.txt',
 * { cwd: '/src' })` yields `'a.txt'`, while `glob('/src/*.txt')` yields the full path. This
 * returned absolute paths in every case, so a caller joining the result onto `cwd` got
 * `/src//src/a.txt`.
 */
function toResultPath(fullPath: string, cwd: string, patternIsAbsolute: boolean): string {
  if (patternIsAbsolute) return fullPath;
  const base = cwd === '/' ? '/' : cwd.replace(/\/+$/, '') + '/';
  return fullPath.startsWith(base) ? fullPath.slice(base.length) : fullPath;
}

function normalizeCwd(cwd: string | URL | undefined): string {
  if (!cwd) return '/';
  if (typeof cwd === 'string') return cwd || '/';
  // URL — only file: supported
  return cwd.pathname || '/';
}

/**
 * `exclude` — both of node's forms, resolved to one predicate.
 *
 * The contract was read off a live `node:fs` rather than the docs, because the two forms differ:
 *
 *   • **function** — receives a `Dirent` when `withFileTypes: true`, and otherwise the entry's
 *     **basename**, not its path. That matters: `exclude: (n) => n === 'node_modules'` is the
 *     common usage and works in node. We passed the *absolute path*, so it matched nothing and
 *     every entry the caller asked to drop came back anyway.
 *   • **array of glob patterns** — matched against the path **relative to `cwd`**, so `'a/*'`
 *     drops that directory's children, `'*.js'` only top-level ones, and a bare `'drop.js'`
 *     drops nothing when the entry sits at `a/drop.js`. This form was not supported at all and
 *     threw.
 *
 * One deliberate difference, documented in the readme: node's *function* form fails to drop
 * **nested files** — `(n) => n.endsWith('.js')` removes `top.js` but leaves `a/drop.js`, while
 * its own pattern form removes both. Reproducing that would silently keep files the caller asked
 * to drop, so the predicate is applied at every depth here, as the docs describe.
 */
function resolveExclude(
  options: GlobOptions | undefined,
  cwd: string,
  patternIsAbsolute: boolean,
): ((fullPath: string, dirent: Dirent | null) => boolean) | undefined {
  const raw = options?.exclude;
  if (raw == null) return undefined;

  if (typeof raw === 'function') {
    const fn = raw as (arg: string | Dirent) => boolean;
    return (fullPath, dirent) => {
      if (dirent) return fn(dirent);
      const slash = fullPath.lastIndexOf('/');
      return fn(slash < 0 ? fullPath : fullPath.slice(slash + 1));
    };
  }

  // Pattern list: compiled once, matched against the cwd-relative path.
  const matchers = (Array.isArray(raw) ? raw : [raw as string])
    .flatMap((pat) => expandBraces(String(pat)))
    .map((pat) => pat.split('/').filter((seg) => seg.length > 0));

  return (fullPath) => {
    const rel = toResultPath(fullPath, cwd, patternIsAbsolute);
    const parts = rel.split('/').filter((seg) => seg.length > 0);
    return matchers.some((segments) => matchSegments(parts, 0, segments, 0));
  };
}

/**
 * Glob-match a split path against a split exclude pattern.
 *
 * `**` spans any number of segments *in the middle* — `'**\/*.js'` matches `top.js` with `**`
 * consuming none — but a **trailing** `**` requires at least one. Verified against node:
 * `exclude: ['skip/**']` drops `skip/inner.txt` and keeps `skip` itself, while
 * `exclude: ['skip']` drops both, because excluding a directory prunes its subtree.
 */
function matchSegments(parts: string[], pi: number, segs: string[], si: number): boolean {
  if (si >= segs.length) return pi >= parts.length;
  if (segs[si] === '**') {
    // Trailing `**`: consumes the rest, and there must be a rest.
    if (si === segs.length - 1) return pi < parts.length;
    for (let skip = pi; skip <= parts.length; skip++) {
      if (matchSegments(parts, skip, segs, si + 1)) return true;
    }
    return false;
  }
  if (pi >= parts.length) return false;
  if (!matchSegment(parts[pi], segs[si])) return false;
  return matchSegments(parts, pi + 1, segs, si + 1);
}

/**
 * Build a Dirent from a file path + parent dir + stat.
 *
 * The hand-written literal this replaced omitted `path` — node's deprecated alias of
 * `parentPath` — so a glob result was missing a property a readdir result had.
 */
function makeDirent(parentPath: string, name: string, isDir: boolean, isSymlink: boolean): Dirent {
  const type = isSymlink ? INODE_TYPE.SYMLINK : isDir ? INODE_TYPE.DIRECTORY : INODE_TYPE.FILE;
  return new DirentClass(name, type, parentPath);
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
  const withFileTypes = options?.withFileTypes === true;
  const patternIsAbsolute = patterns.every((p) => p.startsWith('/'));
  const excludeAt = resolveExclude(options, cwd, patternIsAbsolute);

  /**
   * Whether `exclude` rejects this entry. Consulted before descending as well as at match time:
   * excluding a **directory** prunes its whole subtree in node, so `(n) => n === 'node_modules'`
   * drops the directory *and* everything under it. Checking only at match time removed the
   * directory from the results and then walked into it anyway.
   */
  const blocked = (fullPath: string, isDir: boolean): boolean => {
    if (!excludeAt) return false;
    if (!withFileTypes) return excludeAt(fullPath, null);
    const slash = fullPath.lastIndexOf('/');
    const parent = slash <= 0 ? '/' : fullPath.slice(0, slash);
    return excludeAt(fullPath, makeDirent(parent, fullPath.slice(slash + 1), isDir, false));
  };

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
        if (excludeAt && excludeAt(fullPath, dirent)) { resultsSet.delete(fullPath); return }
        resultsDirents.push(dirent);
      }
    } else {
      if (excludeAt && excludeAt(fullPath, null)) return;
      resultsSet.add(toResultPath(fullPath, cwd, patternIsAbsolute));
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

        if (isDir && !blocked(full, true)) {
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
        if (isDir && !blocked(full, true)) walk(full, segments, segIdx + 1);
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
  const withFileTypes = options?.withFileTypes === true;
  const patternIsAbsolute = patterns.every((p) => p.startsWith('/'));
  const excludeAt = resolveExclude(options, cwd, patternIsAbsolute);

  /**
   * Whether `exclude` rejects this entry. Consulted before descending as well as at match time:
   * excluding a **directory** prunes its whole subtree in node, so `(n) => n === 'node_modules'`
   * drops the directory *and* everything under it. Checking only at match time removed the
   * directory from the results and then walked into it anyway.
   */
  const blocked = (fullPath: string, isDir: boolean): boolean => {
    if (!excludeAt) return false;
    if (!withFileTypes) return excludeAt(fullPath, null);
    const slash = fullPath.lastIndexOf('/');
    const parent = slash <= 0 ? '/' : fullPath.slice(0, slash);
    return excludeAt(fullPath, makeDirent(parent, fullPath.slice(slash + 1), isDir, false));
  };

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
      if (excludeAt && excludeAt(fullPath, dirent)) { resultsSet.delete(fullPath); return }
      resultsDirents.push(dirent);
    } else {
      if (excludeAt && excludeAt(fullPath, null)) return;
      resultsSet.add(toResultPath(fullPath, cwd, patternIsAbsolute));
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

        if (isDir && !blocked(full, true)) await walk(full, segments, segIdx);
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
        if (isDir && !blocked(full, true)) await walk(full, segments, segIdx + 1);
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
