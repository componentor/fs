/**
 * POSIX-style path utilities for OPFS
 * Mirrors Node.js path module behavior
 */

export const sep = '/';
export const delimiter = ':';

export function normalize(p: string): string {
  if (p.length === 0) return '.';

  const isAbsolute = p.charCodeAt(0) === 47; // '/'
  const trailingSlash = p.charCodeAt(p.length - 1) === 47;

  const segments = p.split('/');
  const result: string[] = [];

  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop();
      } else if (!isAbsolute) {
        result.push('..');
      }
    } else {
      result.push(segment);
    }
  }

  let normalized = result.join('/');

  if (isAbsolute) {
    normalized = '/' + normalized;
  }

  if (trailingSlash && normalized.length > 1) {
    normalized += '/';
  }

  return normalized || (isAbsolute ? '/' : '.');
}

export function join(...paths: string[]): string {
  if (paths.length === 0) return '.';

  let joined: string | undefined;

  for (const path of paths) {
    if (path.length > 0) {
      if (joined === undefined) {
        joined = path;
      } else {
        joined += '/' + path;
      }
    }
  }

  if (joined === undefined) return '.';

  return normalize(joined);
}

export function resolve(...paths: string[]): string {
  let resolvedPath = '';
  let resolvedAbsolute = false;

  for (let i = paths.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    const path = i >= 0 ? paths[i] : '/';

    if (path.length === 0) continue;

    resolvedPath = resolvedPath ? path + '/' + resolvedPath : path;
    resolvedAbsolute = path.charCodeAt(0) === 47; // '/'
  }

  resolvedPath = normalize(resolvedPath);

  // Remove trailing slash unless it's the root
  if (resolvedPath.length > 1 && resolvedPath.endsWith('/')) {
    resolvedPath = resolvedPath.slice(0, -1);
  }

  if (resolvedAbsolute) {
    return resolvedPath.length > 0 ? resolvedPath : '/';
  }

  return resolvedPath.length > 0 ? resolvedPath : '.';
}

export function isAbsolute(p: string): boolean {
  return p.length > 0 && p.charCodeAt(0) === 47; // '/'
}

export function dirname(p: string): string {
  if (p.length === 0) return '.';

  const hasRoot = p.charCodeAt(0) === 47;
  let end = -1;
  let matchedSlash = true;

  for (let i = p.length - 1; i >= 1; --i) {
    if (p.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }

  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) return '//';

  return p.slice(0, end);
}

export function basename(p: string, ext?: string): string {
  let start = 0;
  let end = -1;
  let matchedSlash = true;

  for (let i = p.length - 1; i >= 0; --i) {
    if (p.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }

  if (end === -1) return '';

  const base = p.slice(start, end);

  if (ext && base.endsWith(ext)) {
    return base.slice(0, base.length - ext.length);
  }

  return base;
}

export function extname(p: string): string {
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;

  for (let i = p.length - 1; i >= 0; --i) {
    const code = p.charCodeAt(i);

    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }

    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }

    if (code === 46) {
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return '';
  }

  return p.slice(startDot, end);
}

export function relative(from: string, to: string): string {
  if (from === to) return '';

  from = resolve(from);
  to = resolve(to);

  if (from === to) return '';

  // Split into segments
  const fromParts = from.split('/').filter(Boolean);
  const toParts = to.split('/').filter(Boolean);

  // Find common base
  let commonLength = 0;
  const minLength = Math.min(fromParts.length, toParts.length);
  for (let i = 0; i < minLength; i++) {
    if (fromParts[i] === toParts[i]) {
      commonLength++;
    } else {
      break;
    }
  }

  // Build relative path
  const upCount = fromParts.length - commonLength;
  const relativeParts: string[] = [];

  for (let i = 0; i < upCount; i++) {
    relativeParts.push('..');
  }

  for (let i = commonLength; i < toParts.length; i++) {
    relativeParts.push(toParts[i]);
  }

  return relativeParts.join('/') || '.';
}

export function parse(p: string): {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
} {
  const ret = { root: '', dir: '', base: '', ext: '', name: '' };

  if (p.length === 0) return ret;

  const isAbsolutePath = p.charCodeAt(0) === 47;

  if (isAbsolutePath) {
    ret.root = '/';
  }

  let start = 0;
  let end = -1;
  let startDot = -1;
  let matchedSlash = true;
  let preDotState = 0;

  for (let i = p.length - 1; i >= 0; --i) {
    const code = p.charCodeAt(i);

    if (code === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
      continue;
    }

    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }

    if (code === 46) {
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }

  if (end !== -1) {
    if (
      startDot === -1 ||
      preDotState === 0 ||
      (preDotState === 1 && startDot === end - 1 && startDot === start + 1)
    ) {
      ret.base = p.slice(start, end);
      ret.name = ret.base;
    } else {
      ret.name = p.slice(start, startDot);
      ret.base = p.slice(start, end);
      ret.ext = p.slice(startDot, end);
    }
  }

  if (start > 0) {
    ret.dir = p.slice(0, start - 1);
  } else if (isAbsolutePath) {
    ret.dir = '/';
  }

  return ret;
}

export function format(pathObject: {
  root?: string;
  dir?: string;
  base?: string;
  ext?: string;
  name?: string;
}): string {
  const dir = pathObject.dir || pathObject.root || '';
  const base = pathObject.base || (pathObject.name || '') + (pathObject.ext || '');

  if (!dir) return base;
  if (dir === pathObject.root) return dir + base;

  return dir + '/' + base;
}

export const posix = {
  sep,
  delimiter,
  normalize,
  join,
  resolve,
  isAbsolute,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
};

export default posix;
