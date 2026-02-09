/**
 * POSIX path utilities (browser-compatible).
 * No Node.js dependencies.
 */

export const sep = '/';
export const delimiter = ':';

export function normalize(p: string): string {
  if (p.length === 0) return '.';

  const isAbsolute = p.charCodeAt(0) === 47; // '/'
  const segments = p.split('/');
  const result: string[] = [];

  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop();
      } else if (!isAbsolute) {
        result.push('..');
      }
    } else {
      result.push(seg);
    }
  }

  let out = result.join('/');
  if (isAbsolute) out = '/' + out;
  return out || (isAbsolute ? '/' : '.');
}

export function join(...paths: string[]): string {
  return normalize(paths.filter(Boolean).join('/'));
}

export function resolve(...paths: string[]): string {
  let resolved = '';
  for (let i = paths.length - 1; i >= 0; i--) {
    const p = paths[i];
    if (!p) continue;
    resolved = p + (resolved ? '/' + resolved : '');
    if (p.charCodeAt(0) === 47) break; // absolute
  }
  return normalize(resolved || '/');
}

export function dirname(p: string): string {
  if (p.length === 0) return '.';
  const i = p.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return p.substring(0, i);
}

export function basename(p: string, ext?: string): string {
  let base = p;
  const i = p.lastIndexOf('/');
  if (i >= 0) base = p.substring(i + 1);
  if (ext && base.endsWith(ext)) {
    base = base.substring(0, base.length - ext.length);
  }
  return base;
}

export function extname(p: string): string {
  const base = basename(p);
  const i = base.lastIndexOf('.');
  if (i <= 0) return '';
  return base.substring(i);
}

export function isAbsolute(p: string): boolean {
  return p.length > 0 && p.charCodeAt(0) === 47;
}

export function relative(from: string, to: string): string {
  const fromParts = resolve(from).split('/').filter(Boolean);
  const toParts = resolve(to).split('/').filter(Boolean);

  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }

  const ups = fromParts.length - common;
  const result = [...Array(ups).fill('..'), ...toParts.slice(common)];
  return result.join('/') || '.';
}

export function parse(p: string): { root: string; dir: string; base: string; ext: string; name: string } {
  const dir = dirname(p);
  const base = basename(p);
  const ext = extname(p);
  const name = ext ? base.substring(0, base.length - ext.length) : base;
  const root = isAbsolute(p) ? '/' : '';
  return { root, dir, base, ext, name };
}

export function format(obj: { root?: string; dir?: string; base?: string; ext?: string; name?: string }): string {
  const dir = obj.dir || obj.root || '';
  const base = obj.base || ((obj.name || '') + (obj.ext || ''));
  return dir ? (dir === '/' ? '/' + base : dir + '/' + base) : base;
}
